/** Accessibility & dependency rules: can a slot be worked on right now, and if not, why not. */
import { SLOTS, slotDef, type AccessReq } from '../data/slots';
import type { VehicleState } from './vehicle';
import { bonnetOpen, endOnStands, endRaised, isReleased, wheelOffGround } from './vehicle';

export const BUILD_PHASE = 3; // 1: workshop/car, 2: Tier I systems, 3: Tier II engine removal & bottom end

export interface AccessResult {
  ok: boolean;
  reasons: string[];
  unsafe?: string;          // allowed, but a safety violation
}

function stateOk(v: VehicleState, key: string): boolean {
  const sv = (id: string, k = 'open') => (v.slots[id]?.vars[k] ?? 0) > 0.5;
  switch (key) {
    case 'doorOpenL': return sv('body.door_L');
    case 'doorOpenR': return sv('body.door_R');
    case 'hatchOpen': return sv('body.hatch');
    case 'panelOpen': return sv('int.center_panel');
    case 'bootFloorOpen': return sv('body.boot_floor') && sv('body.hatch');
    case 'engineOff': return !v.engine.running;
    case 'engineCold': return v.engine.coolantC < 50;
    case 'engineOnStand': return v.engineLoc === 'stand';
    case 'coolantLow': return Object.values(v.coolant.comp).reduce((a, b) => a + (b ?? 0), 0) < 1.0;
  }
  return false;
}

export function checkReq(v: VehicleState, r: AccessReq): { ok: boolean; reason?: string; unsafe?: string } {
  switch (r.type) {
    case 'bonnetOpen': return bonnetOpen(v) || v.engineLoc === 'stand' ? { ok: true } : { ok: false, reason: 'Bonnet is closed' };
    case 'under': {
      if (!endRaised(v, r.end, 0.2)) return { ok: false, reason: `Raise the ${r.end} of the car (≥ 200 mm) to get underneath` };
      if (!endOnStands(v, r.end)) return { ok: true, unsafe: `Working under the ${r.end} of the car supported only by a jack` };
      return { ok: true };
    }
    case 'cornerRaised': return wheelOffGround(v, r.corner) ? { ok: true } : { ok: false, reason: `Raise the ${r.corner} corner until the wheel is clear of the floor` };
    case 'removed': return v.slots[r.slot]?.part ? { ok: false, reason: `Remove ${SLOTS[r.slot].name} first` } : { ok: true };
    case 'state': return stateOk(v, r.key) ? { ok: true } : { ok: false, reason: r.label };
    case 'phase': return r.phase <= BUILD_PHASE ? { ok: true } : { ok: false, reason: r.label };
  }
}

/** Can the player physically reach this slot (to inspect closely, remove, fit or turn its fastener)? */
export function canReach(v: VehicleState, slotId: string): AccessResult {
  const d = slotDef(slotId);
  const reasons: string[] = [];
  let unsafe: string | undefined;
  for (const r of d.access ?? []) {
    const res = checkReq(v, r);
    if (!res.ok && res.reason) reasons.push(res.reason);
    if (res.unsafe) unsafe = res.unsafe;
  }
  // A child slot is only reachable through its parent's opening
  return { ok: reasons.length === 0, reasons, unsafe };
}

/** Can the part in this slot be lifted out now (fasteners released, access available)? */
export function canRemove(v: VehicleState, slotId: string): AccessResult {
  const d = slotDef(slotId);
  const base = canReach(v, slotId);
  const reasons = [...base.reasons];
  if (!v.slots[slotId].part) reasons.push('Nothing fitted');
  if (d.removable === false) reasons.push('Not removable in this build (structural / later phase)');
  if (d.thread && !d.thread.captive && v.slots[slotId].turnsIn > 0.01) reasons.push('Still threaded in — unscrew it first');
  for (const f of d.heldBy ?? []) {
    if (!isReleased(v, f)) {
      const fd = SLOTS[f];
      reasons.push(fd.connector ? `Disconnect ${fd.name}` : fd.thread?.captive ? `Slacken ${fd.name}` : `Remove ${fd.name}`);
    }
  }
  return { ok: reasons.length === 0, reasons, unsafe: base.unsafe };
}

/** Can a part be fitted into this (empty) slot now? */
export function canFit(v: VehicleState, slotId: string, partDef: string): AccessResult {
  const d = slotDef(slotId);
  const base = canReach(v, slotId);
  const reasons = [...base.reasons];
  if (v.slots[slotId].part) reasons.push('Slot already occupied');
  if (!d.accepts.includes(partDef)) reasons.push('Part does not fit this location');
  if (d.parent && slotId !== 'lub.filter_element' && !v.slots[d.parent].part) reasons.push(`Fit ${SLOTS[d.parent].name} first`);
  return { ok: reasons.length === 0, reasons, unsafe: base.unsafe };
}

/** Slots that hold this part on (for UI). */
export const holders = (slotId: string) => slotDef(slotId).heldBy ?? [];
