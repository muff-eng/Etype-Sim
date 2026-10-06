/**
 * Reusable workshop procedures. Steps are *detected* from vehicle/workshop state — the player never
 * clicks "next". Each step explains why it is done. Completed steps latch for the current job.
 */
import type { VehicleState } from '../sim/vehicle';
import { bonnetOpen, endOnStands, endRaised, isFitted, onGround, partIn, sumpOil, wheelOffGround, isReleased, COOLANT_FULL } from '../sim/vehicle';
import type { WorkshopState } from '../game/state';
import { torqueVerdict } from '../sim/threads';
import { POINTS, poseFn } from './layout';
import { total } from './fluids';
import type { Corner } from '../sim/types';
import { ENGINE_CONNECTIONS } from './slots';
import { connected } from '../sim/vehicle';
import { CORNERS } from '../sim/types';

export interface ProcCtx { v: VehicleState; ws: WorkshopState; m: Set<string> }
export interface ProcStep { id: string; text: string; why: string; check: (c: ProcCtx) => boolean; optional?: boolean; tools?: string[] }
export interface ProcedureDef { id: string; title: string; system: string; time: string; tools: string[]; parts: string[]; steps: ProcStep[]; notes?: string[] }

const panUnder = (c: ProcCtx, p: [number, number, number]) => {
  const pose = poseFn(Object.fromEntries(CORNERS.map((k) => [k, c.v.support[k].height])) as Record<Corner, number>);
  const w = pose.apply(p);
  return Math.hypot(c.ws.drainPan.x - w[0], c.ws.drainPan.z - w[2]) < 0.24;
};
const newPart = (v: VehicleState, slot: string) => { const p = partIn(v, slot); return !!p && (p.origin === 'new' || p.origin === 'refurb'); };
const bonnetShut = (v: VehicleState) => (v.slots['body.bonnet'].vars.open ?? 0) < 0.01 && (v.slots['body.bonnet'].vars.latchL ?? 0) > 0.5 && (v.slots['body.bonnet'].vars.latchR ?? 0) > 0.5;

const RAISE_FRONT: ProcStep[] = [
  { id: 'chock', text: 'Apply the handbrake and chock the rear wheels', why: 'The car must not roll when the front is in the air.', check: (c) => c.v.chocks || (c.v.slots['int.handbrake'].vars.on ?? 0) > 0.5 },
  { id: 'jack_front', text: 'Raise the front on the trolley jack at a front jacking point', why: 'The sump is only ~140 mm off the floor; you need room to work and to get a drain pan underneath.', check: (c) => endRaised(c.v, 'front', 0.2), tools: ['floor_jack'] },
  { id: 'stands_front', text: 'Place axle stands under both front stand points and lower the car onto them', why: 'A jack is a lifting device, not a support. Never put any part of your body under a car held only by a jack.', check: (c) => endOnStands(c.v, 'front'), tools: ['jack_stands'] },
];
const LOWER: ProcStep = { id: 'lower', text: 'Jack the car off the stands, remove them and lower it to the floor', why: 'The dipstick and level checks are only meaningful with the car level on all four wheels.', check: (c) => onGround(c.v) };
const CLOSE_BONNET: ProcStep = { id: 'close', text: 'Close and latch the bonnet', why: 'Both catches must engage — an unlatched bonnet can lift at speed.', check: (c) => bonnetShut(c.v) };

