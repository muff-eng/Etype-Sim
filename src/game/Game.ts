/**
 * Game controller: owns GameState, advances the simulation, routes fluids to the pan/floor,
 * and exposes the verbs used by the 3D interaction layer and the UI.
 */
import { bus, notify, sound } from '../core/events';
import { createVehicle, newPart, partIn, sumpOil, isOn, slotVars, onGround, wheelOffGround, OIL_MAX, OIL_MIN, COOLANT_FULL, isReleased, isFitted, specTorque, threadReleased } from '../sim/vehicle';
import type { VehicleState } from '../sim/vehicle';
import { simulate, type SimOut } from '../sim/engine';
import { canFit, canReach, canRemove, checkReq } from '../sim/access';
import { driveCheck, workFastener, type Grip, type DriveCheck, torqueVerdict } from '../sim/threads';
import { evaluate, elecInputsFrom, meterOhms, meterVolts, testLamp, TEST_POINTS, type NodeId } from '../sim/electrical';
import { PARTS, type MeasurementDef } from '../data/parts';
import { SLOTS, slotDef } from '../data/slots';
import { TOOLS, TOOL_LIST } from '../data/tools';
import { FAULTS } from '../data/faults';
import { JOB_BY_ID, LABOUR_RATE, type JobDef } from '../data/jobs';
import { PROCEDURES, type ProcCtx } from '../data/procedures';
import { addFluid, removeFluid, total, antifreeze, compatibility, FLUIDS, type Composition, type FluidId } from '../data/fluids';
import { POINTS, JACK_POINTS, STAND_POINTS, poseFn, type V3 } from '../data/layout';
import { CORNERS, type Corner, type PartState, type SystemId, conditionLabel } from '../sim/types';
import { DAY_START, SAVE_VERSION, type GameState, type JobState, type Settings } from './state';
import { h01, hashStr, mulberry32, uid } from '../core/rng';
import { clamp, fmt, toLbft } from '../core/units';
import { SPEC } from '../data/spec';
import { assemblyCheck, analyzeVehicle } from '../sim/diagnostics';

export type JackPos = Corner | 'F';
export interface MeterState { mode: 'V' | 'R' | 'C'; red: NodeId | null; black: NodeId | null; reading: string; lamp: number }

const SKILLS: SystemId[] = ['body', 'engine', 'lubrication', 'cooling', 'fuel', 'ignition', 'electrical', 'transmission', 'suspension', 'steering', 'brakes', 'wheels', 'interior', 'exhaust'];

export function defaultSettings(): Settings {
  return { assist: 'beginner', edu: true, volume: 0.7, paint: '#1d3a2c', timeScale: 6, quality: 'high' };
}

export class Game {
  state: GameState;
  grip: Grip = { primary: null, socket: null, extension: false };
  dir: 'undo' | 'do' = 'undo';
  torqueSetting = 34;
  held: string | null = null;            // inventory uid held in hand (containers)
  meter: MeterState = { mode: 'V', red: null, black: null, reading: '—', lamp: 0 };
  work: { slot: string | null; dc: DriveCheck | null; pull: { t: number; clicked: boolean; applied: number; broke: boolean }; msg: string; lastEvents: string[] } =
    { slot: null, dc: null, pull: { t: 0, clicked: false, applied: 0, broke: false }, msg: '', lastEvents: [] };
  jack = { at: null as JackPos | null, lift: 0 };
  sim: SimOut | null = null;
  flows: Record<string, number> = {};    // visual flow rates L/s (game)
  pouring: { target: string; rate: number } | null = null;
  inflating: { corner: string; dir: 1 | -1 } | null = null;
  lastDipstick: { level: number; valid: boolean; note: string; color: number } | null = null;
  private engagedPrev = false;
  private autosaveT = 0;
  private procDone = new Set<string>();
  sandbox = false;

  constructor(state?: GameState) {
    this.state = state ?? Game.freshState('menu');
  }

  static freshState(mode: GameState['mode']): GameState {
    return {
      version: SAVE_VERSION, mode, money: 2500, time: DAY_START,
      vehicle: createVehicle(),
      inventory: {},
      tools: TOOL_LIST.filter((t) => t.owned).map((t) => t.id),
      workshop: { drainPan: { x: 1.9, z: -1.5, comp: {} }, jack: { corner: null }, stands: [], standsOwned: 2, spills: [], charger: { connected: false, amps: 6 }, wrenchError: 1, upgrades: [], penetrating: {} },
      job: null,
      settings: defaultSettings(),
      progress: { skills: Object.fromEntries(SKILLS.map((s) => [s, 0])) as any, xp: Object.fromEntries(SKILLS.map((s) => [s, 0])) as any, rep: 20, completed: {} },
      log: [],
    };
  }

  get v(): VehicleState { return this.state.vehicle; }
  get ws() { return this.state.workshop; }
  get assist() { return this.state.settings.assist; }
  get jobDef(): JobDef | null { return this.state.job ? JOB_BY_ID[this.state.job.id] ?? null : null; }

  log(text: string) {
    this.state.log.push({ t: this.state.time, text });
    if (this.state.log.length > 300) this.state.log.shift();
  }
  addTime(minutes: number) { this.state.time += minutes * 60; }
  milestone(m: string) {
    const j = this.state.job;
    if (j && !j.milestones.includes(m)) j.milestones.push(m);
  }
  hasMilestone(m: string) { return !!this.state.job?.milestones.includes(m); }
  violation(text: string) {
    const j = this.state.job;
    if (j && !j.violations.includes(text)) { j.violations.push(text); notify(`⚠ ${text}`, 'bad'); }
    else if (!j) notify(`⚠ ${text}`, 'warn');
  }
  damage(text: string) {
    const j = this.state.job;
    if (j && !j.damage.includes(text)) j.damage.push(text);
    notify(text, 'bad');
  }
  recordTest(tag: string, label: string, value: string, system?: SystemId) {
    const j = this.state.job;
    this.milestone(tag);
    if (j) {
      j.tests.push({ id: uid('test'), t: this.state.time, tag, label, value, system });
      bus.emit('test:recorded', { id: tag });
    }
  }

  // ───────────── Game lifecycle ─────────────
  startJob(jobId: string) {
    const jd = JOB_BY_ID[jobId];
    const st = this.state;
    st.mode = 'tier1';
    st.vehicle = createVehicle();
    st.vehicle.odometer = jd.mileage;
    jd.setup?.(st.vehicle);
    for (const f of jd.faults) FAULTS[f].apply(st.vehicle);
    st.vehicle.engine.ranSinceService = false;
    st.workshop.drainPan = { x: 1.9, z: -1.5, comp: {} };
    st.workshop.stands = []; st.workshop.spills = []; st.workshop.charger.connected = false;
    this.jack = { at: null, lift: 0 };
    st.inventory = Object.fromEntries(Object.entries(st.inventory).filter(([, p]) => p.location === 'stock'));
    st.job = {
      id: jobId, startedAt: st.time, milestones: [], latched: [], tests: [], violations: [], notes: '', diagnosis: null, diagnosisAt: null,
      partsBilled: [], replaced: [], damage: [], spilledL: 0, fixedAt: {},
    };
    this.procDone.clear();
    this.sandbox = false;
    this.log(`Job started: ${jd.title} (${jd.customer})`);
    bus.emit('job:changed', {});
    bus.emit('vehicle:changed', {});
    bus.emit('workshop:changed', {});
  }

  startSandbox() {
    const st = this.state;
    st.mode = 'sandbox';
    st.vehicle = createVehicle();
    st.job = null;
    this.sandbox = true;
    this.jack = { at: null, lift: 0 };
    for (const t of TOOL_LIST) if (!t.phase || t.phase <= 2) if (!st.tools.includes(t.id)) st.tools.push(t.id);
    bus.emit('job:changed', {});
    bus.emit('vehicle:changed', {});
    bus.emit('tools:changed', {});
  }

