/**
 * Procedural 4.2L JET inline-six: block, head, twin-cam covers, triple SU carburettors, manifolds,
 * ancillaries and moving internals (crank, rods, pistons, camshafts, valves). Every component is
 * bound to its slot; explode vectors encode the assembly stack for the exploded view.
 */
import * as THREE from 'three';
import { V, box, cyl, tube, lathe, at, group, extrudeX, hexNut, roundedBox } from './geom';
import { TEX, type Mats } from './materials';
import { cylX, CRANK_R, ROD_L, TDC_COMP, ENGINE_ORIGIN } from '../data/layout';
import type { Binder } from './CarBody';
import { BRANDING } from '../config/branding';

export interface EngineParts {
  root: THREE.Group;
  crank: THREE.Group;
  pistons: THREE.Object3D[];
  rods: THREE.Object3D[];
  camIn: THREE.Object3D;
  camEx: THREE.Object3D;
  valvesIn: THREE.Object3D[];
  valvesEx: THREE.Object3D[];
  altPivot: THREE.Group;
  fanBelt: THREE.Mesh;
  explode: { obj: THREE.Object3D; offset: THREE.Vector3; base: THREE.Vector3 }[];
  clipMats: THREE.Material[];
  internals: THREE.Object3D[];
  leadBoots: THREE.Object3D[];
  pulleys: THREE.Object3D[];
}

