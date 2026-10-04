/**
 * Assembles the car and keeps the 3D presentation in sync with simulation state. The simulation never
 * touches meshes; this class reads VehicleState and poses/hides/tints bound objects accordingly.
 */
import * as THREE from 'three';
import { buildBody, type BindOpts, type Binder, type BodyParts } from './CarBody';
import { buildEngine, beltGeometry, type EngineParts } from './EngineModel';
import { buildChassis, type ChassisParts } from './Chassis';
import { buildWireWheel, type WireWheel } from './Wheels';
import { applyConditionLook, makeMaterials, type Mats } from './materials';
import type { Game } from '../game/Game';
import { SLOTS } from '../data/slots';
import { WHEEL_POS, TDC_COMP, CRANK_R, ROD_L, poseFn, ENGINE_ORIGIN } from '../data/layout';
import { CORNERS, type Corner } from '../sim/types';
import { DROOP, partIn, sumpOil, OIL_MAX, COOLANT_FULL } from '../sim/vehicle';
import { total } from '../data/fluids';
import { clamp } from '../core/units';

interface Binding {
  slot: string;
  condKey?: string;
  objs: THREE.Object3D[];
  base: Map<THREE.Object3D, { pos: THREE.Vector3; quat: THREE.Quaternion }>;
  opts: BindOpts;
}

export type ViewMode = { xray: boolean; cutaway: boolean; exploded: boolean };