  // ───────────── Tick ─────────────
  tick(dtReal: number) {
    const st = this.state;
    if (st.mode === 'menu') return;
    const scale = st.settings.timeScale;
    st.time += dtReal * scale;
    this.updateSupport(dtReal);
    // Charger
    if (st.workshop.charger.connected) {
      const b = partIn(this.v, 'elec.battery');
      if (b) b.vars.charge = Math.min(1, (b.vars.charge ?? 0) + (st.workshop.charger.amps * 0.85 * dtReal * scale) / 3600 / (60 * (b.vars.health ?? 1)));
    }
    // Tyre slow leaks
    for (const c of CORNERS) {
      const w = partIn(this.v, `whl.${c}`);
      if (w && (w.vars.leak ?? 0) > 0) w.vars.pressure = Math.max(0, (w.vars.pressure ?? 0) - (w.vars.leak ?? 0) * dtReal * scale / 3600);
    }
    if (this.pouring) this.pourTick(dtReal);
    if (this.inflating) this.inflateTick(dtReal);
    if (this.work.slot) this.workTick(dtReal);
    const out = simulate(this.v, dtReal, scale, this.engagedPrev);
    this.engagedPrev = out.elec.solenoidEngaged;
    this.sim = out;
    this.route(out, dtReal * scale);
    this.engineEvents(out);
    this.updateProcedures();
    this.trackFaults();
    this.autosaveT += dtReal;
  }

  private engineEvents(out: SimOut) {
    for (const e of out.events) {
      switch (e) {
        case 'start': sound('engine_catch'); notify('The engine fires and settles into an idle.', 'good'); this.milestone('ran_after_service'); break;
        case 'stall': sound('engine_stop', 0.6); break;
        case 'backfire': sound('backfire'); break;
        case 'click': sound('solenoid', 0.7); break;
        case 'catch': sound('cough', 0.5); break;
        case 'fuse': sound('pop', 0.4); notify('A fuse has blown.', 'bad'); break;
        case 'steam': break;
        case 'knock': sound('knock', 0.6); break;
      }
      bus.emit('engine:event', { name: e as any });
    }
  }

  /** Advance time quickly (waiting for oil to drain, battery to charge, engine to cool). */
  wait(minutes: number) {
    const st = this.state;
    let remaining = minutes * 60;
    const scaleSave = st.settings.timeScale;
    while (remaining > 0) {
      const big = this.v.engine.running ? 4 : 30;
      const dtG = Math.min(remaining, big);
      st.settings.timeScale = dtG / (1 / 30);
      this.tick(1 / 30);
      remaining -= dtG;
    }
    st.settings.timeScale = scaleSave;
    notify(`${minutes} min passed.`, 'info');
  }

  private route(out: SimOut, dtG: number) {
    const pose = this.pose();
    this.flows = {};
    for (const f of out.outflows) {
      const l = total(f.comp);
      if (l <= 0) continue;
      this.flows[f.at] = (this.flows[f.at] ?? 0) + l / Math.max(1e-6, dtG);
      const local: V3 = f.at === 'drain' ? POINTS.drainPlug : f.at === 'filter' ? POINTS.filterBottom : f.at === 'hose' ? POINTS.bottomHoseRad : [1.55, 0.2, 0.36];
      const w = pose.apply(local);
      this.catchFluid(w[0], w[2], f.comp, f.at === 'hose' || f.at === 'cap' ? 'coolant' : 'oil');
    }
    for (const l of out.leaks) this.flows[`leak_${l.at}`] = l.rate;
  }

  catchFluid(x: number, z: number, comp: Composition, kind: 'oil' | 'coolant') {
    const pan = this.ws.drainPan;
    const l = total(comp);
    if (Math.hypot(pan.x - x, pan.z - z) < 0.24 && total(pan.comp) + l <= 12) {
      for (const [k, q] of Object.entries(comp)) addFluid(pan.comp, k as FluidId, q ?? 0);
      return;
    }
    // Floor spill
    let s = this.ws.spills.find((p) => Math.hypot(p.x - x, p.z - z) < 0.3 && p.kind === kind);
    if (!s) { s = { x, z, r: 0.02, kind }; this.ws.spills.push(s); }
    s.r = Math.min(1.1, Math.sqrt(s.r * s.r + l * 0.12));
    if (this.state.job) {
      this.state.job.spilledL += l;
      if (this.state.job.spilledL > 0.2 && !this.state.job.violations.some((v) => v.startsWith('Spilt'))) this.violation('Spilt fluid on the workshop floor — position the drain pan first');
    }
  }

  // ───────────── Vehicle support (jack / stands) ─────────────
  pose() { return poseFn(Object.fromEntries(CORNERS.map((c) => [c, this.v.support[c].height])) as Record<Corner, number>); }
  jackCorners(at: JackPos | null): Corner[] { return at === 'F' ? ['FL', 'FR'] : at ? [at] : []; }

  private updateSupport(_dt: number) {
    for (const c of CORNERS) {
      const s = this.v.support[c];
      const onJack = this.jackCorners(this.jack.at).includes(c);
      s.jack = onJack && this.jack.lift > 0.001;
      s.height = Math.max(onJack ? this.jack.lift : 0, s.stand);
    }
  }

  placeJack(at: JackPos) {
    if (this.v.engine.running) return notify('Switch the engine off before jacking.', 'warn');
    if (this.jack.at && this.jack.lift > 0.002) return notify('Lower the jack before moving it.', 'warn');
    this.jack = { at, lift: 0 };
    sound('jack_roll');
    if (!this.v.chocks && !isOn(this.v, 'int.handbrake')) this.violation('Jacked without chocks or handbrake');
    const corners = this.jackCorners(at);
    const startH = Math.max(...corners.map((c) => this.v.support[c].stand), 0);
    this.jack.lift = startH > 0 ? 0 : 0;
    notify(`Trolley jack positioned at ${at === 'F' ? 'front cross-member' : `${at} jacking point`}. Hold to pump.`, 'info');
    bus.emit('workshop:changed', {});
  }
  removeJack() {
    if (!this.jack.at) return;
    const holding = this.jackCorners(this.jack.at).some((c) => this.jack.lift > this.v.support[c].stand + 0.002);
    if (holding) return notify('The jack is carrying the car — lower it first.', 'warn');
    this.jack = { at: null, lift: 0 };
    bus.emit('workshop:changed', {});
  }
  pumpJack(dir: 1 | -1, dt: number) {
    if (!this.jack.at) return;
    const corners = this.jackCorners(this.jack.at);
    if (dir > 0) {
      const minStand = Math.max(...corners.map((c) => this.v.support[c].stand), 0);
      if (this.jack.lift < minStand) this.jack.lift = minStand;
      this.jack.lift = Math.min(0.42, this.jack.lift + 0.055 * dt);
      if (Math.random() < dt * 3) sound('jack_pump');
    } else {
      this.jack.lift = Math.max(0, this.jack.lift - 0.09 * dt);
      if (Math.random() < dt * 2) sound('hiss', 0.3);
    }
    this.updateSupport(dt);
    bus.emit('vehicle:changed', { reason: 'support' });
  }
  placeStand(c: Corner) {
    const h = this.v.support[c].height;
    if (this.ws.stands.includes(c)) return notify('A stand is already there.', 'warn');
    if (this.ws.stands.length >= this.ws.standsOwned) return notify('All your axle stands are in use (buy another pair).', 'warn');
    if (h < 0.12) return notify('Raise the car higher first — the stand will not fit under.', 'warn');
    this.v.support[c].stand = Math.floor(h / 0.02) * 0.02;
    this.ws.stands.push(c);
    sound('metal_place');
    bus.emit('workshop:changed', {});
    bus.emit('vehicle:changed', { reason: 'support' });
  }
  removeStand(c: Corner) {
    const s = this.v.support[c];
    if (!this.ws.stands.includes(c)) return;
    if (!(this.jackCorners(this.jack.at).includes(c) && this.jack.lift > s.stand + 0.004)) return notify('The car is resting on this stand — take the weight on the jack first.', 'warn');
    s.stand = 0;
    this.ws.stands = this.ws.stands.filter((k) => k !== c);
    sound('metal_place');
    bus.emit('workshop:changed', {});
  }
  toggleChocks() { this.v.chocks = !this.v.chocks; sound('thud', 0.4); bus.emit('workshop:changed', {}); }
  placeDrainPan(x: number, z: number) {
    this.ws.drainPan.x = x; this.ws.drainPan.z = z;
    sound('plastic', 0.5);
    bus.emit('workshop:changed', {});
  }
  emptyDrainPan() {
    const l = total(this.ws.drainPan.comp);
    this.ws.drainPan.comp = {};
    this.addTime(3);
    notify(`Emptied ${fmt(l, 1)} L into the waste-oil drum.`, 'info');
    bus.emit('workshop:changed', {});
  }
  cleanSpills() {
    if (!this.ws.spills.length) return;
    this.ws.spills = [];
    this.addTime(8);
    this.state.money -= 4;
    notify('Spread absorbent granules and swept up (£4, 8 min).', 'info');
    bus.emit('workshop:changed', {});
  }

