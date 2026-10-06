/**
 * Vehicle topology: every serviceable location on the car ("slot"), what fits there, what holds it,
 * and what must be done before it can be reached. Rendering binds meshes to slot ids; gameplay never
 * hard-codes parts — it reads these definitions.
 */
import type { Corner, SystemId } from '../sim/types';
import type { ToolKind } from './tools';
import { PARTS, definePart } from './parts';
import { TORQUE } from './spec';

export type StateKey = 'doorOpenL' | 'doorOpenR' | 'hatchOpen' | 'panelOpen' | 'engineOff' | 'engineCold' | 'bootFloorOpen' | 'engineOnStand' | 'coolantLow';

export type AccessReq =
  | { type: 'bonnetOpen' }
  | { type: 'under'; end: 'front' | 'rear' }
  | { type: 'cornerRaised'; corner: Corner }
  | { type: 'removed'; slot: string }
  | { type: 'state'; key: StateKey; label: string }
  | { type: 'phase'; phase: number; label: string };

export interface ThreadSpec {
  size: string;
  drive: 'hex' | 'slot' | 'spinner' | 'hand';
  driveSize?: string;
  turns: number;
  torqueKey?: keyof typeof TORQUE | string;
  torqueNm?: number;
  tolPct?: number;
  stripFactor?: number;
  host: 'aluminium' | 'steel' | 'iron' | 'brass' | 'rubber';
  leftHand?: boolean;
  needsExtension?: boolean;
  captive?: boolean;          // backs off but stays put (hose clip screw, pinch bolt)
  releaseTurns?: number;
  stiffness?: number;         // Nm per degree beyond seating
  handTight?: boolean;        // finger-tight item
}

export interface SlotDef {
  id: string;
  name: string;
  system: SystemId;
  accepts: string[];
  initial: string;
  parent?: string;
  heldBy?: string[];
  access?: AccessReq[];
  removable?: boolean;
  removeTool?: ToolKind[];
  thread?: ThreadSpec;
  connector?: boolean;        // disconnect/connect instead of removal (battery clamps, HT leads)
  toggle?: { var: string; on: string; off: string; label: string }; // levers, doors, switches
  edu?: string;
  group: string;
  hint?: string;
  optional?: boolean;         // may legitimately be empty
  heavy?: boolean;
}

export const SLOTS: Record<string, SlotDef> = {};
const def = (d: SlotDef) => (SLOTS[d.id] = d);

/** Static component: creates a matching single-use PartDef. */
function comp(id: string, name: string, system: SystemId, group: string, o: Partial<SlotDef> & { price?: number; mass?: number } = {}) {
  const pid = `p.${id}`;
  if (!PARTS[pid]) definePart({ id: pid, name, system, mass: o.mass ?? 1, price: o.price ?? 50, kind: 'component', edu: o.edu });
  const { price, mass, ...rest } = o;
  return def({ id, name, system, group, accepts: [pid], initial: pid, removable: false, ...rest });
}

const PH3 = { type: 'phase', phase: 4, label: 'Valvetrain & ancillary strip-down — Phase 4' } as const;
const STAND = { type: 'state', key: 'engineOnStand', label: 'Lift the engine out and mount it on the engine stand' } as const;
const COLD = { type: 'state', key: 'engineCold', label: 'Let the engine cool below 50 °C' } as const;
const DRAINED = { type: 'state', key: 'coolantLow', label: 'Drain the coolant first (radiator drain tap)' } as const;
const PH4 = { type: 'phase', phase: 4, label: 'Chassis rebuild — Phase 4' } as const;
const UNDER_F = { type: 'under', end: 'front' } as const;
const UNDER_R = { type: 'under', end: 'rear' } as const;
const BONNET = { type: 'bonnetOpen' } as const;

// ═══════════════════════ BODY ═══════════════════════
comp('body.shell', 'Monocoque body shell', 'body', 'Body', { price: 9000, mass: 300, edu: 'monocoque' });
comp('body.bonnet', 'Bonnet (one-piece forward-hinged)', 'body', 'Body', { price: 4200, mass: 45, edu: 'bonnet', toggle: { var: 'open', on: 'Open bonnet', off: 'Close bonnet', label: 'Bonnet' } });
comp('body.front_frame', 'Front tubular sub-frame', 'body', 'Body', { price: 1400, mass: 30, access: [BONNET], edu: 'front_frame' });
comp('body.bulkhead', 'Bulkhead', 'body', 'Body', { price: 900, mass: 12 });
comp('body.door_L', 'Door — left', 'body', 'Body', { price: 900, mass: 22, toggle: { var: 'open', on: 'Open door', off: 'Close door', label: 'Left door' } });
comp('body.door_R', 'Door — right', 'body', 'Body', { price: 900, mass: 22, toggle: { var: 'open', on: 'Open door', off: 'Close door', label: 'Right door' } });
comp('body.hatch', 'Rear hatch (side-hinged tailgate)', 'body', 'Body', { price: 1100, mass: 18, toggle: { var: 'open', on: 'Open hatch', off: 'Close hatch', label: 'Rear hatch' } });
comp('body.boot_floor', 'Boot floor panel (spare wheel cover)', 'body', 'Body', { price: 60, mass: 3, access: [{ type: 'state', key: 'hatchOpen', label: 'Open the rear hatch' }], toggle: { var: 'open', on: 'Lift floor panel', off: 'Lower floor panel', label: 'Boot floor' } });
def({ id: 'body.spare_clamp', name: 'Spare wheel clamp (wing nut)', system: 'wheels', group: 'Body', accepts: ['p.spare_clamp'], initial: 'p.spare_clamp',
  access: [{ type: 'state', key: 'bootFloorOpen', label: 'Lift the boot floor panel' }],
  thread: { size: '3/8 UNC', drive: 'hand', turns: 5, host: 'steel', handTight: true, torqueKey: 'panelScrew' } });
definePart({ id: 'p.spare_clamp', name: 'Spare wheel clamp', system: 'wheels', mass: 0.3, price: 8, kind: 'fastener' });
def({ id: 'body.spare_wheel', name: 'Spare wheel', system: 'wheels', group: 'Body', accepts: ['wheel_wire'], initial: 'wheel_wire', heldBy: ['body.spare_clamp'], heavy: true, optional: true,
  access: [{ type: 'state', key: 'bootFloorOpen', label: 'Lift the boot floor panel' }], edu: 'wire_wheel' });
