/**
 * Electrical system: a real (DC, linear + piecewise) nodal-analysis circuit built from the vehicle state
 * every time it is evaluated. Multimeter readings, starter cranking speed, coil voltage, charging and
 * blown fuses all fall out of the same solution — nothing is scripted.
 */
import type { VehicleState } from './vehicle';
import { partIn, isOn, slotVars, specTorque } from './vehicle';
import { SLOTS } from '../data/slots';

export type NodeId =
  | 'B+' | 'B-' | 'T+' | 'T-' | 'CH' | 'ENG' | 'SOL' | 'MOT' | 'ALT' | 'IGN' | 'SW'
  | 'COIL+' | 'COIL-' | 'PUMP' | 'HORN' | 'FAN' | 'LAMPS' | 'WIPER' | 'CLOCK'
  | 'F1i' | 'F1o' | 'F2i' | 'F2o' | 'F3i' | 'F3o' | 'F4i' | 'F4o' | 'F5i' | 'F5o' | 'F6i' | 'F6o';

export interface ElecInputs {
  ignOn: boolean;
  starter: boolean;
  running: boolean;
  rpm: number;
  altCapacity: number;   // 0..1 belt grip
  fanOn: boolean;
  hornPressed?: boolean;
  lights?: boolean;
  pumpRunning?: boolean;
  /** measurement mode: inject 1 mA between two nodes instead of normal sources */
  ohmProbe?: [NodeId, NodeId];
}

interface Res { a: NodeId; b: NodeId; r: number; tag?: string }
interface Src { neg: NodeId; pos: NodeId; e: number; r: number; tag: string; imax?: number }

export interface ElecResult {
  V: Record<string, number>;
  battI: number;          // + = discharging
  motorV: number;
  motorI: number;
  solenoidEngaged: boolean;
  chatter: boolean;
  coilV: number;
  pumpV: number;
  fanV: number;
  altI: number;
  fuseI: number[];        // 1..6 currents (index 0 unused)
  live: boolean;
}

export const FUSE_CIRCUITS: { n: number; label: string; feed: 'permanent' | 'ignition'; loads: string }[] = [
  { n: 1, label: 'Horns', feed: 'permanent', loads: 'Horn relay & twin horns' },
  { n: 2, label: 'Side / tail / panel lamps', feed: 'permanent', loads: 'Side lamps, tail lamps, number plate, panel lights (via lighting switch)' },
  { n: 3, label: 'Ignition & fuel', feed: 'ignition', loads: 'Ignition coil, fuel pump, instruments' },
  { n: 4, label: 'Wipers & heater', feed: 'ignition', loads: 'Wiper motor, heater blower' },
  { n: 5, label: 'Cooling fan', feed: 'ignition', loads: 'Electric fan via thermostatic switch' },
  { n: 6, label: 'Clock & interior', feed: 'permanent', loads: 'Clock, interior lamp' },
];

/** Probe points the player can touch with meter/test-lamp probes (label + description). */
export const TEST_POINTS: Record<string, string> = {
  'B+': 'Battery positive post', 'B-': 'Battery negative post', 'T+': 'Positive terminal clamp', 'T-': 'Negative terminal clamp',
  CH: 'Body earth point', ENG: 'Engine block (earth)', SOL: 'Starter solenoid main terminal', ALT: 'Alternator output terminal',
  'COIL+': 'Coil SW (+) terminal', 'COIL-': 'Coil CB (–) terminal', IGN: 'Ignition switch output',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].flatMap((n) => [[`F${n}i`, `Fuse ${n} — supply side`], [`F${n}o`, `Fuse ${n} — load side`]])),
};

const GMIN = 1e-7;

function battery(v: VehicleState) {
  const p = partIn(v, 'elec.battery');
  if (!p) return null;
  const charge = Math.max(0, Math.min(1, p.vars.charge ?? 1));
  const health = Math.max(0.05, p.vars.health ?? 1);
  const e = 11.75 + 0.9 * charge;
  const r = 0.0095 / (health * (0.4 + 0.6 * charge));
  return { e, r, p };
}