  // ───────────── Tools ─────────────
  owns(toolId: string) { return this.state.tools.includes(toolId); }
  ownsKind(kind: string) { return this.state.tools.some((t) => TOOLS[t]?.kind === kind); }
  toolKind() { return this.grip.primary ? TOOLS[this.grip.primary].kind : null; }
  selectTool(id: string | null) {
    if (id && !this.owns(id)) return;
    const t = id ? TOOLS[id] : null;
    if (t && (t.kind === 'socket' || t.kind === 'plug_socket')) {
      this.grip.socket = id;
      if (!this.grip.primary || !['ratchet', 'breaker_bar', 'torque_wrench'].includes(TOOLS[this.grip.primary].kind)) this.grip.primary = this.state.tools.find((x) => TOOLS[x].kind === 'ratchet') ?? this.grip.primary;
    } else if (t && t.kind === 'extension') {
      this.grip.extension = !this.grip.extension;
    } else {
      this.grip.primary = id;
    }
    this.held = null;
    if (this.meter.red || this.meter.black) this.meter = { ...this.meter, red: null, black: null };
    sound('tool_pick', 0.5);
    bus.emit('tools:changed', {});
  }
  hold(uidItem: string | null) {
    this.held = uidItem;
    if (uidItem) this.grip.primary = null;
    bus.emit('tools:changed', {});
  }
  toggleDir() { this.dir = this.dir === 'undo' ? 'do' : 'undo'; sound('ratchet_flip', 0.5); bus.emit('tools:changed', {}); }

  // ───────────── Fastener work ─────────────
  isRestrained(slotId: string) {
    const m = slotId.match(/^whl\.spinner_(\w\w)$/);
    if (!m) return true;
    const c = m[1] as Corner;
    if (!wheelOffGround(this.v, c)) return true;
    if (c[0] === 'R' && (isOn(this.v, 'int.handbrake') || isOn(this.v, 'int.gear_lever', 'gear'))) return true;
    return false;
  }
  driveFor(slotId: string): DriveCheck {
    const s = this.v.slots[slotId];
    return driveCheck(SLOTS[slotId], this.grip, s.turnsIn, s.torque);
  }
  beginWork(slotId: string): boolean {
    const d = SLOTS[slotId];
    if (!d.thread || !this.v.slots[slotId].part) return false;
    const r = canReach(this.v, slotId);
    if (!r.ok) { notify(r.reasons[0], 'warn'); return false; }
    if (r.unsafe) this.violation(r.unsafe);
    if (d.connector && (this.v.slots[slotId].vars.off ?? 0) > 0.5) { notify('Connect it first.', 'warn'); return false; }
    const dc = this.driveFor(slotId);
    if (!dc.ok) { notify(dc.reason ?? 'Wrong tool', 'warn'); return false; }
    if (dc.warn) notify(dc.warn, 'warn');
    if (slotId === 'elec.term_pos' && this.dir === 'undo' && !isReleased(this.v, 'elec.term_neg') && !dc.hand) {
      this.violation('Disconnected the positive terminal with the earth still connected — a spanner touching the body would short the battery');
      sound('spark');
    }
    this.work = { slot: slotId, dc, pull: { t: 0, clicked: false, applied: 0, broke: false }, msg: '', lastEvents: [] };
    bus.emit('tools:changed', {});
    return true;
  }
  endWork() {
    const w = this.work;
    if (!w.slot) return;
    const slotId = w.slot;
    const s = this.v.slots[slotId];
    const th = SLOTS[slotId].thread!;
    if (w.dc?.torqueWrench && this.dir === 'do' && s.turnsIn >= th.turns - 0.01) {
      const spec = specTorque(slotId);
      const verdict = torqueVerdict(this.v, slotId);
      if (this.assist === 'beginner' || this.assist === 'experienced') notify(`Torqued: ${fmt(s.torque, 0)} Nm (spec ${spec} Nm) — ${verdict === 'correct' ? '✓ within specification' : verdict.toUpperCase()}`, verdict === 'correct' ? 'good' : 'warn');
    }
    if (w.dc?.torqueWrench && this.dir === 'undo' && w.pull.applied > 20) {
      this.ws.wrenchError = Math.min(1.25, this.ws.wrenchError + 0.04);
      this.violation('Used the torque wrench to undo a fastener — its calibration is now suspect');
    }
    this.work = { slot: null, dc: null, pull: { t: 0, clicked: false, applied: 0, broke: false }, msg: '', lastEvents: [] };
    bus.emit('vehicle:changed', { slot: slotId });
    bus.emit('tools:changed', {});
  }
  private workTick(dt: number) {
    const w = this.work;
    const slotId = w.slot!;
    if (!this.v.slots[slotId].part) return this.endWork();
    const pen = this.ws.penetrating[slotId] != null ? clamp((this.state.time - this.ws.penetrating[slotId]) / 600, 0, 1) : 0;
    const r = workFastener(this.v, slotId, w.dc!, {
      dir: this.dir, dt, torqueSetting: this.torqueSetting, wrenchError: this.ws.wrenchError, restrained: this.isRestrained(slotId), penetrated: pen, pull: w.pull,
    }, this.toolKind());
    this.addTime(dt * 0.6);
    w.msg = r.msg ?? w.msg;
    w.lastEvents = r.events;
    for (const e of r.events) {
      switch (e) {
        case 'ratchet': sound(w.dc?.hand ? 'thread' : 'ratchet', 0.6); break;
        case 'thunk': sound('mallet', 0.9); break;
        case 'click': sound('tw_click'); notify('Click.', 'good'); break;
        case 'crack': sound('crack'); break;
        case 'seated': sound('seat', 0.6); break;
        case 'stall': if (Math.random() < dt * 3) sound('strain', 0.4); break;
        case 'strip': sound('strip'); this.damage(r.msg ?? 'Thread stripped'); break;
        case 'round': sound('slip'); this.damage(`${SLOTS[slotId].name}: flats rounded by a poorly fitting tool`); break;
        case 'crossthread': sound('strain', 0.5); notify('It feels gritty and tight after half a turn…', 'warn'); this.violation(`${SLOTS[slotId].name} started with a tool instead of by hand (cross-threading risk)`); break;
        case 'chip': this.damage('Spinner chrome chipped by a steel hammer'); break;
        case 'spin': if (Math.random() < dt * 2) sound('mallet', 0.4); break;
        case 'out': this.onFastenerOut(slotId); break;
        case 'released': break;
      }
      if (e === 'crack' || e === 'stall' || e === 'out' || e === 'seated' || e === 'released') bus.emit('vehicle:changed', { slot: slotId });
    }
    if (r.msg && ['stall', 'spin'].some((x) => r.events.includes(x as any)) && Math.random() < dt) notify(r.msg, 'warn');
    if (r.events.includes('crack') || r.events.includes('out')) notify(r.msg ?? '', 'info');
    if (slotId.startsWith('whl.spinner_') && this.dir === 'undo' && w.pull.broke) this.milestone(`spinner_loose_${slotId.slice(-2)}`);
  }

  private onFastenerOut(slotId: string) {
    const s = this.v.slots[slotId];
    const p = partIn(this.v, slotId);
    if (!p) return;
    this.toTray(slotId);
    if (slotId === 'lub.drain_plug') {
      notify('The plug comes free — oil gushes out!', 'info');
      sound('pour_start');
    }
    this.endWork();
  }

  /** Move a vehicle part to the parts tray. */
  toTray(slotId: string) {
    const s = this.v.slots[slotId];
    const p = s.part ? this.v.parts[s.part] : null;
    if (!p) return;
    delete this.v.parts[p.uid];
    p.location = 'tray'; p.slot = slotId;
    this.state.inventory[p.uid] = p;
    s.part = null; s.turnsIn = 0; s.torque = 0; s.handStarted = false; s.crossThreaded = false;
    if (slotId === 'lub.filter_canister') {
      const spill = Math.min(0.2, this.v.oil.canister);
      const pose = this.pose();
      const w = pose.apply(POINTS.filterBottom);
      this.catchFluid(w[0], w[2], { oil_20w50_used: spill }, 'oil');
      this.v.oil.canister = 0;
      this.milestone('filter_off');
    }
    if (slotId.startsWith('ign.plug_')) this.milestone('plug_out');
    bus.emit('vehicle:changed', { slot: slotId });
    bus.emit('inventory:changed', {});
  }