for (const s of ['L', 'R'] as const) {
  comp(`body.headlamp_${s}`, `Headlamp & glass cover — ${s === 'L' ? 'left' : 'right'}`, 'electrical', 'Lighting', { price: 160, mass: 2, edu: 'headlamp' });
  comp(`body.sidelamp_${s}`, `Side lamp / indicator — ${s === 'L' ? 'left' : 'right'}`, 'electrical', 'Lighting', { price: 45, mass: 0.3 });
  comp(`body.taillamp_${s}`, `Tail / stop / indicator lamp — ${s === 'L' ? 'left' : 'right'}`, 'electrical', 'Lighting', { price: 55, mass: 0.4 });
  comp(`body.bumper_F${s}`, `Front bumper blade — ${s === 'L' ? 'left' : 'right'}`, 'body', 'Body trim', { price: 180, mass: 3 });
  comp(`body.bumper_R${s}`, `Rear bumper blade — ${s === 'L' ? 'left' : 'right'}`, 'body', 'Body trim', { price: 210, mass: 3.5 });
  comp(`body.door_handle_${s}`, `Door handle — ${s === 'L' ? 'left' : 'right'}`, 'body', 'Body trim', { price: 70, mass: 0.3 });
}
comp('body.windscreen', 'Windscreen (laminated) & chrome frame', 'body', 'Glass', { price: 380, mass: 14 });
comp('body.rear_glass', 'Rear hatch glass', 'body', 'Glass', { price: 300, mass: 8 });
comp('body.side_glass_L', 'Door glass & frame — left', 'body', 'Glass', { price: 220, mass: 5 });
comp('body.side_glass_R', 'Door glass & frame — right', 'body', 'Glass', { price: 220, mass: 5 });
for (let i = 1; i <= 3; i++) comp(`body.wiper_${i}`, `Windscreen wiper arm & blade #${i}`, 'body', 'Body trim', { price: 22, mass: 0.2 });
comp('body.mouth', 'Air intake mouth, grille bar & badge', 'body', 'Body trim', { price: 240, mass: 1.5 });
comp('body.fuel_filler', 'Fuel filler cap & flap', 'fuel', 'Body trim', { price: 65, mass: 0.4 });
comp('body.mirror', 'Interior mirror', 'interior', 'Body trim', { price: 45, mass: 0.3 });

// ═══════════════════════ INTERIOR / CONTROLS ═══════════════════════
comp('int.dashboard', 'Dashboard & instrument panel', 'interior', 'Interior', { price: 600, mass: 6 });
comp('int.speedo', 'Speedometer', 'interior', 'Instruments', { price: 280, mass: 0.6, edu: 'instruments' });
comp('int.tacho', 'Tachometer (with clock)', 'interior', 'Instruments', { price: 300, mass: 0.6, edu: 'instruments' });
comp('int.gauges', 'Minor gauges: ammeter, fuel, oil pressure, water temperature', 'interior', 'Instruments', { price: 340, mass: 1, edu: 'instruments' });
comp('int.ignition', 'Ignition switch', 'electrical', 'Controls', { price: 25, mass: 0.1, toggle: { var: 'on', on: 'Ignition ON', off: 'Ignition OFF', label: 'Ignition' }, edu: 'ignition_switch' });
comp('int.starter_button', 'Starter push-button', 'electrical', 'Controls', { price: 18, mass: 0.05 });
comp('int.choke', 'Cold-start (choke) lever', 'fuel', 'Controls', { price: 30, mass: 0.1, toggle: { var: 'on', on: 'Pull choke', off: 'Push choke in', label: 'Choke' }, edu: 'choke' });
comp('int.handbrake', 'Handbrake lever', 'brakes', 'Controls', { price: 60, mass: 1, toggle: { var: 'on', on: 'Apply handbrake', off: 'Release handbrake', label: 'Handbrake' } });
comp('int.gear_lever', 'Gear lever', 'transmission', 'Controls', { price: 45, mass: 0.6, toggle: { var: 'gear', on: 'Select 1st gear', off: 'Select neutral', label: 'Gear' } });
comp('int.steering_wheel', 'Steering wheel (wood rim, alloy spokes)', 'steering', 'Interior', { price: 380, mass: 1.5 });
comp('int.steering_column', 'Steering column (adjustable)', 'steering', 'Interior', { price: 260, mass: 4 });
comp('int.seat_L', 'Seat — left', 'interior', 'Interior', { price: 450, mass: 12 });
comp('int.seat_R', 'Seat — right (driver)', 'interior', 'Interior', { price: 450, mass: 12 });
comp('int.pedals', 'Pedal box (brake, clutch, throttle)', 'interior', 'Interior', { price: 220, mass: 4 });
comp('int.console', 'Centre console & tunnel trim', 'interior', 'Interior', { price: 160, mass: 3 });
comp('int.bonnet_release_L', 'Bonnet release handle — left', 'body', 'Controls', { price: 25, mass: 0.2, edu: 'bonnet' });
comp('int.bonnet_release_R', 'Bonnet release handle — right', 'body', 'Controls', { price: 25, mass: 0.2, edu: 'bonnet' });
for (const n of [1, 2]) {
  def({ id: `int.panel_screw_${n}`, name: `Centre panel thumb screw #${n}`, system: 'interior', group: 'Fuse box', accepts: ['p.panel_screw'], initial: 'p.panel_screw',
    thread: { size: '2BA', drive: 'hand', turns: 4, host: 'brass', handTight: true, torqueKey: 'panelScrew' } });
}
definePart({ id: 'p.panel_screw', name: 'Thumb screw (2BA)', system: 'interior', mass: 0.01, price: 2, kind: 'fastener', catalog: true });
comp('int.center_panel', 'Centre instrument panel (hinges down for fuse access)', 'interior', 'Fuse box', {
  price: 140, mass: 1.5, heldBy: ['int.panel_screw_1', 'int.panel_screw_2'], toggle: { var: 'open', on: 'Lower panel', off: 'Raise panel', label: 'Centre panel' } });

