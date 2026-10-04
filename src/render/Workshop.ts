/** The workshop environment: low-poly where the player does not interact. */
import * as THREE from 'three';
import { box, cyl, at, group, tube, V } from './geom';
import { TEX, type Mats } from './materials';

export const ROOM = { x0: -6.5, x1: 7.0, z0: -5.2, z1: 5.2, h: 4.2 };

export interface WorkshopParts {
  root: THREE.Group;
  floor: THREE.Mesh;
  toolChest: THREE.Object3D;
  computer: THREE.Object3D;
  jobBoard: THREE.Object3D;
  bench: THREE.Object3D;
  lift: THREE.Object3D;
  hoist: THREE.Object3D;
  engineStand: THREE.Object3D;
  washer: THREE.Object3D;
  lights: THREE.Light[];
  trayTable: THREE.Object3D;
}

export function buildWorkshop(M: Mats): WorkshopParts {
  const root = new THREE.Group();
  root.name = 'workshop';
  const W = ROOM.x1 - ROOM.x0, D = ROOM.z1 - ROOM.z0;
  const cx = (ROOM.x0 + ROOM.x1) / 2, cz = (ROOM.z0 + ROOM.z1) / 2;
  const floorMat = new THREE.MeshStandardMaterial({ map: TEX.concrete(), roughness: 0.82, metalness: 0.02 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  floor.userData.pick = { kind: 'floor', id: 'floor' };
  root.add(floor);
  // Painted bay lines
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.7 });
  for (const z of [-1.9, 1.9]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.08), lineMat); l.rotation.x = -Math.PI / 2; l.position.set(0, 0.002, z); root.add(l); }
  // Walls
  const wallLow = new THREE.MeshStandardMaterial({ map: TEX.brick(), roughness: 0.9 });
  const wallHigh = new THREE.MeshStandardMaterial({ color: 0xcfd2c8, roughness: 0.95 });
  const wall = (w: number, x: number, z: number, ry: number) => {
    const lo = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.4), wallLow); lo.position.set(x, 0.7, z); lo.rotation.y = ry; lo.receiveShadow = true;
    const hi = new THREE.Mesh(new THREE.PlaneGeometry(w, ROOM.h - 1.4), wallHigh); hi.position.set(x, 1.4 + (ROOM.h - 1.4) / 2, z); hi.rotation.y = ry; hi.receiveShadow = true;
    root.add(lo, hi);
  };
  wall(W, cx, ROOM.z0, 0);
  wall(W, cx, ROOM.z1, Math.PI);
  wall(D, ROOM.x0, cz, Math.PI / 2);
  wall(D, ROOM.x1, cz, -Math.PI / 2);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x8b8f92, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(cx, ROOM.h, cz);
  root.add(ceil);
  // Roller door (front wall, +X)
  const door = new THREE.Group();
  for (let i = 0; i < 18; i++) door.add(box(0.03, 0.16, 3.6, new THREE.MeshStandardMaterial({ color: 0x5d6b73, metalness: 0.5, roughness: 0.5 }), ROOM.x1 - 0.02, 0.1 + i * 0.17, 0));
  root.add(door);
  // Roof trusses
  for (let x = -5; x <= 6; x += 2.2) root.add(box(0.12, 0.2, D, M.satin, x, ROOM.h - 0.25, cz));
  // Strip lights (emissive tubes)
  const lights: THREE.Light[] = [];
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 2.2 });
  for (const [x, z] of [[-2.2, -1.2], [-2.2, 1.2], [0.2, -1.2], [0.2, 1.2], [2.6, -1.2], [2.6, 1.2], [5, 0], [-4.8, 0]] as const) {
    const fx = group(box(1.5, 0.05, 0.14, M.white, 0, 0.03, 0), at(cyl(0.02, 1.4, tubeMat, 'x', 8), 0, -0.01, 0.03), at(cyl(0.02, 1.4, tubeMat, 'x', 8), 0, -0.01, -0.03));
    fx.position.set(x, ROOM.h - 0.6, z);
    root.add(fx);
    root.add(tube([V(x - 0.6, ROOM.h - 0.55, z), V(x - 0.6, ROOM.h, z)], 0.003, M.black, 2, 4));
    root.add(tube([V(x + 0.6, ROOM.h - 0.55, z), V(x + 0.6, ROOM.h, z)], 0.003, M.black, 2, 4));
  }
  // Workbench with vise along the back wall (-Z)
  const benchTop = new THREE.MeshStandardMaterial({ color: 0x6b4b2a, roughness: 0.7 });
  const bench = group(box(3.2, 0.06, 0.8, benchTop, 0, 0.92, 0), box(3.1, 0.7, 0.75, M.satin, 0, 0.5, 0), at(box(0.25, 0.14, 0.12, M.toolRed, 1.2, 1.02, 0.2, 0.02), 0, 0, 0));
  const vise = group(box(0.22, 0.12, 0.12, M.toolRed, 0, 0, 0, 0.02), at(box(0.18, 0.1, 0.03, M.steel), 0, 0.03, 0.08), at(cyl(0.01, 0.25, M.steel, 'z'), 0, -0.02, 0.18));
  vise.position.set(-1.3, 1.02, 0.25);
  bench.add(vise);
  bench.position.set(-2.4, 0, ROOM.z0 + 0.45);
  root.add(bench);
  const peg = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), new THREE.MeshStandardMaterial({ map: TEX.pegboard(), roughness: 0.9 }));
  peg.position.set(-2.4, 1.75, ROOM.z0 + 0.02);
  root.add(peg);
  for (let i = 0; i < 14; i++) {
    const t = box(0.025, 0.18 + (i % 4) * 0.04, 0.01, i % 3 ? M.toolChrome : M.toolRed, -3.7 + i * 0.19, 1.85, ROOM.z0 + 0.04);
    root.add(t);
  }
  // Parts tray table beside the car
  const trayTable = group(box(1.2, 0.04, 0.6, M.satin, 0, 0.75, 0), box(1.15, 0.72, 0.55, M.black, 0, 0.37, 0), at(box(1.2, 0.03, 0.6, M.toolRed), 0, 0.785, 0));
  trayTable.position.set(1.0, 0, -2.6);
  trayTable.userData.pick = { kind: 'equipment', id: 'tray' };
  root.add(trayTable);
  // Tool chest (rolling cabinet)
  const chest = group(box(1.0, 1.0, 0.5, M.toolRed, 0, 0.55, 0, 0.02), box(1.02, 0.4, 0.52, M.toolRed, 0, 1.25, 0, 0.02));
  for (let i = 0; i < 6; i++) chest.add(box(0.9, 0.012, 0.01, M.toolChrome, 0, 0.18 + i * 0.16, 0.26));
  for (const [x, z] of [[-0.42, -0.2], [0.42, -0.2], [-0.42, 0.2], [0.42, 0.2]] as const) chest.add(at(cyl(0.04, 0.04, M.black, 'z'), x, 0.04, z));
  chest.position.set(1.6, 0, ROOM.z0 + 0.5);
  chest.userData.pick = { kind: 'equipment', id: 'toolchest' };
  root.add(chest);
  // Parts computer desk
  const computer = group(box(1.2, 0.04, 0.6, benchTop, 0, 0.74, 0), box(0.04, 0.72, 0.55, M.satin, -0.55, 0.36, 0), box(0.04, 0.72, 0.55, M.satin, 0.55, 0.36, 0),
    at(box(0.42, 0.34, 0.36, new THREE.MeshStandardMaterial({ color: 0xd9d2bf, roughness: 0.6 }), 0, 0.95, -0.05, 0.03), 0, 0, 0),
    at(box(0.32, 0.24, 0.01, new THREE.MeshStandardMaterial({ color: 0x0b2a10, emissive: 0x2bd04a, emissiveIntensity: 0.35 }), 0, 0.97, 0.131), 0, 0, 0),
    at(box(0.4, 0.02, 0.15, M.white, 0, 0.77, 0.18), 0, 0, 0));
  computer.position.set(4.2, 0, ROOM.z0 + 0.45);
  computer.userData.pick = { kind: 'equipment', id: 'computer' };
  root.add(computer);
  // Job board
  const jobBoard = group(box(1.2, 0.8, 0.03, new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 }), 0, 0, 0));
  for (let i = 0; i < 5; i++) jobBoard.add(box(0.2, 0.28, 0.01, M.white, -0.42 + i * 0.21, (i % 2) * 0.1, 0.02));
  jobBoard.position.set(ROOM.x0 + 0.03, 1.7, -2.2); jobBoard.rotation.y = Math.PI / 2;
  jobBoard.userData.pick = { kind: 'equipment', id: 'jobboard' };
  root.add(jobBoard);
  // Shelving with parts boxes
  const shelf = new THREE.Group();
  for (let lv = 0; lv < 4; lv++) {
    shelf.add(box(2.2, 0.03, 0.5, M.satin, 0, 0.3 + lv * 0.55, 0));
    for (let i = 0; i < 6; i++) shelf.add(box(0.28, 0.2 + ((i + lv) % 3) * 0.06, 0.34, new THREE.MeshStandardMaterial({ color: [0x8a6a3a, 0x2a4a8a, 0x8a2a2a, 0x3a6a3a][(i + lv) % 4], roughness: 0.8 }), -0.85 + i * 0.34, 0.43 + lv * 0.55, 0));
  }
  for (const x of [-1.08, 1.08]) for (const z of [-0.22, 0.22]) shelf.add(box(0.03, 2.1, 0.03, M.satin, x, 1.05, z));
  shelf.position.set(ROOM.x0 + 0.35, 0, 2.6); shelf.rotation.y = Math.PI / 2;
  root.add(shelf);
  // Oil drums, compressor + air reel, waste drum
  for (const [x, z, c] of [[-5.6, -4.4, 0x2a4a8a], [-5.0, -4.5, 0x8a2a2a], [-5.3, -3.8, 0x2a2a2a]] as const) {
    const d = cyl(0.29, 0.88, new THREE.MeshStandardMaterial({ color: c, metalness: 0.5, roughness: 0.5 }), 'y', 20); d.position.set(x, 0.44, z); root.add(d);
  }
  const comp = group(at(cyl(0.22, 0.9, new THREE.MeshStandardMaterial({ color: 0x9a1a14, metalness: 0.4, roughness: 0.4 }), 'x', 20), 0, 0.3, 0), at(box(0.3, 0.25, 0.3, M.satin), 0.1, 0.65, 0), at(cyl(0.06, 0.08, M.black, 'z'), 0.3, 0.06, 0.15));
  comp.position.set(5.6, 0, -4.4);
  root.add(comp);
  const reel = group(cyl(0.22, 0.12, new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5 }), 'x', 24));
  reel.position.set(ROOM.x1 - 0.1, 2.0, -3.2);
  root.add(reel);
  // Phase-locked equipment (shown dim until owned)
  const ghost = new THREE.MeshStandardMaterial({ color: 0x777777, transparent: true, opacity: 0.35, roughness: 0.8 });
  const lift = group(box(0.3, 2.8, 0.3, ghost, 0, 1.4, 0), box(0.3, 2.8, 0.3, ghost, 0, 1.4, 3.0), box(0.3, 0.2, 3.3, ghost, 0, 2.9, 1.5));
  lift.position.set(-4.8, 0, -1.6);
  root.add(lift);
  const hoist = group(box(1.4, 0.08, 0.08, M.toolRed, 0, 0.08, 0.4), box(1.4, 0.08, 0.08, M.toolRed, 0, 0.08, -0.4), box(0.1, 1.7, 0.1, M.toolRed, -0.6, 0.9, 0), at(box(1.5, 0.1, 0.1, M.toolRed), 0.1, 1.75, 0, 0, 0, -0.2), at(tube([V(0.8, 1.6, 0), V(0.8, 1.2, 0)], 0.006, M.steel, 2, 4), 0, 0, 0), at(cyl(0.05, 0.4, M.steel, 'y'), -0.4, 1.2, 0, 0, 0, 0.5));
  hoist.position.set(-4.5, 0, 3.6);
  root.add(hoist);
  const engineStand = group(box(0.08, 0.9, 0.08, M.toolRed, 0, 0.45, 0), box(0.8, 0.06, 0.06, M.toolRed, 0, 0.05, 0), box(0.06, 0.06, 0.8, M.toolRed, -0.35, 0.05, 0), at(cyl(0.12, 0.05, M.steel, 'x'), 0.1, 0.9, 0));
  engineStand.position.set(-2.4, 0, 3.8);
  root.add(engineStand);
  const washer = group(box(0.9, 0.9, 0.6, new THREE.MeshStandardMaterial({ color: 0x2a5a8a, metalness: 0.4, roughness: 0.5 }), 0, 0.45, 0, 0.03));
  washer.position.set(-0.6, 0, 4.5);
  root.add(washer);
  // Workshop sign
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.5), new THREE.MeshStandardMaterial({ map: TEX.text('COUGAR TYPE E SPECIALISTS', 1024, 160, 'bold 74px Georgia', '#e9e0c9', '#1d3a2c'), roughness: 0.6 }));
  sign.position.set(0.5, 3.2, ROOM.z0 + 0.03);
  root.add(sign);
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== floor) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, floor, toolChest: chest, computer, jobBoard, bench, lift, hoist, engineStand, washer, lights, trayTable };
}