export function buildEngine(M: Mats, B: Binder): EngineParts {
  const root = new THREE.Group();
  root.name = 'engine';
  root.position.set(...ENGINE_ORIGIN);
  const explode: EngineParts['explode'] = [];
  const ex = (obj: THREE.Object3D, x: number, y: number, z: number) => { explode.push({ obj, offset: V(x, y, z), base: obj.position.clone() }); return obj; };
  // Materials that get the cutaway clipping plane
  const iron = M.iron.clone(); iron.side = THREE.DoubleSide;
  const alu = M.alu.clone(); alu.side = THREE.DoubleSide;
  const polished = M.polished.clone(); polished.side = THREE.DoubleSide;
  const clipMats = [iron, alu, polished];

  // ── Block ──
  const block = extrudeX([[-0.128, 0.25], [0.128, 0.25], [0.152, 0.12], [0.172, 0.02], [0.168, -0.072], [-0.168, -0.072], [-0.172, 0.02], [-0.152, 0.12]], 0.66, iron, 0.006);
  root.add(ex(block, 0, 0, 0));
  B.bind('eng.block', block);
  // bores (dark liners visible in cutaway)
  const bores = new THREE.Group();
  for (let c = 1; c <= 6; c++) { const b = cyl(0.047, 0.2, new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.8, roughness: 0.3, side: THREE.BackSide }), 'y', 24); b.position.set(cylX(c), 0.15, 0); bores.add(b); }
  root.add(bores);
  // ── Head gasket ──
  const gasket = box(0.66, 0.003, 0.27, new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.6, roughness: 0.5 }), 0, 0.2515, 0);
  root.add(ex(gasket, 0, 0.17, 0));
  B.bind('eng.head_gasket', gasket);
  // ── Head ──
  const head = extrudeX([[-0.134, 0.253], [0.134, 0.253], [0.142, 0.3], [0.124, 0.372], [-0.124, 0.372], [-0.142, 0.3]], 0.68, alu, 0.005);
  root.add(ex(head, 0, 0.34, 0));
  B.bind('eng.head', head);
  // Head nuts along the flanges
  for (let n = 1; n <= 14; n++) {
    const side = n <= 7 ? 1 : -1;
    const k = (n - 1) % 7;
    const nut = group(hexNut(0.019, 0.016, M.zinc), at(new THREE.Mesh(new THREE.SphereGeometry(0.0095, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.zinc), 0, 0.008, 0));
    nut.position.set(-0.3 + k * 0.1, 0.38, side * 0.128);
    root.add(ex(nut, 0, 0.42, side * 0.05));
    B.bind(`eng.head_nut_${n}`, nut, { axis: V(0, 1, 0), pitch: 0.0016 });
  }
  // ── Cam covers ──
  const camCover = (side: 1 | -1) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(roundedBox(0.66, 0.075, 0.105, 0.03), polished);
    body.position.set(0, 0.41, side * 0.083);
    g.add(body);
    for (let r = -1; r <= 1; r++) g.add(box(0.5, 0.006, 0.006, polished, -0.04, 0.449, side * 0.083 + r * 0.025, 0.002));
    const nuts = new THREE.InstancedMesh(new THREE.SphereGeometry(0.008, 10, 8), M.chrome, 14);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < 14; i++) {
      const k = i % 7, o = i < 7 ? 1 : -1;
      mtx.makeTranslation(-0.3 + k * 0.1, 0.38, side * 0.083 + o * 0.058);
      nuts.setMatrixAt(i, mtx);
    }
    nuts.castShadow = true;
    const ng = group(nuts);
    root.add(ng);
    B.bind(side > 0 ? 'eng.cover_nuts_in' : 'eng.cover_nuts_ex', ng, { axis: V(0, 1, 0), pitch: 0.003 });
    return g;
  };
  const coverIn = camCover(1), coverEx = camCover(-1);
  root.add(ex(coverIn, 0, 0.66, 0.05), ex(coverEx, 0, 0.66, -0.05));
  B.bind('eng.cam_cover_in', coverIn);
  B.bind('eng.cam_cover_ex', coverEx);
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.04), new THREE.MeshStandardMaterial({ map: TEX.text(BRANDING.engineFamily, 512, 128, 'bold 96px Georgia', '#f4f4f4'), transparent: true, metalness: 1, roughness: 0.15 }));
  logo.rotation.x = -Math.PI / 2; logo.position.set(0.1, 0.4485, -0.083);
  coverEx.add(logo);
  const capLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.03), new THREE.MeshStandardMaterial({ map: TEX.text('4.2 LITRE', 512, 128, 'bold 70px Georgia', '#f4f4f4'), transparent: true, metalness: 1, roughness: 0.15 }));
  capLabel.rotation.x = -Math.PI / 2; capLabel.position.set(-0.12, 0.4485, 0.083);
  coverIn.add(capLabel);
  // Oil filler cap (front of inlet cover)
  const filler = group(cyl(0.028, 0.03, M.polished, 'y', 24), at(cyl(0.031, 0.008, M.polished, 'y', 30), 0, 0.016, 0));
  filler.position.set(0.26, 0.455, 0.083);
  root.add(ex(filler, 0, 0.75, 0.05));
  B.bind('lub.filler_cap', filler, { axis: V(0, 1, 0), pitch: 0.01, spin: true });

  // ── Spark plugs & HT leads ──
  const leadBoots: THREE.Object3D[] = [];
  const distPos = V(0.06, 0.2, 0.215);
  for (let c = 1; c <= 6; c++) {
    const x = cylX(c);
    const plug = group(
      hexNut(0.0206, 0.012, M.zinc),
      at(cyl(0.007, 0.034, M.white, 'y', 12), 0, 0.022, 0),
      at(cyl(0.003, 0.012, M.zinc, 'y', 8), 0, 0.044, 0),
      at(cyl(0.007, 0.016, M.zinc, 'y', 10), 0, -0.014, 0),
    );
    plug.position.set(x, 0.395, 0);
    root.add(ex(plug, 0, 0.6, 0));
    B.bind(`ign.plug_${c}`, plug, { axis: V(0, 1, 0), pitch: 0.004, spin: true });
    // lead
    const boot = group(cyl(0.008, 0.035, M.black, 'y', 12));
    boot.position.set(x, 0.44, 0);
    const pts = [distPos.clone().add(V(-0.01 + c * 0.004, 0.03, 0)), V(0.1 - c * 0.012, 0.36, 0.15), V(x + 0.02, 0.43, 0.035), V(x, 0.455, 0.0)];
    const lead = tube(pts, 0.0035, c % 2 ? M.wireRed : M.black, 40, 6);
    const leadGrp = group(lead, boot);
    root.add(ex(leadGrp, 0, 0.62, 0.03));
    leadBoots.push(boot);
    B.bind(`ign.lead_${c}`, leadGrp);
  }
  // ── Distributor ──
  const dist = group(cyl(0.028, 0.12, M.alu, 'y', 20), at(cyl(0.02, 0.05, M.alu, 'y', 12), 0, -0.07, 0), at(cyl(0.022, 0.01, M.satin, 'z', 12), 0.03, 0.03, 0.02));
  dist.position.set(distPos.x, 0.12, distPos.z); dist.rotation.x = -0.25;
  root.add(ex(dist, 0, 0, 0.35));
  B.bind('ign.distributor', dist);
  const capMat = new THREE.MeshStandardMaterial({ color: 0x3a1c10, roughness: 0.35 });
  const cap = group(lathe([[0.001, 0], [0.034, 0], [0.034, 0.03], [0.026, 0.045], [0.001, 0.046]], capMat, 24));
  for (let i = 0; i < 7; i++) { const a = (i / 6) * Math.PI * 2; const t = cyl(0.006, 0.02, capMat, 'y', 8); t.position.set(Math.cos(a) * 0.02 * (i < 6 ? 1 : 0), 0.05, Math.sin(a) * 0.02 * (i < 6 ? 1 : 0)); cap.add(t); }
  cap.position.set(0, 0.06, 0);
  dist.add(cap);
  B.bind('ign.dist_cap', cap);
  const rotor = box(0.03, 0.01, 0.008, M.black, 0.008, 0.07, 0);
  dist.add(rotor);
  B.bind('ign.rotor', rotor);
  const points = box(0.02, 0.004, 0.01, M.zinc, -0.006, 0.06, 0.008);
  dist.add(points);
  B.bind('ign.points', points);

  // ── Induction: inlet manifold, 3 × SU HD8, air box ──
  const manifold = new THREE.Group();
  for (let c = 1; c <= 6; c++) manifold.add(tube([V(cylX(c), 0.31, 0.13), V(cylX(c), 0.3, 0.17), V(cylX(c) + (c % 2 ? 0.05 : -0.05), 0.285, 0.215)], 0.022, M.alu, 10, 10));
  manifold.add(box(0.62, 0.03, 0.03, M.alu, 0, 0.245, 0.2, 0.008));
  root.add(ex(manifold, 0, 0.78, 0.15));
  B.bind('fuel.inlet_manifold', manifold);
  const carbX = [-0.2, 0, 0.2];
  for (let i = 1; i <= 3; i++) {
    const cx = carbX[i - 1];
    const carb = group(
      at(cyl(0.032, 0.085, M.alu, 'z', 20), 0, 0, 0),
      at(lathe([[0.001, 0], [0.036, 0], [0.036, 0.05], [0.03, 0.065], [0.012, 0.075], [0.006, 0.09], [0.001, 0.09]], M.polished, 24), 0, 0.02, -0.005),
      at(cyl(0.022, 0.05, M.alu, 'y', 16), -0.055, -0.01, 0.0),
      at(cyl(0.006, 0.04, M.brass, 'x', 8), -0.03, -0.03, 0),
    );
    carb.position.set(cx, 0.275, 0.27);
    root.add(ex(carb, 0, 0.9, 0.22));
    B.bind(`fuel.carb_${i}`, carb);
  }
  const airBox = group(box(0.56, 0.12, 0.07, M.satin, 0, 0, 0, 0.02));
  airBox.position.set(0, 0.28, 0.345);
  root.add(ex(airBox, 0, 1.0, 0.3));
  B.bind('fuel.air_box', airBox);
  const drum = cyl(0.075, 0.15, M.satin, 'x', 28);
  drum.position.set(0.36, 0.27, 0.36);
  const ram = cyl(0.045, 0.16, M.polished, 'x', 20); ram.position.set(0.52, 0.27, 0.36);
  const drumGrp = group(drum, ram);
  root.add(ex(drumGrp, 0, 1.0, 0.3));
  B.bind('fuel.air_box', drumGrp);
  const airCover = group(cyl(0.078, 0.012, M.satin, 'x', 28), at(cyl(0.01, 0.02, M.chrome, 'x', 8), 0.01, 0.03, 0.04), at(cyl(0.01, 0.02, M.chrome, 'x', 8), 0.01, -0.03, -0.04));
  airCover.position.set(0.282, 0.27, 0.36);
  root.add(ex(airCover, -0.25, 1.0, 0.3));
  B.bind('fuel.air_cover', airCover, { axis: V(-1, 0, 0), pitch: 0.004 });
  const element = group(cyl(0.066, 0.12, M.paper, 'x', 32), at(cyl(0.035, 0.122, M.black, 'x', 16), 0, 0, 0));
  element.position.set(0.36, 0.27, 0.36);
  root.add(ex(element, -0.12, 1.0, 0.3));
  B.bind('fuel.air_element', element);

  // ── Exhaust manifolds (left) ──
  const exMan = (cyls: number[], key: string) => {
    const g = new THREE.Group();
    const col = V((cylX(cyls[0]) + cylX(cyls[2])) / 2, 0.1, -0.22);
    for (const c of cyls) g.add(tube([V(cylX(c), 0.3, -0.13), V(cylX(c), 0.27, -0.19), V(cylX(c) * 0.8 + col.x * 0.2, 0.17, -0.22), col], 0.022, M.enamel, 16, 10));
    g.add(tube([col, V(col.x, -0.02, -0.21), V(col.x - 0.1, -0.13, -0.18)], 0.028, M.enamel, 12, 10));
    root.add(ex(g, 0, 0.2, -0.35));
    B.bind(key, g);
  };
  exMan([4, 5, 6], 'exh.manifold_F');
  exMan([1, 2, 3], 'exh.manifold_R');

  // ── Front of engine: timing cover, damper, water pump, thermostat housing ──
  const tcover = extrudeX([[-0.13, -0.07], [0.13, -0.07], [0.14, 0.2], [0.1, 0.33], [-0.1, 0.33], [-0.14, 0.2]], 0.03, alu, 0.006);
  tcover.position.x = 0.345;
  root.add(ex(tcover, 0.3, 0, 0));
  B.bind('eng.timing_cover', tcover);
  const damper = group(cyl(0.075, 0.025, M.satin, 'x', 32), at(cyl(0.062, 0.02, M.steel, 'x', 32), 0.022, 0, 0), at(cyl(0.02, 0.03, M.zinc, 'x', 6), 0.035, 0, 0));
  damper.position.set(0.385, 0, 0);
  root.add(ex(damper, 0.45, 0, 0));
  B.bind('eng.damper', damper);
  const wpPulley = group(cyl(0.055, 0.02, M.satin, 'x', 28), at(cyl(0.04, 0.06, M.alu, 'x', 20), -0.03, 0, 0));
  wpPulley.position.set(0.39, 0.15, 0);
  root.add(ex(wpPulley, 0.38, 0, 0));
  B.bind('cool.water_pump', wpPulley);
  const thermo = group(box(0.05, 0.04, 0.06, M.alu, 0, 0, 0, 0.01), at(cyl(0.022, 0.06, M.alu, 'x', 16), 0.04, 0, 0));
  thermo.position.set(0.355, 0.355, 0);
  root.add(ex(thermo, 0.3, 0.4, 0));
  B.bind('cool.thermostat', thermo);
  // Alternator on a pivot (left, low)
  const altPivot = new THREE.Group();
  altPivot.position.set(0.3, -0.04, -0.17);
  const alt = group(cyl(0.062, 0.13, M.alu, 'x', 24), at(cyl(0.035, 0.02, M.satin, 'x', 20), 0.085, 0, 0), at(box(0.03, 0.02, 0.04, M.alu), -0.05, 0.06, 0));
  alt.position.set(0, 0.075, -0.03);
  altPivot.add(alt);
  root.add(ex(altPivot, 0.25, 0, -0.4));
  B.bind('elec.alternator', alt);
  const pivotBolt = group(hexNut(0.0127, 0.01, M.zinc, 'x'), at(cyl(0.004, 0.05, M.zinc, 'x', 8), -0.025, 0, 0));
  pivotBolt.position.set(0.37, -0.04, -0.17);
  root.add(ex(pivotBolt, 0.3, 0, -0.4));
  B.bind('elec.alt_pivot', pivotBolt, { axis: V(1, 0, 0), pitch: 0.0013 });
  const link = box(0.008, 0.12, 0.02, M.zinc, 0.34, 0.12, -0.15);
  link.rotation.x = 0.4;
  root.add(link);
  const linkBolt = group(hexNut(0.0127, 0.01, M.zinc, 'x'));
  linkBolt.position.set(0.37, 0.09, -0.21);
  root.add(ex(linkBolt, 0.3, 0, -0.4));
  B.bind('elec.alt_adjust', linkBolt, { axis: V(1, 0, 0), pitch: 0.0013 });
  // Fan belt (rebuilt when alternator moves)
  const fanBelt = new THREE.Mesh(new THREE.BufferGeometry(), M.rubber);
  fanBelt.castShadow = true;
  root.add(ex(fanBelt, 0.4, 0, 0));
  B.bind('eng.fan_belt', fanBelt);
  // Breather
  const breather = cyl(0.015, 0.06, M.alu, 'x', 12); breather.position.set(0.37, 0.3, 0.06);
  root.add(breather);
  B.bind('eng.breather', breather);

  // ── Lubrication: sump, drain plug, filter, dipstick ──
  const sumpG = new THREE.Group();
  const sumpRear = extrudeX([[-0.16, -0.072], [0.16, -0.072], [0.14, -0.2], [0.11, -0.222], [-0.11, -0.222], [-0.14, -0.2]], 0.36, alu, 0.006);
  sumpRear.position.x = -0.15;
  const sumpFront = extrudeX([[-0.16, -0.072], [0.16, -0.072], [0.14, -0.15], [0.11, -0.168], [-0.11, -0.168], [-0.14, -0.15]], 0.3, alu, 0.006);
  sumpFront.position.x = 0.18;
  for (let r = -2; r <= 2; r++) sumpG.add(box(0.34, 0.012, 0.006, alu, -0.15, -0.226, r * 0.04));
  sumpG.add(sumpRear, sumpFront);
  root.add(ex(sumpG, 0, -0.85, 0));
  B.bind('eng.sump', sumpG);
  const drain = group(hexNut(0.0238, 0.014, M.zinc), at(cyl(0.009, 0.014, M.zinc, 'y', 12), 0, 0.012, 0));
  drain.rotation.x = Math.PI;
  drain.position.set(-0.22, -0.232, 0.02);
  root.add(ex(drain, 0, -0.95, 0));
  B.bind('lub.drain_plug', drain, { axis: V(0, -1, 0), pitch: 0.0035, spin: true });
  const washer = new THREE.Mesh(new THREE.TorusGeometry(0.0125, 0.0025, 6, 20), M.copper);
  washer.rotation.x = Math.PI / 2; washer.position.set(-0.22, -0.2245, 0.02);
  root.add(ex(washer, 0, -0.92, 0));
  B.bind('lub.drain_washer', washer, { axis: V(0, -1, 0), pitch: 0 });
  // Filter head, seal, canister, element, bolt
  const fhead = box(0.08, 0.04, 0.05, alu, 0, -0.02, 0.18, 0.008);
  root.add(fhead);
  const seal = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.0035, 6, 32), M.rubber);
  seal.rotation.x = Math.PI / 2; seal.position.set(0, -0.042, 0.19);
  root.add(ex(seal, 0, -0.3, 0.32));
  B.bind('lub.filter_seal', seal);
  const canister = group(lathe([[0.002, -0.15], [0.04, -0.15], [0.047, -0.14], [0.048, -0.01], [0.05, 0], [0.002, 0]], M.satin, 28));
  canister.position.set(0, -0.045, 0.19);
  root.add(ex(canister, 0, -0.45, 0.32));
  B.bind('lub.filter_canister', canister);
  const fElement = group(cyl(0.038, 0.12, M.paper, 'y', 28), at(cyl(0.015, 0.122, M.black, 'y', 12), 0, 0, 0));
  fElement.position.set(0, -0.075, 0);
  canister.add(fElement);
  B.bind('lub.filter_element', fElement);
  const fBolt = group(hexNut(0.019, 0.012, M.zinc), at(cyl(0.005, 0.03, M.zinc, 'y', 8), 0, 0.02, 0));
  fBolt.rotation.x = Math.PI;
  fBolt.position.set(0, -0.2, 0.19);
  root.add(ex(fBolt, 0, -0.55, 0.32));
  B.bind('lub.filter_bolt', fBolt, { axis: V(0, -1, 0), pitch: 0.0028, spin: true });
  // Dipstick
  const tubeD = tube([V(0.12, -0.05, -0.172), V(0.125, 0.1, -0.2), V(0.12, 0.28, -0.205)], 0.006, M.zinc, 12, 8);
  root.add(tubeD);
  const dip = group(cyl(0.0025, 0.3, M.steel, 'y', 6), at(new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 6, 16), M.yellow), 0, 0.165, 0));
  dip.position.set(0.12, 0.15, -0.205);
  root.add(ex(dip, 0, 0.6, -0.25));
  B.bind('lub.dipstick', dip, { axis: V(0, 1, 0), pitch: 0 });

  // ── Starter, mounts ──
  const starter = group(cyl(0.05, 0.17, M.satin, 'x', 20), at(cyl(0.024, 0.1, M.satin, 'x', 16), 0.0, 0.06, 0.0), at(cyl(0.005, 0.015, M.copper, 'y', 8), 0.03, 0.09, 0));
  starter.position.set(-0.3, -0.03, 0.18);
  root.add(ex(starter, 0, 0, 0.3));
  B.bind('elec.starter', starter);
  for (const s of [1, -1]) {
    const mount = group(box(0.05, 0.04, 0.05, M.rubber, 0, 0, 0, 0.01), at(box(0.06, 0.008, 0.06, M.zinc), 0, 0.024, 0));
    mount.position.set(0.22, -0.02, s * 0.2);
    root.add(mount);
    B.bind(s > 0 ? 'eng.mount_R' : 'eng.mount_L', mount);
  }

  // ── Bellhousing, gearbox, level plug ──
  const bell = cyl(0.13, 0.13, alu, 'x', 28, 0.19); bell.position.set(-0.395, 0.0, 0);
  root.add(ex(bell, -0.25, 0, 0));
  B.bind('trn.bellhousing', bell);
  const gbx = box(0.5, 0.2, 0.2, M.alu, -0.71, -0.01, 0, 0.04);
  root.add(ex(gbx, -0.45, 0, 0));
  B.bind('trn.gearbox', gbx);
  const lvl = group(hexNut(0.0222, 0.012, M.zinc, 'z'));
  lvl.position.set(-0.67, -0.07, 0.101);
  root.add(ex(lvl, -0.45, 0, 0.1));
  B.bind('trn.gbx_level', lvl, { axis: V(0, 0, 1), pitch: 0.003, spin: true });

  // ── Internals ──
  const internals: THREE.Object3D[] = [];
  const steel = M.steel;
  const crank = new THREE.Group();
  for (let j = 0; j < 7; j++) { const jn = cyl(0.033, 0.04, steel, 'x', 20); jn.position.x = -0.3 + j * 0.1; crank.add(jn); }
  const pins: THREE.Mesh[] = [];
  for (let c = 1; c <= 6; c++) {
    const a = (TDC_COMP[c] % 360) * Math.PI / 180;
    const pin = cyl(0.026, 0.035, steel, 'x', 16);
    pin.position.set(cylX(c), Math.cos(a) * CRANK_R, Math.sin(a) * CRANK_R);
    crank.add(pin); pins.push(pin);
    for (const dx of [-0.03, 0.03]) {
      const web = box(0.014, 0.1, 0.07, steel, cylX(c) + dx, Math.cos(a) * CRANK_R * 0.5, Math.sin(a) * CRANK_R * 0.5);
      web.rotation.x = -a;
      crank.add(web);
    }
  }
  const fly = cyl(0.15, 0.03, steel, 'x', 40); fly.position.x = -0.36; crank.add(fly);
  root.add(ex(crank, 0, -0.62, 0));
  B.bind('eng.crankshaft', crank);
  B.bind('eng.flywheel', fly);
  internals.push(crank);
  const pistons: THREE.Object3D[] = [], rods: THREE.Object3D[] = [];
  for (let c = 1; c <= 6; c++) {
    const p = group(cyl(0.045, 0.06, M.alu, 'y', 24), at(new THREE.Mesh(new THREE.TorusGeometry(0.0452, 0.0015, 4, 24), steel), 0, 0.02, 0, Math.PI / 2, 0, 0), at(new THREE.Mesh(new THREE.TorusGeometry(0.0452, 0.0015, 4, 24), steel), 0, 0.01, 0, Math.PI / 2, 0, 0));
    p.position.set(cylX(c), 0.2, 0);
    root.add(ex(p, 0, -0.32, 0));
    B.bind(`eng.piston_${c}`, p);
    pistons.push(p);
    const rod = group(box(0.014, ROD_L, 0.024, steel, 0, ROD_L / 2, 0, 0.004), at(cyl(0.032, 0.03, steel, 'x', 16), 0, 0, 0));
    root.add(ex(rod, 0, -0.46, 0));
    B.bind(`eng.conrod_${c}`, rod);
    rods.push(rod);
    internals.push(p, rod);
  }
  const camShaft = (side: 1 | -1, slot: string) => {
    const g = new THREE.Group();
    g.add(cyl(0.012, 0.66, steel, 'x', 12));
    for (let c = 1; c <= 6; c++) {
      const lobe = cyl(0.02, 0.018, steel, 'x', 16);
      lobe.scale.set(1, 1.35, 1);
      lobe.position.set(cylX(c), 0, 0);
      const ang = ((TDC_COMP[c] / 2) + (side > 0 ? -55 : 55)) * Math.PI / 180;
      lobe.rotation.x = -ang;
      lobe.geometry = lobe.geometry.clone().translate(0, 0.006, 0);
      g.add(lobe);
    }
    g.position.set(0, 0.395, side * 0.083);
    root.add(ex(g, 0, 0.56, side * 0.05));
    B.bind(slot, g);
    internals.push(g);
    return g;
  };
  const camIn = camShaft(1, 'eng.camshaft_in'), camEx = camShaft(-1, 'eng.camshaft_ex');
  const valvesIn: THREE.Object3D[] = [], valvesEx: THREE.Object3D[] = [];
  for (let c = 1; c <= 6; c++) {
    for (const side of [1, -1] as const) {
      const v = group(at(cyl(0.0035, 0.12, steel, 'y', 8), 0, 0.06, 0), at(cyl(side > 0 ? 0.021 : 0.018, 0.004, steel, 'y', 16), 0, 0, 0), at(cyl(0.013, 0.03, M.zinc, 'y', 12), 0, 0.105, 0));
      const holder = new THREE.Group();
      holder.position.set(cylX(c) + side * 0.012, 0.27, side * 0.02);
      holder.rotation.x = side * 0.62;
      holder.add(v);
      root.add(ex(holder, 0, 0.46, side * 0.04));
      B.bind(side > 0 ? `eng.valve_in_${c}` : `eng.valve_ex_${c}`, holder);
      (side > 0 ? valvesIn : valvesEx).push(v);
      internals.push(holder);
    }
  }
  const chain = group(tube([V(0.33, 0, 0.03), V(0.33, 0.2, 0.05), V(0.33, 0.39, 0.083), V(0.33, 0.4, -0.083), V(0.33, 0.2, -0.05), V(0.33, 0, -0.03)], 0.006, steel, 40, 6, true));
  root.add(ex(chain, 0.2, 0.2, 0));
  B.bind('eng.timing_chain', chain);
  internals.push(chain);
  const pump = cyl(0.04, 0.06, M.alu, 'y', 16); pump.position.set(0.2, -0.13, 0);
  root.add(ex(pump, 0, -0.72, 0));
  B.bind('eng.oil_pump', pump);
  const pickup = tube([V(0.2, -0.16, 0), V(0.05, -0.19, 0), V(-0.15, -0.205, 0)], 0.01, M.zinc, 12, 8);
  root.add(ex(pickup, 0, -0.78, 0));
  B.bind('eng.oil_pickup', pickup);
  internals.push(pump, pickup);

  // ── Tier II fasteners, shells and the engine connections ──
  const ring = (n: number, mk: (i: number) => THREE.Vector3, af: number, mat: THREE.Material, axis: 'x' | 'y' | 'z' = 'y') => {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) { const h = hexNut(af, 0.008, mat, axis); h.position.copy(mk(i)); g.add(h); }
    return g;
  };
  const sumpBolts = ring(26, (i) => i < 13 ? V(-0.31 + i * 0.05, -0.078, 0.165) : V(-0.31 + (i - 13) * 0.05, -0.078, -0.165), 0.0127, M.zinc);
  root.add(ex(sumpBolts, 0, -0.8, 0));
  B.bind('eng.sump_bolts', sumpBolts, { axis: V(0, -1, 0), pitch: 0.003 });
  const mainBolts = ring(14, (i) => V(-0.3 + Math.floor(i / 2) * 0.1, -0.07, i % 2 ? 0.045 : -0.045), 0.019, M.zinc);
  root.add(ex(mainBolts, 0, -0.7, 0));
  B.bind('eng.main_bolts', mainBolts, { axis: V(0, -1, 0), pitch: 0.003 });
  const shells = new THREE.Group();
  for (let j = 0; j < 7; j++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.003, 6, 20, Math.PI), M.brass); t.rotation.y = Math.PI / 2; t.rotation.x = Math.PI; t.position.x = -0.3 + j * 0.1; shells.add(t); }
  root.add(ex(shells, 0, -0.66, 0));
  B.bind('eng.main_bearings', shells);
  for (let c = 1; c <= 6; c++) {
    const rod = rods[c - 1];
    const nutsG = group(at(hexNut(0.0143, 0.008, M.zinc), 0, -0.035, 0.022), at(hexNut(0.0143, 0.008, M.zinc), 0, -0.035, -0.022));
    rod.add(nutsG);
    B.bind(`eng.rod_nuts_${c}`, nutsG, { axis: V(0, -1, 0), pitch: 0.003 });
    const shell = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.0028, 6, 18), M.brass);
    shell.rotation.y = Math.PI / 2;
    rod.add(shell);
    B.bind('eng.rod_bearings', shell);
  }
  const conn = (id: string, p: THREE.Vector3, color: number) => {
    const m = group(cyl(0.012, 0.03, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 }), 'y', 10));
    m.position.copy(p);
    root.add(m);
    B.bind(`eng.conn_${id}`, m);
  };
  conn('fuel', V(0.1, 0.33, 0.33), 0xb03a2e); conn('throttle', V(-0.05, 0.3, 0.33), 0x999999); conn('choke', V(-0.25, 0.3, 0.32), 0x777777);
  conn('coil', V(0.06, 0.29, 0.24), 0x111111); conn('alt', V(0.25, 0.12, -0.25), 0x553311); conn('senders', V(-0.1, 0.1, 0.2), 0x2255aa);
  conn('heater', V(-0.33, 0.33, 0.12), 0x111111); conn('top_hose', V(0.39, 0.36, 0.02), 0x222222); conn('bottom_hose', V(0.38, 0.08, -0.06), 0x222222);
  conn('earth', V(-0.1, -0.02, -0.19), 0xb87333); conn('starter', V(-0.3, 0.03, 0.23), 0xaa2222); conn('exhaust', V(-0.1, -0.15, -0.18), 0x555555);
  conn('prop', V(-0.97, -0.01, 0), 0x666666); conn('clutch', V(-0.45, -0.02, 0.13), 0x8a7a30); conn('speedo', V(-0.9, -0.05, 0.1), 0x333333); conn('gear', V(-0.75, 0.1, 0), 0x222222);
  const mountBolts = group(at(hexNut(0.0143, 0.012, M.zinc), 0.22, -0.055, 0.2), at(hexNut(0.0143, 0.012, M.zinc), 0.22, -0.055, -0.2));
  root.add(mountBolts);
  B.bind('eng.mount_bolts', mountBolts, { axis: V(0, -1, 0), pitch: 0.004 });

  const pulleys = [damper, wpPulley, alt];
  return { root, crank, pistons, rods, camIn, camEx, valvesIn, valvesEx, altPivot, fanBelt, explode, clipMats, internals, leadBoots, pulleys };
}

