import { AF } from '../core/units';
import type { SystemId } from '../sim/types';

export type ToolKind =
  | 'ratchet' | 'breaker_bar' | 'torque_wrench' | 'socket' | 'plug_socket' | 'extension' | 'uj'
  | 'spanner' | 'adjustable' | 'screwdriver_flat' | 'screwdriver_phillips' | 'pliers' | 'insulated_pliers'
  | 'needle_pliers' | 'locking_pliers' | 'side_cutters' | 'pick' | 'hammer' | 'copper_mallet' | 'allen'
  | 'floor_jack' | 'jack_stand' | 'chocks' | 'drain_pan' | 'funnel'
  | 'multimeter' | 'test_light' | 'battery_charger' | 'battery_tester'
  | 'tyre_gauge' | 'tread_gauge' | 'air_line' | 'feeler_gauge' | 'gap_tool' | 'vernier' | 'micrometer'
  | 'wire_brush' | 'rag' | 'compression_tester' | 'hydrometer' | 'ruler' | 'pressure_tester' | 'fluid_pump'
  | 'grease_gun' | 'penetrating_oil' | 'timing_light' | 'fuse_puller' | 'terminal_grease'
  | 'engine_hoist' | 'engine_stand' | 'transmission_jack' | 'dial_indicator' | 'bore_gauge' | 'plastigauge'
  | 'straight_edge' | 'leakdown_tester' | 'torque_angle' | 'thread_gauge' | 'bearing_puller' | 'gear_puller'
  | 'spring_compressor' | 'balljoint_tool' | 'clutch_align' | 'brake_bleeder' | 'creeper' | 'parts_washer' | 'vehicle_lift';

export type ToolCategory = 'Hand tools' | 'Sockets & drives' | 'Spanners' | 'Lifting & support' | 'Fluids' | 'Measuring' | 'Electrical' | 'Diagnostic' | 'Restoration' | 'Consumables & cleaning';

export interface ToolDef {
  id: string;
  name: string;
  kind: ToolKind;
  category: ToolCategory;
  size?: string;
  sizeMm?: number;
  maxTorque?: number;     // Nm the tool can apply / tolerate
  turnRate?: number;      // degrees of fastener rotation per second while working
  price: number;
  owned?: boolean;        // in the starting kit
  unlock?: { skill: SystemId; level: number } | { rep: number };
  phase?: number;         // development phase that activates it (3 = Tier II engine work)
  desc: string;
  insulated?: boolean;
  resolution?: number;    // measuring resolution
}

const sockets = ['5/16 AF', '3/8 AF', '7/16 AF', '1/2 AF', '9/16 AF', '5/8 AF', '11/16 AF', '3/4 AF', '7/8 AF', '15/16 AF', '1-1/16 AF', '10 mm', '13 mm', '17 mm'];
const spanners = ['5/16 AF', '3/8 AF', '7/16 AF', '1/2 AF', '9/16 AF', '5/8 AF', '11/16 AF', '3/4 AF', '7/8 AF', '15/16 AF', '13 mm'];