  removePart(slotId: string) {
    const d = SLOTS[slotId];
    const r = canRemove(this.v, slotId);
    if (!r.ok) return notify(r.reasons[0], 'warn');
    if (r.unsafe) this.violation(r.unsafe);
    if (d.removeTool && d.removeTool.length) {
      const has = d.removeTool.some((k) => this.toolKind() === k);
      if (!has && slotId === 'lub.filter_seal') return notify('Your fingers cannot get under the ring — use a pick.', 'warn');
      if (!has && slotId.startsWith('elec.fuse_')) notify('Prised out with fingers — use a fuse puller next time.', 'info');
    }
    if (slotId.startsWith('ign.plug_') && this.v.engine.coolantC > 60) this.violation('Removed spark plugs from a hot aluminium head (thread damage risk)');
    this.addTime(d.heavy ? 2 : 0.5);
    sound(d.heavy ? 'thud' : 'part_remove');
    this.toTray(slotId);
    if (d.heavy) notify(`${d.name} lifted out.`, 'info');
  }

  fitPart(slotId: string, partUid: string) {
    const p = this.state.inventory[partUid];
    if (!p) return;
    const r = canFit(this.v, slotId, p.def);
    if (!r.ok) return notify(r.reasons[0], 'warn');
    if (r.unsafe) this.violation(r.unsafe);
    delete this.state.inventory[partUid];
    p.location = 'vehicle'; p.slot = slotId;
    this.v.parts[p.uid] = p;
    const s = this.v.slots[slotId];
    s.part = p.uid; s.turnsIn = 0; s.torque = 0; s.handStarted = false; s.crossThreaded = false;
    const d = SLOTS[slotId];
    if (d.connector) s.vars.off = 1;
    if (!d.thread) s.turnsIn = 0;
    if (d.thread?.captive) { s.turnsIn = d.thread.turns - (d.thread.releaseTurns ?? 1) - 1.5; }
    if (p.origin === 'new' && this.state.job && !this.state.job.replaced.includes(slotId)) this.state.job.replaced.push(slotId);
    if (p.origin === 'new' && this.state.job) this.state.job.partsBilled.push({ def: p.def, price: PARTS[p.def].price });
    if (slotId === 'lub.drain_washer' && p.flags.includes('crushed')) notify('That washer has already been crushed once…', 'warn');
    if (slotId === 'lub.filter_canister' && !this.v.slots['lub.filter_element'].part) notify('The canister is empty — no filter element!', 'warn');
    if (slotId === 'lub.drain_plug' && !this.v.slots['lub.drain_washer'].part) notify('No sealing washer on the plug.', 'warn');
    if (PARTS[p.def].wrongFor) this.violation(`Fitted an incorrect part: ${PARTS[p.def].name}`);
    sound(d.heavy ? 'thud' : 'part_fit', 0.7);
    this.addTime(d.heavy ? 2 : 0.5);
    notify(`${PARTS[p.def].name} fitted${d.thread ? ' — now thread it in' : ''}${d.connector ? ' (connect it)' : ''}.`, 'info');
    bus.emit('vehicle:changed', { slot: slotId });
    bus.emit('inventory:changed', {});
  }

  setConnector(slotId: string, connect: boolean, target?: number) {
    const d = SLOTS[slotId];
    const s = this.v.slots[slotId];
    if (!s.part) return;
    const r = canReach(this.v, slotId);
    if (!r.ok) return notify(r.reasons[0], 'warn');
    if (d.thread && !threadReleased(this.v, slotId) && !connect) return notify(`Slacken the pinch bolt first (${d.thread.driveSize}).`, 'warn');
    if (!connect) {
      if (slotId.startsWith('ign.lead_') && this.v.engine.running) {
        if (this.toolKind() !== 'insulated_pliers') {
          sound('zap'); this.violation('Pulled an HT lead off a running engine bare-handed (20 kV shock)'); notify('ZAP! A painful 20 kV jolt up your arm.', 'bad');
        }
        const before = Math.round(this.v.engine.rpm);
        s.vars.off = 1;
        // let the engine settle for a moment to read the drop
        for (let i = 0; i < 45; i++) simulate(this.v, 1 / 30, 1, false);
        const after = Math.round(this.v.engine.rpm);
        const cyl = s.vars.target ?? +slotId.slice(-1);
        this.recordTest('idle_drop', `Idle-drop test, lead ${slotId.slice(-1)} (plug ${cyl}) removed`, `${before} → ${after} rpm (${before - after > 25 ? 'drop' : 'NO change'})`, 'ignition');
        notify(`RPM ${before} → ${after}`, 'info');
      } else s.vars.off = 1;
      if (slotId === 'elec.term_pos' && !isReleased(this.v, 'elec.term_neg')) this.violation('Positive terminal disconnected before the negative');
      if (slotId.startsWith('ign.lead_')) this.milestone('lead_off');
      sound('unplug', 0.6);
    } else {
      if (slotId === 'elec.term_neg' && (this.v.slots['elec.term_pos'].vars.off ?? 0) > 0.5) notify('Reconnect the positive first; the earth goes on last.', 'warn');
      if (slotId.startsWith('ign.lead_')) s.vars.target = target ?? +slotId.slice(-1);
      if (slotId.startsWith('ign.lead_') && !this.v.slots[`ign.plug_${s.vars.target}`].part) return notify('There is no plug in that hole.', 'warn');
      s.vars.off = 0;
      sound('plug_in', 0.6);
    }
    this.addTime(0.3);
    bus.emit('vehicle:changed', { slot: slotId });
  }

  applyPenetrating(slotId: string) {
    if (!this.owns('penetrating_oil')) return notify('You need penetrating oil.', 'warn');
    this.ws.penetrating[slotId] = this.state.time;
    sound('spray');
    notify('Soaked the threads. Give it ten minutes to creep in.', 'info');
  }

  // ───────────── Toggles & controls ─────────────
  toggle(slotId: string) {
    const d = SLOTS[slotId];
    const s = this.v.slots[slotId];
    const t = d.toggle!;
    const on = (s.vars[t.var] ?? 0) > 0.5;
    if (slotId === 'body.bonnet') {
      if (!on) {
        if ((s.vars.latchL ?? 0) > 0.5 || (s.vars.latchR ?? 0) > 0.5) return notify(`The bonnet is latched — pull both release handles inside the car (${(s.vars.latchL ?? 0) > 0.5 ? 'left' : ''}${(s.vars.latchL ?? 0) > 0.5 && (s.vars.latchR ?? 0) > 0.5 ? ' & ' : ''}${(s.vars.latchR ?? 0) > 0.5 ? 'right' : ''} still locked).`, 'warn');
        s.vars.open = 1; sound('bonnet_open');
      } else {
        if (this.v.funnelIn) return notify('The funnel is still in the filler neck — the bonnet will not close over it.', 'warn');
        s.vars.open = 0; s.vars.latchL = 1; s.vars.latchR = 1; sound('bonnet_close');
      }
    } else if (slotId === 'int.center_panel') {
      if (!on && (this.v.slots['int.panel_screw_1'].part || this.v.slots['int.panel_screw_2'].part)) return notify('Remove the two thumb screws first.', 'warn');
      s.vars.open = on ? 0 : 1; sound('panel');
    } else if (slotId === 'body.boot_floor') {
      if (!on && (this.v.slots['body.hatch'].vars.open ?? 0) < 0.5) return notify('Open the rear hatch first.', 'warn');
      s.vars.open = on ? 0 : 1; sound('panel');
    } else if (slotId === 'body.hatch' && on && (this.v.slots['body.boot_floor'].vars.open ?? 0) > 0.5) {
      return notify('Lower the boot floor panel first.', 'warn');
    } else {
      s.vars[t.var] = on ? 0 : 1;
      sound(slotId.startsWith('body.door') || slotId === 'body.hatch' ? (on ? 'door_close' : 'door_open') : 'switch');
      if (slotId === 'int.ignition' && !on) { this.v.engine.lastStartAttempt = this.state.time; }
    }
    if (slotId === 'int.gear_lever' && this.v.engine.running && !on) notify('The clutch is down… you leave it in neutral.', 'info');
    bus.emit('vehicle:changed', { slot: slotId });
  }
  pullRelease(side: 'L' | 'R') {
    const door = (this.v.slots[`body.door_${side}`].vars.open ?? 0) > 0.5;
    if (!door) return notify(`Open the ${side === 'L' ? 'left' : 'right'} door to reach the release handle.`, 'warn');
    this.v.slots['body.bonnet'].vars[side === 'L' ? 'latchL' : 'latchR'] = 0;
    sound('latch');
    notify(`${side === 'L' ? 'Left' : 'Right'} bonnet catch released.`, 'info');
    bus.emit('vehicle:changed', { slot: 'body.bonnet' });
  }
  setStarter(down: boolean) {
    slotVars(this.v, 'int.starter_button').pressed = down ? 1 : 0;
    if (down && !isOn(this.v, 'int.ignition')) notify('Nothing — the ignition is off.', 'info');
    if (down && !this.v.engine.running) {
      if (!onGround(this.v) && (this.v.support.RL.height > 0.06 || this.v.support.RR.height > 0.06) && isOn(this.v, 'int.gear_lever', 'gear')) this.violation('Started the engine in gear with the rear wheels off the ground');
    }
  }
  setThrottle(t: number) { this.v.engine.throttle = clamp(t, 0, 1); }
  horn(down: boolean) {
    if (!down) return;
    const r = evaluate(this.v, { ...elecInputsFrom(this.v), hornPressed: true });
    const ok = r.V['HORN'] - r.V['CH'] > 8;
    this.recordTest('horn', 'Horn push pressed', ok ? 'Horns sound' : 'Silent', 'electrical');
    if (ok) { sound('horn'); this.milestone('horn_ok'); } else notify('Silence.', 'info');
  }