/** Rebuilds the V-belt path around crank, water-pump and alternator pulleys. */
export function beltGeometry(altAngle: number, slack: number) {
  const x = 0.395;
  const crank = { y: 0, z: 0, r: 0.075 };
  const wp = { y: 0.15, z: 0, r: 0.057 };
  const piv = { y: -0.04, z: -0.17 };
  const off = { y: 0.075, z: -0.03 };
  const ca = Math.cos(altAngle), sa = Math.sin(altAngle);
  const alt = { y: piv.y + off.y * ca - off.z * sa, z: piv.z + off.y * sa + off.z * ca, r: 0.037 };
  const pts: THREE.Vector3[] = [];
  const arc = (c: { y: number; z: number; r: number }, a0: number, a1: number, n: number) => {
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); pts.push(new THREE.Vector3(x, c.y + Math.cos(a) * c.r, c.z + Math.sin(a) * c.r)); }
  };
  arc(wp, -0.6, 1.9, 6);
  const sag = slack * 0.0012;
  pts.push(new THREE.Vector3(x, (wp.y + crank.y) / 2 - 0.01, 0.075 + sag));
  arc(crank, 1.5, 4.0, 8);
  pts.push(new THREE.Vector3(x, (crank.y + alt.y) / 2 - 0.03 - sag, (crank.z + alt.z) / 2 - 0.02));
  arc(alt, 4.0, 6.0, 5);
  pts.push(new THREE.Vector3(x, (alt.y + wp.y) / 2 + sag * 0.5, (alt.z + wp.z) / 2 - 0.03 - sag));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  return new THREE.TubeGeometry(curve, 90, 0.005, 6, true);
}
