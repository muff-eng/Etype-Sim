/** Front frame, suspension, brakes, cooling, battery, IRS, exhaust and other chassis components. */
import * as THREE from 'three';
import { V, box, cyl, tube, at, group, hexNut, roundedBox } from './geom';
import type { Mats } from './materials';
import type { Binder } from './CarBody';
import { AXLE_F, AXLE_R, TRACK, WHEEL_R, POINTS, eng as engL } from '../data/layout';
const eng = (p: [number, number, number]) => new THREE.Vector3(...engL(p));

export interface ChassisParts {
  root: THREE.Group;
  battery: THREE.Group;
  termPos: THREE.Object3D;
  termNeg: THREE.Object3D;
  clipRad: THREE.Object3D;
  clipPump: THREE.Object3D;
  headerCap: THREE.Object3D;
  coolantLevel: THREE.Mesh;
  brakeLevel: THREE.Mesh;
  fan: THREE.Object3D;
  propshaft: THREE.Object3D;
  halfshafts: THREE.Object3D[];
  hubs: Record<string, THREE.Object3D>;
}

export function buildChassis(M: Mats, B: Binder): ChassisParts {
  const root = new THREE.Group();
  root.name = 'chassis';
  const T = (a: THREE.Vector3[], r: number, mat = M.black) => tube(a, r, mat, 16, 8);
  // ── Front frame (square tubes) ──
  const frame = new THREE.Group();
  const sq = (a: THREE.Vector3, b: THREE.Vector3, s = 0.035) => {
    const len = a.distanceTo(b);
    const m = box(s, s, len, M.black);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.lookAt(b);
    frame.add(m);
  };
  for (const s of [1, -1]) {
    sq(V(0.62, 0.3, s * 0.42), V(1.75, 0.27, s * 0.42));
    sq(V(0.62, 0.55, s * 0.4), V(1.7, 0.5, s * 0.36));
    sq(V(1.0, 0.3, s * 0.42), V(1.3, 0.5, s * 0.38));
    sq(V(1.5, 0.27, s * 0.42), V(1.62, 0.5, s * 0.37));
    sq(V(0.62, 0.3, s * 0.42), V(0.62, 0.55, s * 0.4));
  }
  sq(V(1.75, 0.27, 0.42), V(1.75, 0.27, -0.42));
  sq(V(1.62, 0.5, 0.37), V(1.62, 0.5, -0.37));
  sq(V(1.1, 0.24, 0.42), V(1.1, 0.24, -0.42), 0.05);
  root.add(frame);
  B.bind('body.front_frame', frame);

  // ── Front suspension & brakes ──
  const hubs: Record<string, THREE.Object3D> = {};
  for (const [c, s] of [['FR', 1], ['FL', -1]] as const) {
    const z = s * TRACK / 2;
    const upper = group(T([V(AXLE_F - 0.12, 0.5, s * 0.38), V(AXLE_F, 0.48, z - s * 0.11), V(AXLE_F + 0.12, 0.5, s * 0.38)], 0.012));
    const lower = group(T([V(AXLE_F - 0.15, 0.24, s * 0.4), V(AXLE_F, 0.22, z - s * 0.1), V(AXLE_F + 0.15, 0.24, s * 0.4)], 0.016));
    const upright = T([V(AXLE_F, 0.48, z - s * 0.11), V(AXLE_F, 0.34, z - s * 0.09), V(AXLE_F, 0.22, z - s * 0.1)], 0.02, M.satin);
    const damper = group(cyl(0.022, 0.26, M.satin, 'y', 12), at(cyl(0.015, 0.12, M.chrome, 'y', 10), 0, 0.17, 0));
    damper.position.set(AXLE_F + 0.04, 0.38, z - s * 0.2); damper.rotation.x = s * 0.25;
    root.add(upper, lower, upright, damper);
    B.bind(`sus.uwb_${c}`, upper); B.bind(`sus.lwb_${c}`, lower); B.bind(`sus.damper_${c}`, damper);
    const hub = group(cyl(0.05, 0.1, M.steel, 'z', 20));
    hub.position.set(AXLE_F, WHEEL_R, z - s * 0.06);
    root.add(hub);
    B.bind(`sus.hub_${c}`, hub);
    hubs[c] = hub;
    const disc = group(cyl(0.1395, 0.0127, M.steel, 'z', 48), at(cyl(0.06, 0.03, M.satin, 'z', 24), 0, 0, -s * 0.015));
    disc.position.set(AXLE_F, WHEEL_R, z - s * 0.09);
    root.add(disc);
    B.bind(`brk.disc_${c}`, disc);
    const caliper = group(box(0.09, 0.06, 0.05, M.satin, 0, 0, 0, 0.012), at(cyl(0.006, 0.02, M.brass, 'z', 8), 0.02, 0.03, s * 0.025));
    caliper.position.set(AXLE_F - 0.1, WHEEL_R + 0.08, z - s * 0.09); caliper.rotation.z = 0.7;
    root.add(caliper);
    B.bind(`brk.caliper_${c}`, caliper);
    const pads = group(box(0.07, 0.04, 0.01, M.iron, 0, 0, 0.012), box(0.07, 0.04, 0.01, M.iron, 0, 0, -0.012));
    pads.position.copy(caliper.position); pads.rotation.z = 0.7;
    root.add(pads);
    B.bind(`brk.pads_${c}`, pads);
    const tbar = cyl(0.012, 1.2, M.satin, 'x', 10); tbar.position.set(AXLE_F - 0.62, 0.24, s * 0.4);
    root.add(tbar);
    B.bind(s > 0 ? 'sus.torsion_R' : 'sus.torsion_L', tbar);
  }
  const arbF = T([V(AXLE_F + 0.25, 0.25, 0.5), V(AXLE_F + 0.3, 0.25, 0), V(AXLE_F + 0.25, 0.25, -0.5)], 0.01);
  root.add(arbF); B.bind('sus.arb_F', arbF);
  const rack = group(cyl(0.025, 0.7, M.satin, 'z', 14), at(cyl(0.01, 0.2, M.zinc, 'z', 8), 0, 0, 0.42), at(cyl(0.01, 0.2, M.zinc, 'z', 8), 0, 0, -0.42));
  rack.position.set(AXLE_F + 0.12, 0.32, 0);
  root.add(rack); B.bind('str.rack', rack);

  // ── Cooling ──
  const rad = group(box(0.05, 0.4, 0.62, M.radiator, 0, 0, 0), at(box(0.06, 0.04, 0.64, M.black), 0, 0.22, 0), at(box(0.06, 0.04, 0.64, M.black), 0, -0.22, 0));
  rad.position.set(1.57, 0.44, 0); rad.rotation.z = -0.12;
  root.add(rad); B.bind('cool.radiator', rad);
  const fan = group(cyl(0.05, 0.08, M.black, 'x', 16));
  for (let i = 0; i < 4; i++) { const bl = box(0.01, 0.16, 0.05, M.black, -0.05, 0, 0); bl.geometry.translate(0, 0.08, 0); bl.rotation.x = (i * Math.PI) / 2; bl.rotation.y = 0.3; fan.add(bl); }
  fan.position.set(1.48, 0.44, 0.12);
  root.add(fan); B.bind('cool.fan', fan);
  const header = group(cyl(0.065, 0.2, M.brass, 'x', 20));
  header.position.set(POINTS.headerCap[0], POINTS.headerCap[1] - 0.08, POINTS.headerCap[2]);
  root.add(header); B.bind('cool.header_tank', header);
  const coolantLevel = new THREE.Mesh(new THREE.CircleGeometry(0.018, 16), M.coolant);
  coolantLevel.rotation.x = -Math.PI / 2; coolantLevel.position.set(POINTS.headerCap[0], POINTS.headerCap[1] - 0.02, POINTS.headerCap[2]);
  root.add(coolantLevel);
  const hcap = group(cyl(0.024, 0.016, M.brass, 'y', 20), at(box(0.05, 0.008, 0.008, M.brass), 0, 0.01, 0));
  hcap.position.set(...POINTS.headerCap);
  root.add(hcap); B.bind('cool.header_cap', hcap, { axis: V(0, 1, 0), pitch: 0.012, spin: true });
  const neck = cyl(0.02, 0.05, M.brass, 'y', 16); neck.position.set(POINTS.headerCap[0], POINTS.headerCap[1] - 0.03, POINTS.headerCap[2]);
  root.add(neck);
  const top = T([eng([0.395, 0.355, 0]), V(1.45, 0.73, 0.05), V(1.53, 0.62, 0.1)], 0.02, M.hose);
  root.add(top); B.bind('cool.top_hose', top);
  const pRad = V(...POINTS.bottomHoseRad), pPump = V(...POINTS.bottomHosePump);
  const bottom = T([pRad, V(1.44, 0.3, -0.13), V(1.38, 0.4, -0.09), pPump], 0.021, M.hose);
  root.add(bottom); B.bind('cool.bottom_hose', bottom);
  const wormClip = () => group(new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0025, 6, 24), M.zinc), at(box(0.012, 0.01, 0.014, M.zinc), 0, 0.026, 0), at(cyl(0.003, 0.016, M.zinc, 'z', 8), 0, 0.03, 0));
  const clipRad = wormClip();
  clipRad.position.copy(pRad).add(V(-0.025, 0.005, 0)); clipRad.rotation.y = Math.PI / 2;
  const clipPump = wormClip();
  clipPump.position.copy(pPump).add(V(0.02, -0.02, -0.01)); clipPump.rotation.set(0.6, 0.5, 0);
  root.add(clipRad, clipPump);
  B.bind('cool.clip_rad', clipRad, { axis: V(0, 1, 0), pitch: 0 });
  B.bind('cool.clip_pump', clipPump, { axis: V(0, 1, 0), pitch: 0 });

  // ── Battery, terminals, hold-down ──
  const bp = V(...POINTS.battery);
  const battery = new THREE.Group();
  battery.position.copy(bp);
  const caseM = new THREE.Mesh(roundedBox(0.24, 0.19, 0.17, 0.008), M.battery);
  battery.add(caseM);
  for (let i = 0; i < 6; i++) battery.add(at(cyl(0.012, 0.01, M.black, 'y', 12), -0.09 + i * 0.036, 0.1, 0.0));
  const postP = cyl(0.01, 0.02, M.zinc, 'y', 12); postP.position.set(0.08, 0.105, 0.05);
  const postN = cyl(0.009, 0.02, M.zinc, 'y', 12); postN.position.set(0.08, 0.105, -0.05);
  battery.add(postP, postN);
  battery.add(at(box(0.02, 0.003, 0.02, M.red), 0.04, 0.097, 0.05));
  root.add(battery);
  B.bind('elec.battery', battery);
  const tray = box(0.26, 0.01, 0.19, M.black, bp.x, bp.y - 0.1, bp.z); root.add(tray);
  const hold = group(box(0.03, 0.01, 0.2, M.black, 0, 0, 0), at(cyl(0.004, 0.2, M.zinc, 'y', 6), 0, -0.1, 0.09), at(cyl(0.004, 0.2, M.zinc, 'y', 6), 0, -0.1, -0.09), at(cyl(0.01, 0.01, M.zinc, 'y', 6), 0, 0.008, 0.09), at(cyl(0.01, 0.01, M.zinc, 'y', 6), 0, 0.008, -0.09));
  hold.position.set(bp.x - 0.06, bp.y + 0.1, bp.z);
  root.add(hold); B.bind('elec.batt_hold', hold, { axis: V(0, 1, 0), pitch: 0.002 });
  const clamp = (red: boolean) => group(cyl(0.016, 0.022, red ? M.zinc : M.zinc, 'y', 14), at(hexNut(0.0111, 0.008, M.zinc, 'z'), 0, 0, 0.02), at(cyl(0.007, 0.05, red ? M.wireRed : M.wire, 'z', 8), 0, 0.004, 0.045));
  const termPos = clamp(true); termPos.position.set(bp.x + 0.08, bp.y + 0.11, bp.z + 0.05);
  const termNeg = clamp(false); termNeg.position.set(bp.x + 0.08, bp.y + 0.11, bp.z - 0.05);
  root.add(termPos, termNeg);
  B.bind('elec.term_pos', termPos, { axis: V(0, 1, 0), pitch: 0 });
  B.bind('elec.term_neg', termNeg, { axis: V(0, 1, 0), pitch: 0 });
  // main cables
  root.add(T([V(bp.x + 0.08, bp.y + 0.12, bp.z + 0.1), V(0.9, 0.5, 0.38), eng([-0.3, 0.06, 0.2])], 0.008, M.wireRed));
  const strap = T([eng([-0.1, -0.02, -0.17]), V(0.82, 0.32, -0.38), V(0.7, 0.33, -0.42)], 0.006, M.copper);
  root.add(strap); B.bind('elec.earth_strap', strap);
  const reg = box(0.08, 0.05, 0.06, M.black, 0.66, 0.66, -0.3); root.add(reg); B.bind('elec.regulator', reg);
  const horns = group(cyl(0.04, 0.04, M.black, 'x', 16), at(cyl(0.04, 0.04, M.black, 'x', 16), 0, 0, -0.12));
  horns.position.set(1.68, 0.35, 0.25); root.add(horns); B.bind('elec.horns', horns);
  const coil = group(cyl(0.028, 0.13, M.black, 'y', 16), at(cyl(0.012, 0.03, M.black, 'y', 10), 0, 0.075, 0));
  coil.position.set(0.82, 0.6, 0.38); root.add(coil); B.bind('ign.coil', coil);
  // harness (decorative bundle along the inner wings)
  const harness = group(T([V(0.66, 0.6, 0.36), V(1.2, 0.56, 0.36), V(1.6, 0.42, 0.3)], 0.008, M.wire), T([V(0.66, 0.6, -0.36), V(1.2, 0.56, -0.36), V(1.6, 0.42, -0.3)], 0.008, M.wire));
  root.add(harness); B.bind('elec.harness', harness);

  // ── Brake & clutch reservoirs, master cylinder ──
  const resv = (p: readonly number[], slot: string) => {
    const g = group(cyl(0.03, 0.08, M.plastic, 'y', 16), at(cyl(0.032, 0.015, M.black, 'y', 16), 0, 0.045, 0));
    g.position.set(p[0], p[1], p[2]);
    root.add(g); B.bind(slot, g);
    return g;
  };
  resv(POINTS.brakeRes, 'brk.reservoir');
  resv(POINTS.clutchRes, 'clu.reservoir');
  const brakeLevel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0xd8c890, transparent: true, opacity: 0.6 }));
  brakeLevel.position.set(POINTS.brakeRes[0], POINTS.brakeRes[1] - 0.008, POINTS.brakeRes[2]);
  root.add(brakeLevel);
  const master = group(cyl(0.035, 0.18, M.satin, 'x', 16), at(cyl(0.08, 0.06, M.satin, 'x', 24), -0.1, 0, 0));
  master.position.set(0.7, 0.6, 0.22); root.add(master); B.bind('brk.master', master);

  // ── Propshaft, IRS cage, final drive, inboard brakes, rear suspension ──
  const prop = cyl(0.035, 1.0, M.satin, 'x', 14); prop.position.set(-0.5, 0.33, 0);
  root.add(prop); B.bind('trn.propshaft', prop);
  const cage = group(box(0.6, 0.04, 0.9, M.black, 0, 0.2, 0), at(box(0.04, 0.3, 0.9, M.black), 0.3, 0.05, 0), at(box(0.04, 0.3, 0.9, M.black), -0.3, 0.05, 0));
  cage.position.set(AXLE_R, 0.18, 0);
  root.add(cage); B.bind('sus.irs_cage', cage);
  const diff = group(new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 18), M.alu), at(cyl(0.07, 0.12, M.alu, 'x', 16), 0.14, 0, 0));
  diff.position.set(AXLE_R, 0.33, 0);
  root.add(diff); B.bind('trn.diff', diff);
  const dlvl = group(hexNut(0.019, 0.012, M.zinc, 'z'));
  dlvl.position.set(POINTS.diffLevel[0], POINTS.diffLevel[1], POINTS.diffLevel[2]);
  root.add(dlvl); B.bind('trn.diff_level', dlvl, { axis: V(0, 0, 1), pitch: 0.003, spin: true });
  const halfshafts: THREE.Object3D[] = [];
  for (const [c, s] of [['RR', 1], ['RL', -1]] as const) {
    const z = s * TRACK / 2;
    const disc = cyl(0.127, 0.0127, M.steel, 'z', 40); disc.position.set(AXLE_R, 0.33, s * 0.17);
    root.add(disc); B.bind(`brk.disc_${c}`, disc);
    const cal = box(0.08, 0.06, 0.05, M.satin, AXLE_R + 0.1, 0.42, s * 0.17, 0.01); root.add(cal); B.bind(`brk.caliper_${c}`, cal);
    const hs = T([V(AXLE_R, 0.33, s * 0.19), V(AXLE_R, WHEEL_R, z - s * 0.06)], 0.022, M.satin);
    root.add(hs); B.bind(`sus.halfshaft_${c}`, hs); halfshafts.push(hs);
    const wb = T([V(AXLE_R - 0.15, 0.17, s * 0.25), V(AXLE_R, 0.2, z - s * 0.1), V(AXLE_R + 0.15, 0.17, s * 0.25)], 0.018);
    root.add(wb); B.bind(`sus.wishbone_${c}`, wb);
    for (const [k, dx] of [['a', 0.07], ['b', -0.07]] as const) {
      const d = group(cyl(0.022, 0.28, M.satin, 'y', 12), new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.006, 6, 18), M.toolRed));
      const coils = new THREE.Group();
      for (let i = 0; i < 6; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.006, 6, 18), M.toolRed); r.rotation.x = Math.PI / 2; r.position.y = -0.1 + i * 0.04; coils.add(r); }
      d.add(coils);
      d.position.set(AXLE_R + dx, 0.38, z - s * 0.2); d.rotation.x = s * 0.2;
      root.add(d); B.bind(`sus.damper_${c}${k}`, d);
    }
    const ra = T([V(AXLE_R, 0.2, z - s * 0.12), V(AXLE_R + 0.5, 0.22, s * 0.55)], 0.014);
    root.add(ra); B.bind(`sus.radius_arm_${c}`, ra);
    const hub = group(cyl(0.05, 0.1, M.steel, 'z', 20)); hub.position.set(AXLE_R, WHEEL_R, z - s * 0.06); root.add(hub); hubs[c] = hub;
  }
  const arbR = T([V(AXLE_R - 0.2, 0.22, 0.5), V(AXLE_R - 0.25, 0.22, 0), V(AXLE_R - 0.2, 0.22, -0.5)], 0.009);
  root.add(arbR); B.bind('sus.arb_R', arbR);
  const tank = box(0.55, 0.2, 0.9, M.black, -1.55, 0.36, 0, 0.04); root.add(tank); B.bind('fuel.tank', tank);
  // ── Exhaust system ──
  const exh = new THREE.Group();
  for (const s of [1, -1]) {
    exh.add(T([eng([s > 0 ? 0.17 : -0.17, -0.13, -0.18]), V(0.6, 0.15, s * 0.07), V(0.0, 0.14, s * 0.12), V(-0.8, 0.15, s * 0.14)], 0.024, M.steel));
    const sil = cyl(0.07, 0.6, M.steel, 'x', 16); sil.position.set(-1.1, 0.16, s * 0.2); exh.add(sil);
    exh.add(T([V(-1.4, 0.16, s * 0.2), V(-1.9, 0.2, s * 0.1), V(-2.2, 0.23, s * 0.07)], 0.024, M.steel));
  }
  root.add(exh); B.bind('exh.system', exh);
  return { root, battery, termPos, termNeg, clipRad, clipPump, headerCap: hcap, coolantLevel, brakeLevel, fan, propshaft: prop, halfshafts, hubs };
}
