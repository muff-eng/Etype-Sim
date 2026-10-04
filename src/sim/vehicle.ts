import { PARTS } from '../data/parts';
import { SLOTS, SLOT_LIST, slotDef } from '../data/slots';
import type { Composition } from '../data/fluids';
import { uid } from '../core/rng';
import { TORQUE } from '../data/spec';
import type { Corner, CornerSupport, PartOrigin, PartState, SlotState } from './types';
import { CORNERS } from './types';

export interface FluidCircuitState {
  comp: Composition;      // litres of each fluid currently in the circuit (static portion)
}

export interface OilState extends FluidCircuitState {
  canister: number;       // L held in the filter canister
  gallery: number;        // L circulating in galleries while running
  tempC: number;
  oilOnEngine: number;    // L spilled on hot engine surfaces
}

export interface EngineRuntime {
  running: boolean;
  rpm: number;
  crankAngle: number;     // degrees, 0..720
  cranking: boolean;
  crankTime: number;
  coolantC: number;
  oilPressure: number;    // psi
  chargeV: number;
  fuelBowls: number;      // 0..1 float chamber fill
  fanOn: boolean;
  misfire: number[];      // per cylinder 1..6: 0 firing, 1 dead
  roughness: number;
  backfire: number;
  bearingDamage: number;
  headGasketDamage: number;
  smoke: { blue: number; white: number; black: number; steam: number };
  sinceStop: number;      // game seconds since engine stopped
  ranSinceService: boolean;
  stallTimer: number;
  throttle: number;
  lastStartAttempt: number;
}

export interface VehicleState {
  id: string;
  slots: Record<string, SlotState>;
  parts: Record<string, PartState>;   // instances installed in the vehicle
  support: Record<Corner, CornerSupport>;
  chocks: boolean;
  oil: OilState;
  coolant: FluidCircuitState & { pressureCapOff?: boolean; leakRate: number };
  brake: FluidCircuitState;
  clutch: FluidCircuitState;
  gearbox: FluidCircuitState;
  diff: FluidCircuitState;
  fuelL: number;
  engine: EngineRuntime;
  funnelIn: boolean;
  floorSpill: number;
  odometer: number;
}

export function newPart(defId: string, origin: PartOrigin = 'new', location: PartState['location'] = 'stock', overrides: Partial<PartState> = {}): PartState {
  const d = PARTS[defId];
  if (!d) throw new Error(`Unknown part ${defId}`);
  const id = uid(defId);
  const vars = { ...(d.defaults ?? {}), ...(d.newVars ? d.newVars(id) : {}) };
  if (d.fluid) vars.volume = Object.values(d.fluid).reduce((a, b) => a + (b ?? 0), 0);
  return { uid: id, def: defId, condition: origin === 'new' ? 1 : 0.8, flags: [], vars, known: { measured: {} }, origin, location, ...overrides };
}

function emptySlot(): SlotState {
  return { part: null, turnsIn: 0, torque: 0, handStarted: false, crossThreaded: false, threadDamage: 0, vars: {} };
}

/** Builds a complete, correctly assembled vehicle with factory-fresh parts. Scenarios then age/fault it. */
export function createVehicle(): VehicleState {
  const v: VehicleState = {
    id: uid('veh'),
    slots: {}, parts: {},
    support: Object.fromEntries(CORNERS.map((c) => [c, { height: 0, jack: false, stand: 0 }])) as Record<Corner, CornerSupport>,
    chocks: false,
    oil: { comp: { oil_20w50: 7.95 }, canister: 0.55, gallery: 0, tempC: 18, oilOnEngine: 0 },
    coolant: { comp: { coolant_iat: 9.1, water: 9.1 }, leakRate: 0 },
    brake: { comp: { brake_dot4: 0.9 } },
    clutch: { comp: { brake_dot4: 0.3 } },
    gearbox: { comp: { gear_ep90: 1.42 } },
    diff: { comp: { gear_ep90: 1.56 } },
    fuelL: 30,
    engine: {
      running: false, rpm: 0, crankAngle: 0, cranking: false, crankTime: 0, coolantC: 18, oilPressure: 0, chargeV: 0,
      fuelBowls: 1, fanOn: false, misfire: [0, 0, 0, 0, 0, 0], roughness: 0, backfire: 0, bearingDamage: 0, headGasketDamage: 0,
      smoke: { blue: 0, white: 0, black: 0, steam: 0 }, sinceStop: 9999, ranSinceService: false, stallTimer: 0, throttle: 0, lastStartAttempt: 0,
    },
    funnelIn: false,
    floorSpill: 0,
    odometer: 48210,
  };
  for (const s of SLOT_LIST) {
    const st = emptySlot();
    v.slots[s.id] = st;
    const p = newPart(s.initial, 'factory', 'vehicle', { condition: 0.9 });
    p.slot = s.id;
    if ((p.vars.new ?? 0) > 0) { p.vars.new = 0; p.vars.gap = 0.64; }
    v.parts[p.uid] = p;
    st.part = p.uid;
    if (s.thread) {
      st.turnsIn = s.thread.turns;
      st.torque = specTorque(s.id);
      st.handStarted = true;
    }
  }
  // Default control positions
  slotVars(v, 'body.bonnet').latchL = 1;
  slotVars(v, 'body.bonnet').latchR = 1;
  slotVars(v, 'int.handbrake').on = 1;
  for (let c = 1; c <= 6; c++) slotVars(v, `ign.lead_${c}`).target = c;
  const belt = partIn(v, 'eng.fan_belt');
  if (belt) belt.vars.deflection = 12;
  return v;
}

