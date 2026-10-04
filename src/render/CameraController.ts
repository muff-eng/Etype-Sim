/**
 * Camera modes: workshop orbit, free-fly (WASD), inspection (close orbit on a component),
 * underbody (creeper view), cockpit (driver's seat), with smooth transitions.
 */
import * as THREE from 'three';
import { ROOM } from './Workshop';
import { clamp } from '../core/units';

export type CamMode = 'orbit' | 'free' | 'inspect' | 'under' | 'cockpit';

export class CameraController {
  camera: THREE.PerspectiveCamera;
  mode: CamMode = 'orbit';
  target = new THREE.Vector3(0.3, 0.5, 0);
  yaw = 0.9;
  pitch = 0.32;
  dist = 6.2;
  private goal = { target: new THREE.Vector3(0.3, 0.5, 0), yaw: 0.9, pitch: 0.32, dist: 6.2 };
  private keys = new Set<string>();
  private dragging: 'orbit' | 'pan' | null = null;
  private last = { x: 0, y: 0 };
  private flyVel = new THREE.Vector3();
  menuSpin = false;
  onModeChange?: (m: CamMode) => void;

  constructor(private dom: HTMLElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.02, 80);
    window.addEventListener('keydown', (e) => { if (!(e.target as HTMLElement)?.closest('input,textarea,select')) this.keys.add(e.key.toLowerCase()); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.sign(e.deltaY)); }, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setMode(m: CamMode, focus?: THREE.Vector3, dist?: number) {
    this.mode = m;
    if (m === 'orbit') { this.goal.target.set(0.3, 0.5, 0); this.goal.dist = Math.max(this.goal.dist, 4.5); this.goal.pitch = clamp(this.goal.pitch, 0.12, 1.2); }
    if (m === 'inspect' && focus) { this.goal.target.copy(focus); this.goal.dist = dist ?? 0.9; }
    if (m === 'under') { this.goal.target.set(0.9, 0.22, 0); this.goal.pitch = -0.5; this.goal.dist = 1.0; this.goal.yaw = -2.2; }
    if (m === 'cockpit') { this.goal.target.set(0.3, 0.74, 0.33); this.goal.yaw = -Math.PI / 2; this.goal.pitch = 0.32; this.goal.dist = 0.62; }
    if (m === 'free') { /* keep current */ }
    this.onModeChange?.(m);
  }

  focus(p: THREE.Vector3, dist = 1.0) { this.setMode('inspect', p, dist); }

  beginDrag(button: number, x: number, y: number) {
    this.dragging = button === 2 || button === 1 || this.keys.has('shift') ? 'pan' : 'orbit';
    if (button === 2 && this.mode !== 'free') this.dragging = 'orbit';
    if (button === 1) this.dragging = 'pan';
    this.last = { x, y };
  }
  drag(x: number, y: number) {
    if (!this.dragging) return;
    const dx = x - this.last.x, dy = y - this.last.y;
    this.last = { x, y };
    if (this.dragging === 'orbit') {
      this.goal.yaw -= dx * 0.006;
      this.goal.pitch = clamp(this.goal.pitch + dy * 0.005, this.mode === 'under' ? -1.4 : -0.35, 1.45);
      if (this.mode === 'free') { this.yaw = this.goal.yaw; this.pitch = this.goal.pitch; }
    } else {
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      const s = this.dist * 0.0012;
      this.goal.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    }
  }
  endDrag() { this.dragging = null; }
  get isDragging() { return !!this.dragging; }

  zoom(dir: number) {
    const f = dir > 0 ? 1.12 : 1 / 1.12;
    const [min, max] = this.mode === 'inspect' ? [0.15, 4] : this.mode === 'cockpit' ? [0.2, 1.2] : this.mode === 'under' ? [0.3, 2.5] : [0.6, 11];
    this.goal.dist = clamp(this.goal.dist * f, min, max);
  }

  update(dt: number) {
    const k = clamp(dt * 7, 0, 1);
    if (this.menuSpin) this.goal.yaw += dt * 0.08;
    if (this.mode === 'free') {
      const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(-1);
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const acc = new THREE.Vector3();
      if (this.keys.has('w')) acc.addScaledVector(fwd, -1);
      if (this.keys.has('s')) acc.addScaledVector(fwd, 1);
      if (this.keys.has('a')) acc.addScaledVector(right, -1);
      if (this.keys.has('d')) acc.addScaledVector(right, 1);
      if (this.keys.has('e')) acc.y += 1;
      if (this.keys.has('q')) acc.y -= 1;
      const speed = this.keys.has('shift') ? 4 : 1.6;
      this.flyVel.lerp(acc.multiplyScalar(speed), clamp(dt * 8, 0, 1));
      this.goal.target.addScaledVector(this.flyVel, dt);
      this.yaw += (this.goal.yaw - this.yaw) * k;
      this.pitch += (this.goal.pitch - this.pitch) * k;
      this.target.copy(this.goal.target);
      this.dist = 0.001;
    } else {
      // WASD pans the orbit target in the other modes too
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const fwdFlat = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const pan = new THREE.Vector3();
      if (this.keys.has('w')) pan.add(fwdFlat);
      if (this.keys.has('s')) pan.sub(fwdFlat);
      if (this.keys.has('a')) pan.sub(right);
      if (this.keys.has('d')) pan.add(right);
      if (this.keys.has('e')) pan.y += 1;
      if (this.keys.has('q')) pan.y -= 1;
      if (pan.lengthSq() > 0) this.goal.target.addScaledVector(pan.normalize(), dt * Math.max(0.4, this.dist * 0.5));
      this.target.lerp(this.goal.target, k);
      this.yaw += (this.goal.yaw - this.yaw) * k;
      this.pitch += (this.goal.pitch - this.pitch) * k;
      this.dist += (this.goal.dist - this.dist) * k;
    }
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const offset = new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).multiplyScalar(this.dist);
    const pos = this.target.clone().add(offset);
    // Stay inside the room and above the floor (except underbody, which may sit just above the floor)
    pos.x = clamp(pos.x, ROOM.x0 + 0.2, ROOM.x1 - 0.2);
    pos.z = clamp(pos.z, ROOM.z0 + 0.2, ROOM.z1 - 0.2);
    pos.y = clamp(pos.y, this.mode === 'under' ? 0.06 : 0.08, ROOM.h - 0.15);
    this.camera.position.copy(pos);
    if (this.mode === 'free') {
      const look = pos.clone().add(new THREE.Vector3(-Math.sin(this.yaw) * cp, -sp, -Math.cos(this.yaw) * cp));
      this.camera.lookAt(look);
    } else this.camera.lookAt(this.target);
    this.camera.fov += ((this.mode === 'inspect' ? 38 : this.mode === 'cockpit' ? 62 : 45) - this.camera.fov) * k;
    this.camera.updateProjectionMatrix();
  }
}