  // ───────────── Fluids ─────────────
  heldContainer(): PartState | null {
    const p = this.held ? this.state.inventory[this.held] : null;
    return p && PARTS[p.def].kind === 'container' ? p : null;
  }
  startPour(target: 'oil' | 'coolant' | 'brake' | 'clutch' | 'gearbox' | 'diff') {
    const c = this.heldContainer();
    if (!c) return notify('Pick up a fluid container from the inventory first.', 'warn');
    if ((c.vars.volume ?? 0) <= 0.001) return notify('That container is empty.', 'warn');
    if (target === 'oil' && this.v.slots['lub.filler_cap'].part) return notify('Remove the oil filler cap.', 'warn');
    if (target === 'coolant' && this.v.slots['cool.header_cap'].part) return notify('Remove the header tank cap.', 'warn');
    if ((target === 'gearbox' || target === 'diff') && !this.owns('fluid_pump')) return notify('You need a hand fluid-transfer pump to fill through the level plug.', 'warn');
    if (target === 'gearbox' && this.v.slots['trn.gbx_level'].part) return notify('Remove the level plug.', 'warn');
    if (target === 'diff' && this.v.slots['trn.diff_level'].part) return notify('Remove the level plug.', 'warn');
    this.pouring = { target, rate: target === 'oil' ? 0.35 : target === 'coolant' ? 0.45 : target === 'brake' || target === 'clutch' ? 0.03 : 0.06 };
    sound('pour_start', 0.5);
  }
  stopPour() { this.pouring = null; bus.emit('vehicle:changed', { reason: 'fluid' }); bus.emit('inventory:changed', {}); }
  private pourTick(dt: number) {
    const c = this.heldContainer();
    const p = this.pouring!;
    if (!c) { this.pouring = null; return; }
    const q = Math.min(c.vars.volume ?? 0, p.rate * dt);
    if (q <= 0) { this.stopPour(); notify('Container empty.', 'info'); return; }
    const frac = q / Math.max(1e-6, c.vars.volume ?? 1);
    c.vars.volume = (c.vars.volume ?? 0) - q;
    const comp: Composition = {};
    const base = PARTS[c.def].fluid ?? {};
    const tot = total(base);
    for (const [k, l] of Object.entries(base)) comp[k as FluidId] = ((l ?? 0) / tot) * q;
    void frac;
    const job = this.state.job;
    const bill = (PARTS[c.def].price / Math.max(0.1, tot)) * q;
    if (job) job.partsBilled.push({ def: c.def, price: bill });
    let into: Composition | null = null;
    let spill = 0;
    switch (p.target) {
      case 'oil': {
        into = this.v.oil.comp;
        if (!this.v.funnelIn) { spill = q * 0.14; this.v.oil.oilOnEngine += spill; if (Math.random() < dt) notify('Oil glugs over the cam cover — use a funnel.', 'warn'); }
        this.milestone('oil_added');
        break;
      }
      case 'coolant': into = this.v.coolant.comp; break;
      case 'brake': into = this.v.brake.comp; break;
      case 'clutch': into = this.v.clutch.comp; break;
      case 'gearbox': into = this.v.gearbox.comp; break;
      case 'diff': into = this.v.diff.comp; break;
    }
    if (into) {
      for (const [k, l] of Object.entries(comp)) addFluid(into, k as FluidId, (l ?? 0) * (1 - spill / q || 1));
    }
    // Overflow
    if (p.target === 'coolant' && total(this.v.coolant.comp) > COOLANT_FULL) {
      const over = removeFluid(this.v.coolant.comp, total(this.v.coolant.comp) - COOLANT_FULL);
      const w = this.pose().apply(POINTS.headerCap);
      this.catchFluid(w[0] + 0.05, w[2], over, 'coolant');
    }
    if ((p.target === 'gearbox' || p.target === 'diff') && total(this.v[p.target].comp) > (p.target === 'gearbox' ? 1.42 : 1.56)) {
      const over = removeFluid(this.v[p.target].comp, total(this.v[p.target].comp) - (p.target === 'gearbox' ? 1.42 : 1.56));
      const w = this.pose().apply(p.target === 'gearbox' ? POINTS.gbxLevel : POINTS.diffLevel);
      this.catchFluid(w[0], w[2], over, 'oil');
      if (Math.random() < dt * 2) notify('Oil runs back out of the level hole — it is full.', 'info');
    }
    if ((p.target === 'brake' || p.target === 'clutch') && total(this.v[p.target].comp) > (p.target === 'brake' ? 1.0 : 0.35)) {
      removeFluid(this.v[p.target].comp, total(this.v[p.target].comp) - (p.target === 'brake' ? 1.0 : 0.35));
      notify('Reservoir brim-full — brake fluid dribbles onto the paint (it strips paint!).', 'warn');
      this.violation('Over-filled a hydraulic reservoir (brake fluid on paintwork)');
      this.stopPour();
    }
    if (Math.random() < dt * 4) sound('glug', 0.5);
    this.addTime(dt * 0.4);
  }
  toggleFunnel() {
    if (!this.owns('funnel')) return;
    if (!this.v.funnelIn && this.v.slots['lub.filler_cap'].part) return notify('Remove the filler cap first.', 'warn');
    this.v.funnelIn = !this.v.funnelIn;
    sound('plastic', 0.5);
    bus.emit('vehicle:changed', { reason: 'funnel' });
  }

  readDipstick() {
    const v = this.v;
    if (!canReach(v, 'lub.dipstick').ok) return notify('Open the bonnet.', 'warn');
    const level = sumpOil(v);
    const p = this.pose();
    const tilt = p.pitch * 180 / Math.PI;
    const settled = !v.engine.running && v.engine.sinceStop > 120;
    const valid = Math.abs(tilt) < 0.6 && settled;
    const reading = level + tilt * 0.35 + (v.engine.running ? -0.2 : 0);
    const colorF = total(v.oil.comp) > 0 ? Object.entries(v.oil.comp).reduce((a, [k, l]) => a + FLUIDS[k as FluidId].freshness * (l ?? 0), 0) / total(v.oil.comp) : 1;
    const note = !valid ? (v.engine.running ? 'Engine running — oil is in the galleries, the reading is meaningless.' : !settled ? 'Engine only just stopped — oil is still draining back to the sump.' : 'The car is not level — the reading is skewed.') : '';
    this.lastDipstick = { level: reading, valid, note, color: colorF };
    const pos = (reading - OIL_MIN) / (OIL_MAX - OIL_MIN);
    const desc = pos > 1.25 ? 'well above MAX' : pos > 1.04 ? 'just above MAX' : pos >= 0.94 ? 'at MAX' : pos >= 0.55 ? 'between MIN and MAX' : pos >= 0 ? 'near MIN' : 'below MIN — no oil on the blade tip';
    this.recordTest('dipstick', 'Dipstick', `${desc}${colorF < 0.5 ? ', oil black' : ', oil amber'}${valid ? '' : ' (questionable)'}`, 'lubrication');
    if (this.hasMilestone('oil_added') && valid) this.milestone('dipstick_after_fill');
    if (this.hasMilestone('ran_after_service') && valid && this.hasMilestone('oil_added')) this.milestone('dipstick_after_run');
    this.addTime(1);
    sound('dipstick', 0.6);
    bus.emit('ui:open', { panel: 'dipstick' });
  }

