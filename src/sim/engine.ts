/**
 * Engine, lubrication, cooling and charging simulation. Symptoms emerge from component state:
 * nothing here knows which "fault" a scenario applied.
 *
 * dtReal drives fast dynamics (cranking, rpm). dtGame (= dtReal × time scale) drives thermal,
 * electrical charge and fluid flows.
 */
import type { VehicleState } from './vehicle';
import { partIn, isOn, isFitted, slotVars, sumpOil, specTorque, OIL_MAX, COOLANT_FULL } from './vehicle';
import { evaluate, applyElectrical, elecInputsFrom, type ElecResult } from './electrical';
import { addFluid, removeFluid, total, viscosity, compatibility, type Composition } from '../data/fluids';
import { SLOTS } from '../data/slots';
import { TDC_COMP } from '../data/layout';
import { clamp } from '../core/units';

export type Outflow = { at: 'drain' | 'filter' | 'hose' | 'cap' | 'engine'; comp: Composition };
export type EngineEvent = 'start' | 'stall' | 'backfire' | 'click' | 'crank' | 'catch' | 'fuse' | 'steam' | 'knock' | 'shock';

export interface SimOut {
  elec: ElecResult;
  outflows: Outflow[];
  events: EngineEvent[];
  sparks: number[];        // per cylinder spark quality 1..6
  firing: boolean[];       // per cylinder
  lambda: number;
  crankRpm: number;
  leaks: { at: string; rate: number }[]; // litres/s game, for visual drips
  messages: string[];
}

const ROOM_C = 18;

/** Per-cylinder ignition analysis (used by sim and by the diagnostics/debrief report). */
export function ignitionAnalysis(v: VehicleState, coilV: number) {
  const coil = clamp((coilV - 4.5) / 4.2, 0, 1);
  const cap = partIn(v, 'ign.dist_cap');
  const rotor = partIn(v, 'ign.rotor');
  const distOk = !!cap && !!rotor && isFitted(v, 'ign.dist_cap');
  const sparks = [0, 0, 0, 0, 0, 0, 0];
  const wrongTiming = [false, false, false, false, false, false, false];
  const notes: string[] = [];
  for (let lead = 1; lead <= 6; lead++) {
    const ls = v.slots[`ign.lead_${lead}`];
    if (!ls.part || (ls.vars.off ?? 0) > 0.5) continue;
    const target = ls.vars.target ?? lead;
    const plugSlot = `ign.plug_${target}`;
    const plug = partIn(v, plugSlot);
    if (!plug) continue;
    let q = coil * (distOk ? 1 : 0);
    if (cap?.flags.includes('cracked')) q *= 0.5;
    const gap = plug.vars.gap ?? 0.64;
    const gapF = gap < 0.3 ? 0.45 : gap > 1.15 ? 0.4 : gap > 0.9 ? 0.85 : 1;
    q *= gapF * (1 - clamp(plug.vars.fouling ?? 0, 0, 1) * 0.92) * (1 - clamp((plug.vars.oily ?? 0) - 0.4, 0, 1));
    if (plug.def === 'plug_l82y') q *= 0.35;
    if (plug.flags.includes('cracked')) q = 0;
    sparks[target] = Math.max(sparks[target], q);
    if (target !== lead) wrongTiming[target] = true;
  }
  if (!distOk) notes.push('Distributor cap/rotor missing');
  return { sparks, wrongTiming, notes, coil, distOk };
}

export function oilPressure(v: VehicleState, rpm: number): number {
  if (rpm < 30) return 0;
  const running = sumpOil(v) - v.oil.gallery - Math.max(0, 0.55 - v.oil.canister) * 0;
  const pickup = clamp((running - 2.4) / 1.2, 0, 1);
  const visc = viscosity(v.oil.comp, v.oil.tempC) || 0.1;
  const bearing = 1 + v.engine.bearingDamage * 2.5;
  const filterOpen = v.slots['lub.filter_seal'].part ? 1 : 0.15;
  const p = 18.5 * Math.pow(rpm / 1000, 0.7) * Math.sqrt(visc) / bearing * pickup * filterOpen;
  return clamp(p, 0, 62);
}

