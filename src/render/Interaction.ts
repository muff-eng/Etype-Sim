/**
 * Mouse interaction: hover highlight, click-to-select, hold-to-work on fasteners, floor placement,
 * hotspots (jack/stand/probe points) and equipment. LMB-drag on empty space orbits; RMB orbits;
 * MMB/Shift pans; wheel zooms.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { CameraController } from './CameraController';
import type { CarModel } from './CarModel';
import type { Equipment } from './Equipment';
import { bus, notify, type PickTarget } from '../core/events';
import { SLOTS } from '../data/slots';
import type { Corner } from '../sim/types';
import type { NodeId } from '../sim/electrical';

export class Interaction {
  hover: PickTarget | null = null;
  selected: PickTarget | null = null;
  ghost: THREE.Vector3 | null = null;
  private ray = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private downAt: { x: number; y: number; t: number; target: PickTarget | null; button: number } | null = null;
  private holdTimer = 0;
  private working = false;
  private jacking: 1 | -1 | 0 = 0;
  hoverObject: THREE.Object3D | null = null;
  enabled = true;

  constructor(private dom: HTMLCanvasElement, private game: Game, private cam: CameraController, private car: CarModel, private eq: Equipment, private floor: THREE.Mesh, private extra: THREE.Object3D[]) {
    dom.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
  }

  private pick(clientX: number, clientY: number): { target: PickTarget | null; obj: THREE.Object3D | null; point: THREE.Vector3 | null } {
    const r = this.dom.getBoundingClientRect();
    this.mouse.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.cam.camera);
    const list = [...this.eq.allPickables(), ...this.car.pickables, ...this.extra];
    const hits = this.ray.intersectObjects(list, false);
    const isGlass = (o: THREE.Object3D) => { const m = (o as THREE.Mesh).material as THREE.Material & { opacity?: number }; return !!m && m.transparent && (m.opacity ?? 1) < 0.3; };
    const solid = hits.filter((x) => !isGlass(x.object));
    hits.splice(0, hits.length, ...solid, ...hits.filter((x) => isGlass(x.object)));
    for (const h of hits) {
      if (!this.visibleChain(h.object)) continue;
      const mat = (h.object as THREE.Mesh).material as THREE.Material;
      if (mat && (mat as any).opacity !== undefined && mat.transparent && (mat as any).opacity < 0.15 && h.object.userData.pick?.kind === 'slot' && !this.car.view.xray) continue;
      const pk = this.findPick(h.object);
      if (pk) return { target: { ...pk, point: [h.point.x, h.point.y, h.point.z] }, obj: h.object, point: h.point };
    }
    const fh = this.ray.intersectObject(this.floor, false)[0];
    if (fh) return { target: { kind: 'floor', id: 'floor', point: [fh.point.x, fh.point.y, fh.point.z] }, obj: this.floor, point: fh.point };
    return { target: null, obj: null, point: null };
  }
  private visibleChain(o: THREE.Object3D | null): boolean {
    while (o) { if (!o.visible) return false; o = o.parent; }
    return true;
  }
  private findPick(o: THREE.Object3D | null): PickTarget | null {
    while (o) { if (o.userData?.pick) return o.userData.pick; o = o.parent; }
    return null;
  }

  private down(e: PointerEvent) {
    if (!this.enabled) return;
    this.dom.setPointerCapture?.(e.pointerId);
    const { target } = this.pick(e.clientX, e.clientY);
    this.downAt = { x: e.clientX, y: e.clientY, t: performance.now(), target, button: e.button };
    this.holdTimer = 0;
    if (e.button !== 0 || !target || target.kind === 'floor') { this.cam.beginDrag(e.button, e.clientX, e.clientY); return; }
    // Jack pumping: hold LMB on the jack hotspot when the jack is placed there
    if (target.kind === 'hotspot' && target.id.startsWith('jack:') && this.game.jack.at === target.id.slice(5)) { this.jacking = e.shiftKey ? -1 : 1; return; }
  }

  private move(e: PointerEvent) {
    if (!this.enabled) return;
    if (this.downAt && this.cam.isDragging) { this.cam.drag(e.clientX, e.clientY); return; }
    if (this.downAt && !this.working && this.downAt.button === 0) {
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      if (moved > 6 && !this.jacking) { this.cam.beginDrag(0, e.clientX, e.clientY); return; }
    }
    if (e.target !== this.dom) { if (this.hover) { this.hover = null; this.hoverObject = null; bus.emit('hover:changed', { target: null }); } return; }
    const { target, obj, point } = this.pick(e.clientX, e.clientY);
    const kind = this.game.toolKind();
    this.ghost = kind === 'drain_pan' && target?.kind === 'floor' && point ? point.clone() : null;
    const changed = target?.kind !== this.hover?.kind || target?.id !== this.hover?.id;
    this.hover = target && target.kind !== 'floor' ? target : null;
    this.hoverObject = this.hover ? this.groupFor(obj) : null;
    if (changed) bus.emit('hover:changed', { target: this.hover });
  }

  private groupFor(obj: THREE.Object3D | null): THREE.Object3D | null {
    if (!obj) return null;
    const pk = this.findPick(obj);
    if (pk?.kind === 'slot') return this.car.objectFor(pk.id);
    let o: THREE.Object3D | null = obj;
    while (o?.parent && o.parent.userData?.pick?.id === pk?.id) o = o.parent;
    return o;
  }

  private up(e: PointerEvent) {
    if (!this.downAt) return;
    const d = this.downAt;
    this.downAt = null;
    this.jacking = 0;
    if (this.working) { this.working = false; this.game.endWork(); this.cam.endDrag(); return; }
    if (this.cam.isDragging) {
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      this.cam.endDrag();
      if (moved > 6 || d.button !== 0) return;
    }
    if (d.button !== 0) return;
    const { target, point } = this.pick(e.clientX, e.clientY);
    this.click(target, point, e);
  }

  /** Per-frame: hold-to-work & jack pumping. */
  update(dt: number) {
    if (this.jacking && this.game.jack.at) this.game.pumpJack(this.jacking, dt);
    if (!this.downAt || this.downAt.button !== 0 || this.cam.isDragging || this.working) return;
    const t = this.downAt.target;
    if (!t || t.kind !== 'slot') return;
    this.holdTimer += dt;
    if (this.holdTimer > 0.18 && SLOTS[t.id]?.thread) {
      if (this.game.beginWork(t.id)) { this.working = true; this.select(t); }
      else this.downAt = null;
    }
  }

  select(t: PickTarget | null) {
    this.selected = t;
    bus.emit('selection:changed', { target: t });
  }

  private click(target: PickTarget | null, point: THREE.Vector3 | null, e: PointerEvent) {
    const g = this.game;
    const kind = g.toolKind();
    if (kind === 'drain_pan' && target?.kind === 'floor' && point) { g.placeDrainPan(point.x, point.z); return; }
    if (!target) { this.select(null); return; }
    if (target.kind === 'hotspot') {
      const [type, id] = target.id.split(':');
      if (type === 'jack') { if (g.jack.at === id) g.pumpJack(e.shiftKey ? -1 : 1, 0.25); else g.placeJack(id as any); return; }
      if (type === 'stand') { g.placeStand(id as Corner); return; }
      if (type === 'probe') { g.probe(id as NodeId); return; }
    }
    if (target.kind === 'equipment') {
      if (target.id.startsWith('stand:')) { g.removeStand(target.id.slice(6) as Corner); return; }
      if (target.id === 'pan') { bus.emit('ui:open', { panel: 'pan' }); return; }
      bus.emit('ui:open', { panel: target.id });
      return;
    }
    if (target.kind === 'tray') { bus.emit('ui:open', { panel: 'inventory', arg: target.id }); return; }
    if (target.kind === 'slot') {
      this.select(target);
      return;
    }
    if (target.kind === 'floor') this.select(null);
    void notify;
  }
}