  coolantCheck() {
    const v = this.v;
    if (v.slots['cool.header_cap'].part) return notify('Remove the cap to see the level.', 'warn');
    const lvl = total(v.coolant.comp) / COOLANT_FULL;
    const desc = lvl > 1.0 ? 'brim full' : lvl > 0.95 ? 'at the filler neck seat — full' : lvl > 0.88 ? 'just visible, a little low' : lvl > 0.75 ? 'no coolant visible in the tank — low' : 'tank and radiator top empty — very low';
    this.recordTest('coolant.level', 'Coolant level (header tank)', desc, 'cooling');
    this.addTime(1);
    notify(`Coolant: ${desc}.`, lvl > 0.93 ? 'good' : 'warn');
  }
  removeHeaderCap() {
    if (this.v.engine.coolantC > 90) {
      sound('steam');
      const lost = removeFluid(this.v.coolant.comp, 1.2);
      const w = this.pose().apply(POINTS.headerCap);
      this.catchFluid(w[0], w[2], lost, 'coolant');
      this.violation('Opened the pressure cap on a hot engine — scalding coolant erupted');
      this.damage('Scalded hand — 15 minutes lost');
      this.addTime(15);
    }
  }
  hydrometer() {
    if (this.v.slots['cool.header_cap'].part) return notify('Remove the header tank cap.', 'warn');
    const a = antifreeze(this.v.coolant.comp);
    const rng = mulberry32(hashStr(this.v.id + 'hyd'))();
    const r = Math.round(a.freezeC + (rng - 0.5) * 2);
    this.recordTest('antifreeze', 'Antifreeze hydrometer', `Protected to ${r} °C (${Math.round(a.frac * 100)} % glycol est.)`, 'cooling');
    notify(`Hydrometer: protection to ${r} °C.`, r <= -30 ? 'good' : 'warn');
    this.addTime(2);
  }
  pressureTest() {
    if (!this.owns('pressure_tester')) return;
    if (this.v.engine.coolantC > 60) return notify('Only pressure-test a COLD system.', 'warn');
    if (this.v.slots['cool.header_cap'].part) return notify('Fit the tester in place of the cap.', 'warn');
    const leaking = torqueVerdict(this.v, 'cool.clip_rad') === 'under' || torqueVerdict(this.v, 'cool.clip_pump') === 'under' || partIn(this.v, 'cool.bottom_hose')?.flags.includes('damaged');
    const where = torqueVerdict(this.v, 'cool.clip_rad') === 'under' ? 'radiator-end bottom hose clip' : torqueVerdict(this.v, 'cool.clip_pump') === 'under' ? 'pump-end bottom hose clip' : 'bottom hose';
    this.recordTest('pressure_test', 'Cooling-system pressure test (4 psi, cold)', leaking ? `Pressure falls 4 → 1 psi in 2 min; coolant beads at the ${where}` : 'Holds 4 psi for 5 min — no leaks', 'cooling');
    this.addTime(6);
    notify(leaking ? `Pressure falls — coolant beads at the ${where}.` : 'Holds pressure.', leaking ? 'warn' : 'good');
  }

  // ───────────── Tyres ─────────────
  startInflate(corner: string, dir: 1 | -1) {
    if (dir > 0 && !this.owns('air_line')) return;
    this.inflating = { corner, dir };
  }
  stopInflate() { this.inflating = null; bus.emit('vehicle:changed', {}); }
  private inflateTick(dt: number) {
    const w = this.inflating!.corner === 'spare' ? partIn(this.v, 'body.spare_wheel') : partIn(this.v, `whl.${this.inflating!.corner}`) ?? this.state.inventory[this.inflating!.corner];
    if (!w) return;
    w.vars.pressure = clamp((w.vars.pressure ?? 0) + this.inflating!.dir * dt * (this.inflating!.dir > 0 ? 1.6 : 2.4), 0, 60);
    if (Math.random() < dt * 6) sound('air', 0.4);
    this.addTime(dt * 0.3);
  }

  // ───────────── Inspection & measurement ─────────────
  inspectSlot(slotId: string) {
    const r = canReach(this.v, slotId);
    const p = partIn(this.v, slotId);
    if (!r.ok && (SLOTS[slotId].access ?? []).some((a) => a.type !== 'phase')) return notify(r.reasons[0], 'warn');
    if (!p) return;
    this.inspectPart(p, slotId);
  }
  inspectPart(p: PartState, slotId?: string) {
    const d = PARTS[p.def];
    const obs = d.inspect ? d.inspect(p) : [`${d.name}: ${conditionLabel(p.condition, p.flags).toLowerCase()} condition.`];
    if (slotId === 'cool.bottom_hose' || slotId === 'cool.clip_rad') this.recordTest('inspect.cool.bottom_hose', 'Inspected bottom hose & clips', obs.join(' '), 'cooling');
    if (slotId?.startsWith('whl.') && p.flags.includes('punctured')) {
      const c = slotId.slice(4);
      if (!wheelOffGround(this.v, c as Corner) && this.assist !== 'beginner') obs.splice(0, 1, 'Visible tread looks fine — the rest of the circumference is on the floor (raise the wheel to rotate it).');
    }
    p.known.inspected = true;
    const tag = `inspect.${slotId ?? p.def}`;
    this.recordTest(tag, `Inspected ${slotId ? SLOTS[slotId].name : d.name}`, obs.join(' '), d.system);
    if (slotId?.startsWith('ign.plug_') || p.def.startsWith('plug_')) this.milestone('plug_inspected');
    this.addTime(1);
    bus.emit('ui:open', { panel: 'inspect', arg: { name: slotId ? SLOTS[slotId].name : d.name, obs, part: p } });
  }

  measure(p: PartState, m: MeasurementDef, slotId?: string) {
    const kind = this.toolKind();
    if (m.phase && m.phase > 2) return notify('This measurement arrives with Tier II (Phase 3).', 'info');
    if (!kind || !m.tools.includes(kind as any)) return notify(`Select a suitable tool: ${m.tools.map((k) => TOOL_LIST.find((t) => t.kind === k)?.name ?? k).join(' or ')}.`, 'warn');
    const tool = TOOL_LIST.find((t) => t.kind === kind)!;
    const truth = m.read(p);
    const res = tool.resolution ?? 0.01;
    const rng = mulberry32(hashStr(p.uid + m.id + Math.floor(this.state.time / 600)))();
    const val = Math.round((truth + (rng - 0.5) * res * 1.2) / res) * res;
    p.known.measured[m.id] = val;
    const inSpec = (m.spec?.min == null || val >= m.spec.min - 1e-9) && (m.spec?.max == null || val <= m.spec.max + 1e-9);
    const verdict = !m.spec ? '' : inSpec ? 'WITHIN SPECIFICATION' : (m.spec.min != null && val < m.spec.min) ? (m.spec.serviceLimit != null && val < m.spec.serviceLimit ? 'BELOW SERVICE LIMIT' : 'BELOW SPECIFICATION') : 'ABOVE SPECIFICATION';
    const tagBase = `measure.${m.id}`;
    const corner = slotId?.match(/^whl\.(\w\w)$/)?.[1];
    this.recordTest(corner ? `${tagBase}.${corner}` : tagBase, `${m.label}${slotId ? ` — ${SLOTS[slotId].name}` : ''}`, `${fmt(val, m.decimals)} ${m.unit}`, PARTS[p.def].system);
    if (corner) this.milestone(`${tagBase}.${corner}`);
    this.addTime(0.7);
    sound('measure', 0.4);
    bus.emit('ui:open', { panel: 'measure', arg: { label: m.label, value: `${fmt(val, m.decimals)} ${m.unit}`, spec: m.spec?.label ?? '—', verdict } });
  }

  setPlugGap(p: PartState, target: number) {
    if (this.toolKind() !== 'gap_tool') return notify('Select the gapping tool.', 'warn');
    const rng = mulberry32(hashStr(p.uid + this.state.time))();
    p.vars.gap = Math.max(0.3, target + (rng - 0.5) * 0.04);
    p.vars.new = 0;
    this.addTime(1);
    sound('measure', 0.4);
    notify('Side electrode bent — re-measure with the feeler gauge.', 'info');
    bus.emit('inventory:changed', {});
  }

