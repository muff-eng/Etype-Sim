/**
 * Fastener mechanics: tool engagement, thread engagement, seating, torque build-up, breakaway,
 * cross-threading, stripping and rounding. All consequences follow deterministic rules.
 */
import { slotDef, type SlotDef } from '../data/slots';
import { TOOLS, sizeFit, type Fit, type ToolDef } from '../data/tools';
import { AF } from '../core/units';
import type { VehicleState } from './vehicle';
import { partIn, specTorque } from './vehicle';

export interface Grip {
  primary: string | null;     // tool id in hand (null = bare hand)
  socket: string | null;
  extension: boolean;
}

export interface DriveCheck {
  ok: boolean;
  reason?: string;
  fit: Fit;
  maxTorque: number;
  rate: number;          // deg/s
  torqueWrench: boolean;
  hand: boolean;
  label: string;
  warn?: string;
}

const HAND: DriveCheck = { ok: true, fit: 'exact', maxTorque: 3, rate: 330, torqueWrench: false, hand: true, label: 'Hand' };

export function describeGrip(g: Grip): string {
  if (!g.primary) return 'Bare hands';
  const t = TOOLS[g.primary];
  if (['ratchet', 'breaker_bar', 'torque_wrench'].includes(t.kind)) {
    const s = g.socket ? TOOLS[g.socket].name : 'no socket';
    return `${t.name} + ${g.extension ? 'extension + ' : ''}${s}`;
  }
  return t.name;
}

export function driveCheck(slot: SlotDef, g: Grip, turnsIn = 0, seatedTorque = 0): DriveCheck {
  const th = slot.thread;
  if (!th) return { ...HAND, ok: false, reason: 'Not a threaded fastener' };
  const t: ToolDef | null = g.primary ? TOOLS[g.primary] : null;
  const fastMm = th.driveSize ? AF[th.driveSize] : undefined;

  if (!t) {
    if (th.drive === 'hand' || th.handTight) return HAND;
    if (th.drive === 'spinner') return { ...HAND, maxTorque: 25, label: 'Hand (spinning a loose spinner)' };
    if (th.drive === 'slot') return { ...HAND, ok: false, reason: 'Needs a flat-blade screwdriver' };
    if (th.captive) return { ...HAND, ok: false, reason: `Needs a ${th.driveSize} spanner or socket` };
    // Starting or running threads by hand is allowed (and is the correct way to start a fastener)
    return { ...HAND, maxTorque: 2.5, label: 'Fingers (start / run threads)' };
  }

  if (th.drive === 'hand') return { ...HAND, ok: false, reason: 'Finger-tight item — use your hand, not a tool' };

  switch (th.drive) {
    case 'spinner':
      if (t.kind === 'copper_mallet') return { ok: true, fit: 'exact', maxTorque: 420, rate: 34, torqueWrench: false, hand: false, label: 'Copper/hide mallet' };
      if (t.kind === 'hammer') return { ok: true, fit: 'exact', maxTorque: 420, rate: 34, torqueWrench: false, hand: false, label: 'Steel hammer', warn: 'A steel hammer will chip the chrome spinner' };
      return { ...HAND, ok: false, reason: 'Spinners are driven with a copper/hide mallet' };
    case 'slot':
      if (t.kind === 'screwdriver_flat') return { ok: true, fit: 'exact', maxTorque: t.maxTorque ?? 6, rate: t.turnRate ?? 240, torqueWrench: false, hand: false, label: t.name };
      return { ...HAND, ok: false, reason: 'Needs a flat-blade screwdriver' };
    case 'hex': {
      if (['ratchet', 'breaker_bar', 'torque_wrench'].includes(t.kind)) {
        if (!g.socket) return { ...HAND, ok: false, reason: 'Fit a socket to the drive first' };
        const s = TOOLS[g.socket];
        if (th.needsExtension && !g.extension) return { ...HAND, ok: false, reason: 'Recessed fastener — add an extension bar' };
        if (slot.id.startsWith('ign.plug_') && s.kind !== 'plug_socket') return { ...HAND, ok: false, reason: 'A standard socket is too shallow for the plug insulator — use the plug socket' };
        const fit = sizeFit(s.sizeMm, fastMm);
        if (fit === 'nofit') return { ...HAND, ok: false, fit, reason: `${s.size} does not fit a ${th.driveSize} hex` };
        return {
          ok: true, fit, maxTorque: t.maxTorque ?? 100, rate: t.turnRate ?? 120, torqueWrench: t.kind === 'torque_wrench', hand: false,
          label: `${t.name} + ${s.size}`, warn: fit === 'loose' ? `${s.size} is a loose fit on ${th.driveSize} — it may round the flats` : undefined,
        };
      }
      if (t.kind === 'spanner' || t.kind === 'adjustable') {
        if (th.needsExtension) return { ...HAND, ok: false, reason: 'Recessed in the head — a spanner cannot reach. Use a socket and extension.' };
        const fit = t.kind === 'adjustable' ? 'loose' : sizeFit(t.sizeMm, fastMm);
        if (fit === 'nofit') return { ...HAND, ok: false, fit, reason: `${t.size} does not fit a ${th.driveSize} hex` };
        return { ok: true, fit, maxTorque: t.maxTorque ?? 60, rate: t.turnRate ?? 50, torqueWrench: false, hand: false, label: t.name, warn: fit === 'loose' ? 'Poor fit — risk of rounding' : undefined };
      }
      return { ...HAND, ok: false, reason: `Needs a ${th.driveSize} socket or spanner` };
    }
  }
  return { ...HAND, ok: false, reason: 'Wrong tool' };
}