export class CarModel implements Binder {
  root = new THREE.Group();
  M: Mats;
  body!: BodyParts;
  engine!: EngineParts;
  chassis!: ChassisParts;
  wheels = {} as Record<Corner, WireWheel>;
  spare!: WireWheel;
  bindings = new Map<string, Binding>();
  private objBinding = new Map<THREE.Object3D, Binding>();
  pickables: THREE.Object3D[] = [];
  view: ViewMode = { xray: false, cutaway: false, exploded: false };
  private anim = { bonnet: 0, doorL: 0, doorR: 0, hatch: 0, panel: 0, explode: 0, xray: 0 };
  private xrayMats = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.02);
  /** +1 when the camera is on the car's right (+Z) side: the cutaway removes the half nearest the camera. */
  cutSide: 1 | -1 = 1;
  private hidden = new Set<string>();
  private altAngle = 0;
  private beltKey = '';

  constructor(paint: string) {
    this.M = makeMaterials(paint);
    this.root.name = 'car';
    this.body = buildBody(this.M, this);
    this.engine = buildEngine(this.M, this);
    this.chassis = buildChassis(this.M, this);
    this.root.add(this.body.root, this.engine.root, this.chassis.root);
    for (const c of CORNERS) {
      const w = buildWireWheel(this.M, c.endsWith('R') ? 1 : -1);
      w.root.position.set(...WHEEL_POS[c]);
      this.root.add(w.root);
      this.wheels[c] = w;
      this.bind(`whl.${c}`, w.root);
      this.bind(`whl.spinner_${c}`, w.spinner, { axis: new THREE.Vector3(0, 1, 0), pitch: 0.008, spin: true });
    }
    this.spare = buildWireWheel(this.M, 1);
    this.spare.root.position.set(-1.42, 0.36, 0);
    this.spare.root.rotation.x = Math.PI / 2;
    this.root.add(this.spare.root);
    this.bind('body.spare_wheel', this.spare.root);
    const clamp_ = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), this.M.zinc);
    clamp_.position.set(-1.42, 0.4, 0);
    this.root.add(clamp_);
    this.bind('body.spare_clamp', clamp_, { axis: new THREE.Vector3(0, 1, 0), pitch: 0.004, spin: true });
    for (const m of this.engine.clipMats) { (m as THREE.Material).clippingPlanes = []; }
  }

  bind(slotId: string, obj: THREE.Object3D, opts: BindOpts = {}) {
    let b = this.bindings.get(slotId);
    if (!b) { b = { slot: slotId, objs: [], base: new Map(), opts }; this.bindings.set(slotId, b); }
    if (Object.keys(opts).length) b.opts = { ...b.opts, ...opts };
    b.objs.push(obj);
    this.objBinding.set(obj, b);
    b.base.set(obj, { pos: obj.position.clone(), quat: obj.quaternion.clone() });
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !opts.noPick) {
        o.userData.pick = { kind: 'slot', id: slotId };
        this.pickables.push(o);
      }
    });
  }

  objectFor(slotId: string): THREE.Object3D | null { return this.bindings.get(slotId)?.objs[0] ?? null; }

  setPaint(color: string) {
    this.M.paint.color.set(color);
    this.M.paintInner.color.set(color);
  }

  /** Full state sync (cheap enough to run every frame for the handful of animated bindings). */
  sync(game: Game, dt: number) {
    const v = game.state.vehicle;
    // Body pose from corner support heights
    const pose = poseFn(Object.fromEntries(CORNERS.map((c) => [c, v.support[c].height])) as Record<Corner, number>);
    this.root.position.y = pose.y0;
    this.root.rotation.set(-pose.roll, 0, pose.pitch, 'ZYX');
    for (const c of CORNERS) {
      const w = this.wheels[c];
      w.root.position.y = WHEEL_POS[c][1] - Math.max(0, Math.min(v.support[c].height, DROOP));
    }
    // Toggles (animated)
    const k = clamp(dt * 3, 0, 1);
    const tgt = (id: string, key = 'open') => (v.slots[id]?.vars[key] ?? 0) > 0.5 ? 1 : 0;
    const showEngine = this.view.exploded;
    this.anim.bonnet += ((showEngine ? 1 : tgt('body.bonnet')) - this.anim.bonnet) * k;
    this.anim.doorL += (tgt('body.door_L') - this.anim.doorL) * k;
    this.anim.doorR += (tgt('body.door_R') - this.anim.doorR) * k;
    this.anim.hatch += (tgt('body.hatch') - this.anim.hatch) * k;
    this.anim.panel += (tgt('int.center_panel') - this.anim.panel) * k;
    this.anim.explode += ((this.view.exploded ? 1 : 0) - this.anim.explode) * clamp(dt * 2.2, 0, 1);
    this.body.bonnetPivot.rotation.z = -this.anim.bonnet * 1.6;
    this.body.doorPivot.R.rotation.y = this.anim.doorR * 1.1;
    this.body.doorPivot.L.rotation.y = -this.anim.doorL * 1.1;
    this.body.hatchPivot.rotation.x = this.anim.hatch * 1.25;
    this.body.panelPivot.rotation.z = this.anim.panel * 1.25;
    this.body.bootFloor.visible = tgt('body.boot_floor') < 0.5;
    // Controls
    const on = (id: string, key = 'on') => (v.slots[id]?.vars[key] ?? 0) > 0.5;
    this.body.ignitionKey.rotation.x = on('int.ignition') ? -0.8 : 0;
    const choke = this.objectFor('int.choke'); if (choke) choke.position.x = 0.3 - (on('int.choke') ? 0.04 : 0);
    const hb = this.objectFor('int.handbrake'); if (hb) hb.rotation.z = on('int.handbrake') ? 0.55 : 0.18;
    const gear = this.objectFor('int.gear_lever'); if (gear) gear.rotation.z = on('int.gear_lever', 'gear') ? 0.35 : 0.15;
    const sb = this.objectFor('int.starter_button'); if (sb) sb.position.x = 0.27 + ((v.slots['int.starter_button'].vars.pressed ?? 0) > 0.5 ? 0.004 : 0);
    // Slot presence, fastener travel, connectors
    for (const [slot, b] of this.bindings) {
      const s = v.slots[slot];
      if (!s) continue;
      const d = SLOTS[slot];
      const present = !!s.part && !this.hidden.has(slot);
      for (const o of b.objs) {
        o.visible = present;
        const base = b.base.get(o)!;
        if (d.thread && b.opts.axis) {
          const out = Math.max(0, d.thread.captive ? (d.thread.turns - s.turnsIn) * 0.3 : d.thread.turns - s.turnsIn) * (b.opts.pitch ?? 0.002);
          o.position.copy(base.pos).addScaledVector(b.opts.axis, out);
          if (b.opts.spin) {
            const q = new THREE.Quaternion().setFromAxisAngle(b.opts.axis, -s.turnsIn * Math.PI * 2 * (d.thread.leftHand ? -1 : 1));
            o.quaternion.copy(q).multiply(base.quat);
          }
        } else if (d.connector) {
          const off = (s.vars.off ?? 0) > 0.5;
          o.position.copy(base.pos);
          if (off) o.position.y += 0.035;
        } else if (slot === 'lub.dipstick') {
          o.position.copy(base.pos);
        }
      }
      if (present && s.part) {
        const p = v.parts[s.part];
        const key = p ? `${p.uid}|${p.flags.join(',')}|${Math.round(p.condition * 10)}` : '';
        if (p && key !== b.condKey) {
          b.condKey = key;
          for (const o of b.objs) applyConditionLook(o, p.flags, p.flags.length || p.condition < 0.6 ? p.condition : 1);
        }
      }
      if (slot.startsWith('ign.lead_') && present) {
        const boot = this.engine.leadBoots[+slot.slice(-1) - 1];
        const tgtCyl = s.vars.target ?? +slot.slice(-1);
        boot.position.x = -0.25 + (tgtCyl - 1) * 0.1;
      }
    }
    // Belt & alternator swing follow belt deflection
    const belt = partIn(v, 'eng.fan_belt');
    const defl = belt?.vars.deflection ?? 12;
    this.altAngle += ((-(12 - defl) * 0.012) - this.altAngle) * k;
    this.engine.altPivot.rotation.x = this.altAngle;
    const bk = `${Math.round(this.altAngle * 200)}|${Math.round(defl)}`;
    if (bk !== this.beltKey) {
      this.beltKey = bk;
      this.engine.fanBelt.geometry.dispose();
      this.engine.fanBelt.geometry = beltGeometry(this.altAngle, Math.max(0, defl - 12));
    }
    // Fluid level visuals
    this.chassis.coolantLevel.visible = !v.slots['cool.header_cap'].part && total(v.coolant.comp) / COOLANT_FULL > 0.93;
    this.chassis.brakeLevel.scale.y = clamp(total(v.brake.comp) / 1.0, 0.05, 1);
    // Rotating machinery
    const e = v.engine;
    const crankRad = (e.crankAngle * Math.PI) / 180;
    this.engine.crank.rotation.x = -crankRad;
    this.engine.camIn.rotation.x = -crankRad / 2;
    this.engine.camEx.rotation.x = -crankRad / 2;
    for (let c = 1; c <= 6; c++) {
      const a = (TDC_COMP[c] % 360) * Math.PI / 180;
      const th = crankRad - a;
      const pinY = CRANK_R * Math.cos(th), pinZ = -CRANK_R * Math.sin(th);
      const pistonY = pinY + Math.sqrt(ROD_L * ROD_L - pinZ * pinZ);
      const ex = this.engine.explode.find((q) => q.obj === this.engine.pistons[c - 1]);
      const exRod = this.engine.explode.find((q) => q.obj === this.engine.rods[c - 1]);
      const ke = this.anim.explode;
      this.engine.pistons[c - 1].position.y = pistonY - 0.01 + (ex ? ex.offset.y * ke : 0);
      const rod = this.engine.rods[c - 1];
      rod.position.set(rod.position.x, pinY + (exRod ? exRod.offset.y * ke : 0), pinZ);
      rod.rotation.x = Math.atan2(-pinZ, pistonY - pinY);
      const cyc = (((e.crankAngle - TDC_COMP[c]) % 720) + 720) % 720;
      const lift = (from: number, len: number) => { const t = (cyc - from) / len; return t > 0 && t < 1 ? Math.sin(t * Math.PI) * 0.0095 : 0; };
      this.engine.valvesIn[c - 1].position.y = -lift(345, 250);
      this.engine.valvesEx[c - 1].position.y = -lift(125, 250);
    }
    for (const p of this.engine.pulleys) p.rotation.x = -crankRad * (p === this.engine.pulleys[2] ? 2 : 1);
    if (e.running) {
      const shake = e.roughness * 0.0035 * Math.sin(performance.now() * 0.05) + 0.0004 * Math.sin(performance.now() * 0.13);
      this.engine.root.rotation.x = shake;
    } else this.engine.root.rotation.x = 0;
    const fanOn = e.fanOn && (game.sim?.elec.fanV ?? 0) > 9;
    this.chassis.fan.rotation.x += fanOn ? dt * 40 : 0;
    // Exploded view
    const ke = this.anim.explode;
    for (const q of this.engine.explode) {
      if (this.engine.pistons.includes(q.obj) || this.engine.rods.includes(q.obj)) { q.obj.position.x = q.base.x + q.offset.x * ke; q.obj.position.z = this.engine.rods.includes(q.obj) ? q.obj.position.z : q.base.z + q.offset.z * ke; continue; }
      if (q.obj === this.engine.crank || this.engine.leadBoots.includes(q.obj)) { q.obj.position.copy(q.base).addScaledVector(q.offset, ke); continue; }
      const b = this.findBinding(q.obj);
      const slotOffset = b ? this.slotOffset(b, q.obj, v) : new THREE.Vector3();
      q.obj.position.copy(q.base).addScaledVector(q.offset, ke).add(slotOffset);
    }
    this.engine.root.position.y = ENGINE_ORIGIN[1] + ke * 0.95;
    // X-ray / cutaway
    const wantX = this.view.xray || this.view.cutaway || this.view.exploded;
    this.applyXray(wantX);
    this.clipPlane.normal.set(0, 0, -this.cutSide);
    for (const m of this.engine.clipMats) (m as THREE.Material).clippingPlanes = this.view.cutaway ? [this.clipPlane] : [];
    this.chassis.root.visible = !this.view.exploded;
    this.body.root.visible = !this.view.exploded || ke < 0.5;
    for (const w of Object.values(this.wheels)) w.root.visible = (!this.view.exploded || ke < 0.5) && w.root.visible;
    // Gauges
    const gg = this.body.gauges;
    const gauge = (o: THREE.Object3D, f: number, sweep = Math.PI * 1.5) => { o.rotation.x = -(-sweep / 2 + clamp(f, 0, 1) * sweep); };
    const ign = on('int.ignition');
    gauge(gg.tach, e.rpm / 6000);
    gauge(gg.speedo, 0);
    gauge(gg.oil, ign ? e.oilPressure / 100 : 0, Math.PI * 0.9);
    gauge(gg.temp, ign ? (e.coolantC - 30) / 90 : 0, Math.PI * 0.9);
    gauge(gg.fuel, ign ? v.fuelL / 63.6 : 0, Math.PI * 0.9);
    const amps = game.sim ? -game.sim.elec.battI : 0;
    gauge(gg.amps, 0.5 + clamp(amps / 60, -0.5, 0.5), Math.PI * 0.9);
    void sumpOil; void OIL_MAX;
  }

  private findBinding(o: THREE.Object3D) { return this.objBinding.get(o) ?? null; }
  private slotOffset(b: Binding, o: THREE.Object3D, v: Game['state']['vehicle']) {
    const d = SLOTS[b.slot];
    const s = v.slots[b.slot];
    if (d.thread && b.opts.axis && s) {
      const out = Math.max(0, d.thread.captive ? (d.thread.turns - s.turnsIn) * 0.3 : d.thread.turns - s.turnsIn) * (b.opts.pitch ?? 0.002);
      return b.opts.axis.clone().multiplyScalar(out);
    }
    if (d.connector && s && (s.vars.off ?? 0) > 0.5) return new THREE.Vector3(0, 0.035, 0);
    void o;
    return new THREE.Vector3();
  }

  private applyXray(on: boolean) {
    const targets: THREE.Mesh[] = [...this.body.bodyMeshes];
    const engineShell = ['eng.block', 'eng.head', 'eng.sump', 'eng.cam_cover_in', 'eng.cam_cover_ex', 'eng.timing_cover', 'trn.bellhousing', 'trn.gearbox', 'fuel.air_box'];
    for (const s of engineShell) this.bindings.get(s)?.objs.forEach((o) => o.traverse((m) => { if ((m as THREE.Mesh).isMesh) targets.push(m as THREE.Mesh); }));
    if (on && this.xrayMats.size === 0) {
      const ghostBody = new THREE.MeshStandardMaterial({ color: 0x6fa8ff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, roughness: 0.4 });
      const ghostEng = new THREE.MeshStandardMaterial({ color: 0x9aa4b0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, roughness: 0.4 });
      for (const m of targets) {
        this.xrayMats.set(m, m.material);
        const isBody = this.body.bodyMeshes.includes(m);
        if (this.view.cutaway && !isBody) continue;
        m.material = isBody ? ghostBody : ghostEng;
        m.castShadow = false;
      }
      for (const g of this.body.glass) g.visible = false;
    } else if (!on && this.xrayMats.size) {
      for (const [m, mat] of this.xrayMats) { m.material = mat; m.castShadow = true; }
      this.xrayMats.clear();
      for (const g of this.body.glass) g.visible = true;
    }
  }
  refreshView() { if (this.xrayMats.size) { this.applyXray(false); } }

  setHidden(slot: string, hide: boolean) { if (hide) this.hidden.add(slot); else this.hidden.delete(slot); }
  clearHidden() { this.hidden.clear(); }
  isHidden(slot: string) { return this.hidden.has(slot); }
}
