/**
 * Error detection: the engine can explain *why* the vehicle does (not) work. The player never sees this
 * directly while working — it powers the debrief, Beginner hints after the player has gathered evidence,
 * and the Assembly Check.
 */
import type { VehicleState } from './vehicle';
import { partIn, isFitted, sumpOil, OIL_MAX, OIL_MIN, COOLANT_FULL, onGround, isReleased } from './vehicle';
import { evaluate, elecInputsFrom } from './electrical';
import { ignitionAnalysis, oilPressure } from './engine';
import { SLOT_LIST, SLOTS } from '../data/slots';
import { torqueVerdict } from './threads';
import { total, compatibility, freshness } from '../data/fluids';
import { CORNERS } from './types';
import { fmt } from '../core/units';
import { bearingClearance } from '../data/parts';

export interface Check { group: string; label: string; ok: boolean; detail?: string; severity?: 'info' | 'warn' | 'fail' }

/** "Why won't it start / run properly" chain. */
export function analyzeVehicle(v: VehicleState): Check[] {
  const c: Check[] = [];
  const ei = elecInputsFrom(v);
  const rest = evaluate(v, { ...ei, starter: false, running: false });
  const crank = evaluate(v, { ...ei, ignOn: true, starter: true, running: false });
  const bat = partIn(v, 'elec.battery');
  const restV = rest.V['B+'] - rest.V['B-'];
  c.push({ group: 'Battery', label: 'Battery state of charge', ok: restV >= 12.4, detail: `${fmt(restV)} V at rest (${Math.round((bat?.vars.charge ?? 0) * 100)} %)` });
  c.push({ group: 'Battery', label: 'Battery terminals', ok: !['elec.term_pos', 'elec.term_neg'].some((s) => partIn(v, s)?.flags.includes('corroded')) && torqueVerdict(v, 'elec.term_pos') === 'correct' && torqueVerdict(v, 'elec.term_neg') === 'correct', detail: 'Clean, tight clamps' });
  c.push({ group: 'Starter', label: 'Cranking', ok: crank.solenoidEngaged && crank.motorV > 8.2, detail: crank.solenoidEngaged ? `${fmt(crank.motorV)} V at the motor while cranking` : crank.chatter ? 'Solenoid chatters — voltage collapses under load' : 'Solenoid does not engage' });
  const drop = crank.solenoidEngaged ? (crank.V['B+'] - crank.V['B-']) - (crank.V['SOL'] - crank.V['ENG']) : 0;
  c.push({ group: 'Starter', label: 'Starter circuit voltage drop', ok: drop < 1.0, detail: `${fmt(drop)} V lost between battery posts and starter` });
  c.push({ group: 'Fuel', label: 'Fuel present', ok: v.fuelL > 2, detail: `${fmt(v.fuelL, 1)} L` });
  c.push({ group: 'Fuel', label: 'Fuel delivery', ok: !!partIn(v, 'elec.fuse_3') && !partIn(v, 'elec.fuse_3')!.flags.includes('blown'), detail: 'Pump fed via fuse 3' });
  const air = partIn(v, 'fuel.air_element');
  c.push({ group: 'Air', label: 'Air cleaner', ok: !!air && (air.vars.clog ?? 0) < 0.5, detail: air ? `${Math.round((air.vars.clog ?? 0) * 100)} % restricted` : 'Element missing' });
  const ign = ignitionAnalysis(v, crank.coilV);
  c.push({ group: 'Ignition', label: 'Coil supply while cranking', ok: crank.coilV > 7, detail: `${fmt(crank.coilV)} V` });
  c.push({ group: 'Ignition', label: 'Distributor cap & rotor', ok: ign.distOk && !partIn(v, 'ign.dist_cap')?.flags.includes('cracked'), detail: ign.notes.join(', ') || 'Fitted' });
  for (let cyl = 1; cyl <= 6; cyl++) {
    const plug = partIn(v, `ign.plug_${cyl}`);
    const lead = v.slots[`ign.lead_${cyl}`];
    const issues: string[] = [];
    if (!plug) issues.push('no plug');
    else {
      if ((plug.vars.fouling ?? 0) > 0.5) issues.push('plug fouled');
      if ((plug.vars.gap ?? 0.64) > 0.9 || (plug.vars.gap ?? 0.64) < 0.5) issues.push(`gap ${fmt(plug.vars.gap ?? 0, 2)} mm`);
      if (plug.def === 'plug_l82y') issues.push('wrong (short-reach) plug');
      if (!isFitted(v, `ign.plug_${cyl}`)) issues.push('plug not seated');
    }
    if ((lead.vars.off ?? 0) > 0.5) issues.push('HT lead disconnected');
    if (ign.wrongTiming[cyl]) issues.push('HT lead on wrong plug (firing order)');
    c.push({ group: 'Ignition', label: `Cylinder ${cyl} spark`, ok: issues.length === 0, detail: issues.join(', ') || 'Good spark' });
  }
  const sump = sumpOil(v) + v.oil.gallery;
  c.push({ group: 'Lubrication', label: 'Oil level', ok: sump >= OIL_MIN && sump <= OIL_MAX + 0.35, detail: `${fmt(sump, 2)} L in sump (MIN ${OIL_MIN} / MAX ${OIL_MAX})` });
  const comp = compatibility('engineOil', v.oil.comp);
  c.push({ group: 'Lubrication', label: 'Oil grade', ok: comp.wrongFrac < 0.05 && comp.problems.length === 0, detail: comp.problems[0] ?? 'Correct grade' });
  c.push({ group: 'Lubrication', label: 'Oil pressure at 3000 rpm (hot)', ok: oilPressure({ ...v, oil: { ...v.oil, tempC: 85 } } as VehicleState, 3000) >= 35, detail: `${fmt(oilPressure({ ...v, oil: { ...v.oil, tempC: 85 } } as VehicleState, 3000), 0)} psi` });
  const cool = total(v.coolant.comp);
  c.push({ group: 'Cooling', label: 'Coolant level', ok: cool / COOLANT_FULL > 0.93, detail: `${fmt(cool, 1)} / ${COOLANT_FULL} L` });
  c.push({ group: 'Cooling', label: 'Bottom hose clips', ok: torqueVerdict(v, 'cool.clip_rad') !== 'under' && torqueVerdict(v, 'cool.clip_pump') !== 'under' && torqueVerdict(v, 'cool.clip_rad') !== 'loose', detail: 'Worm-drive clips at specified tension' });
  const belt = partIn(v, 'eng.fan_belt');
  const d = belt?.vars.deflection ?? 99;
  c.push({ group: 'Charging', label: 'Fan/alternator belt tension', ok: d >= 9 && d <= 14, detail: belt ? `${fmt(d, 0)} mm deflection` : 'Belt missing' });
  for (let n = 1; n <= 6; n++) {
    const f = partIn(v, `elec.fuse_${n}`);
    c.push({ group: 'Fuses', label: `Fuse ${n}`, ok: !!f && !f.flags.includes('blown') && (f.vars.rating ?? 0) <= (n === 1 ? 50 : 35), detail: f ? `${f.vars.rating} A${f.flags.includes('blown') ? ' — BLOWN' : ''}` : 'Missing' });
  }
  for (const k of CORNERS) {
    const w = partIn(v, `whl.${k}`);
    c.push({ group: 'Tyres', label: `Tyre ${k}`, ok: !!w && Math.abs((w.vars.pressure ?? 0) - 32) <= 1.5 && !w.flags.includes('punctured'), detail: w ? `${fmt(w.vars.pressure ?? 0, 1)} psi${w.flags.includes('punctured') ? ', punctured' : ''}` : 'No wheel' });
  }
  return c;
}