// ═══════════════════════ ENGINE (structure / internals) ═══════════════════════
comp('eng.block', 'Cylinder block (cast iron)', 'engine', 'Engine structure', { price: 2600, mass: 95, access: [BONNET], edu: 'block' });
definePart({ id: 'head_gasket', name: 'Cylinder head gasket (composite)', system: 'engine', mass: 0.4, price: 45, kind: 'consumable', catalog: true, edu: 'head_gasket',
  inspect: (p) => [p.flags.includes('damaged') ? 'Fire ring burnt through between cylinders 3 and 4; brown coolant staining across the land.' : p.flags.includes('crushed') ? 'Compressed and imprinted — a head gasket is single-use.' : 'New gasket, unmarked.'] });
for (const side of ['in', 'ex'] as const) {
  def({ id: `eng.cover_nuts_${side}`, name: `Camshaft cover domed nuts — ${side === 'in' ? 'inlet' : 'exhaust'} (set of 14)`, system: 'engine', group: 'Head fasteners', accepts: ['p.cover_nuts'], initial: 'p.cover_nuts',
    access: [BONNET], thread: { size: '1/4 UNF', drive: 'hex', driveSize: '7/16 AF', turns: 5, torqueKey: 'camCover', host: 'aluminium', stripFactor: 2.6, stiffness: 0.15 } });
  def({ id: `eng.cam_cover_${side}`, name: `Camshaft cover — ${side === 'in' ? 'inlet' : 'exhaust'} (polished, ribbed)`, system: 'engine', group: 'Engine structure', accepts: [`p.eng.cam_cover_${side}`], initial: `p.eng.cam_cover_${side}`,
    heldBy: [`eng.cover_nuts_${side}`, ...(side === 'in' ? ['lub.filler_cap'] : [])], access: [BONNET], edu: 'cam_cover' });
  definePart({ id: `p.eng.cam_cover_${side}`, name: `Camshaft cover — ${side === 'in' ? 'inlet' : 'exhaust'}`, system: 'engine', mass: 2.5, price: 380, kind: 'component', edu: 'cam_cover' });
}
definePart({ id: 'p.cover_nuts', name: 'Cam cover domed nuts & washers (set)', system: 'engine', mass: 0.15, price: 28, kind: 'fastener' });
def({ id: 'eng.head', name: 'Cylinder head (aluminium, hemispherical)', system: 'engine', group: 'Engine structure', accepts: ['p.eng.head'], initial: 'p.eng.head', heavy: true,
  heldBy: [...Array.from({ length: 14 }, (_, i) => `eng.head_nut_${i + 1}`), 'eng.conn_top_hose', 'ign.lead_1', 'ign.lead_2', 'ign.lead_3', 'ign.lead_4', 'ign.lead_5', 'ign.lead_6'],
  access: [BONNET, COLD, DRAINED, { type: 'removed', slot: 'eng.cam_cover_in' }, { type: 'removed', slot: 'eng.cam_cover_ex' }], edu: 'cylinder_head',
  hint: 'Undo the head nuts in the reverse of the tightening sequence — outside in.' });
definePart({ id: 'p.eng.head', name: 'Cylinder head assembly', system: 'engine', mass: 22, price: 2400, kind: 'component', edu: 'cylinder_head' });
def({ id: 'eng.head_gasket', name: 'Cylinder head gasket', system: 'engine', group: 'Engine structure', accepts: ['head_gasket'], initial: 'head_gasket',
  access: [{ type: 'removed', slot: 'eng.head' }], edu: 'head_gasket', hint: 'Always fit a new gasket; clean both faces first.' });
comp('eng.camshaft_in', 'Inlet camshaft', 'engine', 'Valvetrain', { price: 420, mass: 5, access: [PH3], edu: 'camshaft' });
comp('eng.camshaft_ex', 'Exhaust camshaft', 'engine', 'Valvetrain', { price: 420, mass: 5, access: [PH3], edu: 'camshaft' });
comp('eng.timing_chain', 'Duplex timing chains (two-stage) & tensioner', 'engine', 'Valvetrain', { price: 160, mass: 1.5, access: [PH3], edu: 'timing_chain' });
comp('eng.timing_cover', 'Timing cover', 'engine', 'Engine structure', { price: 260, mass: 4, access: [BONNET, PH3] });
def({ id: 'eng.sump_bolts', name: 'Sump bolts (set of 26)', system: 'lubrication', group: 'Bottom end', accepts: ['p.sump_bolts'], initial: 'p.sump_bolts', access: [STAND],
  thread: { size: '5/16 UNC', drive: 'hex', driveSize: '1/2 AF', turns: 8, torqueKey: 'sumpBolts', host: 'aluminium', stripFactor: 2.3, stiffness: 0.25 } });
definePart({ id: 'p.sump_bolts', name: 'Sump bolts & washers (set)', system: 'lubrication', mass: 0.4, price: 18, kind: 'fastener' });
comp('eng.sump', 'Sump (cast aluminium)', 'lubrication', 'Bottom end', { price: 650, mass: 9, access: [STAND], heldBy: ['eng.sump_bolts'], removable: true, edu: 'sump' });
comp('eng.oil_pump', 'Oil pump (eccentric rotor)', 'lubrication', 'Bottom end', { price: 210, mass: 2, access: [STAND, { type: 'removed', slot: 'eng.sump' }], removable: true, edu: 'oil_pump' });
comp('eng.oil_pickup', 'Oil pick-up & strainer', 'lubrication', 'Bottom end', { price: 70, mass: 0.6, access: [STAND, { type: 'removed', slot: 'eng.sump' }], removable: true });
comp('eng.damper', 'Crankshaft damper & pulley', 'engine', 'Engine structure', { price: 240, mass: 4, access: [BONNET, PH3] });
comp('eng.flywheel', 'Flywheel', 'engine', 'Engine structure', { price: 380, mass: 14, access: [PH3] });
def({ id: 'eng.mount_bolts', name: 'Engine mounting bolts (front, both sides)', system: 'engine', group: 'Engine connections', accepts: ['p.mount_bolts'], initial: 'p.mount_bolts', access: [UNDER_F],
  thread: { size: '3/8 UNF', drive: 'hex', driveSize: '9/16 AF', turns: 7, torqueKey: 'engineMount', host: 'steel', captive: true, releaseTurns: 4, stiffness: 0.35 }, edu: 'engine_mount' });