  cleanPart(slotOrUid: string) {
    const p = partIn(this.v, slotOrUid) ?? this.state.inventory[slotOrUid];
    if (!p) return;
    if (this.toolKind() !== 'wire_brush') return notify('Use the terminal/wire brush.', 'warn');
    if (slotOrUid.startsWith('elec.term_') && (this.v.slots[slotOrUid].vars.off ?? 0) < 0.5) return notify('Disconnect the clamp to clean its contact face.', 'warn');
    if (slotOrUid === 'elec.battery' && ((this.v.slots['elec.term_pos'].vars.off ?? 0) < 0.5 || (this.v.slots['elec.term_neg'].vars.off ?? 0) < 0.5)) return notify('Disconnect both terminals to clean the posts.', 'warn');
    p.flags = p.flags.filter((f) => f !== 'corroded' && f !== 'dirty');
    this.addTime(4);
    sound('brush');
    notify(`Cleaned back to bright metal.`, 'good');
    bus.emit('vehicle:changed', {});
  }
  greaseTerminal(slotId: string) {
    const p = partIn(this.v, slotId);
    if (!p || !this.owns('terminal_grease')) return;
    if (!p.flags.includes('greased')) p.flags.push('greased');
    this.addTime(1);
    notify('Thin film of protective grease applied.', 'info');
  }
  cleanEngineBay() {
    if (this.v.oil.oilOnEngine <= 0) return;
    this.v.oil.oilOnEngine = 0;
    this.addTime(6);
    notify('Wiped spilt oil off the cam cover and manifold.', 'good');
  }

  // Charging
  toggleCharger() {
    if (!this.owns('battery_charger')) return notify('You do not own a battery charger.', 'warn');
    this.ws.charger.connected = !this.ws.charger.connected;
    sound('clip');
    notify(this.ws.charger.connected ? 'Charger connected (6 A). Use "Wait" to let it work.' : 'Charger disconnected.', 'info');
    bus.emit('workshop:changed', {});
  }

  // Belt adjustment
  adjustBelt(deflection: number) {
    if (!(isReleased(this.v, 'elec.alt_pivot') && isReleased(this.v, 'elec.alt_adjust'))) return notify('Slacken the pivot and adjusting-link bolts first.', 'warn');
    const b = partIn(this.v, 'eng.fan_belt');
    if (!b) return notify('No belt fitted.', 'warn');
    b.vars.deflection = clamp(deflection, 4, 35);
    this.milestone('belt_adjusted');
    this.addTime(1);
    bus.emit('vehicle:changed', { slot: 'eng.fan_belt' });
  }
  canFitBelt() { return isReleased(this.v, 'elec.alt_pivot') && isReleased(this.v, 'elec.alt_adjust'); }

  // Compression test
  compressionTest(cyl: number) {
    if (!this.owns('compression_tester')) return;
    if (this.v.slots[`ign.plug_${cyl}`].part) return notify('Remove the spark plug first.', 'warn');
    const r = evaluate(this.v, { ...elecInputsFrom(this.v), ignOn: true, starter: true });
    if (!r.solenoidEngaged || r.motorV < 6) return notify('The engine will not crank fast enough for a valid test.', 'warn');
    const base = 152 + (h01(this.v.id + cyl) - 0.5) * 10;
    this.recordTest('compression', `Compression, cylinder ${cyl}`, `${Math.round(base / 5) * 5} psi`, 'engine');
    sound('crank');
    this.addTime(2);
    notify(`Cylinder ${cyl}: ${Math.round(base / 5) * 5} psi`, 'info');
  }

  // ───────────── Electrical probing ─────────────
  probe(node: NodeId) {
    const kind = this.toolKind();
    const m = this.meter;
    const inputs = elecInputsFrom(this.v);
    if (kind === 'test_light') {
      const lamp = testLamp(this.v, inputs, node);
      m.lamp = lamp;
      const label = `Test lamp at ${TEST_POINTS[node]}`;
      const val = lamp > 0.6 ? 'Lamp lights brightly' : lamp > 0.15 ? 'Lamp glows dimly' : 'Lamp stays dark';
      this.recordTest(`testlamp.${node}`, label, val, 'electrical');
      notify(`${label}: ${val}`, 'info');
      sound('click', 0.3);
      bus.emit('tools:changed', {});
      return;
    }
    if (kind !== 'multimeter') return;
    if (!m.red || (m.red && m.black)) { m.red = node; m.black = null; m.reading = '…'; sound('click', 0.3); bus.emit('tools:changed', {}); return; }
    m.black = node;
    this.readMeter(true);
  }
  readMeter(record: boolean) {
    const m = this.meter;
    if (!m.red || !m.black) return;
    const inputs = elecInputsFrom(this.v);
    const cranking = this.sim?.elec.solenoidEngaged ?? false;
    let text = '';
    if (m.mode === 'V') {
      const v = (cranking || this.v.engine.running) && this.sim ? this.sim.elec.V[m.red] - this.sim.elec.V[m.black] : meterVolts(this.v, inputs, m.red, m.black);
      text = `${v >= 0 ? ' ' : ''}${fmt(v, 2)} V`;
      if (record) {
        const tag = this.voltageTag(m.red, m.black, cranking);
        this.recordTest(tag, `Voltage ${TEST_POINTS[m.red]} (+) → ${TEST_POINTS[m.black]} (–)${cranking ? ' while cranking' : this.v.engine.running ? ` at ${Math.round(this.v.engine.rpm)} rpm` : ''}`, text.trim(), 'electrical');
      }
    } else {
      const r = meterOhms(this.v, inputs, m.red, m.black);
      text = Number.isNaN(r) ? 'Err — live circuit' : !isFinite(r) ? 'O.L' : r < 10 ? `${fmt(r, 2)} Ω` : `${fmt(r, 0)} Ω`;
      if (m.mode === 'C' && isFinite(r) && r < 2) sound('beep', 0.5);
      if (record) this.recordTest(`ohms.${m.red}.${m.black}`, `Resistance ${TEST_POINTS[m.red]} → ${TEST_POINTS[m.black]}`, text, 'electrical');
    }
    m.reading = text;
    if (record) bus.emit('tools:changed', {});
  }
  clearProbes() { this.meter.red = null; this.meter.black = null; this.meter.reading = '—'; bus.emit('tools:changed', {}); }
  private voltageTag(a: NodeId, b: NodeId, cranking: boolean) {
    const pair = `${a}|${b}`;
    if (pair === 'B+|B-') {
      if (cranking) return 'volts.crank';
      if (this.v.engine.running) { const t = this.v.engine.rpm > 1600 ? 'volts.charge' : 'volts.idle'; if (t === 'volts.charge' && this.hasMilestone('belt_adjusted')) this.milestone('volts.charge.after'); return t; }
      return 'volts.rest';
    }
    if (pair === 'B+|T+' || pair === 'T+|B+') return cranking ? 'volts.drop+' : 'volts.clamp+';
    if (pair === 'T-|B-' || pair === 'B-|T-') return cranking ? 'volts.drop-' : 'volts.clamp-';
    if (b === 'CH' || b === 'ENG' || b === 'B-') return `volts.${a}`;
    return `volts.${a}.${b}`;
  }

  // ───────────── Economy ─────────────
  buyPart(defId: string, qty = 1) {
    const d = PARTS[defId];
    const cost = d.price * qty;
    if (this.state.money < cost) return notify('Not enough money.', 'bad');
    this.state.money -= cost;
    for (let i = 0; i < qty; i++) {
      if (d.bundle) for (const b of d.bundle) { const p = newPart(b, 'new', 'stock'); this.state.inventory[p.uid] = p; }
      else { const p = newPart(defId, 'new', 'stock'); this.state.inventory[p.uid] = p; }
    }
    sound('till', 0.5);
    notify(`Bought ${qty} × ${d.name}.`, 'good');
    bus.emit('inventory:changed', {}); bus.emit('money:changed', { money: this.state.money });
  }
  toolAvailable(id: string): { ok: boolean; reason?: string } {
    const t = TOOLS[id];
    if (t.phase && t.phase > 2) return { ok: false, reason: `Arrives with Phase ${t.phase}` };
    if (t.unlock) {
      if ('rep' in t.unlock && this.state.progress.rep < t.unlock.rep) return { ok: false, reason: `Reputation ${t.unlock.rep} required` };
      if ('skill' in t.unlock && (this.state.progress.skills[t.unlock.skill] ?? 0) < t.unlock.level) return { ok: false, reason: `${t.unlock.skill} skill ${t.unlock.level} required` };
    }
    return { ok: true };
  }
  buyTool(id: string) {
    const t = TOOLS[id];
    if (this.owns(id) && t.kind !== 'jack_stand') return;
    const a = this.toolAvailable(id);
    if (!a.ok) return notify(a.reason!, 'warn');
    if (this.state.money < t.price) return notify('Not enough money.', 'bad');
    this.state.money -= t.price;
    if (t.kind === 'jack_stand' && this.owns(id)) this.ws.standsOwned += 2;
    else this.state.tools.push(id);
    if (id === 'torque_wrench') this.ws.wrenchError = 1;
    sound('till', 0.5);
    notify(`Bought: ${t.name}.`, 'good');
    bus.emit('tools:changed', {}); bus.emit('money:changed', { money: this.state.money });
  }
  sellPart(uidItem: string) {
    const p = this.state.inventory[uidItem];
    if (!p) return;
    const d = PARTS[p.def];
    const value = p.origin === 'new' && p.location === 'stock' ? d.price * 0.6 : d.price * 0.15 * p.condition;
    this.state.money += value;
    delete this.state.inventory[uidItem];
    if (this.held === uidItem) this.held = null;
    notify(`${p.location === 'stock' && p.origin === 'new' ? 'Returned' : 'Scrapped'} ${d.name}: +£${fmt(value)}`, 'info');
    bus.emit('inventory:changed', {}); bus.emit('money:changed', { money: this.state.money });
  }
  recalibrateWrench() {
    if (this.state.money < 25) return;
    this.state.money -= 25; this.ws.wrenchError = 1; this.addTime(30);
    notify('Torque wrench recalibrated (£25).', 'good');
  }

