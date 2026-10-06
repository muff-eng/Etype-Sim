/**
 * Diagnostic faults. A fault only changes component state; every symptom the player observes
 * is produced by the simulation from that state. resolved() checks the physical state, not a flag.
 */
import type { SystemId } from '../sim/types';
import type { VehicleState } from '../sim/vehicle';
import { partIn, sumpOil, OIL_MIN, OIL_MAX, COOLANT_FULL, isFitted } from '../sim/vehicle';
import { torqueVerdict } from '../sim/threads';
import { bearingClearance } from './parts';
import { ENGINE_CONNECTIONS } from './slots';
import { connected, engineInCar } from '../sim/vehicle';
import { total, compatibility, freshness } from './fluids';
import { CORNERS } from '../sim/types';

export interface FaultDef {
  id: string;
  name: string;
  system: SystemId;
  diagnosis: string | null;      // matching notebook diagnosis id
  cause: string;                 // debrief explanation
  tests: string[];               // test tags that constitute relevant evidence
  apply(v: VehicleState): void;
  resolved(v: VehicleState): boolean;
}

export const DIAGNOSES: { id: string; system: SystemId; label: string }[] = [
  { id: 'corroded_terminal', system: 'electrical', label: 'High-resistance (corroded/loose) battery terminal' },
  { id: 'flat_battery', system: 'electrical', label: 'Discharged battery (battery itself healthy)' },
  { id: 'failed_battery', system: 'electrical', label: 'Failed battery (will not hold charge)' },
  { id: 'starter_motor', system: 'electrical', label: 'Faulty starter motor / solenoid' },
  { id: 'earth_strap', system: 'electrical', label: 'Poor engine earth strap' },
  { id: 'slack_belt', system: 'electrical', label: 'Slipping fan/alternator belt' },
  { id: 'alternator', system: 'electrical', label: 'Faulty alternator' },
  { id: 'regulator', system: 'electrical', label: 'Faulty voltage regulator' },
  { id: 'blown_fuse', system: 'electrical', label: 'Blown fuse' },
  { id: 'horn_unit', system: 'electrical', label: 'Faulty horn / horn relay' },
  { id: 'wiring', system: 'electrical', label: 'Wiring fault (open circuit)' },
  { id: 'fouled_plug', system: 'ignition', label: 'Fouled / worn spark plug(s)' },
  { id: 'ht_lead', system: 'ignition', label: 'Faulty or misrouted HT lead' },
  { id: 'dist_cap', system: 'ignition', label: 'Cracked distributor cap / rotor' },
  { id: 'coil', system: 'ignition', label: 'Weak ignition coil' },
  { id: 'carb_mixture', system: 'fuel', label: 'Carburettor mixture / synchronisation' },
  { id: 'vacuum_leak', system: 'fuel', label: 'Induction (vacuum) leak' },
  { id: 'loose_hose_clip', system: 'cooling', label: 'Coolant leak at a loose hose clip' },
  { id: 'thermostat', system: 'cooling', label: 'Thermostat stuck closed' },
  { id: 'water_pump', system: 'cooling', label: 'Failed water pump' },
  { id: 'radiator', system: 'cooling', label: 'Blocked radiator' },
  { id: 'head_gasket', system: 'cooling', label: 'Head gasket failure' },
  { id: 'worn_bearings', system: 'engine', label: 'Worn crankshaft main / big-end bearings' },
  { id: 'piston_slap', system: 'engine', label: 'Worn pistons / bores (piston slap)' },
  { id: 'oil_pump', system: 'lubrication', label: 'Worn oil pump' },
  { id: 'fan', system: 'cooling', label: 'Cooling fan / fan switch fault' },
  { id: 'puncture', system: 'wheels', label: 'Punctured tyre (slow leak)' },
  { id: 'tyre_pressures', system: 'wheels', label: 'Incorrect tyre pressures only' },
  { id: 'alignment', system: 'steering', label: 'Wheel alignment' },
  { id: 'brake_drag', system: 'brakes', label: 'Sticking brake caliper' },
];