definePart({ id: 'p.mount_bolts', name: 'Engine mounting bolts', system: 'engine', mass: 0.2, price: 9, kind: 'fastener' });
comp('eng.mount_L', 'Engine mounting — left', 'engine', 'Engine structure', { price: 38, mass: 0.8, access: [BONNET, PH3], edu: 'engine_mount' });
comp('eng.mount_R', 'Engine mounting — right', 'engine', 'Engine structure', { price: 38, mass: 0.8, access: [BONNET, PH3], edu: 'engine_mount' });
comp('eng.breather', 'Engine breather', 'engine', 'Engine structure', { price: 40, mass: 0.4, access: [BONNET] });
const RODS_OFF = [1, 2, 3, 4, 5, 6].map((c) => ({ type: 'removed', slot: `eng.rod_nuts_${c}` }) as const);
def({ id: 'eng.main_bolts', name: 'Main bearing cap bolts (set of 14)', system: 'engine', group: 'Bottom end', accepts: ['p.main_bolts'], initial: 'p.main_bolts',
  access: [STAND, { type: 'removed', slot: 'eng.sump' }, { type: 'removed', slot: 'eng.oil_pump' }],
  thread: { size: '1/2 UNF', drive: 'hex', driveSize: '3/4 AF', turns: 12, torqueKey: 'mainBearing', host: 'iron', stripFactor: 1.9, stiffness: 1.4 }, edu: 'crankshaft' });
definePart({ id: 'p.main_bolts', name: 'Main bearing cap bolts (set)', system: 'engine', mass: 0.8, price: 42, kind: 'fastener' });
def({ id: 'eng.crankshaft', name: 'Crankshaft', system: 'engine', group: 'Bottom end', accepts: ['crankshaft'], initial: 'crankshaft', heavy: true,
  heldBy: ['eng.main_bolts'], access: [STAND, { type: 'removed', slot: 'eng.sump' }, ...RODS_OFF], edu: 'crankshaft' });
def({ id: 'eng.main_bearings', name: 'Main bearing shells (7 pairs)', system: 'engine', group: 'Bottom end', accepts: ['main_bearings_std', 'main_bearings_010', 'main_bearings_020'], initial: 'main_bearings_std',
  access: [STAND, { type: 'removed', slot: 'eng.crankshaft' }], edu: 'crankshaft', hint: 'Shell undersize must match the crankshaft: a reground crank needs undersize shells.' });
def({ id: 'eng.rod_bearings', name: 'Big-end bearing shells (6 pairs)', system: 'engine', group: 'Bottom end', accepts: ['rod_bearings_std', 'rod_bearings_010', 'rod_bearings_020'], initial: 'rod_bearings_std',
  access: [STAND, { type: 'removed', slot: 'eng.sump' }, ...RODS_OFF], edu: 'conrod' });
for (let c = 1; c <= 6; c++) {
  def({ id: `eng.rod_nuts_${c}`, name: `Big-end cap nuts — cylinder ${c}`, system: 'engine', group: 'Bottom end', accepts: ['p.rod_nuts'], initial: 'p.rod_nuts',
    access: [STAND, { type: 'removed', slot: 'eng.sump' }, { type: 'removed', slot: 'eng.oil_pump' }],
    thread: { size: '3/8 UNF', drive: 'hex', driveSize: '9/16 AF', turns: 7, torqueKey: 'conrod', host: 'steel', stripFactor: 2.1, stiffness: 0.8 }, edu: 'conrod' });
  def({ id: `eng.piston_${c}`, name: `Piston & rings — cylinder ${c}`, system: 'engine', group: 'Bottom end', accepts: ['piston'], initial: 'piston',
    access: [STAND, { type: 'removed', slot: 'eng.head' }, { type: 'removed', slot: `eng.rod_nuts_${c}` }], removable: true, edu: 'piston' });
  def({ id: `eng.conrod_${c}`, name: `Connecting rod — cylinder ${c}`, system: 'engine', group: 'Bottom end', accepts: ['conrod'], initial: 'conrod',
    access: [STAND, { type: 'removed', slot: 'eng.head' }, { type: 'removed', slot: `eng.rod_nuts_${c}` }], removable: true, edu: 'conrod' });
  comp(`eng.valve_in_${c}`, `Inlet valve, spring & retainer — cyl ${c}`, 'engine', 'Valvetrain', { price: 45, mass: 0.15, access: [PH3], edu: 'valve' });
  comp(`eng.valve_ex_${c}`, `Exhaust valve, spring & retainer — cyl ${c}`, 'engine', 'Valvetrain', { price: 48, mass: 0.15, access: [PH3], edu: 'valve' });
}
definePart({ id: 'p.rod_nuts', name: 'Big-end nuts (pair)', system: 'engine', mass: 0.04, price: 6, kind: 'fastener', catalog: true });
// Everything that ties the engine/gearbox unit to the car. All must be disconnected before the hoist can lift it.
const CONN: [string, string, 'b' | 'u'][] = [
  ['fuel', 'Fuel feed hose to the float chambers', 'b'], ['throttle', 'Throttle linkage', 'b'], ['choke', 'Cold-start cable', 'b'],
  ['coil', 'Coil HT & distributor LT leads', 'b'], ['alt', 'Alternator harness plug', 'b'], ['senders', 'Oil-pressure & temperature sender wires', 'b'],
  ['heater', 'Heater hoses', 'b'], ['top_hose', 'Top hose at thermostat housing', 'b'], ['bottom_hose', 'Bottom hose at water pump', 'b'], ['earth', 'Engine earth strap', 'b'],
  ['starter', 'Starter main cable & solenoid wire', 'u'], ['exhaust', 'Exhaust down-pipe flanges', 'u'], ['prop', 'Propshaft flange at gearbox', 'u'],
  ['clutch', 'Clutch slave cylinder', 'u'], ['speedo', 'Speedometer cable', 'u'], ['gear', 'Gear lever & remote housing', 'u'],
];
export const ENGINE_CONNECTIONS = CONN.map(([k]) => `eng.conn_${k}`);
for (const [k, name, w] of CONN) comp(`eng.conn_${k}`, name, 'engine', 'Engine connections', { price: 10, mass: 0.2, connector: true, access: [w === 'b' ? BONNET : UNDER_F] });
definePart({ id: 'p.head_nut', name: 'Cylinder head nut (domed, 7/16 UNF)', system: 'engine', mass: 0.05, price: 3, kind: 'fastener' });
for (let n = 1; n <= 14; n++) {
  def({ id: `eng.head_nut_${n}`, name: `Cylinder head nut #${n}`, system: 'engine', group: 'Head fasteners', accepts: ['p.head_nut'], initial: 'p.head_nut',
    access: [BONNET, COLD, { type: 'removed', slot: n <= 7 ? 'eng.cam_cover_in' : 'eng.cam_cover_ex' }], thread: { size: '7/16 UNF', drive: 'hex', driveSize: '3/4 AF', turns: 10, torqueKey: 'headNuts', host: 'steel', stiffness: 1.1 } });
}