/** Resistance of a battery clamp joint, or null if open. */
function clampR(v: VehicleState, slot: 'elec.term_pos' | 'elec.term_neg'): number | null {
  const s = v.slots[slot];
  const p = partIn(v, slot);
  if (!p || (s.vars.off ?? 0) > 0.5 || !partIn(v, 'elec.battery')) return null;
  const d = SLOTS[slot].thread!;
  const tight = s.turnsIn >= d.turns - 0.05 ? Math.min(1, s.torque / Math.max(0.1, specTorque(slot))) : 0;
  let r = 0.0006;
  if (p.flags.includes('corroded')) r += 0.034;
  if (tight < 0.5) r += 0.02 * (1 - tight) + (tight < 0.05 ? 0.25 : 0);
  return r;
}

function fuseOk(v: VehicleState, n: number): { ok: boolean; rating: number } {
  const p = partIn(v, `elec.fuse_${n}`);
  if (!p) return { ok: false, rating: 0 };
  return { ok: !p.flags.includes('blown'), rating: p.vars.rating ?? 35 };
}

function build(v: VehicleState, i: ElecInputs, solEngaged: boolean, altMode: 'v' | 'i' | 'off', altImax: number, charging = false) {
  const R: Res[] = [];
  const S: Src[] = [];
  const add = (a: NodeId, b: NodeId, r: number, tag?: string) => R.push({ a, b, r: Math.max(1e-5, r), tag });
  const bat = battery(v);
  // Lead-acid charge acceptance falls steeply as the battery fills: model as a higher resistance when charging.
  if (bat && !i.ohmProbe) S.push({ neg: 'B-', pos: 'B+', e: bat.e, r: charging ? bat.r + 0.45 * Math.pow(Math.max(0, Math.min(1, bat.p.vars.charge ?? 1)), 3) : bat.r, tag: 'bat' });
  else if (bat && i.ohmProbe) add('B-', 'B+', bat.r, 'bat'); // battery looks like a low resistance to an ohmmeter
  const cp = clampR(v, 'elec.term_pos'); if (cp != null) add('B+', 'T+', cp, 'clamp+');
  const cn = clampR(v, 'elec.term_neg'); if (cn != null) add('B-', 'T-', cn, 'clamp-');
  add('T+', 'SOL', 0.0012, 'mainCable');
  add('T-', 'CH', 0.0006, 'negStrap');
  const strap = partIn(v, 'elec.earth_strap');
  add('CH', 'ENG', strap ? (strap.flags.includes('corroded') ? 0.045 : 0.0006) : 50, 'engStrap');
  // Starter
  if (i.starter && i.ignOn) add('IGN', 'SW', 0.05, 'button');
  add('SW', 'ENG', 0.38, 'solWinding');
  if (solEngaged) { add('SOL', 'MOT', 0.0006, 'solContact'); add('MOT', 'ENG', 0.036, 'motor'); }
  // Charging
  add('ALT', 'SOL', 0.004, 'chargeCable');
  if (!i.ohmProbe && i.running && altMode !== 'off') {
    if (altMode === 'v') S.push({ neg: 'ENG', pos: 'ALT', e: 14.25, r: 0.04, tag: 'alt' });
    else S.push({ neg: 'ENG', pos: 'ALT', e: 0, r: 1e6, tag: 'altI', imax: altImax });
  }
  // Ignition switch
  if (i.ignOn) add('SOL', 'IGN', 0.025, 'ignSwitch');
  // Fuses & loads
  const fuse = (n: number, feed: NodeId) => {
    add(feed, `F${n}i` as NodeId, 0.01);
    const f = fuseOk(v, n);
    if (f.ok) add(`F${n}i` as NodeId, `F${n}o` as NodeId, 0.004, `fuse${n}`);
  };
  fuse(1, 'SOL'); fuse(2, 'SOL'); fuse(6, 'SOL');
  fuse(3, 'IGN'); fuse(4, 'IGN'); fuse(5, 'IGN');
  add('F1o', 'HORN', 0.05);
  if (i.hornPressed) add('HORN', 'CH', 1.2, 'horn');
  add('F2o', 'LAMPS', 0.05);
  if (i.lights) add('LAMPS', 'CH', 5.5, 'lamps');
  add('F3o', 'COIL+', 0.06);
  add('COIL+', 'COIL-', 3.1, 'coil');
  add('COIL-', 'ENG', 0.02, 'points'); // engine stopped with points closed
  add('F3o', 'PUMP', 0.08);
  add('PUMP', 'CH', i.pumpRunning ? 5.5 : 900, 'pump');
  add('F4o', 'WIPER', 0.05);
  add('F5o', 'FAN', 0.05);
  if (i.fanOn) add('FAN', 'CH', 1.25, 'fan');
  add('F6o', 'CLOCK', 0.05);
  add('CLOCK', 'CH', 220, 'clock');
  return { R, S };
}

