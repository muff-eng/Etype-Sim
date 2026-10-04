/** 72-spoke wire wheels with 185 VR 15 tyres and eared knock-off spinners. Spokes are instanced. */
import * as THREE from 'three';
import { cyl, lathe, at, group, box } from './geom';
import type { Mats } from './materials';

const RIM_R = 0.19;

export interface WireWheel {
  root: THREE.Group;       // whole wheel (slot whl.X)
  spinner: THREE.Group;    // slot whl.spinner_X
  tyre: THREE.Mesh;
}

let spokeGeo: THREE.CylinderGeometry | null = null;

/** side: +1 for right-hand wheels (outer face towards +Z), -1 for left. */
export function buildWireWheel(M: Mats, side: 1 | -1): WireWheel {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.x = side > 0 ? Math.PI / 2 : -Math.PI / 2; // lathe axis Y → wheel axis Z, outer face out
  root.add(inner);
  // Tyre profile (r, y) — y along axle, outer face at +y
  const tp: [number, number][] = [];
  const W = 0.093;
  tp.push([RIM_R + 0.005, -W * 0.85]);
  for (let i = 0; i <= 16; i++) {
    const a = -Math.PI / 2 + (i / 16) * Math.PI;
    const r = 0.343 - 0.06 + Math.cos(a) * 0.06;
    const y = Math.sin(a) * W;
    tp.push([r + (Math.abs(Math.sin(a)) < 0.8 ? 0.0 : 0), y]);
  }
  tp.push([RIM_R + 0.005, W * 0.85]);
  const tyre = lathe(tp.reverse(), M.tyre, 64);
  inner.add(tyre);
  const sidewallTex = new THREE.Mesh(new THREE.RingGeometry(0.23, 0.29, 64), M.rubber);
  sidewallTex.rotation.x = -Math.PI / 2; sidewallTex.position.y = W * 0.86;
  inner.add(sidewallTex);
  // Rim
  const rim = lathe([[0.17, -0.065], [0.195, -0.065], [0.192, -0.05], [0.178, -0.04], [0.176, 0.04], [0.192, 0.05], [0.195, 0.065], [0.17, 0.065]], M.chrome, 64);
  inner.add(rim);
  // Hub shell
  const hub = lathe([[0.035, -0.07], [0.06, -0.06], [0.05, -0.02], [0.042, 0.03], [0.05, 0.07], [0.035, 0.08]], M.chrome, 32);
  inner.add(hub);
  // Spokes (instanced): 72 = 3 sets of 24 laced in tangential crosses
  if (!spokeGeo) spokeGeo = new THREE.CylinderGeometry(0.0017, 0.0017, 1, 4);
  const spokes = new THREE.InstancedMesh(spokeGeo, M.chrome, 72);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 72; i++) {
    const set = i % 3;
    const k = Math.floor(i / 3);
    const a = (k / 24) * Math.PI * 2 + set * 0.09;
    const hubY = set === 0 ? -0.055 : set === 1 ? 0.0 : 0.06;
    const hubR = set === 2 ? 0.045 : 0.055;
    const dir = k % 2 ? 1 : -1;
    const ah = a + dir * 0.55;
    const p0 = new THREE.Vector3(Math.cos(ah) * hubR, hubY, Math.sin(ah) * hubR);
    const rimY = set === 0 ? 0.02 : set === 1 ? -0.025 : 0.0;
    const p1 = new THREE.Vector3(Math.cos(a) * 0.174, rimY, Math.sin(a) * 0.174);
    const d = p1.clone().sub(p0);
    const len = d.length();
    q.setFromUnitVectors(up, d.normalize());
    s.set(1, len, 1);
    m.compose(p0.clone().add(p1).multiplyScalar(0.5), q, s);
    spokes.setMatrixAt(i, m);
  }
  spokes.castShadow = true;
  inner.add(spokes);
  // Spinner (eared knock-off)
  const spinner = new THREE.Group();
  const nut = lathe([[0.001, 0], [0.05, 0], [0.05, 0.012], [0.036, 0.03], [0.03, 0.05], [0.001, 0.05]], M.chrome, 8);
  spinner.add(nut);
  for (const e of [1, -1]) {
    const ear = box(0.016, 0.03, 0.12, M.chrome, 0, 0.03, e * 0.07, 0.006);
    ear.rotation.x = e * 0.25;
    spinner.add(ear);
  }
  spinner.position.y = 0.075;
  inner.add(spinner);
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, spinner, tyre };
}

export { RIM_R, cyl, at, group };