// ═══════════════════════ LUBRICATION (service) ═══════════════════════
def({ id: 'lub.drain_plug', name: 'Sump drain plug', system: 'lubrication', group: 'Oil service', accepts: ['drain_plug'], initial: 'drain_plug', access: [UNDER_F], edu: 'drain_plug',
  thread: { size: '3/4 UNF', drive: 'hex', driveSize: '15/16 AF', turns: 7, torqueKey: 'drainPlug', host: 'aluminium', stripFactor: 2.0, stiffness: 0.45 },
  hint: 'Drain pan first. Oil runs out the moment the last thread lets go.' });
def({ id: 'lub.drain_washer', name: 'Drain plug sealing washer', system: 'lubrication', group: 'Oil service', accepts: ['washer_drain'], initial: 'washer_drain',
  access: [UNDER_F, { type: 'removed', slot: 'lub.drain_plug' }], edu: 'crush_washer' });
def({ id: 'lub.filter_bolt', name: 'Oil filter centre bolt', system: 'lubrication', group: 'Oil service', accepts: ['filter_bolt'], initial: 'filter_bolt', access: [UNDER_F], edu: 'oil_filter',
  thread: { size: '3/8 UNF', drive: 'hex', driveSize: '3/4 AF', turns: 9, torqueKey: 'filterBolt', host: 'aluminium', stripFactor: 2.2, stiffness: 0.35 } });
def({ id: 'lub.filter_canister', name: 'Oil filter canister', system: 'lubrication', group: 'Oil service', accepts: ['filter_canister'], initial: 'filter_canister', heldBy: ['lub.filter_bolt'], access: [UNDER_F], edu: 'oil_filter' });
def({ id: 'lub.filter_element', name: 'Oil filter element', system: 'lubrication', group: 'Oil service', parent: 'lub.filter_canister', accepts: ['filter_element'], initial: 'filter_element',
  access: [{ type: 'removed', slot: 'lub.filter_canister' }], edu: 'oil_filter', hint: 'The element sits inside the canister — remove the canister to reach it.' });
def({ id: 'lub.filter_seal', name: 'Filter head sealing ring', system: 'lubrication', group: 'Oil service', accepts: ['filter_seal'], initial: 'filter_seal',
  access: [UNDER_F, { type: 'removed', slot: 'lub.filter_canister' }], removeTool: ['pick'], edu: 'oil_filter', hint: 'Lift it out of the groove with a pick. The new ring comes with the element.' });
def({ id: 'lub.filler_cap', name: 'Oil filler cap', system: 'lubrication', group: 'Oil service', accepts: ['filler_cap'], initial: 'filler_cap', access: [BONNET],
  thread: { size: 'bayonet', drive: 'hand', turns: 1, host: 'aluminium', handTight: true, torqueKey: 'panelScrew' } });
def({ id: 'lub.dipstick', name: 'Dipstick', system: 'lubrication', group: 'Oil service', accepts: ['dipstick'], initial: 'dipstick', access: [BONNET], edu: 'dipstick' });

// ═══════════════════════ IGNITION ═══════════════════════
for (let c = 1; c <= 6; c++) {
  def({ id: `ign.lead_${c}`, name: `HT lead — cylinder ${c}`, system: 'ignition', group: 'Ignition', accepts: ['ht_lead'], initial: 'ht_lead', connector: true, access: [BONNET], edu: 'ht_lead' });
  def({ id: `ign.plug_${c}`, name: `Spark plug — cylinder ${c}`, system: 'ignition', group: 'Ignition', accepts: ['plug_n5', 'plug_l82y'], initial: 'plug_n5', heldBy: [`ign.lead_${c}`], access: [BONNET], edu: 'spark_plug',
    thread: { size: '14 mm × 1.25', drive: 'hex', driveSize: '13/16 AF', turns: 9, torqueKey: 'sparkPlug', host: 'aluminium', needsExtension: true, stripFactor: 1.9, stiffness: 0.5 },
    hint: 'Blow debris out of the plug well before removal. Start new plugs by hand.' });
}
def({ id: 'ign.dist_cap', name: 'Distributor cap', system: 'ignition', group: 'Ignition', accepts: ['dist_cap'], initial: 'dist_cap', access: [BONNET], edu: 'distributor' });
def({ id: 'ign.rotor', name: 'Rotor arm', system: 'ignition', group: 'Ignition', accepts: ['rotor'], initial: 'rotor', access: [BONNET, { type: 'removed', slot: 'ign.dist_cap' }], edu: 'distributor' });
comp('ign.distributor', 'Distributor body (contact breaker, advance mechanism)', 'ignition', 'Ignition', { price: 180, mass: 1.6, access: [BONNET], edu: 'distributor' });
comp('ign.points', 'Contact breaker points & condenser', 'ignition', 'Ignition', { price: 18, mass: 0.05, access: [BONNET, { type: 'removed', slot: 'ign.rotor' }, PH4], edu: 'distributor' });
comp('ign.coil', 'Ignition coil', 'ignition', 'Ignition', { price: 45, mass: 1.2, access: [BONNET], edu: 'coil' });