const NODES: NodeId[] = ['B+', 'B-', 'T+', 'T-', 'CH', 'ENG', 'SOL', 'MOT', 'ALT', 'IGN', 'SW', 'COIL+', 'COIL-', 'PUMP', 'HORN', 'FAN', 'LAMPS', 'WIPER', 'CLOCK',
  'F1i', 'F1o', 'F2i', 'F2o', 'F3i', 'F3o', 'F4i', 'F4o', 'F5i', 'F5o', 'F6i', 'F6o'];
const IDX = Object.fromEntries(NODES.map((n, k) => [n, k])) as Record<NodeId, number>;

function solveNet(R: Res[], S: Src[], inject?: [NodeId, NodeId, number]) {
  const n = NODES.length;
  const ref = IDX['B-'];
  const G = Array.from({ length: n }, () => new Float64Array(n));
  const I = new Float64Array(n);
  const stamp = (a: number, b: number, g: number) => { G[a][a] += g; G[b][b] += g; G[a][b] -= g; G[b][a] -= g; };
  for (let k = 0; k < n; k++) G[k][k] += GMIN;
  for (const r of R) stamp(IDX[r.a], IDX[r.b], 1 / r.r);
  for (const s of S) {
    if (s.imax != null) { I[IDX[s.pos]] += s.imax; I[IDX[s.neg]] -= s.imax; continue; }
    const g = 1 / s.r;
    stamp(IDX[s.neg], IDX[s.pos], g);
    I[IDX[s.pos]] += s.e * g; I[IDX[s.neg]] -= s.e * g;
  }
  if (inject) { I[IDX[inject[0]]] += inject[2]; I[IDX[inject[1]]] -= inject[2]; }
  // Fix reference node
  for (let k = 0; k < n; k++) { G[ref][k] = 0; }
  G[ref][ref] = 1; I[ref] = 0;
  // Gaussian elimination with partial pivoting
  const A = G.map((row) => Array.from(row));
  const b = Array.from(I);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
    const d = A[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / d;
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / (A[r][r] || 1e-12);
  }
  const V: Record<string, number> = {};
  NODES.forEach((nd, k) => (V[nd] = x[k]));
  return V;
}

const cur = (V: Record<string, number>, r: Res | undefined) => (r ? (V[r.a] - V[r.b]) / r.r : 0);

export function evaluate(v: VehicleState, i: ElecInputs, prevEngaged = false): ElecResult {
  // Alternator output capability rises with alternator speed (pulley ratio ≈ 2:1), limited by belt grip.
  const altRpm = i.rpm * 2.05 * i.altCapacity;
  const altImax = Math.max(0, Math.min(43, (altRpm - 1100) / 4800 * 43));
  let altMode: 'v' | 'i' | 'off' = i.running && altImax > 0.5 ? 'v' : 'off';
  let engaged = false;
  let chatter = false;
  let charging = false;
  let V: Record<string, number> = {};
  let net = build(v, i, false, altMode, altImax);
  // Iterate: solenoid pull-in/hold hysteresis, alternator current limit / diode, battery charge acceptance.
  for (let it = 0; it < 8; it++) {
    net = build(v, i, engaged, altMode, altImax, charging);
    V = solveNet(net.R, net.S);
    const bs = net.S.find((x) => x.tag === 'bat');
    if (bs && !charging && (bs.e - (V['B+'] - V['B-'])) / bs.r < -0.05) { charging = true; continue; }
    const vsw = V['SW'] - V['ENG'];
    if (!engaged && !chatter && i.starter && vsw > (prevEngaged ? 5.8 : 7.6)) { engaged = true; continue; }
    if (engaged && vsw < 5.8) { engaged = false; chatter = true; continue; }
    if (altMode === 'v') {
      const altI = (14.25 - (V['ALT'] - V['ENG'])) / 0.04;
      if (altI > altImax) { altMode = 'i'; continue; }
      if (altI < 0) { altMode = 'off'; continue; }
    }
    break;
  }
  const find = (tag: string) => net.R.find((r) => r.tag === tag);
  const batSrc = net.S.find((s) => s.tag === 'bat');
  const battI = batSrc ? (batSrc.e - (V['B+'] - V['B-'])) / batSrc.r : 0;
  let altI = 0;
  const alt = net.S.find((s) => s.tag === 'alt' || s.tag === 'altI');
  if (alt?.tag === 'alt') altI = (14.25 - (V['ALT'] - V['ENG'])) / 0.04;
  else if (alt) altI = alt.imax ?? 0;
  const fuseI = [0, 1, 2, 3, 4, 5, 6].map((n) => (n ? Math.abs(cur(V, find(`fuse${n}`))) : 0));
  return {
    V, battI, chatter,
    motorV: engaged ? V['MOT'] - V['ENG'] : 0,
    motorI: engaged ? cur(V, find('motor')) : 0,
    solenoidEngaged: engaged,
    coilV: V['COIL+'] - V['COIL-'],
    pumpV: V['PUMP'] - V['CH'],
    fanV: V['FAN'] - V['CH'],
    altI, fuseI, live: !!batSrc,
  };
}

