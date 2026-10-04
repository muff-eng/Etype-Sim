/** Movable workshop equipment, fluid effects, hotspots, the parts tray and the tool-in-hand visual. */
import * as THREE from 'three';
import { box, cyl, at, group, lathe, tube, V } from './geom';
import type { Mats } from './materials';
import type { Game } from '../game/Game';
import type { CarModel } from './CarModel';
import { JACK_POINTS, STAND_POINTS, POINTS, poseFn, eng, WHEEL_POS, type V3 } from '../data/layout';
import { CORNERS, type Corner } from '../sim/types';
import { total, dominant, FLUIDS } from '../data/fluids';
import { TOOLS } from '../data/tools';
import { SLOTS } from '../data/slots';
import { bonnetOpen } from '../sim/vehicle';
import { PARTS } from '../data/parts';
import { ROOM } from './Workshop';

export const PROBE_POINTS: Record<string, V3> = {
  'B+': [0.84, 0.618, 0.49], 'B-': [0.84, 0.618, 0.39], 'T+': [0.84, 0.63, 0.522], 'T-': [0.84, 0.63, 0.358],
  CH: [0.645, 0.5, 0.52], ENG: eng([-0.1, 0.05, -0.172]), SOL: eng([-0.27, 0.075, 0.18]), ALT: eng([0.24, 0.1, -0.245]),
  'COIL+': [0.805, 0.685, 0.38], 'COIL-': [0.835, 0.685, 0.38], IGN: [0.31, 0.66, -0.12],
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].flatMap((n) => { const z = -0.075 + (n - 1) * 0.03; return [[`F${n}i`, [0.305, 0.75, z] as V3], [`F${n}o`, [0.305, 0.71, z] as V3]]; })),
};

function spriteTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface Particle { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; size: number; color: THREE.Color }

export class Equipment {
  root = new THREE.Group();
  pan: THREE.Group;
  panFluid: THREE.Mesh;
  jack: THREE.Group;
  jackArm: THREE.Group;
  stands: Record<Corner, THREE.Group> = {} as any;
  chocks: THREE.Group;
  funnel: THREE.Group;
  charger: THREE.Group;
  chargerCables: THREE.Mesh | null = null;
  stream: THREE.Mesh;
  hotspots: THREE.Mesh[] = [];
  tray = new THREE.Group();
  trayPickables: THREE.Object3D[] = [];
  tool = new THREE.Group();
  private toolModels: Record<string, THREE.Object3D> = {};
  private spills = new THREE.Group();
  private drips: { m: THREE.Mesh; v: number }[] = [];
  private dripTimers: Record<string, number> = {};
  private particles: Particle[] = [];
  private points: THREE.Points;
  private ghostPan: THREE.Mesh;
  private trayKey = '';
  private chargerKey = '';
  private dripGeo = new THREE.SphereGeometry(0.004, 6, 4);
  private swing = 0;