/** Static leak rates (L/s, game time) from the oil and cooling systems given current state. */
function leakRates(v: VehicleState) {
  const L: { at: string; rate: number; circuit: 'oil' | 'coolant' }[] = [];
  const e = v.engine;
  const ds = v.slots['lub.drain_plug'];
  if (ds.part) {
    const th = SLOTS['lub.drain_plug'].thread!;
    if (ds.turnsIn < th.turns - 0.05) {
      if (ds.turnsIn < 1.2) L.push({ at: 'drain', rate: 0.004 * (1.2 - ds.turnsIn) / 1.2 + 0.0006, circuit: 'oil' });
      else L.push({ at: 'drain', rate: 0.0003, circuit: 'oil' });
    } else {
      const washer = partIn(v, 'lub.drain_washer');
      let r = 0;
      if (!washer) r += 0.0007;
      else if (washer.flags.includes('crushed')) r += 0.00003;
      const tq = ds.torque / specTorque('lub.drain_plug');
      if (tq < 0.5) r += 0.00025 * (1 - tq);
      if (ds.threadDamage >= 1) r += 0.0015;
      if (r > 0) L.push({ at: 'drain', rate: r, circuit: 'oil' });
    }
  }
  if (e.running && e.oilPressure > 2) {
    const pf = e.oilPressure / 40;
    const can = v.slots['lub.filter_canister'];
    const seal = partIn(v, 'lub.filter_seal');
    const bolt = v.slots['lub.filter_bolt'];
    if (can.part) {
      let r = 0;
      if (!seal) r += 0.06;
      else if (seal.flags.includes('hardened')) r += 0.0005;
      const bt = bolt.part ? bolt.torque / specTorque('lub.filter_bolt') : 0;
      if (!bolt.part || bolt.turnsIn < SLOTS['lub.filter_bolt'].thread!.turns - 0.05) r += 0.08;
      else if (bt < 0.5) r += 0.003 * (1 - bt);
      if (bolt.threadDamage >= 1) r += 0.004;
      if (r > 0) L.push({ at: 'filter', rate: r * pf, circuit: 'oil' });
    }
    if (!v.slots['lub.filler_cap'].part || !isFitted(v, 'lub.filler_cap')) L.push({ at: 'engine', rate: 0.0012 * (e.rpm / 1000), circuit: 'oil' });
  }
  // Coolant: a worm clip below torque weeps; pressurised (hot) it runs
  const pressurised = e.coolantC > 75 && v.slots['cool.header_cap'].part && isFitted(v, 'cool.header_cap');
  for (const k of ['cool.clip_rad', 'cool.clip_pump']) {
    const s = v.slots[k];
    const th = SLOTS[k].thread!;
    const tight = s.part && s.turnsIn >= th.turns - 0.05 ? s.torque / specTorque(k) : 0;
    let r = 0;
    if (!s.part || tight < 0.05) r = 0.004;
    else if (tight < 0.45) r = 0.00006 + (pressurised ? 0.0016 * (1 - tight) : 0);
    const hose = partIn(v, 'cool.bottom_hose');
    if (hose?.flags.includes('damaged')) r += pressurised ? 0.0009 : 0.00005;
    if (r > 0) L.push({ at: 'hose', rate: r, circuit: 'coolant' });
  }
  return L;
}