// ═══════════════════════ FUEL & INDUCTION ═══════════════════════
for (const [i, cyl] of [[1, '1–2 (rear)'], [2, '3–4 (centre)'], [3, '5–6 (front)']] as const)
  comp(`fuel.carb_${i}`, `SU HD8 carburettor — cylinders ${cyl}`, 'fuel', 'Fuel & induction', { price: 520, mass: 3.5, access: [BONNET, PH4], edu: 'carburettor' });
comp('fuel.inlet_manifold', 'Inlet manifold (water-heated)', 'fuel', 'Fuel & induction', { price: 480, mass: 7, access: [BONNET, PH3], edu: 'inlet_manifold' });
comp('fuel.air_box', 'Air cleaner housing & ram pipe', 'fuel', 'Fuel & induction', { price: 260, mass: 3, access: [BONNET], edu: 'air_filter' });
def({ id: 'fuel.air_cover', name: 'Air cleaner end cover', system: 'fuel', group: 'Fuel & induction', accepts: ['p.air_cover'], initial: 'p.air_cover', access: [BONNET],
  thread: { size: '1/4 UNF wing nuts', drive: 'hand', turns: 4, torqueKey: 'airCover', host: 'steel', handTight: true } });
definePart({ id: 'p.air_cover', name: 'Air cleaner end cover', system: 'fuel', mass: 0.6, price: 45, kind: 'component' });
def({ id: 'fuel.air_element', name: 'Air cleaner element', system: 'fuel', group: 'Fuel & induction', accepts: ['air_element'], initial: 'air_element', access: [BONNET, { type: 'removed', slot: 'fuel.air_cover' }], edu: 'air_filter' });
comp('fuel.tank', 'Fuel tank (14 gal) & immersed pump', 'fuel', 'Fuel & induction', { price: 520, mass: 12, edu: 'fuel_pump' });

// ═══════════════════════ COOLING ═══════════════════════
comp('cool.radiator', 'Radiator (cross-flow) & drain tap', 'cooling', 'Cooling', { price: 420, mass: 8, access: [BONNET], edu: 'radiator', toggle: { var: 'tap', on: 'Open drain tap (coolant runs out)', off: 'Close drain tap', label: 'Drain tap' } });
comp('cool.header_tank', 'Header tank', 'cooling', 'Cooling', { price: 160, mass: 1.2, access: [BONNET], edu: 'pressure_cap' });
def({ id: 'cool.header_cap', name: 'Header tank pressure cap', system: 'cooling', group: 'Cooling', accepts: ['header_cap'], initial: 'header_cap', access: [BONNET], edu: 'pressure_cap',
  thread: { size: 'bayonet', drive: 'hand', turns: 0.5, host: 'brass', handTight: true, torqueKey: 'panelScrew' }, hint: 'NEVER open when hot — pressurised coolant above 100 °C.' });
comp('cool.top_hose', 'Radiator top hose', 'cooling', 'Cooling', { price: 18, mass: 0.3, access: [BONNET], edu: 'hoses' });
def({ id: 'cool.bottom_hose', name: 'Radiator bottom hose', system: 'cooling', group: 'Cooling', accepts: ['bottom_hose'], initial: 'bottom_hose', access: [BONNET, PH4], edu: 'hoses' });
for (const [k, n] of [['rad', 'radiator end'], ['pump', 'water-pump end']] as const)
  def({ id: `cool.clip_${k}`, name: `Bottom hose clip — ${n}`, system: 'cooling', group: 'Cooling', accepts: ['hose_clip'], initial: 'hose_clip', access: [BONNET], edu: 'hose_clip',
    thread: { size: 'worm drive', drive: 'slot', turns: 8, torqueKey: 'hoseClip', host: 'rubber', captive: true, releaseTurns: 4, stripFactor: 3.5, stiffness: 0.03 } });
comp('cool.thermostat', 'Thermostat', 'cooling', 'Cooling', { price: 14, mass: 0.2, access: [BONNET, PH4], edu: 'thermostat' });
comp('cool.water_pump', 'Water pump', 'cooling', 'Cooling', { price: 95, mass: 3, access: [BONNET, PH4], edu: 'water_pump' });
comp('cool.fan', 'Electric cooling fan & thermostatic switch', 'cooling', 'Cooling', { price: 140, mass: 2.5, access: [BONNET], edu: 'cooling_fan' });

// ═══════════════════════ ELECTRICAL ═══════════════════════
def({ id: 'elec.term_neg', name: 'Battery terminal — NEGATIVE (earth)', system: 'electrical', group: 'Battery', accepts: ['term_clamp'], initial: 'term_clamp', connector: true, access: [BONNET], edu: 'battery',
  thread: { size: '1/4 UNF pinch bolt', drive: 'hex', driveSize: '7/16 AF', turns: 6, torqueKey: 'battClamp', host: 'brass', captive: true, releaseTurns: 1.5, stripFactor: 2.5, stiffness: 0.08 },
  hint: 'Disconnect NEGATIVE first, reconnect it LAST.' });
def({ id: 'elec.term_pos', name: 'Battery terminal — POSITIVE', system: 'electrical', group: 'Battery', accepts: ['term_clamp'], initial: 'term_clamp', connector: true, access: [BONNET], edu: 'battery',
  thread: { size: '1/4 UNF pinch bolt', drive: 'hex', driveSize: '7/16 AF', turns: 6, torqueKey: 'battClamp', host: 'brass', captive: true, releaseTurns: 1.5, stripFactor: 2.5, stiffness: 0.08 } });
def({ id: 'elec.batt_hold', name: 'Battery hold-down clamp', system: 'electrical', group: 'Battery', accepts: ['p.batt_hold'], initial: 'p.batt_hold', access: [BONNET],
  thread: { size: '1/4 UNF wing nuts', drive: 'hand', turns: 6, torqueKey: 'battHold', host: 'steel', handTight: true } });