const T: ToolDef[] = [
  // Drives
  { id: 'ratchet_38', name: '3/8 in drive ratchet', kind: 'ratchet', category: 'Sockets & drives', maxTorque: 140, turnRate: 160, price: 24, owned: true, desc: 'Reversible ratchet. Flick the direction lever (R) before you pull.' },
  { id: 'breaker_bar', name: '1/2 in drive breaker bar (with 3/8 adaptor)', kind: 'breaker_bar', category: 'Sockets & drives', maxTorque: 420, turnRate: 55, price: 30, desc: 'Long non-ratcheting bar for breaking tight or corroded fasteners loose. Never use it to tighten.' },
  { id: 'torque_wrench', name: 'Click-type torque wrench 5–150 Nm', kind: 'torque_wrench', category: 'Sockets & drives', maxTorque: 150, turnRate: 70, price: 118, desc: 'Set the value, pull smoothly until it clicks — then STOP. Never use a torque wrench to undo fasteners.' },
  { id: 'extension_150', name: '150 mm extension bar', kind: 'extension', category: 'Sockets & drives', price: 6, owned: true, desc: 'Needed to reach recessed fasteners such as the spark plugs between the camshaft covers.' },
  { id: 'uj_38', name: '3/8 in universal joint', kind: 'uj', category: 'Sockets & drives', price: 9, desc: 'Lets a socket work at an angle.' },
  { id: 'plug_socket', name: '13/16 in spark-plug socket (rubber insert)', kind: 'plug_socket', category: 'Sockets & drives', size: '13/16 AF', sizeMm: AF['13/16 AF'], price: 9, owned: true, desc: 'Deep socket with a rubber insert that grips the plug insulator.' },
  ...sockets.map<ToolDef>((s) => ({
    id: `socket_${s.replace(/[\s/]/g, '').toLowerCase()}`, name: `${s} socket`, kind: 'socket', category: 'Sockets & drives',
    size: s, sizeMm: AF[s], price: 4, owned: !s.endsWith('mm') || s === '13 mm', desc: s.endsWith('mm') ? 'Metric socket — the JET engine is predominantly AF/UNF. A near-miss size will round fasteners.' : '6-point AF socket.',
  })),
  ...spanners.map<ToolDef>((s) => ({
    id: `spanner_${s.replace(/[\s/]/g, '').toLowerCase()}`, name: `${s} combination spanner`, kind: 'spanner', category: 'Spanners',
    size: s, sizeMm: AF[s], maxTorque: Math.round(20 + AF[s] * 4.2), turnRate: 50, price: 7, owned: true, desc: 'Ring end grips all six flats. Slower than a ratchet; limited leverage.',
  })),
  { id: 'adjustable', name: '8 in adjustable spanner', kind: 'adjustable', category: 'Spanners', maxTorque: 60, turnRate: 35, price: 12, owned: true, desc: 'Fits anything — badly. Prone to slipping and rounding nuts under load.' },
  // Hand tools
  { id: 'screwdriver_flat', name: 'Flat-blade screwdriver set', kind: 'screwdriver_flat', category: 'Hand tools', maxTorque: 6, turnRate: 240, price: 10, owned: true, desc: 'For slotted screws and worm-drive hose clips.' },
  { id: 'screwdriver_phillips', name: 'Cross-point screwdriver set', kind: 'screwdriver_phillips', category: 'Hand tools', maxTorque: 6, turnRate: 240, price: 10, owned: true, desc: 'For cross-head screws (trim, lamps).' },
  { id: 'pliers', name: 'Combination pliers', kind: 'pliers', category: 'Hand tools', price: 9, owned: true, desc: 'General gripping.' },
  { id: 'insulated_pliers', name: 'Insulated HT-lead pliers', kind: 'insulated_pliers', category: 'Hand tools', price: 18, desc: 'For pulling HT leads on a running engine (idle-drop test) without taking a 20 kV shock.', insulated: true },
  { id: 'needle_pliers', name: 'Needle-nose pliers', kind: 'needle_pliers', category: 'Hand tools', price: 8, owned: true, desc: 'Small clips and wires.' },
  { id: 'locking_pliers', name: 'Locking pliers', kind: 'locking_pliers', category: 'Hand tools', price: 12, desc: 'Last resort for rounded fasteners.' },
  { id: 'side_cutters', name: 'Side cutters', kind: 'side_cutters', category: 'Hand tools', price: 8, owned: true, desc: 'Cutting cable ties, split pins.' },
  { id: 'pick', name: 'Hook & pick set', kind: 'pick', category: 'Hand tools', price: 10, owned: true, desc: 'For lifting sealing rings out of grooves without scoring the alloy.' },
  { id: 'hammer', name: 'Ball-pein hammer', kind: 'hammer', category: 'Hand tools', price: 14, owned: true, desc: 'Steel hammer. Will damage chrome and soft metals.' },
  { id: 'copper_mallet', name: 'Copper/hide mallet', kind: 'copper_mallet', category: 'Hand tools', maxTorque: 400, turnRate: 30, price: 55, owned: true, desc: 'The correct tool for wire-wheel spinners — hide face for chrome, copper face for stubborn spinners.' },
  { id: 'allen_set', name: 'Hex key set (AF)', kind: 'allen', category: 'Hand tools', price: 8, owned: true, desc: 'Socket-head screws, grub screws.' },
  { id: 'wire_brush', name: 'Terminal / wire brush', kind: 'wire_brush', category: 'Consumables & cleaning', price: 5, owned: true, desc: 'Cleans battery posts, clamps and earth contact faces back to bright metal.' },
  { id: 'rag', name: 'Shop rags', kind: 'rag', category: 'Consumables & cleaning', price: 3, owned: true, desc: 'Wipe dipsticks, clean up spills, wipe sealing faces.' },
  { id: 'terminal_grease', name: 'Terminal protection grease (petroleum jelly)', kind: 'terminal_grease', category: 'Consumables & cleaning', price: 4, owned: true, desc: 'Thin film on clean terminals prevents re-corrosion.' },
  { id: 'penetrating_oil', name: 'Penetrating oil', kind: 'penetrating_oil', category: 'Consumables & cleaning', price: 8, desc: 'Creeps into corroded threads. Give it time to work.' },
  // Lifting
  { id: 'floor_jack', name: 'Hydraulic trolley jack (2 t)', kind: 'floor_jack', category: 'Lifting & support', price: 95, owned: true, desc: 'Lifts — never supports. Place only under the jacking points.' },
  { id: 'jack_stands', name: 'Axle stands (pair)', kind: 'jack_stand', category: 'Lifting & support', price: 38, owned: true, desc: 'Support the car before you go under it. Place under the stand points, then lower the jack onto them.' },
  { id: 'chocks', name: 'Wheel chocks', kind: 'chocks', category: 'Lifting & support', price: 12, owned: true, desc: 'Chock the wheels that stay on the ground.' },
  { id: 'creeper', name: 'Creeper', kind: 'creeper', category: 'Lifting & support', price: 40, owned: true, desc: 'For working under the car.' },
  { id: 'vehicle_lift', name: 'Two-post vehicle lift', kind: 'vehicle_lift', category: 'Lifting & support', price: 2800, unlock: { rep: 40 }, phase: 4, desc: 'Workshop upgrade — lifts the whole car on its sills.' },
  { id: 'engine_hoist', name: 'Engine hoist (1 t) with load leveller', kind: 'engine_hoist', category: 'Lifting & support', price: 320, phase: 3, desc: 'Tier II — for removing the engine/gearbox unit.' },
  { id: 'engine_stand', name: 'Engine stand', kind: 'engine_stand', category: 'Lifting & support', price: 140, phase: 3, desc: 'Tier II — rotatable stand for engine rebuilds.' },
  { id: 'transmission_jack', name: 'Transmission jack', kind: 'transmission_jack', category: 'Lifting & support', price: 260, phase: 3, desc: 'Tier II — supports the gearbox during removal.' },
  // Fluids
  { id: 'drain_pan', name: 'Oil drain pan (12 L)', kind: 'drain_pan', category: 'Fluids', price: 15, owned: true, desc: 'Position it under the drain point BEFORE you open anything.' },
  { id: 'funnel', name: 'Funnel with flexible spout', kind: 'funnel', category: 'Fluids', price: 6, owned: true, desc: 'Prevents spills when filling.' },
  { id: 'fluid_pump', name: 'Hand fluid-transfer pump', kind: 'fluid_pump', category: 'Fluids', price: 22, desc: 'Fills the gearbox and differential through their level plugs.' },
  { id: 'grease_gun', name: 'Grease gun', kind: 'grease_gun', category: 'Fluids', price: 25, desc: 'Chassis lubrication points.' },
  // Measuring
  { id: 'tyre_gauge', name: 'Tyre pressure gauge (dial)', kind: 'tyre_gauge', category: 'Measuring', price: 14, owned: true, resolution: 0.5, desc: 'Read pressures cold. Has a bleed button.' },
  { id: 'air_line', name: 'Compressor air line & inflator', kind: 'air_line', category: 'Fluids', price: 0, owned: true, desc: 'Workshop compressor (wall reel).' },
  { id: 'tread_gauge', name: 'Tread depth gauge', kind: 'tread_gauge', category: 'Measuring', price: 6, owned: true, resolution: 0.1, desc: 'Measure in the main grooves.' },
  { id: 'feeler_gauge', name: 'Feeler gauge set (imperial + metric)', kind: 'feeler_gauge', category: 'Measuring', price: 8, owned: true, resolution: 0.01, desc: 'Spark plug gaps, points gaps, valve clearances.' },
  { id: 'gap_tool', name: 'Spark plug gapping tool', kind: 'gap_tool', category: 'Measuring', price: 6, owned: true, desc: 'Bends the side electrode — never lever against the centre electrode.' },
  { id: 'ruler', name: 'Steel rule (300 mm)', kind: 'ruler', category: 'Measuring', price: 5, owned: true, resolution: 1, desc: 'Belt deflection, general measurement.' },
  { id: 'vernier', name: 'Vernier caliper 150 mm', kind: 'vernier', category: 'Measuring', price: 26, resolution: 0.02, desc: 'Disc thickness, pad thickness, general dimensions.' },
  { id: 'micrometer', name: 'Outside micrometer set 0–100 mm', kind: 'micrometer', category: 'Measuring', price: 180, phase: 3, resolution: 0.001, desc: 'Tier II — journals, pistons, discs.' },
  { id: 'dial_indicator', name: 'Dial indicator & magnetic base', kind: 'dial_indicator', category: 'Measuring', price: 75, phase: 3, resolution: 0.01, desc: 'Tier II — end float and runout.' },
  { id: 'bore_gauge', name: 'Bore gauge', kind: 'bore_gauge', category: 'Measuring', price: 140, phase: 3, resolution: 0.002, desc: 'Tier II — cylinder bore wear and taper.' },
  { id: 'plastigauge', name: 'Plastigauge strips', kind: 'plastigauge', category: 'Measuring', price: 9, phase: 3, desc: 'Tier II — bearing running clearance.' },
  { id: 'straight_edge', name: 'Precision straight edge', kind: 'straight_edge', category: 'Measuring', price: 60, phase: 3, desc: 'Tier II — head and block flatness.' },
  { id: 'thread_gauge', name: 'Thread pitch gauges (UNF/UNC/metric)', kind: 'thread_gauge', category: 'Measuring', price: 12, phase: 3, desc: 'Identify incorrect fasteners.' },
  { id: 'torque_angle', name: 'Torque-angle gauge', kind: 'torque_angle', category: 'Measuring', price: 15, phase: 3, desc: 'Tier II.' },
  { id: 'hydrometer', name: 'Antifreeze hydrometer', kind: 'hydrometer', category: 'Measuring', price: 12, resolution: 1, desc: 'Measures freezing protection of the coolant (cap off, engine COLD).' },
  // Electrical
  { id: 'multimeter', name: 'Digital multimeter', kind: 'multimeter', category: 'Electrical', price: 45, resolution: 0.01, desc: 'Volts, ohms, continuity. Red probe first, then black.' },
  { id: 'test_light', name: '12 V test lamp', kind: 'test_light', category: 'Electrical', price: 11, owned: true, desc: 'Clip to earth, probe a live point — it lights if power is present under load.' },
  { id: 'battery_charger', name: 'Battery charger 6/12 A', kind: 'battery_charger', category: 'Electrical', price: 95, desc: 'Charges the battery in place. Connect positive first, then negative.' },
  { id: 'battery_tester', name: 'Battery load tester', kind: 'battery_tester', category: 'Electrical', price: 55, unlock: { skill: 'electrical', level: 1 }, desc: 'Applies a heavy load for 10 s to reveal a weak battery.' },
  { id: 'fuse_puller', name: 'Fuse puller', kind: 'fuse_puller', category: 'Electrical', price: 3, owned: true, desc: 'Removes glass fuses without cracking them or bending the clips.' },
  // Diagnostic
  { id: 'compression_tester', name: 'Compression tester (screw-in)', kind: 'compression_tester', category: 'Diagnostic', price: 65, unlock: { skill: 'ignition', level: 1 }, resolution: 5, desc: 'All plugs out, throttle wide open, crank 6 compressions per cylinder.' },
  { id: 'timing_light', name: 'Stroboscopic timing light', kind: 'timing_light', category: 'Diagnostic', price: 70, unlock: { skill: 'ignition', level: 2 }, phase: 4, desc: 'Dynamic ignition timing.' },
  { id: 'pressure_tester', name: 'Cooling-system pressure tester', kind: 'pressure_tester', category: 'Diagnostic', price: 85, unlock: { skill: 'cooling', level: 1 }, desc: 'Pressurises the cold cooling system to reveal leaks.' },
  { id: 'leakdown_tester', name: 'Cylinder leak-down tester', kind: 'leakdown_tester', category: 'Diagnostic', price: 110, phase: 3, desc: 'Tier II.' },
  // Restoration
  { id: 'bearing_puller', name: 'Bearing puller set', kind: 'bearing_puller', category: 'Restoration', price: 70, phase: 4, desc: 'Phase 4.' },
  { id: 'gear_puller', name: 'Gear puller', kind: 'gear_puller', category: 'Restoration', price: 40, phase: 4, desc: 'Phase 4.' },
  { id: 'spring_compressor', name: 'Coil-spring compressor', kind: 'spring_compressor', category: 'Restoration', price: 45, phase: 4, desc: 'Rear coil/damper units — Phase 4.' },
  { id: 'balljoint_tool', name: 'Ball-joint splitter', kind: 'balljoint_tool', category: 'Restoration', price: 25, phase: 4, desc: 'Phase 4.' },
  { id: 'clutch_align', name: 'Clutch alignment tool', kind: 'clutch_align', category: 'Restoration', price: 12, phase: 4, desc: 'Phase 4.' },
  { id: 'brake_bleeder', name: 'One-man brake bleeding kit', kind: 'brake_bleeder', category: 'Restoration', price: 18, phase: 4, desc: 'Phase 4.' },
  { id: 'parts_washer', name: 'Parts washer', kind: 'parts_washer', category: 'Restoration', price: 260, phase: 3, desc: 'Cleaning station — Tier II.' },
];

export const TOOLS: Record<string, ToolDef> = Object.fromEntries(T.map((t) => [t.id, t]));
export const TOOL_LIST = T;

/** Tools that hold a socket. */
export const DRIVES: ToolKind[] = ['ratchet', 'breaker_bar', 'torque_wrench'];

export type Fit = 'exact' | 'loose' | 'nofit';
export function sizeFit(toolMm: number | undefined, fastenerMm: number | undefined): Fit {
  if (toolMm == null || fastenerMm == null) return 'nofit';
  const d = toolMm - fastenerMm;
  if (d < -0.06) return 'nofit';
  if (d <= 0.15) return 'exact';
  if (d <= 0.75) return 'loose';
  return 'nofit';
}