export function specTorque(slotId: string): number {
  const t = SLOTS[slotId]?.thread;
  if (!t) return 0;
  if (t.torqueNm != null) return t.torqueNm;
  return t.torqueKey && TORQUE[t.torqueKey] ? TORQUE[t.torqueKey].nm : 0;
}

export const slotVars = (v: VehicleState, id: string) => v.slots[id].vars;
export const partIn = (v: VehicleState, slotId: string): PartState | null => {
  const s = v.slots[slotId];
  return s && s.part ? v.parts[s.part] ?? null : null;
};
export const isOn = (v: VehicleState, slotId: string, key = 'on') => (v.slots[slotId]?.vars[key] ?? 0) > 0.5;

/** Seated & present (threaded parts must be fully engaged). */
export function isFitted(v: VehicleState, slotId: string): boolean {
  const s = v.slots[slotId];
  if (!s?.part) return false;
  const d = slotDef(slotId);
  if (d.connector && (s.vars.off ?? 0) > 0.5) return false;
  if (d.thread && !d.thread.captive) return s.turnsIn >= d.thread.turns - 0.05;
  return true;
}

/** A captive fastener is released once backed off by its release turns; a removable one when removed. */
export function isReleased(v: VehicleState, slotId: string): boolean {
  const s = v.slots[slotId];
  const d = slotDef(slotId);
  if (!s.part) return true;
  if (d.connector) return (s.vars.off ?? 0) > 0.5;
  if (d.thread?.captive) return s.turnsIn <= d.thread.turns - (d.thread.releaseTurns ?? 1);
  return false;
}

/** Captive thread backed off far enough (ignores connector state). */
export function threadReleased(v: VehicleState, slotId: string): boolean {
  const d = slotDef(slotId);
  const s = v.slots[slotId];
  if (!d.thread) return true;
  return s.turnsIn <= d.thread.turns - (d.thread.releaseTurns ?? 1);
}

export function bonnetOpen(v: VehicleState) { return (v.slots['body.bonnet'].vars.open ?? 0) > 0.95; }

export function cornerLift(v: VehicleState, c: Corner) { return v.support[c].height; }
export const DROOP = 0.055; // suspension droop before wheel leaves the ground (m)
export function wheelOffGround(v: VehicleState, c: Corner) { return v.support[c].height > DROOP + 0.01; }
export function endRaised(v: VehicleState, end: 'front' | 'rear', min = 0.2) {
  const [a, b] = end === 'front' ? (['FL', 'FR'] as Corner[]) : (['RL', 'RR'] as Corner[]);
  return v.support[a].height >= min && v.support[b].height >= min;
}
export function endOnStands(v: VehicleState, end: 'front' | 'rear') {
  const [a, b] = end === 'front' ? (['FL', 'FR'] as Corner[]) : (['RL', 'RR'] as Corner[]);
  const sa = v.support[a], sb = v.support[b];
  return sa.stand > 0 && sb.stand > 0 && sa.height <= sa.stand + 0.01 && sb.height <= sb.stand + 0.01;
}
export function onGround(v: VehicleState) {
  return CORNERS.every((c) => v.support[c].height < 0.005 && !v.support[c].jack && v.support[c].stand === 0);
}
export function isLevel(v: VehicleState) {
  return CORNERS.every((c) => Math.abs(v.support[c].height) < 0.01);
}

/** Installed sump/static oil (litres). */
export const sumpOil = (v: VehicleState) => Object.values(v.oil.comp).reduce((a, b) => a + (b ?? 0), 0);
export const OIL_MAX = 7.95;
export const OIL_MIN = 6.25;
export const COOLANT_FULL = 18.2;