  constructor(private M: Mats, private car: CarModel) {
    // Drain pan
    this.pan = group(lathe([[0.001, 0], [0.22, 0], [0.26, 0.09], [0.265, 0.095], [0.255, 0.095], [0.215, 0.006], [0.001, 0.006]], new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.5, side: THREE.DoubleSide }), 40));
    this.panFluid = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32), M.oil);
    this.panFluid.rotation.x = -Math.PI / 2;
    this.pan.add(this.panFluid);
    this.pan.userData.pick = { kind: 'equipment', id: 'pan' };
    this.pan.traverse((o) => (o.userData.pick = { kind: 'equipment', id: 'pan' }));
    this.root.add(this.pan);
    this.ghostPan = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 32), new THREE.MeshBasicMaterial({ color: 0x55ff88, transparent: true, opacity: 0.5 }));
    this.ghostPan.rotation.x = -Math.PI / 2; this.ghostPan.position.y = 0.005; this.ghostPan.visible = false;
    this.root.add(this.ghostPan);
    // Trolley jack
    const red = M.toolRed;
    this.jackArm = new THREE.Group();
    const saddle = group(cyl(0.05, 0.03, M.satin, 'y', 16), at(box(0.38, 0.05, 0.08, red, -0.19, -0.02, 0, 0.01), 0, 0, 0));
    this.jackArm.add(saddle);
    this.jack = group(box(0.6, 0.1, 0.25, red, -0.3, 0.08, 0, 0.02), at(cyl(0.04, 0.04, M.black, 'z', 12), -0.05, 0.04, 0.12), at(cyl(0.04, 0.04, M.black, 'z', 12), -0.05, 0.04, -0.12), at(cyl(0.05, 0.06, M.black, 'z', 12), -0.55, 0.05, 0), at(cyl(0.012, 0.9, M.steel, 'x', 8), -1.0, 0.45, 0, 0, 0, 0.7), this.jackArm);
    this.root.add(this.jack);
    this.jack.visible = false;
    // Axle stands
    for (const c of CORNERS) {
      const st = new THREE.Group();
      const legs = group(...[0, 1, 2, 3].map((i) => { const l = cyl(0.012, 0.32, red, 'y', 6); l.position.set(Math.cos(i * Math.PI / 2 + 0.78) * 0.09, 0.14, Math.sin(i * Math.PI / 2 + 0.78) * 0.09); l.rotation.set(Math.sin(i * Math.PI / 2 + 0.78) * 0.4, 0, -Math.cos(i * Math.PI / 2 + 0.78) * 0.4); return l; }));
      const column = cyl(0.02, 0.3, M.steel, 'y', 10);
      const head = box(0.08, 0.03, 0.05, red, 0, 0, 0);
      st.add(legs, column, head);
      st.userData = { column, head };
      st.visible = false;
      st.traverse((o) => (o.userData.pick = { kind: 'equipment', id: `stand:${c}` }));
      this.stands[c] = st;
      this.root.add(st);
    }
    // Chocks
    this.chocks = new THREE.Group();
    for (const c of ['RL', 'RR'] as Corner[]) {
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.12, 0.2, 3), M.yellow);
      ch.rotation.set(0, 0, Math.PI / 2); ch.scale.set(1, 0.6, 1);
      ch.position.set(WHEEL_POS[c][0] - 0.38, 0.06, WHEEL_POS[c][2]);
      this.chocks.add(ch);
    }
    this.root.add(this.chocks);
    // Funnel
    this.funnel = group(lathe([[0.012, 0], [0.012, 0.05], [0.07, 0.14], [0.072, 0.15], [0.068, 0.15], [0.01, 0.052], [0.008, 0]], new THREE.MeshStandardMaterial({ color: 0x2255aa, roughness: 0.5, side: THREE.DoubleSide }), 24));
    this.funnel.visible = false;
    this.root.add(this.funnel);
    // Charger
    this.charger = group(box(0.3, 0.2, 0.2, new THREE.MeshStandardMaterial({ color: 0x2a3a6a, roughness: 0.5 }), 0, 0.1, 0, 0.02), at(box(0.1, 0.05, 0.01, new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0x33ff55, emissiveIntensity: 0.6 }), 0, 0.16, 0.101), 0, 0, 0));
    this.charger.position.set(1.3, 0, 1.45);
    this.charger.visible = false;
    this.root.add(this.charger);
    // Oil stream
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), M.oil);
    this.stream.visible = false;
    this.root.add(this.stream);
    this.root.add(this.spills);
    // Particles
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(600 * 3), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(600 * 3), 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.22, map: spriteTex(), transparent: true, depthWrite: false, vertexColors: true, opacity: 0.45, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    this.root.add(this.points);
    // Hotspots
    const hsMat = (c: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthTest: false });
    const addHs = (id: string, r: number, color: number) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), hsMat(color));
      m.userData.pick = { kind: 'hotspot', id };
      m.renderOrder = 10;
      m.visible = false;
      this.hotspots.push(m);
      this.root.add(m);
    };
    for (const c of [...CORNERS, 'F']) addHs(`jack:${c}`, 0.035, 0xffcc00);
    for (const c of CORNERS) addHs(`stand:${c}`, 0.03, 0x33ccff);
    for (const n of Object.keys(PROBE_POINTS)) addHs(`probe:${n}`, n.startsWith('F') ? 0.006 : 0.011, 0xff3355);
    this.root.add(this.tray);
    this.buildToolModels();
    this.root.add(this.tool);
  }

  private buildToolModels() {
    const M = this.M;
    const ratchet = group(at(box(0.25, 0.018, 0.03, M.toolChrome, -0.14, 0, 0, 0.008), 0, 0, 0), cyl(0.022, 0.028, M.toolChrome, 'y', 16), at(cyl(0.014, 0.04, M.toolChrome, 'y', 12), 0, -0.03, 0));
    const tw = group(at(box(0.42, 0.02, 0.028, M.toolChrome, -0.22, 0, 0, 0.008), 0, 0, 0), at(cyl(0.016, 0.12, M.black, 'x', 10), -0.38, 0, 0), cyl(0.022, 0.028, M.toolChrome, 'y', 16), at(cyl(0.014, 0.04, M.toolChrome, 'y', 12), 0, -0.03, 0));
    const breaker = group(at(box(0.45, 0.022, 0.022, M.toolChrome, -0.24, 0, 0, 0.006), 0, 0, 0), cyl(0.02, 0.03, M.toolChrome, 'y', 12), at(cyl(0.015, 0.04, M.toolChrome, 'y', 12), 0, -0.03, 0));
    const spanner = group(at(box(0.18, 0.006, 0.022, M.toolChrome, -0.1, 0, 0, 0.003), 0, 0, 0), new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.006, 6, 16), M.toolChrome));
    (spanner.children[1] as THREE.Mesh).rotation.x = Math.PI / 2;
    const screwdriver = group(at(cyl(0.003, 0.12, M.toolChrome, 'y', 6), 0, 0.06, 0), at(cyl(0.013, 0.1, M.toolRed, 'y', 10), 0, 0.17, 0));
    const mallet = group(at(cyl(0.035, 0.12, M.copper, 'x', 16), 0, 0.0, 0), at(cyl(0.01, 0.3, new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.6 }), 'y', 8), 0, 0.15, 0));
    const hammer = group(at(box(0.11, 0.025, 0.025, M.steel), 0, 0, 0), at(cyl(0.01, 0.3, new THREE.MeshStandardMaterial({ color: 0x8a5a2a }), 'y', 8), 0, 0.15, 0));
    const ext = cyl(0.007, 0.15, M.toolChrome, 'y', 8);
    this.toolModels = { ratchet, torque_wrench: tw, breaker_bar: breaker, spanner, adjustable: spanner.clone(), screwdriver_flat: screwdriver, copper_mallet: mallet, hammer, ext };
    for (const m of Object.values(this.toolModels)) { m.visible = false; this.tool.add(m); m.traverse((o) => { o.castShadow = true; }); }
  }

  update(game: Game, dt: number, camera: THREE.Camera, ghost: THREE.Vector3 | null) {
    const v = game.state.vehicle;
    const ws = game.state.workshop;
    const pose = poseFn(Object.fromEntries(CORNERS.map((c) => [c, v.support[c].height])) as Record<Corner, number>);
    const W = (p: V3) => new THREE.Vector3(...pose.apply(p));
    // Pan
    this.pan.position.set(ws.drainPan.x, 0, ws.drainPan.z);
    const panL = total(ws.drainPan.comp);
    this.panFluid.visible = panL > 0.02;
    this.panFluid.position.y = 0.006 + Math.min(0.085, panL / 12 * 0.085);
    const dom = dominant(ws.drainPan.comp);
    if (dom) (this.panFluid.material as THREE.MeshStandardMaterial) = this.M.oil;
    if (dom && FLUIDS[dom].family === 'coolant') this.panFluid.material = this.M.coolant;
    this.ghostPan.visible = !!ghost;
    if (ghost) this.ghostPan.position.set(ghost.x, 0.005, ghost.z);
    // Jack
    const jackAt = game.jack.at;
    this.jack.visible = !!jackAt;
    if (jackAt) {
      const lp: V3 = jackAt === 'F' ? [1.1, 0.2, 0] : JACK_POINTS[jackAt];
      const wpt = W(lp);
      this.jack.position.set(wpt.x + (jackAt === 'F' ? 0.0 : 0), 0, wpt.z + (jackAt === 'F' ? 0 : Math.sign(lp[2]) * 0.0));
      this.jack.rotation.y = jackAt === 'F' ? 0 : Math.sign(lp[2]) * -Math.PI / 2;
      if (jackAt === 'F') this.jack.rotation.y = Math.PI;
      const contact = game.jack.lift > 0.001 ? wpt.y : 0.13 + game.jack.lift;
      this.jackArm.position.set(0, Math.max(0.12, contact - 0.015), 0);
    }
    // Stands
    for (const c of CORNERS) {
      const st = this.stands[c];
      const on = ws.stands.includes(c);
      st.visible = on;
      if (on) {
        const wp = W(STAND_POINTS[c]);
        const h = 0.16 + v.support[c].stand;
        st.position.set(wp.x, 0, wp.z);
        const { column, head } = st.userData as { column: THREE.Mesh; head: THREE.Mesh };
        column.scale.y = (h - 0.05) / 0.3; column.position.y = (h - 0.05) / 2 + 0.03;
        head.position.y = h - 0.015;
      }
    }
    this.chocks.visible = v.chocks;
    // Funnel
    this.funnel.visible = v.funnelIn;
    if (v.funnelIn) { const p = W(POINTS.oilFiller); this.funnel.position.copy(p).add(V(0, 0.01, 0)); }
    // Charger
    this.charger.visible = ws.charger.connected;
    const b = W(POINTS.battery);
    const ck = ws.charger.connected ? `${b.x.toFixed(2)},${b.y.toFixed(2)}` : '';
    if (ck !== this.chargerKey && this.chargerCables) { this.root.remove(this.chargerCables); this.chargerCables.geometry.dispose(); this.chargerCables = null; }
    if (ws.charger.connected && ck !== this.chargerKey) {
      this.chargerCables = tube([V(1.3, 0.2, 1.4), V(1.2, 0.3, 1.0), V(b.x + 0.2, b.y + 0.3, b.z + 0.2), V(b.x + 0.08, b.y + 0.13, b.z + 0.05)], 0.006, this.M.wireRed, 20, 6);
      this.root.add(this.chargerCables);
    }
    this.chargerKey = ck;
    // Oil stream from the drain hole
    const drainFlow = game.flows['drain'] ?? 0;
    this.stream.visible = drainFlow > 0.002;
    if (this.stream.visible) {
      const top = W(POINTS.drainPlug);
      const panHit = Math.hypot(ws.drainPan.x - top.x, ws.drainPan.z - top.z) < 0.24;
      const bottomY = panHit ? 0.01 + Math.min(0.085, panL / 12 * 0.085) : 0.002;
      const len = Math.max(0.01, top.y - bottomY);
      const r = 0.003 + Math.sqrt(drainFlow) * 0.03;
      this.stream.scale.set(r, len, r);
      this.stream.position.set(top.x, bottomY + len / 2, top.z);
    }
    // Drips from leaks and the filter
    const dripSources: [string, V3][] = [['leak_drain', POINTS.drainPlug], ['leak_filter', POINTS.filterBottom], ['leak_hose', POINTS.bottomHoseRad], ['filter', POINTS.filterBottom], ['hose', POINTS.bottomHoseRad], ['cap', [1.55, 0.2, 0.36]]];
    for (const [k, p] of dripSources) {
      const rate = game.flows[k] ?? 0;
      if (rate <= 0) continue;
      this.dripTimers[k] = (this.dripTimers[k] ?? 0) + dt * Math.min(25, rate * 2500 * game.state.settings.timeScale);
      while (this.dripTimers[k] > 1) {
        this.dripTimers[k] -= 1;
        const m = new THREE.Mesh(this.dripGeo, k.includes('hose') || k === 'cap' ? this.M.coolant : this.M.oil);
        m.position.copy(W(p));
        this.root.add(m);
        this.drips.push({ m, v: 0 });
      }
    }
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      d.v += 9.8 * dt; d.m.position.y -= d.v * dt;
      if (d.m.position.y < 0) { this.root.remove(d.m); this.drips.splice(i, 1); }
    }
    // Spills
    if (this.spills.children.length !== ws.spills.length) {
      this.spills.clear();
      for (const s of ws.spills) {
        const m = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshStandardMaterial({ color: s.kind === 'oil' ? 0x120a02 : 0x3a6ab8, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }));
        m.rotation.x = -Math.PI / 2; m.position.set(s.x, 0.003, s.z);
        this.spills.add(m);
      }
    }
    ws.spills.forEach((s, i) => { const m = this.spills.children[i]; if (m) m.scale.setScalar(s.r); });
    // Particles: exhaust smoke & steam
    const e = v.engine;
    if (e.running) {
      const sm = e.smoke;
      const emit = (p: V3, n: number, col: number, vel: THREE.Vector3, size: number) => { for (let i = 0; i < n; i++) this.particles.push({ p: W(p).add(V((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.02)), v: vel.clone().add(V((Math.random() - 0.5) * 0.2, Math.random() * 0.2, (Math.random() - 0.5) * 0.2)), life: 0, max: 2 + Math.random() * 2, size, color: new THREE.Color(col) }); };
      const rate = dt * 30;
      if (Math.random() < rate * (sm.white + 0.08)) for (const z of [0.07, -0.07]) emit([-2.3, 0.23, z], 1, 0xdddddd, V(-0.8, 0.1, 0), 0.2);
      if (Math.random() < rate * sm.black) for (const z of [0.07, -0.07]) emit([-2.3, 0.23, z], 1, 0x202020, V(-0.8, 0.1, 0), 0.25);
      if (Math.random() < rate * sm.blue) emit(bonnetOpen(v) ? eng([-0.1, 0.25, -0.22]) : [-2.3, 0.23, 0.07], 1, 0x8899bb, V(0, 0.4, 0), 0.25);
    }
    if (e.smoke.steam > 0 && Math.random() < dt * 40 * e.smoke.steam) {
      for (let i = 0; i < 2; i++) this.particles.push({ p: W(POINTS.headerCap), v: V((Math.random() - 0.5) * 0.3, 0.8 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3), life: 0, max: 1.5, size: 0.3, color: new THREE.Color(0xffffff) });
    }
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.points.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life > p.max || i > 590) { this.particles.splice(i, 1); continue; }
      p.v.y += 0.15 * dt; p.v.multiplyScalar(1 - dt * 0.8);
      p.p.addScaledVector(p.v, dt);
    }
    for (let i = 0; i < 600; i++) {
      const p = this.particles[i];
      if (p) { pos.setXYZ(i, p.p.x, p.p.y, p.p.z); const f = 1 - p.life / p.max; col.setXYZ(i, p.color.r * f, p.color.g * f, p.color.b * f); }
      else pos.setXYZ(i, 0, -10, 0);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    // Hotspots
    const kind = game.toolKind();
    for (const h of this.hotspots) {
      const [type, id] = (h.userData.pick.id as string).split(':');
      let vis = false, p: V3 | null = null;
      if (type === 'jack' && kind === 'floor_jack') { vis = true; p = id === 'F' ? [1.1, 0.2, 0] : JACK_POINTS[id as Corner]; }
      if (type === 'stand' && kind === 'jack_stand') { vis = true; p = STAND_POINTS[id as Corner]; }
      if (type === 'probe' && (kind === 'multimeter' || kind === 'test_light')) {
        const fuse = id.startsWith('F') && id !== 'F';
        vis = fuse ? (v.slots['int.center_panel'].vars.open ?? 0) > 0.5 : id === 'IGN' ? (v.slots['int.center_panel'].vars.open ?? 0) > 0.5 : bonnetOpen(v);
        p = PROBE_POINTS[id];
      }
      h.visible = vis;
      if (vis && p) h.position.copy(W(p));
      if (vis) { const s = 1 + 0.25 * Math.sin(performance.now() * 0.006); h.scale.setScalar(s); }
    }
    // Tray
    this.updateTray(game);
    // Tool in hand at the fastener being worked
    this.updateTool(game, dt);
    void camera; void ROOM;
  }

  private updateTray(game: Game) {
    const items = Object.values(game.state.inventory).filter((p) => p.location === 'tray');
    const key = items.map((i) => i.uid).join(',');
    if (key === this.trayKey) return;
    this.trayKey = key;
    this.tray.clear();
    this.trayPickables = [];
    let n = 0, big = 0;
    for (const p of items) {
      const src = p.slot ? this.car.objectFor(p.slot) : null;
      let obj: THREE.Object3D;
      const heavy = p.slot ? SLOTS[p.slot]?.heavy : false;
      if (src) {
        obj = src.clone(true);
        obj.visible = true;
        obj.traverse((o) => { o.visible = true; });
        obj.position.set(0, 0, 0); obj.rotation.set(0, 0, 0); obj.scale.set(1, 1, 1);
      } else {
        obj = box(0.08, 0.05, 0.06, this.M.satin);
      }
      const bb = new THREE.Box3().setFromObject(obj);
      const size = bb.getSize(new THREE.Vector3());
      const holder = new THREE.Group();
      holder.add(obj);
      obj.position.sub(bb.getCenter(new THREE.Vector3()));
      if (heavy) {
        holder.position.set(2.3 + big * 0.75, size.y / 2 + 0.002, -2.75);
        if (p.def === 'wheel_wire') { holder.rotation.x = Math.PI / 2; holder.position.y = 0.1; }
        big++;
      } else {
        const sc = Math.min(1, 0.22 / Math.max(size.x, size.y, size.z, 0.01));
        holder.scale.setScalar(sc);
        const col = n % 5, row = Math.floor(n / 5);
        holder.position.set(1.0 - 0.48 + col * 0.24, 0.8 + (size.y * sc) / 2, -2.6 - 0.2 + row * 0.2);
        n++;
      }
      holder.traverse((o) => { o.userData = { ...o.userData, pick: { kind: 'tray', id: p.uid } }; if ((o as THREE.Mesh).isMesh) this.trayPickables.push(o); });
      this.tray.add(holder);
      void PARTS;
    }
  }

  private updateTool(game: Game, dt: number) {
    for (const m of Object.values(this.toolModels)) m.visible = false;
    const w = game.work;
    if (!w.slot || !w.dc || w.dc.hand) return;
    const obj = this.car.objectFor(w.slot);
    const b = this.car.bindings.get(w.slot);
    if (!obj || !b) return;
    const kind = game.toolKind() ?? '';
    const model = this.toolModels[kind === 'adjustable' ? 'adjustable' : kind] ?? null;
    if (!model) return;
    model.visible = true;
    const ext = this.toolModels['ext'];
    const wp = obj.getWorldPosition(new THREE.Vector3());
    const axisW = (b.opts.axis ?? V(0, 1, 0)).clone().applyQuaternion(obj.parent!.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const turning = w.lastEvents.length > 0 || w.pull.applied > 0;
    this.swing += dt * (turning ? 6 : 0);
    const kindIsMallet = kind === 'copper_mallet' || kind === 'hammer';
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), axisW);
    const spin = new THREE.Quaternion().setFromAxisAngle(axisW, Math.sin(this.swing) * (kindIsMallet ? 0.2 : 0.45));
    model.quaternion.copy(spin).multiply(q);
    const lift = game.grip.extension && !kindIsMallet ? 0.17 : 0.035;
    model.position.copy(wp).addScaledVector(axisW, lift);
    if (kindIsMallet) model.position.addScaledVector(axisW, 0.05);
    ext.visible = game.grip.extension && !kindIsMallet && kind !== 'spanner' && kind !== 'screwdriver_flat';
    if (ext.visible) { ext.quaternion.copy(q); ext.position.copy(wp).addScaledVector(axisW, 0.09); }
    void TOOLS;
  }

  allPickables(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [...this.hotspots.filter((h) => h.visible), ...this.trayPickables];
    this.pan.traverse((o) => { if ((o as THREE.Mesh).isMesh) list.push(o); });
    for (const c of CORNERS) if (this.stands[c].visible) this.stands[c].traverse((o) => { if ((o as THREE.Mesh).isMesh) list.push(o); });
    return list;
  }
}