export interface TurnCtx {
  dir: 'undo' | 'do';
  dt: number;                // real seconds
  torqueSetting?: number;    // torque wrench setting Nm
  wrenchError?: number;      // calibration error multiplier (1 = perfect)
  restrained?: boolean;      // the item can resist rotation (wheel on ground etc.)
  penetrated?: number;       // 0..1 penetrating oil effect
  pull: { t: number; clicked: boolean; applied: number; broke: boolean };  // per-hold state
}

export interface TurnResult {
  events: ('click' | 'crack' | 'seated' | 'stall' | 'strip' | 'round' | 'crossthread' | 'out' | 'released' | 'spin' | 'chip' | 'ratchet' | 'thunk')[];
  applied: number;
  msg?: string;
}

/** Advances a fastener being worked by the player. Mutates slot state. */
export function workFastener(v: VehicleState, slotId: string, dc: DriveCheck, ctx: TurnCtx, toolKind: string | null): TurnResult {
  const d = slotDef(slotId);
  const th = d.thread!;
  const s = v.slots[slotId];
  const part = partIn(v, slotId);
  const res: TurnResult = { events: [], applied: 0 };
  if (!part) return { ...res, msg: 'Nothing fitted' };
  const spec = specTorque(slotId) || 5;
  const seated = s.turnsIn >= th.turns - 0.01;
  const deg = dc.rate * ctx.dt;
  const strip = spec * (th.stripFactor ?? 2.4);
  const rounded = part.flags.includes('rounded');
  const effMax = dc.maxTorque * (rounded && !dc.hand ? (dc.fit === 'exact' ? 0.55 : 0.2) : 1);
  const tick = () => { if (Math.random() < ctx.dt * (dc.rate / 60)) res.events.push(th.drive === 'spinner' ? 'thunk' : 'ratchet'); };

  if (ctx.dir === 'undo') {
    if (s.torque > 0.05 && seated) {
      // Breaking loose: applied torque ramps up until breakaway or tool limit
      const seize = (s.vars.seize ?? 0) * (1 - 0.6 * (ctx.penetrated ?? 0));
      const breakaway = s.torque * 1.15 * (1 + seize * 3) + (s.crossThreaded ? 10 : 0);
      if (th.drive === 'spinner' && !ctx.restrained) {
        res.events.push('spin');
        return { ...res, msg: 'The wheel just turns with each blow — break the spinner loose with the wheel on the ground (or the handbrake on for a rear wheel).' };
      }
      ctx.pull.applied = Math.min(effMax, ctx.pull.applied + Math.max(40, breakaway * 1.4) * ctx.dt);
      res.applied = ctx.pull.applied;
      if (dc.torqueWrench) {
        v.slots[slotId].vars.twAbuse = 1;
      }
      if (dc.fit === 'loose' && ctx.pull.applied > Math.min(breakaway, 0.45 * effMax) && !rounded && ctx.pull.applied > 15) {
        part.flags.push('rounded');
        res.events.push('round');
        return { ...res, msg: 'The tool slips — the flats are rounding off!' };
      }
      if (ctx.pull.applied >= breakaway) {
        s.torque = 0;
        ctx.pull.broke = true;
        s.vars.seize = 0;
        res.events.push('crack');
        if (toolKind === 'hammer') { if (!part.flags.includes('chipped')) part.flags.push('chipped'); res.events.push('chip'); }
        return { ...res, msg: 'Cracked loose.' };
      }
      if (ctx.pull.applied >= effMax - 0.01) {
        res.events.push('stall');
        return { ...res, msg: dc.hand ? 'Too tight to turn by hand.' : 'Won’t budge with this tool — more leverage, penetrating oil, or check the direction.' };
      }
      tick();
      return res;
    }
    // Running out
    const running = s.crossThreaded ? 6 : 0.4;
    if (running > effMax) { res.events.push('stall'); return { ...res, msg: 'Binding — too stiff to turn by hand.' }; }
    s.torque = 0;
    s.turnsIn = Math.max(0, s.turnsIn - deg / 360);
    if (th.captive) {
      const min = th.turns - (th.releaseTurns ?? 1) - 1.5;
      if (s.turnsIn <= min) { s.turnsIn = min; res.events.push('released'); return { ...res, msg: 'Fully slackened.' }; }
    } else if (s.turnsIn <= 0) {
      s.turnsIn = 0;
      s.crossThreaded = false;
      res.events.push('out');
      return { ...res, msg: 'Free of the thread.' };
    }
    tick();
    return res;
  }

  // ── Tightening ──
  if (!seated) {
    // Starting: a tool (not fingers) on the first turns of an un-started thread cross-threads it
    const hostCanCross = th.drive === 'hex' && !th.captive;
    if (hostCanCross && s.turnsIn < 0.6 && !s.handStarted && !dc.hand && !s.crossThreaded) {
      s.crossThreaded = true;
      res.events.push('crossthread');
    }
    if (dc.hand && s.turnsIn >= 0.6) s.handStarted = true;
    if (dc.hand && s.turnsIn < 0.6) s.handStarted = s.turnsIn + deg / 360 >= 0.6;
    const running = s.crossThreaded ? 3 + s.turnsIn * 7 : 0.4;
    res.applied = running;
    if (running > effMax) {
      res.events.push('stall');
      return { ...res, msg: s.crossThreaded ? 'It has jammed solid after a turn — this is cross-threaded. Back it out.' : 'Too stiff to turn by hand — use the tool now.' };
    }
    if (s.crossThreaded) {
      s.threadDamage = Math.min(1, s.threadDamage + (deg / 360) * 0.25);
      if (s.turnsIn > 2.5) {
        s.threadDamage = 1;
        res.events.push('strip');
        return { ...res, msg: 'Forced in cross-threaded — the host thread is ruined.' };
      }
    }
    s.turnsIn = Math.min(th.turns, s.turnsIn + deg / 360);
    if (s.turnsIn >= th.turns - 0.01) { res.events.push('seated'); return { ...res, msg: 'Seated.' }; }
    tick();
    return res;
  }

  // Seated: building torque
  if (th.drive === 'spinner' && !ctx.restrained) {
    const cap = 60;
    if (s.torque >= cap) { res.events.push('spin'); return { ...res, applied: s.torque, msg: 'The wheel turns with each blow — lower it to the ground for final tightening.' }; }
  }
  if (s.threadDamage >= 1) {
    s.torque = Math.min(s.torque, spec * 0.3);
    res.events.push('spin');
    return { ...res, applied: s.torque, msg: 'It just spins — the thread is stripped.' };
  }
  const stiff = th.stiffness ?? 0.5;
  const err = dc.torqueWrench ? (ctx.wrenchError ?? 1) : 1;
  let add = stiff * deg;
  if (dc.torqueWrench && ctx.pull.clicked) add *= 0.35; // overshooting after the click
  const next = Math.min(effMax, s.torque + add);
  if (next >= effMax - 0.01 && s.torque >= effMax - 0.01) { res.events.push('stall'); return { ...res, applied: s.torque, msg: 'At the limit of this tool.' }; }
  if (dc.fit === 'loose' && next > 0.45 * dc.maxTorque && next > 15 && !rounded) {
    part.flags.push('rounded'); res.events.push('round');
    return { ...res, applied: s.torque, msg: 'The tool slips — the flats are rounding!' };
  }
  s.torque = next;
  res.applied = next;
  if (dc.torqueWrench && ctx.torqueSetting && !ctx.pull.clicked && next * err >= ctx.torqueSetting) {
    ctx.pull.clicked = true;
    res.events.push('click');
  }
  if (toolKind === 'hammer' && !part.flags.includes('chipped')) { part.flags.push('chipped'); res.events.push('chip'); }
  if (next > strip && th.host !== 'rubber' && !th.handTight) {
    s.threadDamage = 1;
    s.torque = spec * 0.3;
    res.events.push('strip');
    return { ...res, applied: s.torque, msg: `Sudden give — the ${th.host} thread has stripped! (${Math.round(next)} Nm against ${spec} Nm spec)` };
  }
  if (th.host === 'rubber' && next > strip) {
    // Worm-drive clip over-tightened: cuts into the hose
    const hose = partIn(v, 'cool.bottom_hose');
    if (hose && !hose.flags.includes('damaged')) hose.flags.push('damaged');
  }
  tick();
  return res;
}

export type TorqueVerdict = 'correct' | 'under' | 'over' | 'loose' | 'stripped' | 'crossthreaded' | 'none';
export function torqueVerdict(v: VehicleState, slotId: string): TorqueVerdict {
  const d = slotDef(slotId);
  const th = d.thread;
  const s = v.slots[slotId];
  if (!th || !s.part) return 'none';
  if (s.threadDamage >= 1) return 'stripped';
  if (s.crossThreaded) return 'crossthreaded';
  if (s.turnsIn < th.turns - 0.05) return 'loose';
  const spec = specTorque(slotId);
  if (!spec) return 'correct';
  if (th.handTight) return s.torque >= spec * 0.35 ? 'correct' : 'under';
  if (th.drive === 'spinner') return s.torque >= spec * 0.75 ? 'correct' : 'under';
  const tol = (th.tolPct ?? 12) / 100;
  if (s.torque < spec * (1 - tol)) return 'under';
  if (s.torque > spec * (1 + tol)) return 'over';
  return 'correct';
}