  // ───────────── Diagnosis & completion ─────────────
  submitDiagnosis(id: string) {
    const j = this.state.job;
    if (!j) return;
    j.diagnosis = id; j.diagnosisAt = this.state.time;
    notify('Diagnosis recorded in the job card.', 'info');
    bus.emit('job:changed', {});
  }

  private trackFaults() {
    const j = this.state.job; const jd = this.jobDef;
    if (!j || !jd) return;
    for (const f of jd.faults) if (j.fixedAt[f] == null && FAULTS[f].resolved(this.v)) j.fixedAt[f] = this.state.time;
    // Latch hot run for the cooling job
    if (this.v.engine.running && this.v.engine.coolantC > 80) this.milestone('hot_run');
    if (this.v.engine.running) this.milestone('ran_after_service');
    if (this.v.engine.running && this.v.engine.coolantC > 92) this.recordTestOnce('temp_gauge', 'Temperature gauge while idling', `${Math.round(this.v.engine.coolantC)} °C and rising`, 'cooling');
  }
  private recordTestOnce(tag: string, label: string, value: string, system: SystemId) { if (!this.hasMilestone(tag)) this.recordTest(tag, label, value, system); }

  procCtx(): ProcCtx {
    return { v: this.v, ws: this.ws, m: new Set(this.state.job?.milestones ?? []) };
  }
  private updateProcedures() {
    const jd = this.jobDef; const j = this.state.job;
    if (!jd || !j) return;
    const ctx = this.procCtx();
    for (const pid of jd.procedures) for (const s of PROCEDURES[pid].steps) {
      const key = `${pid}:${s.id}`;
      if (!j.latched.includes(key) && s.check(ctx)) j.latched.push(key);
    }
  }

  completeJob(): JobReport | null {
    const j = this.state.job; const jd = this.jobDef;
    if (!j || !jd) return null;
    const v = this.v;
    const checks = assemblyCheck(v, { requireTestRun: jd.requireTestRun });
    const faults = jd.faults.map((f) => ({ f: FAULTS[f], fixed: FAULTS[f].resolved(v) }));
    const evidence = jd.faults.map((f) => {
      const ft = FAULTS[f];
      const fixedAt = j.fixedAt[f] ?? Infinity;
      const before = j.tests.filter((t) => t.t <= fixedAt && ft.tests.some((tag) => t.tag === tag || t.tag.startsWith(tag)));
      return { fault: ft, tests: before.map((t) => t.label), count: new Set(before.map((t) => t.tag)).size };
    });
    const diagFault = jd.faults.map((f) => FAULTS[f]).find((f) => f.diagnosis);
    const diagCorrect = !jd.requireDiagnosis || (!!diagFault && j.diagnosis === diagFault.diagnosis);
    // Unnecessary replacements: parts swapped in slots unrelated to the job's faults/requests
    const related = (slot: string) => {
      const map: Record<string, string[]> = { oil_service_due: ['lub.'], batt_terminal: ['elec.term', 'elec.battery'], plug_fouled: ['ign.plug_'], hose_clip: ['cool.'], slack_belt: ['eng.fan_belt', 'elec.alt'], horn_fuse: ['elec.fuse_1'], puncture_fl: ['whl.', 'body.spare'] };
      return jd.faults.some((f) => (map[f] ?? []).some((pre) => slot.startsWith(pre)));
    };
    const unnecessary = j.replaced.filter((s) => !related(s));
    const failing = checks.filter((c) => !c.ok);
    const failCritical = failing.filter((c) => c.severity === 'fail');
    const fixedAll = faults.every((f) => f.fixed);
    // Quality breakdown (each 0..1)
    const q = {
      repair: fixedAll ? 1 : faults.filter((f) => f.fixed).length / Math.max(1, faults.length),
      assembly: Math.max(0, 1 - failCritical.length * 0.25 - (failing.length - failCritical.length) * 0.08),
      diagnosis: jd.requireDiagnosis ? (diagCorrect ? 1 : j.diagnosis ? 0.2 : 0) * (0.5 + 0.5 * Math.min(1, (evidence[0]?.count ?? 0) / 2)) : 1,
      safety: Math.max(0, 1 - j.violations.length * 0.2),
      care: Math.max(0, 1 - j.damage.length * 0.3 - Math.min(0.4, j.spilledL * 0.2)),
      efficiency: clamp(1.4 - (this.state.time - j.startedAt) / 3600 / Math.max(0.3, jd.bookHours) * 0.4, 0, 1),
    };
    const quality = q.repair * 0.35 + q.assembly * 0.2 + q.diagnosis * 0.15 + q.safety * 0.1 + q.care * 0.1 + q.efficiency * 0.1;
    const grade = quality > 0.92 ? 'A' : quality > 0.8 ? 'B' : quality > 0.65 ? 'C' : quality > 0.45 ? 'D' : 'F';
    const labour = jd.bookHours * LABOUR_RATE * (fixedAll ? 1 : 0.5);
    const partsBilled = j.partsBilled.filter((b) => !unnecessary.some((s) => SLOTS[s].accepts.includes(b.def))).reduce((a, b) => a + b.price, 0) * 1.15;
    const pay = Math.round((labour * (0.6 + 0.4 * quality) + partsBilled) * 100) / 100;
    const repDelta = Math.round((quality - 0.6) * 20 - (fixedAll ? 0 : 8) - failCritical.length * 2);
    const st = this.state;
    st.money += pay;
    st.progress.rep = clamp(st.progress.rep + repDelta, 0, 100);
    const skillMsgs: string[] = [];
    for (const s of jd.skills) {
      st.progress.xp[s] = (st.progress.xp[s] ?? 0) + Math.round(quality * 100);
      const lvl = Math.min(5, Math.floor(st.progress.xp[s] / 80));
      if (lvl > (st.progress.skills[s] ?? 0)) { st.progress.skills[s] = lvl; skillMsgs.push(`${s} skill → ${lvl}`); }
    }
    const prev = st.progress.completed[jd.id];
    if (!prev || prev.quality < quality) st.progress.completed[jd.id] = { grade, pay, at: st.time, quality };
    const report: JobReport = { job: jd, checks, faults, evidence, diagnosis: j.diagnosis, diagCorrect, diagExpected: diagFault?.diagnosis ?? null, unnecessary, violations: [...j.violations], damage: [...j.damage], q, quality, grade, pay, labour, partsBilled, repDelta, skillMsgs, hours: (st.time - j.startedAt) / 3600, analysis: analyzeVehicle(v) };
    st.job = null;
    st.mode = 'menu';
    this.log(`Job complete: ${jd.title} — grade ${grade}, paid £${fmt(pay)}`);
    bus.emit('money:changed', { money: st.money });
    bus.emit('job:changed', {});
    return report;
  }
}

export interface JobReport {
  job: JobDef;
  checks: ReturnType<typeof assemblyCheck>;
  faults: { f: (typeof FAULTS)[string]; fixed: boolean }[];
  evidence: { fault: (typeof FAULTS)[string]; tests: string[]; count: number }[];
  diagnosis: string | null;
  diagCorrect: boolean;
  diagExpected: string | null;
  unnecessary: string[];
  violations: string[];
  damage: string[];
  q: Record<string, number>;
  quality: number;
  grade: string;
  pay: number;
  labour: number;
  partsBilled: number;
  repDelta: number;
  skillMsgs: string[];
  hours: number;
  analysis: ReturnType<typeof analyzeVehicle>;
}

export { slotDef, checkReq, isFitted, toLbft, SPEC };