const plugsGood = (v: VehicleState) => [1, 2, 3, 4, 5, 6].every((c) => {
  const p = partIn(v, `ign.plug_${c}`);
  return p && p.def === 'plug_n5' && (p.vars.fouling ?? 0) < 0.3 && (p.vars.gap ?? 0) >= 0.58 && (p.vars.gap ?? 0) <= 0.72 && !p.flags.includes('cracked')
    && torqueVerdict(v, `ign.plug_${c}`) === 'correct' && (v.slots[`ign.lead_${c}`].vars.off ?? 0) < 0.5 && (v.slots[`ign.lead_${c}`].vars.target ?? c) === c;
});

export const FAULTS: Record<string, FaultDef> = {
  oil_service_due: {
    id: 'oil_service_due', name: 'Engine oil & filter overdue', system: 'lubrication', diagnosis: null,
    cause: 'The oil had covered well over its interval: dark, thinned and slightly low. The filter element was loaded, its sealing ring had taken a set, and the drain washer had been reused.',
    tests: ['dipstick', 'inspect.lub.filter_element', 'inspect.lub.drain_washer'],
    apply: (v) => {
      v.oil.comp = { oil_20w50_used: 7.25 };
      const el = partIn(v, 'lub.filter_element'); if (el) el.vars.clog = 0.7;
      const seal = partIn(v, 'lub.filter_seal'); if (seal) seal.flags.push('hardened');
      const w = partIn(v, 'lub.drain_washer'); if (w) w.flags.push('crushed');
      const dp = partIn(v, 'lub.drain_plug'); if (dp) dp.vars.metal = 0.15;
    },
    resolved: (v) => {
      const s = sumpOil(v) + v.oil.gallery + v.oil.canister - 0.55;
      const el = partIn(v, 'lub.filter_element');
      const seal = partIn(v, 'lub.filter_seal');
      const w = partIn(v, 'lub.drain_washer');
      return freshness(v.oil.comp) > 0.85 && s >= OIL_MIN && s <= OIL_MAX + 0.35 && compatibility('engineOil', v.oil.comp).wrongFrac < 0.05
        && !!el && (el.vars.clog ?? 1) < 0.1 && !!seal && !seal.flags.includes('hardened') && !!w && !w.flags.includes('crushed')
        && torqueVerdict(v, 'lub.drain_plug') === 'correct' && torqueVerdict(v, 'lub.filter_bolt') === 'correct' && isFitted(v, 'lub.filler_cap');
    },
  },
  batt_terminal: {
    id: 'batt_terminal', name: 'Corroded positive battery terminal + partially discharged battery', system: 'electrical', diagnosis: 'corroded_terminal',
    cause: 'Sulphate corrosion between the positive clamp and post added ≈ 0.035 Ω to the starter circuit. Under a 200 A cranking load that drops several volts: the starter turned slowly, the coil starved, and repeated attempts drained the battery further.',
    tests: ['volts.rest', 'volts.crank', 'volts.drop+', 'inspect.elec.term_pos', 'load.battery'],
    apply: (v) => {
      partIn(v, 'elec.term_pos')!.flags.push('corroded');
      partIn(v, 'elec.battery')!.vars.charge = 0.5;
      partIn(v, 'elec.battery')!.flags.push('corroded');
    },
    resolved: (v) => {
      const pos = partIn(v, 'elec.term_pos'), neg = partIn(v, 'elec.term_neg'), b = partIn(v, 'elec.battery');
      return !!pos && !!neg && !!b && !pos.flags.includes('corroded') && !neg.flags.includes('corroded') && (b.vars.charge ?? 0) > 0.75
        && torqueVerdict(v, 'elec.term_pos') === 'correct' && torqueVerdict(v, 'elec.term_neg') === 'correct';
    },
  },
  plug_fouled: {
    id: 'plug_fouled', name: 'Fouled No.4 plug and worn plug set', system: 'ignition', diagnosis: 'fouled_plug',
    cause: 'The plugs had far exceeded their life: electrodes eroded to ≈ 1.0 mm gaps, and No.4 was carbon-fouled so its spark tracked across the soot instead of jumping the gap. No.4 contributed nothing — the classic "five-cylinder" lumpy idle.',
    tests: ['idle_drop', 'inspect.ign.plug_4', 'measure.gap', 'compression'],
    apply: (v) => {
      for (let c = 1; c <= 6; c++) { const p = partIn(v, `ign.plug_${c}`)!; p.vars.gap = 0.98 + c * 0.01; p.vars.wear = 0.7; p.vars.fouling = c === 4 ? 0.88 : 0.15; p.condition = 0.35; }
    },
    resolved: plugsGood,
  },
  hose_clip: {
    id: 'hose_clip', name: 'Loose bottom-hose clip — coolant loss', system: 'cooling', diagnosis: 'loose_hose_clip',
    cause: 'The radiator-end bottom hose clip had backed off. Cold it only wept; hot and pressurised it pushed coolant out. With the level ≈ 25 % down, air in the system and a starved pump, the engine overheated at idle.',
    tests: ['coolant.level', 'inspect.cool.bottom_hose', 'pressure_test', 'temp_gauge', 'antifreeze'],
    apply: (v) => {
      v.slots['cool.clip_rad'].torque = 0.45;
      v.coolant.comp = { coolant_iat: 6.8, water: 6.8 };
      partIn(v, 'cool.bottom_hose')!.flags.push('leaking');
    },
    resolved: (v) => ['cool.clip_rad', 'cool.clip_pump'].every((k) => torqueVerdict(v, k) === 'correct' || torqueVerdict(v, k) === 'over')
      && total(v.coolant.comp) / COOLANT_FULL > 0.93 && compatibility('coolant', v.coolant.comp).problems.length === 0,
  },
  slack_belt: {
    id: 'slack_belt', name: 'Slack, glazed fan/alternator belt', system: 'electrical', diagnosis: 'slack_belt',
    cause: 'The belt had stretched to ≈ 26 mm deflection and glazed. It slipped on the alternator pulley, so charging output collapsed at idle and town speeds: the battery was never fully recharged.',
    tests: ['volts.charge', 'measure.deflection', 'inspect.eng.fan_belt', 'volts.rest'],
    apply: (v) => {
      const b = partIn(v, 'eng.fan_belt')!; b.vars.deflection = 26; b.flags.push('glazed'); b.vars.wear = 0.5;
      partIn(v, 'elec.battery')!.vars.charge = 0.62;
    },
    resolved: (v) => {
      const b = partIn(v, 'eng.fan_belt');
      const d = b?.vars.deflection ?? 99;
      return !!b && d >= 9.5 && d <= 13.5 && !b.flags.includes('glazed')
        && torqueVerdict(v, 'elec.alt_pivot') === 'correct' && torqueVerdict(v, 'elec.alt_adjust') === 'correct';
    },
  },
  horn_fuse: {
    id: 'horn_fuse', name: 'Blown horn fuse', system: 'electrical', diagnosis: 'blown_fuse',
    cause: 'Fuse 1 (horns) had failed with age and vibration — the element fatigued and parted. No downstream short was present.',
    tests: ['inspect.elec.fuse_1', 'testlamp.F1o', 'testlamp.F1i', 'volts.F1o', 'horn'],
    apply: (v) => { partIn(v, 'elec.fuse_1')!.flags.push('blown'); },
    resolved: (v) => { const f = partIn(v, 'elec.fuse_1'); return !!f && !f.flags.includes('blown') && (f.vars.rating ?? 0) === 50; },
  },
  puncture_fl: {
    id: 'puncture_fl', name: 'Slow puncture — front left', system: 'wheels', diagnosis: 'puncture',
    cause: 'A roofing nail in the front-left tread let the tyre lose ≈ 1 psi an hour. The soft tyre dragged the car left; the other pressures had simply never been set.',
    tests: ['measure.pressure.FL', 'inspect.whl.FL', 'measure.pressure.FR'],
    apply: (v) => {
      const fl = partIn(v, 'whl.FL')!; fl.vars.pressure = 19; fl.flags.push('punctured'); fl.vars.leak = 1;
      partIn(v, 'whl.FR')!.vars.pressure = 30; partIn(v, 'whl.RL')!.vars.pressure = 33.5; partIn(v, 'whl.RR')!.vars.pressure = 29;
      const sp = partIn(v, 'body.spare_wheel'); if (sp) sp.vars.pressure = 31;
    },
    resolved: (v) => CORNERS.every((c) => { const w = partIn(v, `whl.${c}`); return !!w && !w.flags.includes('punctured') && Math.abs((w.vars.pressure ?? 0) - 32) <= 1.0; }),
  },
  head_gasket: {
    id: 'head_gasket', name: 'Failed head gasket between cylinders 3 and 4', system: 'engine', diagnosis: 'head_gasket',
    cause: 'A previous overheat had burnt the gasket fire-ring between cylinders 3 and 4. Combustion gas leaked between the two cylinders and into the waterways: low compression on 3 and 4, a misfire, white sweet-smelling smoke, and coolant slowly consumed.',
    tests: ['compression', 'exhaust.smoke', 'coolant.level', 'pressure_test', 'idle_drop', 'inspect.eng.head_gasket'],
    apply: (v) => { partIn(v, 'eng.head_gasket')!.flags.push('damaged'); v.coolant.comp = { coolant_iat: 7.6, water: 7.6 }; v.engine.headGasketDamage = 0.55; },
    resolved: (v) => {
      const g = partIn(v, 'eng.head_gasket');
      return !!g && !g.flags.includes('damaged') && !g.flags.includes('crushed') && !!v.slots['eng.head'].part
        && Array.from({ length: 14 }, (_, i) => `eng.head_nut_${i + 1}`).every((k) => torqueVerdict(v, k) === 'correct')
        && ['eng.cover_nuts_in', 'eng.cover_nuts_ex'].every((k) => torqueVerdict(v, k) === 'correct')
        && connected(v, 'eng.conn_top_hose') && total(v.coolant.comp) / COOLANT_FULL > 0.93 && (v.slots['cool.radiator'].vars.tap ?? 0) < 0.5
        && [1, 2, 3, 4, 5, 6].every((c) => connected(v, `ign.lead_${c}`) && (v.slots[`ign.lead_${c}`].vars.target ?? c) === c);
    },
  },
  bearing_knock: {
    id: 'bearing_knock', name: 'Worn main & big-end bearings, crankshaft below service limit', system: 'engine', diagnosis: 'worn_bearings',
    cause: 'Years of short trips and a skipped oil change had worn the bearing overlay through and scored the main journals beyond the service limit. The extra running clearance bled oil pressure away (low hot idle pressure) and let the crank hammer the shells: a deep knock that rises with load. New shells alone would not have fixed it — the journals had to be reground and matched with 0.010 in undersize shells.',
    tests: ['dipstick', 'inspect.lub.drain_plug', 'measure.main', 'measure.clearance', 'inspect.eng.main_bearings', 'inspect.crankshaft'],
    apply: (v) => {
      const c = partIn(v, 'eng.crankshaft')!;
      [0.031, 0.038, 0.046, 0.042, 0.036, 0.033, 0.027].forEach((w, i) => (c.vars[`wear${i + 1}`] = w));
      c.vars.pinWear = 0.024; c.condition = 0.35;
      partIn(v, 'eng.main_bearings')!.vars.wear = 0.05; partIn(v, 'eng.main_bearings')!.flags.push('worn');
      partIn(v, 'eng.rod_bearings')!.vars.wear = 0.045; partIn(v, 'eng.rod_bearings')!.flags.push('worn');
      partIn(v, 'lub.drain_plug')!.vars.metal = 0.9;
      v.oil.comp = { oil_20w50_used: 7.4 };
    },
    resolved: (v) => {
      const c = partIn(v, 'eng.crankshaft');
      if (!c || !engineInCar(v)) return false;
      const journalsOk = [1, 2, 3, 4, 5, 6, 7].every((n) => (c.vars[`wear${n}`] ?? 0.003) <= 0.008) && (c.vars.pinWear ?? 0.003) <= 0.008;
      const clr = [bearingClearance(v, 'main'), bearingClearance(v, 'rod')].every((x) => x >= 0.064 && x <= 0.107);
      const torques = ['eng.main_bolts', 'eng.sump_bolts', 'eng.mount_bolts', ...[1, 2, 3, 4, 5, 6].map((k) => `eng.rod_nuts_${k}`)].every((k) => torqueVerdict(v, k) === 'correct');
      const s = sumpOil(v) + v.oil.gallery;
      return journalsOk && clr && torques && ENGINE_CONNECTIONS.every((k) => connected(v, k)) && s >= OIL_MIN && s <= OIL_MAX + 0.35
        && total(v.coolant.comp) / COOLANT_FULL > 0.93 && (v.slots['cool.radiator'].vars.tap ?? 0) < 0.5;
    },
  },
};