definePart({ id: 'p.batt_hold', name: 'Battery hold-down clamp & rods', system: 'electrical', mass: 0.4, price: 15, kind: 'fastener' });
def({ id: 'elec.battery', name: 'Battery', system: 'electrical', group: 'Battery', accepts: ['battery_60ah'], initial: 'battery_60ah', heldBy: ['elec.batt_hold', 'elec.term_neg', 'elec.term_pos'], access: [BONNET], heavy: true, edu: 'battery' });
for (let f = 1; f <= 6; f++) {
  def({ id: `elec.fuse_${f}`, name: `Fuse #${f}`, system: 'electrical', group: 'Fuse box', accepts: ['fuse_25a', 'fuse_35a', 'fuse_50a'], initial: f === 1 ? 'fuse_50a' : 'fuse_35a',
    access: [{ type: 'state', key: 'panelOpen', label: 'Lower the centre instrument panel' }], removeTool: ['fuse_puller'], edu: 'fuse' });
}
comp('elec.alternator', 'Alternator', 'electrical', 'Charging', { price: 190, mass: 5, access: [BONNET], edu: 'alternator' });
def({ id: 'elec.alt_pivot', name: 'Alternator pivot bolt', system: 'electrical', group: 'Charging', accepts: ['p.alt_pivot'], initial: 'p.alt_pivot', access: [BONNET], edu: 'fan_belt',
  thread: { size: '5/16 UNF', drive: 'hex', driveSize: '1/2 AF', turns: 8, torqueKey: 'altPivot', host: 'steel', captive: true, releaseTurns: 1.5, stiffness: 0.3 } });
def({ id: 'elec.alt_adjust', name: 'Alternator adjusting-link bolt', system: 'electrical', group: 'Charging', accepts: ['p.alt_adjust'], initial: 'p.alt_adjust', access: [BONNET], edu: 'fan_belt',
  thread: { size: '5/16 UNF', drive: 'hex', driveSize: '1/2 AF', turns: 8, torqueKey: 'altAdjust', host: 'steel', captive: true, releaseTurns: 1.5, stiffness: 0.3 } });
definePart({ id: 'p.alt_pivot', name: 'Alternator pivot bolt', system: 'electrical', mass: 0.08, price: 3, kind: 'fastener' });
definePart({ id: 'p.alt_adjust', name: 'Adjusting-link bolt', system: 'electrical', mass: 0.05, price: 2, kind: 'fastener' });
def({ id: 'eng.fan_belt', name: 'Fan / alternator belt', system: 'engine', group: 'Charging', accepts: ['fan_belt'], initial: 'fan_belt', access: [BONNET], edu: 'fan_belt',
  hint: 'Slacken pivot and link bolts, swing the alternator in, then the belt comes off.' });
comp('elec.starter', 'Starter motor (pre-engaged) & solenoid', 'electrical', 'Starting', { price: 220, mass: 7, access: [UNDER_F, PH4], edu: 'starter' });
comp('elec.regulator', 'Voltage regulator', 'electrical', 'Charging', { price: 60, mass: 0.4, access: [BONNET] });
comp('elec.earth_strap', 'Engine earth strap', 'electrical', 'Starting', { price: 12, mass: 0.2, access: [BONNET], edu: 'earth_strap' });
comp('elec.horns', 'Horns (twin) & horn relay', 'electrical', 'Lighting', { price: 75, mass: 1.5, access: [BONNET] });
comp('elec.harness', 'Main wiring harness', 'electrical', 'Wiring', { price: 450, mass: 6, edu: 'harness' });