export const PROCEDURES: Record<string, ProcedureDef> = {
  oil_change: {
    id: 'oil_change', title: 'Engine oil & filter change', system: 'Lubrication', time: '≈ 1.0 h',
    tools: ['15/16 AF socket', '3/4 AF socket', 'Ratchet', 'Torque wrench', 'Trolley jack & axle stands', 'Drain pan', 'Funnel', 'Pick'],
    parts: ['8.5 L SAE 20W-50', 'Oil filter kit (element + sealing ring)', 'Drain plug sealing washer'],
    steps: [
      { id: 'bonnet', text: 'Release both bonnet catches (handles in the footwells) and open the bonnet', why: 'Access to the filler, the dipstick, and a first look for leaks.', check: (c) => bonnetOpen(c.v) },
      { id: 'warm', text: 'Run the engine to warm the oil (≥ 45 °C), then switch off', why: 'Warm oil flows several times faster and carries suspended contaminants out with it.', check: (c) => c.v.oil.tempC > 45, optional: true },
      ...RAISE_FRONT,
      { id: 'pan_drain', text: 'Position the drain pan under the sump drain plug', why: 'Once the last thread lets go the plug drops and ~8 L of oil follows immediately.', check: (c) => panUnder(c, POINTS.drainPlug) },
      { id: 'drain_plug_out', text: 'Undo and remove the drain plug (15/16 AF)', why: 'Undo the last turns by hand while pushing the plug in, then pull it away quickly.', check: (c) => !c.v.slots['lub.drain_plug'].part },
      { id: 'drained', text: 'Let the oil drain until it slows to drips', why: 'Every litre of old oil left behind contaminates the new.', check: (c) => sumpOil(c.v) < 0.35 },
      { id: 'washer', text: 'Discard the old copper washer and fit a NEW one to the plug', why: 'Crush washers seal by deforming. Once crushed they cannot seal again.', check: (c) => newPart(c.v, 'lub.drain_washer') },
      { id: 'plug_in', text: 'Start the drain plug by hand, then torque to 34 Nm (25 lb ft)', why: 'The sump is aluminium: a cross-threaded or over-torqued plug ruins the sump thread.', check: (c) => torqueVerdict(c.v, 'lub.drain_plug') === 'correct' && !!c.v.slots['lub.drain_washer'].part },
      { id: 'pan_filter', text: 'Move the pan under the oil filter canister', why: 'The canister holds over half a litre of oil that will pour out as it comes away.', check: (c) => panUnder(c, POINTS.filterBottom) || c.m.has('filter_off') },
      { id: 'filter_off', text: 'Undo the canister centre bolt (3/4 AF) and lower the canister away', why: 'The element is inside the canister; the bolt passes through it into the filter head.', check: (c) => !c.v.slots['lub.filter_canister'].part },
      { id: 'element', text: 'Discard the old element; fit the new element into the cleaned canister', why: 'The paper element traps the abrasive particles that wear bearings.', check: (c) => newPart(c.v, 'lub.filter_element') },
      { id: 'seal', text: 'Pick the old sealing ring out of the filter-head groove and fit the new ring', why: 'The old ring has taken a set — re-using it is the most common cause of a leaking filter.', check: (c) => newPart(c.v, 'lub.filter_seal') },
      { id: 'filter_on', text: 'Refit the canister and torque the centre bolt to 20 Nm (15 lb ft)', why: 'Under-tight leaks under pressure; over-tight distorts the canister or strips the head.', check: (c) => !!c.v.slots['lub.filter_canister'].part && torqueVerdict(c.v, 'lub.filter_bolt') === 'correct' },
      LOWER,
      { id: 'fill', text: 'Remove the filler cap, insert a funnel and fill with ≈ 8.5 L SAE 20W-50', why: 'Correct grade matters: the JET engine was designed around thick mineral oil.', check: (c) => sumpOil(c.v) > 7.2 && c.m.has('oil_added') },
      { id: 'level1', text: 'Wipe and read the dipstick', why: 'Fill in stages and check — over-filling is as harmful as under-filling.', check: (c) => c.m.has('dipstick_after_fill') },
      { id: 'cap', text: 'Remove the funnel and refit the filler cap', why: 'A missing cap sprays oil over the engine bay and hot exhaust.', check: (c) => isFitted(c.v, 'lub.filler_cap') && !c.v.funnelIn },
      { id: 'run', text: 'Start the engine; watch oil pressure rise and check underneath for leaks', why: 'The empty filter canister must fill; any leak shows within the first minute.', check: (c) => c.m.has('ran_after_service') },
      { id: 'level2', text: 'Stop, wait 2+ minutes, re-check the dipstick and top up to MAX', why: 'The filter canister absorbed about half a litre — the level will have dropped.', check: (c) => c.m.has('dipstick_after_run') },
      CLOSE_BONNET,
    ],
  },
  spark_plugs: {
    id: 'spark_plugs', title: 'Spark plug renewal', system: 'Ignition', time: '≈ 0.6 h',
    tools: ['13/16 in plug socket', 'Extension', 'Ratchet', 'Torque wrench', 'Feeler gauge', 'Gapping tool'],
    parts: ['6 × Champion N5 (long reach)'],
    steps: [
      { id: 'bonnet', text: 'Open the bonnet', why: 'The plugs sit in the centre of the head between the camshaft covers.', check: (c) => bonnetOpen(c.v) },
      { id: 'cold', text: 'Let the engine cool (coolant < 50 °C)', why: 'Steel plugs in a hot aluminium head can pull the threads out.', check: (c) => c.v.engine.coolantC < 50 },
      { id: 'leads', text: 'Pull the HT leads off by their boots — one cylinder at a time', why: 'Working one at a time means the leads cannot be swapped. Pulling the cable damages the conductor.', check: (c) => c.m.has('lead_off') },
      { id: 'out', text: 'Remove the plugs (13/16 plug socket on an extension) and inspect each', why: 'Each plug is a record of how its cylinder has been burning.', check: (c) => c.m.has('plug_inspected') },
      { id: 'gap', text: 'Gap new plugs to 0.64 mm (0.025 in) with a feeler gauge', why: 'New plugs are not pre-set for this engine. Too wide misfires under load; too narrow gives a weak spark.', check: (c) => [1, 2, 3, 4, 5, 6].every((n) => { const p = partIn(c.v, `ign.plug_${n}`); return !!p && (p.vars.gap ?? 0) >= 0.61 && (p.vars.gap ?? 0) <= 0.66; }) },
      { id: 'in', text: 'Start each plug by hand, then torque to 37 Nm', why: 'A plug started with a ratchet cross-threads the alloy head.', check: (c) => [1, 2, 3, 4, 5, 6].every((n) => torqueVerdict(c.v, `ign.plug_${n}`) === 'correct') },
      { id: 'leads_on', text: 'Refit each lead to its own plug (firing order 1-5-3-6-2-4, No.1 at the rear)', why: 'A lead on the wrong plug fires that cylinder at the wrong moment: misfire or backfire.', check: (c) => [1, 2, 3, 4, 5, 6].every((n) => (c.v.slots[`ign.lead_${n}`].vars.off ?? 0) < 0.5 && (c.v.slots[`ign.lead_${n}`].vars.target ?? n) === n) },
      { id: 'test', text: 'Start the engine and listen for an even idle', why: 'Verify the repair.', check: (c) => c.m.has('ran_after_service') },
      CLOSE_BONNET,
    ],
  },
  battery: {
    id: 'battery', title: 'Battery & terminal service', system: 'Electrical', time: '≈ 0.4 h + charging',
    tools: ['7/16 AF spanner', 'Terminal brush', 'Multimeter', 'Battery charger', 'Terminal grease'],
    parts: [],
    steps: [
      { id: 'bonnet', text: 'Open the bonnet', why: 'The battery sits ahead of the bulkhead on the right.', check: (c) => bonnetOpen(c.v) },
      { id: 'measure', text: 'Measure the battery voltage at the posts (engine off)', why: '12.6 V = charged, 12.4 V ≈ 75 %, 12.2 V ≈ 50 %. Measure before you disturb anything.', check: (c) => c.m.has('volts.rest') },
      { id: 'neg_off', text: 'Disconnect the NEGATIVE (earth) terminal first', why: 'With the earth off, a spanner touching the body while on the positive terminal cannot short the battery.', check: (c) => (c.v.slots['elec.term_neg'].vars.off ?? 0) > 0.5 },
      { id: 'pos_off', text: 'Disconnect the positive terminal', why: '', check: (c) => (c.v.slots['elec.term_pos'].vars.off ?? 0) > 0.5 },
      { id: 'clean', text: 'Clean posts and clamps to bright metal; apply a thin film of terminal grease', why: 'A few hundredths of an ohm of corrosion costs volts at 200 A cranking current.', check: (c) => ['elec.term_pos', 'elec.term_neg'].every((s) => !partIn(c.v, s)?.flags.includes('corroded')) && !partIn(c.v, 'elec.battery')?.flags.includes('corroded') },
      { id: 'charge', text: 'Charge the battery to ≥ 75 %', why: 'A partly discharged battery sulphates and cannot deliver cranking current.', check: (c) => (partIn(c.v, 'elec.battery')?.vars.charge ?? 0) > 0.75 },
      { id: 'pos_on', text: 'Reconnect POSITIVE first and tighten (5 Nm)', why: '', check: (c) => (c.v.slots['elec.term_pos'].vars.off ?? 0) < 0.5 && torqueVerdict(c.v, 'elec.term_pos') === 'correct' },
      { id: 'neg_on', text: 'Reconnect NEGATIVE last and tighten (5 Nm)', why: 'Reconnecting the earth last avoids sparks at the positive post.', check: (c) => (c.v.slots['elec.term_neg'].vars.off ?? 0) < 0.5 && torqueVerdict(c.v, 'elec.term_neg') === 'correct' },
      { id: 'test', text: 'Measure cranking voltage and start the engine', why: 'At the posts the voltage should stay above ~9.6 V while cranking.', check: (c) => c.m.has('ran_after_service') },
      CLOSE_BONNET,
    ],
  },
  coolant: {
    id: 'coolant', title: 'Cooling system leak check & top-up', system: 'Cooling', time: '≈ 0.5 h',
    tools: ['Flat screwdriver', 'Hydrometer', 'Pressure tester (optional)'],
    parts: ['IAT coolant 50/50 premix'],
    steps: [
      { id: 'bonnet', text: 'Open the bonnet', why: '', check: (c) => bonnetOpen(c.v) },
      { id: 'cold', text: 'Wait until the engine is COLD (coolant < 50 °C) before touching the cap', why: 'Above 100 °C the coolant is held liquid only by pressure — releasing the cap flashes it to steam over you.', check: (c) => c.v.engine.coolantC < 50 },
      { id: 'level', text: 'Remove the header tank cap and check the level', why: 'Establish how much has been lost.', check: (c) => c.m.has('coolant.level') },
      { id: 'find', text: 'Trace the leak — hoses, clips, radiator, pump', why: 'Topping up without finding the leak just hides the symptom.', check: (c) => c.m.has('inspect.cool.bottom_hose') || c.m.has('pressure_test') },
      { id: 'fix', text: 'Tighten the clip (3.5 Nm — snug, do not cut the hose)', why: 'Over-tightened worm clips cut into the rubber.', check: (c) => ['cool.clip_rad', 'cool.clip_pump'].every((k) => torqueVerdict(c.v, k) === 'correct') },
      { id: 'fill', text: 'Top up with 50 % IAT antifreeze mix to the level', why: 'Never plain water — antifreeze also inhibits corrosion of the alloy head.', check: (c) => total(c.v.coolant.comp) / COOLANT_FULL > 0.93 },
      { id: 'cap', text: 'Refit the pressure cap', why: 'Without pressure the coolant boils at 100 °C instead of ~108 °C.', check: (c) => isFitted(c.v, 'cool.header_cap') },
      { id: 'test', text: 'Run to temperature; watch the gauge and fan cut in', why: 'Confirm the system now holds temperature.', check: (c) => c.m.has('hot_run') },
      CLOSE_BONNET,
    ],
  },
  belt: {
    id: 'belt', title: 'Fan/alternator belt tension & renewal', system: 'Charging', time: '≈ 0.5 h',
    tools: ['1/2 AF socket & ratchet', 'Torque wrench', 'Steel rule', 'Multimeter'],
    parts: ['Fan/alternator V-belt'],
    steps: [
      { id: 'bonnet', text: 'Open the bonnet', why: '', check: (c) => bonnetOpen(c.v) },
      { id: 'charge', text: 'Measure charging voltage at the battery with the engine at ~2000 rpm', why: 'Healthy: 14.0–14.4 V. Low output with a slipping belt.', check: (c) => c.m.has('volts.charge') },
      { id: 'measure', text: 'Measure belt deflection at mid-span', why: 'Spec 10–13 mm under firm thumb pressure.', check: (c) => c.m.has('measure.deflection') },
      { id: 'slack', text: 'Slacken the alternator pivot and adjusting-link bolts', why: 'The alternator pivots on its lower bolt; the link bolt locks it.', check: (c) => isReleased(c.v, 'elec.alt_pivot') && isReleased(c.v, 'elec.alt_adjust') || c.m.has('belt_adjusted') },
      { id: 'renew', text: 'Renew a glazed or cracked belt', why: 'A glazed belt slips even at the correct tension.', check: (c) => !partIn(c.v, 'eng.fan_belt')?.flags.includes('glazed') },
      { id: 'tension', text: 'Lever the alternator out to 10–13 mm deflection', why: 'Too tight wrecks the alternator and water-pump bearings; too slack slips.', check: (c) => { const d = partIn(c.v, 'eng.fan_belt')?.vars.deflection ?? 99; return d >= 10 && d <= 13; } },
      { id: 'tighten', text: 'Torque the link bolt (20 Nm) then the pivot bolt (27 Nm)', why: '', check: (c) => torqueVerdict(c.v, 'elec.alt_pivot') === 'correct' && torqueVerdict(c.v, 'elec.alt_adjust') === 'correct' },
      { id: 'verify', text: 'Re-measure charging voltage', why: '', check: (c) => c.m.has('volts.charge.after') },
      CLOSE_BONNET,
    ],
  },
  fuse: {
    id: 'fuse', title: 'Fuse diagnosis & renewal', system: 'Electrical', time: '≈ 0.3 h',
    tools: ['Test lamp or multimeter', 'Fuse puller'],
    parts: ['Glass fuse of the CORRECT rating'],
    steps: [
      { id: 'symptom', text: 'Confirm the symptom (press the horn push)', why: 'Note exactly what does and does not work.', check: (c) => c.m.has('horn') },
      { id: 'panel', text: 'Undo the two thumb screws and lower the centre panel', why: 'The fuse block lives behind the centre instrument panel.', check: (c) => (c.v.slots['int.center_panel'].vars.open ?? 0) > 0.5 },
      { id: 'test', text: 'Test both sides of each fuse with the test lamp (ignition on for fuses 3–5)', why: 'Power on the supply side but not the load side = open fuse.', check: (c) => c.m.has('testlamp.F1o') || c.m.has('volts.F1o') || c.m.has('inspect.elec.fuse_1') },
      { id: 'replace', text: 'Fit a new fuse of the same rating', why: 'A bigger fuse moves the weak point into the wiring loom — a fire risk.', check: (c) => { const f = partIn(c.v, 'elec.fuse_1'); return !!f && !f.flags.includes('blown') && f.vars.rating === 50; } },
      { id: 'verify', text: 'Check the circuit works', why: 'If it blows again there is a short to find.', check: (c) => c.m.has('horn_ok') },
      { id: 'close', text: 'Raise and secure the centre panel', why: '', check: (c) => (c.v.slots['int.center_panel'].vars.open ?? 0) < 0.5 && torqueVerdict(c.v, 'int.panel_screw_1') === 'correct' && torqueVerdict(c.v, 'int.panel_screw_2') === 'correct' },
    ],
  },
  wheel_change: {
    id: 'wheel_change', title: 'Wheel change & tyre pressures', system: 'Wheels', time: '≈ 0.5 h',
    tools: ['Copper/hide mallet', 'Trolley jack', 'Axle stands', 'Tyre gauge', 'Air line'],
    parts: ['Spare wheel'],
    steps: [
      { id: 'measure', text: 'Check all four pressures COLD', why: 'Spec 32 psi front and rear for 185 VR 15.', check: (c) => CORNERS.every((k) => c.m.has(`measure.pressure.${k}`)) },
      { id: 'loosen', text: 'With the wheel on the ground, knock the spinner loose (strike the ear towards the rear)', why: 'Once the wheel is in the air it will just spin.', check: (c) => c.m.has('spinner_loose_FL') },
      { id: 'raise', text: 'Raise the corner and support it', why: '', check: (c) => wheelOffGround(c.v, 'FL') },
      { id: 'off', text: 'Remove the spinner and pull the wheel off the splines', why: 'Clean and lightly grease the splines before refitting.', check: (c) => !c.v.slots['whl.FL'].part },
      { id: 'spare', text: 'Fit the spare (from under the boot floor)', why: '', check: (c) => !!partIn(c.v, 'whl.FL') && !partIn(c.v, 'whl.FL')!.flags.includes('punctured') },
      { id: 'spinner_on', text: 'Run the spinner on by hand, snug it with the mallet', why: '', check: (c) => (c.v.slots['whl.spinner_FL'].turnsIn ?? 0) >= 4.95 },
      { id: 'lower', text: 'Lower the car and finish tightening the spinner on the ground', why: 'Spinners are self-tightening in the direction of rotation, but must start tight.', check: (c) => !wheelOffGround(c.v, 'FL') && torqueVerdict(c.v, 'whl.spinner_FL') === 'correct' },
      { id: 'pressures', text: 'Set all four tyres to 32 psi', why: 'Unequal pressures make the car pull and wear unevenly.', check: (c) => CORNERS.every((k) => Math.abs((partIn(c.v, `whl.${k}`)?.vars.pressure ?? 0) - 32) <= 1) },
    ],
  },
  head_gasket: {
    id: 'head_gasket', title: 'Cylinder head gasket renewal', system: 'Engine', time: '≈ 6–7 h',
    tools: ['3/4 AF socket & breaker bar', '7/16 AF socket', 'Torque wrench 150 Nm', 'Compression tester', 'Drain pan'],
    parts: ['Head gasket', 'Coolant (≈ 18 L premix)'],
    steps: [
      { id: 'bonnet', text: 'Open the bonnet', why: '', check: (c) => bonnetOpen(c.v) },
      { id: 'evidence', text: 'Gather evidence: compression test, exhaust smoke, coolant level', why: 'White sweet smoke + coolant loss + two adjacent low cylinders is the classic gasket signature.', check: (c) => c.m.has('compression') && (c.m.has('exhaust.smoke') || c.m.has('coolant.level')) },
      { id: 'cold', text: 'Let the engine cool completely', why: 'Never remove an aluminium head hot — it can warp.', check: (c) => c.v.engine.coolantC < 50 },
      { id: 'drain', text: 'Open the radiator drain tap into the pan until empty; close it', why: 'Lifting the head with coolant in the block floods the cylinders.', check: (c) => total(c.v.coolant.comp) < 1.0 || c.m.has('head_off') },
      { id: 'disc', text: 'Disconnect the top hose and all six HT leads', why: '', check: (c) => !connected(c.v, 'eng.conn_top_hose') || c.m.has('head_off') },
      { id: 'covers', text: 'Remove both camshaft covers (domed nuts, 7/16 AF)', why: '', check: (c) => (!c.v.slots['eng.cam_cover_in'].part && !c.v.slots['eng.cam_cover_ex'].part) || c.m.has('head_off') },
      { id: 'nuts', text: 'Undo the 14 head nuts — outside first, working inwards', why: 'Releasing in the reverse of the tightening sequence avoids distorting the head.', check: (c) => Array.from({ length: 14 }, (_, i) => c.v.slots[`eng.head_nut_${i + 1}`].part).every((p) => !p) || c.m.has('head_off') },
      { id: 'lift', text: 'Lift the head off and remove the old gasket; inspect it', why: 'The gasket tells you where it failed — and why.', check: (c) => c.m.has('head_off') && !c.v.slots['eng.head_gasket'].part },
      { id: 'newgasket', text: 'Fit a NEW gasket (never reuse) and lower the head on', why: 'A gasket seals by crushing once.', check: (c) => { const g = partIn(c.v, 'eng.head_gasket'); return !!g && g.origin === 'new' && !!c.v.slots['eng.head'].part; } },
      { id: 'torque', text: 'Run the nuts down by hand, then torque to 73 Nm (54 lb ft) from the centre outwards', why: 'Spiral sequence from the centre clamps the gasket evenly.', check: (c) => Array.from({ length: 14 }, (_, i) => torqueVerdict(c.v, `eng.head_nut_${i + 1}`)).every((x) => x === 'correct') },
      { id: 'reassemble', text: 'Refit cam covers (7 Nm), top hose and HT leads in firing order', why: '', check: (c) => ['eng.cover_nuts_in', 'eng.cover_nuts_ex'].every((k) => torqueVerdict(c.v, k) === 'correct') && connected(c.v, 'eng.conn_top_hose') && [1, 2, 3, 4, 5, 6].every((n) => connected(c.v, `ign.lead_${n}`)) },
      { id: 'refill', text: 'Close the drain tap and refill with 50 % IAT coolant', why: '', check: (c) => total(c.v.coolant.comp) / COOLANT_FULL > 0.93 && (c.v.slots['cool.radiator'].vars.tap ?? 0) < 0.5 },
      { id: 'test', text: 'Run to temperature: smooth idle, clear exhaust, level holds', why: 'Re-check the coolant once cold.', check: (c) => c.m.has('hot_run') },
      CLOSE_BONNET,
    ],
  },
  engine_removal: {
    id: 'engine_removal', title: 'Engine & gearbox removal', system: 'Engine', time: '≈ 5 h',
    tools: ['Engine hoist', 'Engine stand', 'Drain pan', 'Spanners & sockets', 'Trolley jack & stands'],
    parts: [],
    steps: [
      { id: 'tools', text: 'Buy an engine hoist and engine stand (Tools, T)', why: 'The engine/gearbox unit weighs ≈ 270 kg.', check: (c) => c.m.has('owns_hoist') || c.v.engineLoc !== 'car' },
      { id: 'bonnet', text: 'Open the bonnet', why: '', check: (c) => bonnetOpen(c.v) || c.v.engineLoc !== 'car' },
      { id: 'battery', text: 'Disconnect the battery earth terminal', why: 'Live starter cables while lifting an engine are a fire risk.', check: (c) => (c.v.slots['elec.term_neg'].vars.off ?? 0) > 0.5 || c.v.engineLoc !== 'car' },
      { id: 'oil', text: 'Drain the engine oil', why: 'The engine tilts nose-up on the hoist.', check: (c) => sumpOil(c.v) < 0.6 || c.v.engineLoc !== 'car' },
      { id: 'coolant', text: 'Drain the coolant (radiator drain tap)', why: '', check: (c) => total(c.v.coolant.comp) < 1.0 || c.v.engineLoc !== 'car' },
      { id: 'raise', text: 'Raise the front onto axle stands for access underneath', why: 'Starter, exhaust, propshaft and clutch connections are reached from below.', check: (c) => endOnStands(c.v, 'front') || c.v.engineLoc !== 'car' },
      { id: 'conn', text: 'Disconnect every engine connection (Parts list → Engine connections)', why: 'Anything left attached will stop the engine coming out — or tear.', check: (c) => ENGINE_CONNECTIONS.every((k) => !connected(c.v, k)) || c.v.engineLoc !== 'car' },
      { id: 'mounts', text: 'Undo the engine mounting bolts', why: '', check: (c) => isReleased(c.v, 'eng.mount_bolts') || c.v.engineLoc !== 'car' },
      { id: 'lift', text: 'Select the cylinder block → Lift engine out with the hoist', why: 'Lift slowly, tilting the nose up to clear the front frame.', check: (c) => c.m.has('engine_out') },
      { id: 'stand', text: 'Mount it on the engine stand', why: '', check: (c) => c.m.has('engine_on_stand') },
    ],
  },
  bottom_end: {
    id: 'bottom_end', title: 'Bottom-end inspection & rebuild', system: 'Engine', time: '≈ 10 h + machine shop',
    tools: ['Micrometer', 'Plastigauge', 'Torque wrench 150 Nm', '3/4, 9/16, 1/2 AF sockets', 'Breaker bar'],
    parts: ['Main & big-end shells (size to suit the crank)', 'Oil, filter, coolant'],
    steps: [
      { id: 'sump', text: 'Undo the sump bolts and remove the sump and oil pump', why: '', check: (c) => (!c.v.slots['eng.sump'].part && !c.v.slots['eng.oil_pump'].part) || c.m.has('crank_out') },
      { id: 'rods', text: 'Remove all six big-end caps (9/16 AF)', why: 'Keep each cap with its own rod — they are machined as a pair.', check: (c) => [1, 2, 3, 4, 5, 6].every((n) => !c.v.slots[`eng.rod_nuts_${n}`].part) || c.m.has('crank_out') },
      { id: 'mains', text: 'Undo the main bearing cap bolts (breaker bar) and lift the crankshaft out', why: '', check: (c) => c.m.has('crank_out') },
      { id: 'inspect', text: 'Inspect the old shells and the crankshaft', why: 'Shell wear patterns tell you about oil supply and alignment.', check: (c) => c.m.has('inspect.eng.main_bearings') || c.m.has('inspect.crankshaft') || c.m.has('inspect.eng.crankshaft') },
      { id: 'measure', text: 'Micrometer every main journal and compare with the manual', why: 'Below the service limit = regrind (or replace), not just new shells.', check: (c) => c.m.has('measure.main') },
      { id: 'decide', text: 'Decide: reuse, polish, regrind (machine shop) or replace the crank', why: 'Machine shop work costs money and days; a new crankshaft costs more.', check: (c) => c.m.has('machine_shop') || c.m.has('new_crank') },
      { id: 'shells', text: 'Fit main shells matching the crank size, lubricate, lay the crank in', why: 'Undersize shells on a standard crank lock it solid; standard shells on a reground crank leave it loose.', check: (c) => { const b = partIn(c.v, 'eng.main_bearings'); return !!b && b.origin === 'new' && !!c.v.slots['eng.crankshaft'].part; } },
      { id: 'mainst', text: 'Torque the main bolts to 113 Nm (83 lb ft)', why: '', check: (c) => torqueVerdict(c.v, 'eng.main_bolts') === 'correct' },
      { id: 'plasti', text: 'Check running clearance with Plastigauge', why: 'Spec 0.064–0.107 mm. Measure, don\'t assume.', check: (c) => c.m.has('measure.clearance') },
      { id: 'bigends', text: 'Fit new big-end shells and torque the cap nuts to 50 Nm (37 lb ft)', why: '', check: (c) => { const b = partIn(c.v, 'eng.rod_bearings'); return !!b && b.origin === 'new' && [1, 2, 3, 4, 5, 6].every((n) => torqueVerdict(c.v, `eng.rod_nuts_${n}`) === 'correct'); } },
      { id: 'close', text: 'Refit oil pump, pick-up and sump; sump bolts 20 Nm', why: '', check: (c) => !!c.v.slots['eng.oil_pump'].part && !!c.v.slots['eng.oil_pickup'].part && torqueVerdict(c.v, 'eng.sump_bolts') === 'correct' },
      { id: 'refit', text: 'Hoist the engine back in, tighten the mounts (40 Nm) and reconnect everything', why: '', check: (c) => c.v.engineLoc === 'car' && torqueVerdict(c.v, 'eng.mount_bolts') === 'correct' && ENGINE_CONNECTIONS.every((k) => connected(c.v, k)) },
      { id: 'fluids', text: 'New oil & filter, refill coolant (tap closed), reconnect the battery', why: '', check: (c) => sumpOil(c.v) > 6.3 && total(c.v.coolant.comp) / COOLANT_FULL > 0.93 && (c.v.slots['elec.term_neg'].vars.off ?? 0) < 0.5 },
      { id: 'run', text: 'Start, check hot oil pressure (≥ 35 psi at 3000 rpm) and listen', why: 'The knock should be gone and the pressure back up.', check: (c) => c.m.has('hot_run') },
    ],
  },
};