export function simulate(v: VehicleState, dtReal: number, timeScale: number, prevEngaged: boolean): SimOut {
  const dtG = dtReal * timeScale;
  const e = v.engine;
  const out: SimOut = { elec: null as any, outflows: [], events: [], sparks: [], firing: [], lambda: 1, crankRpm: 0, leaks: [], messages: [] };
  const ignOn = isOn(v, 'int.ignition');
  const starter = (slotVars(v, 'int.starter_button').pressed ?? 0) > 0.5;

  // ── Electrical ──
  const ei = elecInputsFrom(v);
  const elec = evaluate(v, ei, prevEngaged);
  out.elec = elec;
  applyElectrical(v, elec, dtG, () => out.events.push('fuse'));
  if (elec.chatter && starter) out.events.push('click');

  // ── Fuel delivery: immersed pump fills float chambers when it gets voltage ──
  if (elec.pumpV > 8 && v.fuelL > 0.5) e.fuelBowls = Math.min(1, e.fuelBowls + dtReal * 0.35);
  if (e.running) e.fuelBowls = Math.max(0, e.fuelBowls - dtReal * (elec.pumpV > 8 && v.fuelL > 0.5 ? 0 : 0.04));

  // ── Ignition & mixture ──
  const ign = ignitionAnalysis(v, ignOn ? elec.coilV + (e.running ? 0 : 0) : 0);
  out.sparks = ign.sparks.slice(1);
  const cold = clamp((60 - e.coolantC) / 45, 0, 1);
  const choke = isOn(v, 'int.choke');
  const airEl = partIn(v, 'fuel.air_element');
  const airClog = airEl ? (airEl.vars.clog ?? 0) : 0;
  let lambda = 1.0 - (choke ? 0.32 : 0) + cold * 0.22 - airClog * 0.15 + (airEl ? 0 : 0.04);
  if (e.fuelBowls < 0.15) lambda = 2.5;
  out.lambda = lambda;
  const mixOk = lambda > 0.62 && lambda < 1.45;
  const mixEff = mixOk ? 1 - Math.min(0.5, Math.abs(lambda - 0.95) * 0.9) : 0;

  // compression: plug must be seated to seal
  const comp = [0, 1, 2, 3, 4, 5, 6].map((c) => (c === 0 ? 0 : (isFitted(v, `ign.plug_${c}`) && v.slots[`ign.plug_${c}`].threadDamage < 1 ? 1 : 0.15)));

  // ── Cranking ──
  const visc = viscosity(v.oil.comp, v.oil.tempC) || 1;
  e.cranking = elec.solenoidEngaged && !e.running;
  if (e.cranking) {
    const friction = 1 / (0.75 + 0.06 * visc);
    out.crankRpm = clamp((elec.motorV - 4.6) * 52 * friction, 0, 280);
    e.crankTime += dtReal;
    if (Math.random() < dtReal * 4) out.events.push('crank');
  } else if (!e.running) {
    e.crankTime = Math.max(0, e.crankTime - dtReal * 0.5);
  }

  const firing: boolean[] = [];
  let firingN = 0, power = 0;
  for (let c = 1; c <= 6; c++) {
    const ok = ign.sparks[c] > 0.35 && comp[c] > 0.5 && mixOk && !ign.wrongTiming[c];
    firing.push(ok);
    if (ok) { firingN++; power += ign.sparks[c] * comp[c] * mixEff; }
    if (ign.wrongTiming[c] && ign.sparks[c] > 0.35 && (e.running || e.cranking) && Math.random() < dtReal * 1.2) out.events.push('backfire');
  }
  out.firing = firing;
  e.misfire = firing.map((f) => (f ? 0 : 1));

  // ── Starting ──
  if (!e.running && e.cranking && ignOn) {
    const need = 0.7 + cold * (choke ? 0.9 : 3.5) + (lambda > 1.3 ? 3 : 0);
    if (out.crankRpm > 65 && firingN >= 3 && power > 1.6 && e.crankTime > need) {
      e.running = true;
      e.rpm = 450;
      e.stallTimer = 0;
      e.ranSinceService = true;
      out.events.push('start');
    } else if (out.crankRpm > 65 && firingN > 0 && Math.random() < dtReal * 2) out.events.push('catch');
  }
  if (!e.running) e.rpm = Math.max(out.crankRpm, e.rpm - dtReal * 900);

  // ── Running ──
  if (e.running) {
    const throttle = e.throttle;
    let target = 700 + cold * (choke ? 450 : -120) + throttle * 4600;
    if (choke && cold < 0.15) target += 150; // choke left on hot: rich, lumpy fast idle
    const frac = firingN / 6;
    target *= Math.pow(frac, 1.6) * (0.6 + 0.4 * mixEff);
    e.rpm += (target - e.rpm) * clamp(dtReal * 2.5, 0, 1);
    e.roughness = clamp((6 - firingN) / 4 + Math.abs(lambda - 0.95) * 0.8 + (choke && cold < 0.15 ? 0.25 : 0), 0, 1);
    if (!ignOn || firingN <= 2 || e.fuelBowls < 0.1 || e.rpm < 280) {
      e.stallTimer += dtReal;
      if (!ignOn || e.stallTimer > 0.6) {
        e.running = false;
        e.sinceStop = 0;
        out.events.push('stall');
      }
    } else e.stallTimer = 0;
    v.fuelL = Math.max(0, v.fuelL - dtG * (0.0004 + e.rpm * 2.5e-7));
    v.odometer += 0;
  } else {
    e.roughness = 0;
    e.sinceStop += dtG;
  }
  e.crankAngle = (e.crankAngle + e.rpm * 6 * dtReal) % 720;

  // ── Lubrication ──
  e.oilPressure = oilPressure(v, e.rpm);
  const sump = sumpOil(v);
  if (e.running || e.cranking) {
    if (v.slots['lub.filter_canister'].part && v.slots['lub.filter_element'].part && v.oil.canister < 0.55) {
      const mv = Math.min(0.55 - v.oil.canister, dtG * 0.06, Math.max(0, sump - 1));
      const moved = removeFluid(v.oil.comp, mv); v.oil.canister += total(moved);
    }
    if (v.oil.gallery < 0.45) {
      const mv = Math.min(0.45 - v.oil.gallery, dtG * 0.2, Math.max(0, sump - 1));
      removeFluid(v.oil.comp, mv); v.oil.gallery += mv;
    }
    if (e.running && e.oilPressure < 6) {
      e.bearingDamage = Math.min(1, e.bearingDamage + dtG * (e.rpm / 1000) * 0.0012);
      if (Math.random() < dtReal * e.bearingDamage * 3) out.events.push('knock');
    }
    const compat = compatibility('engineOil', v.oil.comp);
    if (e.running && compat.wrongFrac > 0.25) e.bearingDamage = Math.min(1, e.bearingDamage + dtG * compat.wrongFrac * 0.00008);
  } else if (v.oil.gallery > 0) {
    const back = Math.min(v.oil.gallery, dtG * 0.0028);
    v.oil.gallery -= back;
    addFluid(v.oil.comp, (Object.keys(v.oil.comp)[0] as any) ?? 'oil_20w50', back);
  }
  if (sump > OIL_MAX + 0.6 && e.running && e.rpm > 1500) e.smoke.blue = Math.max(e.smoke.blue, 0.4);

  // Draining through an open drain plug hole
  const ds = v.slots['lub.drain_plug'];
  if (!ds.part) {
    const fluid = 1 / Math.sqrt(Math.max(0.3, viscosity(v.oil.comp, v.oil.tempC)));
    const q = Math.min(Math.max(0, sumpOil(v) - 0.18), dtG * 0.022 * Math.sqrt(Math.max(0, sumpOil(v))) * fluid);
    if (q > 0) out.outflows.push({ at: 'drain', comp: removeFluid(v.oil.comp, q) });
    if (e.running) e.bearingDamage = Math.min(1, e.bearingDamage + dtG * 0.002);
  }

  // Leaks
  for (const l of leakRates(v)) {
    out.leaks.push({ at: l.at, rate: l.rate });
    if (l.circuit === 'oil') {
      const q = Math.min(l.rate * dtG, sumpOil(v));
      if (q > 0) {
        if (l.at === 'engine') { v.oil.oilOnEngine += q; removeFluid(v.oil.comp, q); }
        else out.outflows.push({ at: l.at as Outflow['at'], comp: removeFluid(v.oil.comp, q) });
      }
    } else {
      const q = Math.min(l.rate * dtG, total(v.coolant.comp));
      if (q > 0) out.outflows.push({ at: 'hose', comp: removeFluid(v.coolant.comp, q) });
    }
  }

  // ── Cooling ──
  const coolL = total(v.coolant.comp);
  const level = coolL / COOLANT_FULL;
  const levelF = Math.pow(clamp((level - 0.62) / 0.3, 0, 1), 2.2);
  const belt = partIn(v, 'eng.fan_belt');
  const beltGrip = ei.altCapacity;
  const pump = belt ? clamp(0.35 + 0.65 * beltGrip, 0, 1) * clamp(e.rpm / 600, 0, 1.6) : 0;
  const T = e.coolantC;
  const thermo = clamp((T - 74) / 10, 0, 1);
  const fanWorks = elec.fanV > 9;
  if (!e.fanOn && T > 88 && ignOn) e.fanOn = true;
  if (e.fanOn && (T < 82 || !ignOn)) e.fanOn = false;
  const heatIn = e.running ? 3.2 + (e.rpm / 1000) * 4.2 + (lambda > 1.15 ? 1.5 : 0) : 0;
  const radiator = thermo * (fanWorks && e.fanOn ? 16 : 6.5) * Math.min(1, pump) * levelF + thermo * 0.8;
  const passive = (T - ROOM_C) * 0.035;
  const C = 40 + coolL * 1.5;
  e.coolantC += ((heatIn - radiator - passive) / C) * dtG;
  e.coolantC = Math.max(ROOM_C - 2, e.coolantC);
  v.oil.tempC += (Math.max(ROOM_C, e.coolantC - 4) - v.oil.tempC) * clamp(dtG * 0.004, 0, 1);
  if (e.coolantC > 107) {
    e.smoke.steam = clamp((e.coolantC - 107) / 8, 0, 1);
    if (isFitted(v, 'cool.header_cap')) {
      const q = Math.min(coolL, dtG * 0.004 * e.smoke.steam);
      out.outflows.push({ at: 'cap', comp: removeFluid(v.coolant.comp, q) });
    }
    if (Math.random() < dtReal * 0.5) out.events.push('steam');
    if (e.coolantC > 122) e.headGasketDamage = Math.min(1, e.headGasketDamage + dtG * 0.0015);
  } else e.smoke.steam = Math.max(0, e.smoke.steam - dtReal * 0.3);

  // Smoke
  e.smoke.black = e.running ? clamp((0.82 - lambda) * 3, 0, 1) : 0;
  e.smoke.white = e.running ? clamp(cold * 0.4 + e.headGasketDamage, 0, 1) : 0;
  const burnOff = v.oil.oilOnEngine > 0.01 && e.coolantC > 60;
  e.smoke.blue = e.running ? Math.max(clamp(e.bearingDamage * 0.3 + (burnOff ? 0.5 : 0), 0, 1), e.smoke.blue * 0.98) : 0;
  if (burnOff) v.oil.oilOnEngine = Math.max(0, v.oil.oilOnEngine - dtG * 0.00002);

  // Charging voltage seen at the battery
  e.chargeV = elec.V['B+'] - elec.V['B-'];
  return out;
}