// ═══════════════════════ WHEELS / BRAKES / SUSPENSION ═══════════════════════
const SIDE = (c: Corner) => (c.endsWith('L') ? 'left' : 'right');
for (const c of ['FL', 'FR', 'RL', 'RR'] as Corner[]) {
  const front = c[0] === 'F';
  const nm = `${front ? 'front' : 'rear'} ${SIDE(c)}`;
  def({ id: `whl.spinner_${c}`, name: `Spinner — ${nm}`, system: 'wheels', group: 'Wheels', accepts: [c.endsWith('L') ? 'spinner_l' : 'spinner_r'], initial: c.endsWith('L') ? 'spinner_l' : 'spinner_r', edu: 'spinner',
    thread: { size: c.endsWith('L') ? 'LH splined hub' : 'RH splined hub', drive: 'spinner', turns: 5, torqueNm: 270, tolPct: 25, host: 'steel', leftHand: c.endsWith('L'), stiffness: 2.2 },
    hint: 'Break the spinner loose with the wheel on the ground. Strike the ear towards the rear of the car.' } as SlotDef);
  def({ id: `whl.${c}`, name: `Wheel — ${nm}`, system: 'wheels', group: 'Wheels', accepts: ['wheel_wire'], initial: 'wheel_wire', heldBy: [`whl.spinner_${c}`], heavy: true,
    access: [{ type: 'cornerRaised', corner: c }], edu: 'wire_wheel' });
  if (front) {
    def({ id: `brk.disc_${c}`, name: `Brake disc — ${nm}`, system: 'brakes', group: 'Brakes', accepts: ['brake_disc_f'], initial: 'brake_disc_f', removable: false, access: [{ type: 'removed', slot: `whl.${c}` }], edu: 'brake_disc' });
    def({ id: `brk.pads_${c}`, name: `Brake pads — ${nm}`, system: 'brakes', group: 'Brakes', accepts: ['brake_pads_f'], initial: 'brake_pads_f', removable: false, access: [{ type: 'removed', slot: `whl.${c}` }], edu: 'brake_pads' });
    comp(`brk.caliper_${c}`, `Brake caliper — ${nm}`, 'brakes', 'Brakes', { price: 160, mass: 3, access: [{ type: 'removed', slot: `whl.${c}` }, PH4], edu: 'caliper' });
    comp(`sus.hub_${c}`, `Hub & stub axle — ${nm}`, 'suspension', 'Front suspension', { price: 220, mass: 5, access: [PH4], edu: 'hub' });
    comp(`sus.uwb_${c}`, `Upper wishbone & ball joint — ${nm}`, 'suspension', 'Front suspension', { price: 140, mass: 2, access: [PH4], edu: 'wishbone' });
    comp(`sus.lwb_${c}`, `Lower wishbone & ball joint — ${nm}`, 'suspension', 'Front suspension', { price: 180, mass: 3, access: [PH4], edu: 'wishbone' });
    comp(`sus.damper_${c}`, `Front damper — ${nm}`, 'suspension', 'Front suspension', { price: 95, mass: 1.5, access: [PH4], edu: 'damper' });
  } else {
    comp(`brk.disc_${c}`, `Inboard brake disc — ${nm}`, 'brakes', 'Brakes', { price: 70, mass: 5, access: [UNDER_R, PH4], edu: 'brake_disc' });
    comp(`brk.caliper_${c}`, `Inboard caliper & handbrake mechanism — ${nm}`, 'brakes', 'Brakes', { price: 190, mass: 3.5, access: [UNDER_R, PH4], edu: 'caliper' });
    comp(`sus.damper_${c}a`, `Rear coil-spring/damper unit (front) — ${nm}`, 'suspension', 'Rear suspension', { price: 140, mass: 3, access: [UNDER_R, PH4], edu: 'damper' });
    comp(`sus.damper_${c}b`, `Rear coil-spring/damper unit (rear) — ${nm}`, 'suspension', 'Rear suspension', { price: 140, mass: 3, access: [UNDER_R, PH4], edu: 'damper' });
    comp(`sus.halfshaft_${c}`, `Drive shaft (upper link) — ${nm}`, 'suspension', 'Rear suspension', { price: 210, mass: 5, access: [UNDER_R, PH4], edu: 'irs' });
    comp(`sus.wishbone_${c}`, `Lower wishbone & hub carrier — ${nm}`, 'suspension', 'Rear suspension', { price: 260, mass: 7, access: [UNDER_R, PH4], edu: 'irs' });
    comp(`sus.radius_arm_${c}`, `Radius arm — ${nm}`, 'suspension', 'Rear suspension', { price: 80, mass: 2, access: [UNDER_R, PH4], edu: 'irs' });
  }
}
comp('sus.torsion_L', 'Torsion bar — left', 'suspension', 'Front suspension', { price: 180, mass: 6, access: [PH4], edu: 'torsion_bar' });
comp('sus.torsion_R', 'Torsion bar — right', 'suspension', 'Front suspension', { price: 180, mass: 6, access: [PH4], edu: 'torsion_bar' });
comp('sus.arb_F', 'Front anti-roll bar', 'suspension', 'Front suspension', { price: 90, mass: 4, access: [PH4] });
comp('sus.arb_R', 'Rear anti-roll bar', 'suspension', 'Rear suspension', { price: 90, mass: 3, access: [PH4] });
comp('sus.irs_cage', 'IRS cage (sub-frame) & mountings', 'suspension', 'Rear suspension', { price: 700, mass: 22, access: [UNDER_R, PH4], edu: 'irs' });
comp('str.rack', 'Steering rack & tie rods', 'steering', 'Steering', { price: 380, mass: 7, access: [PH4], edu: 'steering_rack' });
comp('brk.master', 'Brake master cylinder & servo', 'brakes', 'Brakes', { price: 320, mass: 5, access: [BONNET, PH4], edu: 'master_cylinder' });
comp('brk.reservoir', 'Brake fluid reservoir', 'brakes', 'Brakes', { price: 30, mass: 0.3, access: [BONNET], edu: 'master_cylinder' });
comp('clu.reservoir', 'Clutch fluid reservoir', 'transmission', 'Clutch', { price: 30, mass: 0.3, access: [BONNET], edu: 'clutch_hydraulics' });

// ═══════════════════════ TRANSMISSION / EXHAUST ═══════════════════════
comp('trn.gearbox', '4-speed all-synchromesh gearbox', 'transmission', 'Transmission', { price: 2200, mass: 38, access: [PH4], edu: 'gearbox' });
comp('trn.bellhousing', 'Clutch bellhousing & clutch', 'transmission', 'Transmission', { price: 600, mass: 12, access: [PH4], edu: 'clutch' });
comp('trn.propshaft', 'Propeller shaft', 'transmission', 'Transmission', { price: 260, mass: 8, access: [PH4] });
comp('trn.diff', 'Final drive (Powr-Lok LSD)', 'transmission', 'Transmission', { price: 1800, mass: 30, access: [UNDER_R, PH4], edu: 'differential' });
definePart({ id: 'p.level_plug', name: 'Level / filler plug', system: 'transmission', mass: 0.06, price: 6, kind: 'fastener' });
def({ id: 'trn.gbx_level', name: 'Gearbox level/filler plug', system: 'transmission', group: 'Transmission', accepts: ['p.level_plug'], initial: 'p.level_plug', access: [UNDER_F],
  thread: { size: '1/2 BSP', drive: 'hex', driveSize: '7/8 AF', turns: 6, torqueKey: 'fillPlugGbx', host: 'iron', stiffness: 0.5 }, hint: 'Correct level: oil just reaches the bottom of the plug hole.' });
def({ id: 'trn.diff_level', name: 'Differential level/filler plug', system: 'transmission', group: 'Transmission', accepts: ['p.level_plug'], initial: 'p.level_plug', access: [UNDER_R],
  thread: { size: '1/2 BSP', drive: 'hex', driveSize: '3/4 AF', turns: 6, torqueKey: 'fillPlugDiff', host: 'iron', stiffness: 0.5 } });
comp('exh.manifold_F', 'Exhaust manifold — front (cyl 4–6)', 'exhaust', 'Exhaust', { price: 280, mass: 9, access: [BONNET, PH3], edu: 'exhaust_manifold' });
comp('exh.manifold_R', 'Exhaust manifold — rear (cyl 1–3)', 'exhaust', 'Exhaust', { price: 280, mass: 9, access: [BONNET, PH3], edu: 'exhaust_manifold' });
comp('exh.system', 'Twin down-pipes, silencers & tail pipes', 'exhaust', 'Exhaust', { price: 620, mass: 18, access: [UNDER_F, PH4], edu: 'exhaust' });

export const SLOT_LIST = Object.values(SLOTS);
export const slotDef = (id: string) => {
  const s = SLOTS[id];
  if (!s) throw new Error(`Unknown slot ${id}`);
  return s;
};
export function torqueSpecNm(t: ThreadSpec): number | null {
  if (t.torqueNm != null) return t.torqueNm;
  if (t.torqueKey && TORQUE[t.torqueKey]) return TORQUE[t.torqueKey].nm;
  return null;
}