/** Multimeter DC volts between red and black probes. */
export function meterVolts(v: VehicleState, i: ElecInputs, red: NodeId, black: NodeId): number {
  const r = evaluate(v, i);
  return r.V[red] - r.V[black];
}

/** Ohmmeter: valid only on a de-energised circuit. Returns NaN for "live circuit" and Infinity for OL. */
export function meterOhms(v: VehicleState, i: ElecInputs, red: NodeId, black: NodeId): number {
  // The circuit is energised only when the battery is fully connected (or the engine is charging).
  const energised = (clampR(v, 'elec.term_pos') != null && clampR(v, 'elec.term_neg') != null) || i.running;
  if (energised) {
    const live = evaluate(v, i);
    if (Math.abs(live.V[red] - live.V[black]) > 0.05) return NaN;
  }
  const net = build(v, { ...i, ohmProbe: [red, black], running: false, starter: false }, false, 'off', 0);
  const V = solveNet(net.R, [], [red, black, 0.001]);
  const ohms = (V[red] - V[black]) / 0.001;
  return ohms > 2e6 ? Infinity : ohms;
}

/** Test lamp (5 W) between probe and earth: lights if the point can source current. */
export function testLamp(v: VehicleState, i: ElecInputs, probe: NodeId, earth: NodeId = 'CH'): number {
  const live = evaluate(v, i);
  if (!live.live) return 0;
  const net = build(v, i, live.solenoidEngaged, i.running ? 'v' : 'off', 40);
  net.R.push({ a: probe, b: earth, r: 28.8, tag: 'lamp' });
  const V = solveNet(net.R, net.S);
  return Math.max(0, Math.min(1, (V[probe] - V[earth]) / 12));
}

/** Applies battery charge/discharge and fuse blowing for a game-time step (seconds). */
export function applyElectrical(v: VehicleState, r: ElecResult, dtGame: number, onFuseBlow?: (n: number) => void) {
  const bat = partIn(v, 'elec.battery');
  if (bat && r.live) {
    const capAh = 60 * Math.max(0.1, bat.vars.health ?? 1);
    const eff = r.battI < 0 ? 0.85 : 1;
    bat.vars.charge = Math.max(0, Math.min(1, (bat.vars.charge ?? 1) - (r.battI * eff * dtGame) / 3600 / capAh));
  }
  for (let n = 1; n <= 6; n++) {
    const f = partIn(v, `elec.fuse_${n}`);
    if (f && !f.flags.includes('blown') && r.fuseI[n] > (f.vars.rating ?? 35) * 1.6) {
      f.flags.push('blown');
      onFuseBlow?.(n);
    }
  }
}

export function elecInputsFrom(v: VehicleState): ElecInputs {
  const belt = partIn(v, 'eng.fan_belt');
  const defl = belt?.vars.deflection ?? 12;
  const grip = belt ? Math.max(0, Math.min(1, 1 - Math.max(0, defl - 14) / 16)) * (belt.flags.includes('glazed') ? 0.8 : 1) : 0;
  return {
    ignOn: isOn(v, 'int.ignition'),
    starter: (slotVars(v, 'int.starter_button').pressed ?? 0) > 0.5,
    running: v.engine.running,
    rpm: v.engine.rpm,
    altCapacity: grip,
    fanOn: v.engine.fanOn,
    pumpRunning: isOn(v, 'int.ignition') && v.engine.fuelBowls < 0.999,
  };
}