/** Assembly validation — "do not simply say Complete; explain what remains". */
export function assemblyCheck(v: VehicleState, opts: { requireTestRun?: boolean } = {}): Check[] {
  const out: Check[] = [];
  // Every non-optional slot fitted
  const missing = SLOT_LIST.filter((s) => !s.optional && !v.slots[s.id].part);
  out.push({ group: 'Components', label: 'All components fitted', ok: missing.length === 0, detail: missing.length ? `Missing: ${missing.slice(0, 6).map((s) => s.name).join(', ')}${missing.length > 6 ? '…' : ''}` : undefined, severity: 'fail' });
  // Connectors
  const disc = SLOT_LIST.filter((s) => s.connector && v.slots[s.id].part && (v.slots[s.id].vars.off ?? 0) > 0.5);
  out.push({ group: 'Components', label: 'All connectors connected', ok: disc.length === 0, detail: disc.map((s) => s.name).join(', ') || undefined, severity: 'fail' });
  // Fasteners & torque
  const bad: string[] = [];
  for (const s of SLOT_LIST) {
    if (!s.thread || !v.slots[s.id].part) continue;
    const verdict = torqueVerdict(v, s.id);
    if (s.thread.drive === 'spinner' && verdict === 'over') continue;
    if (verdict !== 'correct' && verdict !== 'none') bad.push(`${s.name}: ${verdict === 'under' ? 'under-torqued' : verdict === 'over' ? 'over-torqued' : verdict === 'loose' ? 'not tightened' : verdict === 'stripped' ? 'thread stripped' : 'cross-threaded'}`);
  }
  out.push({ group: 'Fasteners', label: 'All fasteners at specified torque', ok: bad.length === 0, detail: bad.slice(0, 6).join(' · ') + (bad.length > 6 ? ` (+${bad.length - 6} more)` : ''), severity: 'fail' });
  // Leads order
  const wrongLeads = [1, 2, 3, 4, 5, 6].filter((c) => (v.slots[`ign.lead_${c}`].vars.target ?? c) !== c);
  out.push({ group: 'Ignition', label: 'HT leads in firing order', ok: wrongLeads.length === 0, detail: wrongLeads.length ? `Leads ${wrongLeads.join(', ')} on wrong plugs` : undefined, severity: 'fail' });
  // Fluids
  const sump = sumpOil(v) + v.oil.gallery;
  out.push({ group: 'Fluids', label: 'Engine oil between MIN and MAX', ok: sump >= OIL_MIN && sump <= OIL_MAX + 0.35, detail: `${fmt(sump, 2)} L (static)`, severity: 'fail' });
  const oc = compatibility('engineOil', v.oil.comp);
  out.push({ group: 'Fluids', label: 'Engine oil is the correct grade', ok: oc.wrongFrac < 0.05 && oc.problems.length === 0, detail: oc.problems.join(' '), severity: 'fail' });
  const cool = total(v.coolant.comp) / COOLANT_FULL;
  out.push({ group: 'Fluids', label: 'Coolant full', ok: cool > 0.93, detail: `${Math.round(cool * 100)} %`, severity: 'fail' });
  const cc = compatibility('coolant', v.coolant.comp);
  out.push({ group: 'Fluids', label: 'Coolant type compatible', ok: cc.problems.length === 0 && cc.wrongFrac < 0.05, detail: cc.problems.join(' '), severity: 'fail' });
  const bc = compatibility('brake', v.brake.comp);
  out.push({ group: 'Fluids', label: 'Brake fluid level & type', ok: total(v.brake.comp) > 0.75 && bc.problems.length === 0, detail: bc.problems.join(' '), severity: 'fail' });
  out.push({ group: 'Fluids', label: 'Clutch fluid level & type', ok: total(v.clutch.comp) > 0.25 && compatibility('clutch', v.clutch.comp).problems.length === 0, severity: 'fail' });
  out.push({ group: 'Fluids', label: 'Gearbox oil at level plug', ok: Math.abs(total(v.gearbox.comp) - 1.42) < 0.12 && compatibility('gearbox', v.gearbox.comp).problems.length === 0, severity: 'warn' });
  out.push({ group: 'Fluids', label: 'Differential oil at level plug', ok: Math.abs(total(v.diff.comp) - 1.56) < 0.12 && compatibility('diff', v.diff.comp).problems.length === 0, severity: 'warn' });
  // Caps, funnel
  out.push({ group: 'Engine bay', label: 'Oil filler cap fitted', ok: isFitted(v, 'lub.filler_cap'), severity: 'fail' });
  out.push({ group: 'Engine bay', label: 'Dipstick fitted', ok: !!v.slots['lub.dipstick'].part, severity: 'fail' });
  out.push({ group: 'Engine bay', label: 'Header tank cap fitted', ok: isFitted(v, 'cool.header_cap'), severity: 'fail' });
  out.push({ group: 'Engine bay', label: 'No funnel or tools left in the engine bay', ok: !v.funnelIn, detail: v.funnelIn ? 'Funnel still in the oil filler neck' : undefined, severity: 'fail' });
  out.push({ group: 'Engine bay', label: 'Battery secured', ok: torqueVerdict(v, 'elec.batt_hold') === 'correct', severity: 'fail' });
  out.push({ group: 'Engine bay', label: 'No oil on hot engine surfaces', ok: v.oil.oilOnEngine < 0.01, detail: v.oil.oilOnEngine >= 0.01 ? 'Spilt oil will smoke on the exhaust manifold — clean it off' : undefined, severity: 'warn' });
  // Vehicle state
  out.push({ group: 'Vehicle', label: 'On the ground, stands and jack removed', ok: onGround(v), severity: 'fail' });
  out.push({ group: 'Vehicle', label: 'Bonnet closed and latched', ok: (v.slots['body.bonnet'].vars.open ?? 0) < 0.01 && (v.slots['body.bonnet'].vars.latchL ?? 0) > 0.5 && (v.slots['body.bonnet'].vars.latchR ?? 0) > 0.5, severity: 'fail' });
  out.push({ group: 'Vehicle', label: 'Centre panel secured', ok: (v.slots['int.center_panel'].vars.open ?? 0) < 0.5 && torqueVerdict(v, 'int.panel_screw_1') === 'correct' && torqueVerdict(v, 'int.panel_screw_2') === 'correct', severity: 'warn' });
  out.push({ group: 'Vehicle', label: 'Ignition off', ok: !v.engine.running && (v.slots['int.ignition'].vars.on ?? 0) < 0.5, severity: 'warn' });
  const loose = CORNERS.filter((k) => !isReleased(v, `whl.spinner_${k}`) && torqueVerdict(v, `whl.spinner_${k}`) === 'under');
  out.push({ group: 'Vehicle', label: 'Wheel spinners tight', ok: loose.length === 0, detail: loose.length ? `Loose: ${loose.join(', ')}` : undefined, severity: 'fail' });
  out.push({ group: 'Engine', label: 'Engine installed in the car', ok: (v.engineLoc ?? 'car') === 'car', severity: 'fail' });
  out.push({ group: 'Cooling', label: 'Radiator drain tap closed', ok: (v.slots['cool.radiator'].vars.tap ?? 0) < 0.5, severity: 'fail' });
  const mc = bearingClearance(v, 'main'), rc = bearingClearance(v, 'rod');
  out.push({ group: 'Engine', label: 'Bearing running clearances in specification', ok: mc >= 0.064 && mc <= 0.107 && rc >= 0.064 && rc <= 0.107, detail: mc > 5 || rc > 5 ? 'Bearings or crankshaft missing' : `main ${fmt(mc, 3)} mm · big-end ${fmt(rc, 3)} mm (0.064–0.107)`, severity: 'fail' });
  const hg = partIn(v, 'eng.head_gasket');
  out.push({ group: 'Engine', label: 'Head gasket sound', ok: !!hg && !hg.flags.includes('damaged') && !hg.flags.includes('crushed'), detail: hg?.flags.includes('crushed') ? 'A used gasket was refitted' : hg?.flags.includes('damaged') ? 'Gasket failed' : undefined, severity: 'fail' });
  if (opts.requireTestRun) out.push({ group: 'Verification', label: 'Engine run & leak-checked after the work', ok: v.engine.ranSinceService, detail: v.engine.ranSinceService ? undefined : 'Start the engine, check for leaks and recheck levels', severity: 'warn' });
  return out;
}

export const oilFreshness = (v: VehicleState) => freshness(v.oil.comp);
export { SLOTS };
