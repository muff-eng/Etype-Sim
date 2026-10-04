/**
 * Procedural Series 1 FHC body: lofted bonnet (with wings & wheel arches), tub sides, doors,
 * greenhouse (windscreen, roof, side glass, side-hinged rear hatch), trim, lamps, bumpers and interior.
 * Placeholder-quality geometry with stable slot bindings: any mesh can later be swapped for a detailed asset.
 */
import * as THREE from 'three';
import { Loft, resample, trimBelow, stations, pchip, type Sec } from './loft';
import { V, box, cyl, tube, lathe, at, group, roundedBox, shadows } from './geom';
import { TEX, type Mats } from './materials';
import { AXLE_F, AXLE_R, WHEEL_R } from '../data/layout';
import { BRANDING } from '../config/branding';

export interface Binder {
  bind(slotId: string, obj: THREE.Object3D, opts?: BindOpts): void;
}
export interface BindOpts { axis?: THREE.Vector3; pitch?: number; explode?: THREE.Vector3; spin?: boolean; noPick?: boolean }

export interface BodyParts {
  root: THREE.Group;
  bonnetPivot: THREE.Group;
  doorPivot: { L: THREE.Group; R: THREE.Group };
  hatchPivot: THREE.Group;
  panelPivot: THREE.Group;
  bootFloor: THREE.Group;
  bodyMeshes: THREE.Mesh[];          // for x-ray
  glass: THREE.Mesh[];
  gauges: { tach: THREE.Object3D; speedo: THREE.Object3D; oil: THREE.Object3D; temp: THREE.Object3D; fuel: THREE.Object3D; amps: THREE.Object3D };
  ignitionKey: THREE.Object3D;
  bonnetLoft: Loft;
  tubLoft: Loft;
}

const ARCH_R = 0.375;
const archY = (x: number, cx: number) => { const d = x - cx; return Math.abs(d) < ARCH_R ? WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - d * d) : -1; };
const NHALF = 26;

// ── Front (bonnet) section ──
const FX = [2.235, 2.21, 2.15, 2.05, 1.92, 1.75, 1.55, 1.35, 1.15, 0.95, 0.78, 0.6];
const fW = pchip(FX, [0.235, 0.36, 0.48, 0.58, 0.665, 0.735, 0.785, 0.81, 0.815, 0.805, 0.79, 0.776]);
const fHw = pchip(FX, [0.385, 0.4, 0.43, 0.47, 0.51, 0.56, 0.61, 0.64, 0.645, 0.62, 0.59, 0.565]);
const fT = pchip(FX, [0.465, 0.52, 0.575, 0.622, 0.662, 0.7, 0.732, 0.762, 0.785, 0.806, 0.822, 0.838]);
const fB = pchip(FX, [0.29, 0.265, 0.235, 0.215, 0.205, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]);
const fBulge = pchip(FX, [0, 0, 0, 0.004, 0.012, 0.026, 0.042, 0.054, 0.058, 0.056, 0.048, 0.034]);
const fCrest = pchip(FX, [0, 0, 0, 0.004, 0.012, 0.022, 0.03, 0.034, 0.03, 0.018, 0.008, 0.0]);
const fN = pchip(FX, [2.0, 2.05, 2.15, 2.3, 2.45, 2.6, 2.7, 2.8, 2.85, 2.9, 2.9, 2.9]);

function frontHalf(x: number): Sec {
  const W = fW(x), Hw = fHw(x), T = fT(x), B = fB(x), n = fN(x);
  const zs = W * 0.86;
  const pts: Sec = [];
  for (let i = 0; i <= 14; i++) { const s = i / 14; pts.push({ z: W - (W - zs) * (1 - s) * (1 - s), y: B + (Hw - B) * s }); }
  for (let i = 1; i <= 40; i++) {
    const ph = (i / 40) * Math.PI / 2;
    const z = W * Math.pow(Math.cos(ph), 2 / n);
    let y = Hw + (T - Hw) * Math.pow(Math.sin(ph), 2 / n);
    y += fBulge(x) * Math.exp(-Math.pow(z / 0.25, 4)) + fCrest(x) * Math.exp(-Math.pow((z - W * 0.72) / 0.15, 2));
    pts.push({ z, y });
  }
  const edge = Math.max(B, archY(x, AXLE_F));
  return resample(trimBelow(pts, edge), NHALF);
}
const mirrorSection = (half: Sec): Sec => [...half, ...half.slice(0, -1).reverse().map((p) => ({ z: -p.z, y: p.y }))];

// ── Rear tub (sides only, up to the beltline) ──
const TX = [0.62, 0.4, 0.1, -0.25, -0.6, -0.9, -1.15, -1.4, -1.65, -1.85, -2.02, -2.14, -2.235];
const tW = pchip(TX, [0.776, 0.776, 0.778, 0.785, 0.8, 0.818, 0.828, 0.826, 0.81, 0.78, 0.72, 0.635, 0.52]);
const tHw = pchip(TX, [0.565, 0.56, 0.555, 0.55, 0.56, 0.58, 0.6, 0.6, 0.59, 0.57, 0.55, 0.53, 0.5]);
const tBelt = pchip(TX, [0.84, 0.85, 0.852, 0.852, 0.852, 0.85, 0.845, 0.835, 0.815, 0.785, 0.745, 0.695, 0.635]);
const tB = pchip(TX, [0.19, 0.19, 0.19, 0.19, 0.19, 0.19, 0.2, 0.21, 0.225, 0.245, 0.27, 0.3, 0.33]);
const tWb = (x: number) => tW(x) - (x > -1.8 ? 0.065 : 0.045 + (x + 2.235) * 0.04);

function tubHalf(x: number): Sec {
  const W = tW(x), Hw = tHw(x), belt = tBelt(x), B = tB(x), Wb = tWb(x);
  const zs = W * 0.86;
  const pts: Sec = [];
  for (let i = 0; i <= 14; i++) { const s = i / 14; pts.push({ z: W - (W - zs) * (1 - s) * (1 - s), y: B + (Hw - B) * s }); }
  for (let i = 1; i <= 24; i++) {
    const ph = (i / 24) * Math.PI / 2;
    pts.push({ z: Wb + (W - Wb) * Math.pow(Math.cos(ph), 0.75), y: Hw + (belt - Hw) * Math.pow(Math.sin(ph), 1.1) });
  }
  const edge = Math.max(B, archY(x, AXLE_R));
  return resample(trimBelow(pts, edge), 20);
}

// ── Greenhouse ──
const GX = [0.66, 0.5, 0.49, 0.4, 0.25, 0.1, -0.05, -0.25, -0.45, -0.7, -0.95, -1.2, -1.45, -1.7, -1.9, -2.05, -2.16, -2.235];
const gR = pchip(GX, [0.856, 0.868, 0.875, 0.93, 1.02, 1.1, 1.158, 1.2, 1.214, 1.205, 1.168, 1.11, 1.03, 0.94, 0.86, 0.785, 0.715, 0.645]);
function greenSection(x: number): Sec {
  const belt = tBelt(Math.min(0.62, x)), Wb = tWb(Math.min(0.62, x));
  const R = Math.max(belt + 0.004, gR(x));
  const half: Sec = [];
  for (let i = 0; i < 22; i++) {
    const ph = (i / 21) * Math.PI / 2;
    const z = Wb * (1 - 0.2 * Math.sin(ph)) * Math.pow(Math.cos(ph), 2 / 3.4);
    const y = belt + (R - belt) * Math.pow(Math.sin(ph), 2 / 3.0);
    half.push({ z, y });
  }
  return mirrorSection(half);
}

export function buildBody(M: Mats, B: Binder): BodyParts {
  const root = new THREE.Group();
  root.name = 'body';
  const bodyMeshes: THREE.Mesh[] = [];
  const glass: THREE.Mesh[] = [];
  const chromeDS = M.chrome.clone(); chromeDS.side = THREE.DoubleSide;
  const reg = (m: THREE.Mesh) => { bodyMeshes.push(m); return m; };

  // ═════════ BONNET ═════════
  const bonnetLoft = new Loft(stations(2.235, 0.6, 90), (x) => mirrorSection(frontHalf(x)));
  const bonnetPivot = new THREE.Group();
  const HINGE = V(2.0, 0.3, 0);
  bonnetPivot.position.copy(HINGE);
  root.add(bonnetPivot);
  const bonnetInner = new THREE.Group();
  bonnetInner.position.copy(HINGE).multiplyScalar(-1);
  bonnetPivot.add(bonnetInner);
  const bonnetSkin = reg(bonnetLoft.patch(2.235, 0.6, 0, 1, M.paint));
  bonnetInner.add(bonnetSkin);
  // inner wheel-arch liners and splash panels
  for (const s of [1, -1]) {
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(ARCH_R + 0.01, ARCH_R + 0.01, 0.34, 28, 1, true, Math.PI - 1.25, 2.5), M.underside);
    liner.rotation.x = Math.PI / 2; liner.position.set(AXLE_F, WHEEL_R, s * 0.62);
    liner.rotation.z = 0;
    bonnetInner.add(liner);
  }
  // Mouth: chrome surround, dark grille, bar, badge
  {
    const sec = bonnetLoft.secs[0];
    const x0 = bonnetLoft.xs[0];
    const shape = new THREE.Shape(sec.map((p) => new THREE.Vector2(p.z, p.y)));
    const grille = new THREE.Mesh(new THREE.ShapeGeometry(shape), M.black);
    grille.rotation.y = Math.PI / 2; grille.position.x = x0 - 0.05;
    const ringPts = sec.map((p) => V(x0 + 0.002, p.y, p.z));
    ringPts.push(ringPts[0].clone());
    const ring = tube(ringPts, 0.009, M.chrome, 120, 8, false);
    const bar = box(0.012, 0.012, 0.44, M.chrome, x0 - 0.01, 0.39, 0, 0.004);
    const badge = cyl(0.03, 0.01, M.chrome, 'x', 24); badge.position.set(x0 - 0.002, 0.39, 0);
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.6, 24, 1, true), M.black);
    duct.rotation.z = Math.PI / 2; duct.scale.set(1, 1, 0.5); duct.position.set(x0 - 0.33, 0.38, 0);
    const m = group(grille, ring, bar, badge, duct);
    bonnetInner.add(m);
    B.bind('body.mouth', m);
  }
  // Undertray
  bonnetInner.add(box(0.45, 0.006, 0.42, M.underside, 1.85, 0.235, 0));
  // Headlamps, sidelamps
  for (const [sd, s] of [['R', 1], ['L', -1]] as const) {
    const x = 1.96;
    const t = bonnetLoft.tForZ(x, 0.44, s as 1 | -1);
    const { p, n } = bonnetLoft.at(x, t);
    const up = n.clone().multiplyScalar(n.y < 0 ? -1 : 1);
    if (up.z * s < 0) up.z *= -1;
    const fwd = new THREE.Vector3(1, 0, 0).sub(up.clone().multiplyScalar(up.x)).normalize();
    const lat = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const lamp = new THREE.Group();
    lamp.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd, up, lat));
    lamp.position.copy(p).add(up.clone().multiplyScalar(-0.006));
    const half = (r: number, mat: THREE.Material) => new THREE.Mesh(new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    const recess = half(1, M.black); recess.scale.set(0.15, 0.035, 0.08);
    const reflector = lathe([[0.001, 0], [0.025, 0.006], [0.045, 0.025], [0.052, 0.045]], M.chrome, 28);
    reflector.rotation.z = Math.PI / 2; reflector.position.set(0.08, 0.035, 0); reflector.scale.set(1, 1, 1);
    const cover = half(1, M.lampGlass); cover.scale.set(0.165, 0.07, 0.088);
    const rimPts: THREE.Vector3[] = [];
    for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; rimPts.push(V(Math.cos(a) * 0.166, 0.002, Math.sin(a) * 0.089)); }
    const rim = tube(rimPts, 0.004, M.chrome, 64, 6, true);
    lamp.add(recess, reflector, cover, rim);
    glass.push(cover);
    bonnetInner.add(lamp);
    B.bind(`body.headlamp_${sd}`, lamp);
    // side lamp / indicator below headlamp
    const t2 = bonnetLoft.tForZ(2.11, 0.34, s as 1 | -1, false);
    const sp = bonnetLoft.at(2.11, t2);
    const side = group(at(cyl(0.028, 0.03, M.amber, 'x', 20), 0, 0, 0), at(new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.004, 6, 24), M.chrome), 0.015, 0, 0, 0, Math.PI / 2, 0));
    side.position.copy(sp.p).add(sp.n.clone().multiplyScalar(0.005));
    bonnetInner.add(side);
    B.bind(`body.sidelamp_${sd}`, side);
    // front bumper quarter
    const bpts: THREE.Vector3[] = [];
    for (let k = 0; k <= 8; k++) {
      const xx = 2.2 - k * 0.032;
      const zz = s * (0.27 + k * 0.035);
      bpts.push(V(xx + 0.035 - k * 0.003, 0.34 + k * 0.003, zz + s * 0.02));
    }
    const bumper = tube(bpts, 0.022, M.chrome, 32, 12);
    bumper.scale.y = 0.7;
    const over = tube([V(2.17, 0.33, s * 0.3), V(2.2, 0.42, s * 0.31)], 0.012, M.chrome, 8, 8);
    const bg = group(bumper, over);
    bonnetInner.add(bg);
    B.bind(`body.bumper_F${sd}`, bg);
  }
  // Bonnet hinge brackets
  bonnetInner.add(box(0.06, 0.06, 0.08, M.black, 2.02, 0.25, 0.28), box(0.06, 0.06, 0.08, M.black, 2.02, 0.25, -0.28));
  B.bind('body.bonnet', bonnetSkin);

  // ═════════ TUB SIDES, DOORS ═════════
  const tubXs = stations(0.62, -2.235, 110, [0.45, -0.6, -1.9]);
  const tubHalfCache = new Map<number, Sec>();
  const tubLoft = new Loft(tubXs, (x) => {
    const h = tubHalf(x);
    tubHalfCache.set(x, h);
    return [...h, ...h.slice().reverse().map((p) => ({ z: -p.z, y: p.y }))];
  });
  const half = 0.5 - 0.5 / (tubLoft.nt - 1);
  const sideR1 = reg(tubLoft.patch(0.62, 0.45, 0, half, M.paint));
  const sideR2 = reg(tubLoft.patch(-0.6, -2.235, 0, half, M.paint));
  const sideL1 = reg(tubLoft.patch(0.62, 0.45, 1 - half, 1, M.paint));
  const sideL2 = reg(tubLoft.patch(-0.6, -2.235, 1 - half, 1, M.paint));
  root.add(sideR1, sideR2, sideL1, sideL2);
  for (const m of [sideR1, sideR2, sideL1, sideL2]) B.bind('body.shell', m);
  const doorPivot = { L: new THREE.Group(), R: new THREE.Group() };
  for (const [sd, s] of [['R', 1], ['L', -1]] as const) {
    const pv = doorPivot[sd];
    const hinge = V(0.45, 0.5, s * 0.77);
    pv.position.copy(hinge);
    const inner = new THREE.Group(); inner.position.copy(hinge).multiplyScalar(-1);
    pv.add(inner);
    const skin = reg(tubLoft.patch(0.45, -0.6, s > 0 ? 0 : 1 - half, s > 0 ? half : 1, M.paint));
    inner.add(skin);
    // door card (inner trim)
    const card = box(1.0, 0.5, 0.02, M.leather, -0.075, 0.58, s * 0.7);
    inner.add(card);
    const handle = group(box(0.12, 0.016, 0.014, M.chrome, 0, 0, 0, 0.005));
    const hp = tubLoft.at(-0.45, s > 0 ? 0.42 : 0.58);
    handle.position.copy(hp.p).add(hp.n.clone().multiplyScalar(s > 0 ? -0.012 : -0.012));
    handle.position.z = s * (Math.abs(hp.p.z) + 0.008);
    inner.add(handle);
    B.bind(`body.door_handle_${sd}`, handle);
    root.add(pv);
    B.bind(`body.door_${sd}`, skin);
  }
  // Wheel arch liners (rear) and sills
  for (const s of [1, -1]) {
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(ARCH_R + 0.01, ARCH_R + 0.01, 0.32, 28, 1, true, Math.PI - 1.25, 2.5), M.underside);
    liner.rotation.x = Math.PI / 2; liner.position.set(AXLE_R, WHEEL_R, s * 0.64);
    root.add(liner);
  }

  // ═════════ GREENHOUSE ═════════
  const gXs = stations(0.66, -2.235, 120, [0.49, 0.05, -0.58, -0.62, -1.02, -1.06, -1.76, -1.9]);
  const gl = new Loft(gXs, greenSection);
  const T = (a: number) => a;
  const scuttle = reg(gl.patch(0.66, 0.49, 0, 1, M.paint));
  const screen = gl.patch(0.49, 0.05, T(0.075), T(0.925), M.glass);
  const aR = gl.patch(0.49, 0.05, 0, T(0.075), chromeDS), aL = gl.patch(0.49, 0.05, T(0.925), 1, chromeDS);
  const roof = reg(gl.patch(0.05, -1.02, T(0.23), T(0.77), M.paint));
  const qR = gl.patch(-0.62, -1.02, 0, T(0.23), M.glass), qL = gl.patch(-0.62, -1.02, T(0.77), 1, M.glass);
  const bR = gl.patch(-0.58, -0.62, 0, T(0.23), chromeDS), bL = gl.patch(-0.58, -0.62, T(0.77), 1, chromeDS);
  root.add(scuttle, aR, aL, roof, qR, qL, bR, bL);
  root.add(screen);
  glass.push(screen, qR, qL);
  B.bind('body.windscreen', screen);
  B.bind('body.windscreen', aR); B.bind('body.windscreen', aL);
  B.bind('body.shell', scuttle); B.bind('body.shell', roof);
  B.bind('body.shell', qR); B.bind('body.shell', qL);
  // door glass rides with the doors
  for (const [sd, s] of [['R', 1], ['L', -1]] as const) {
    const g = gl.patch(0.05, -0.58, s > 0 ? 0 : T(0.77), s > 0 ? T(0.23) : 1, M.glass);
    glass.push(g);
    (doorPivot[sd].children[0] as THREE.Group).add(g);
    B.bind(`body.side_glass_${sd}`, g);
  }
  // Rear hatch (side-hinged on the right)
  const hatchPivot = new THREE.Group();
  const hingeH = V(-1.4, 0.98, 0.6);
  hatchPivot.position.copy(hingeH);
  const hInner = new THREE.Group(); hInner.position.copy(hingeH).multiplyScalar(-1);
  hatchPivot.add(hInner);
  const hGlass = gl.patch(-1.06, -1.76, T(0.16), T(0.84), M.glass);
  const hFrameA = reg(gl.patch(-1.02, -1.06, 0, 1, M.paint));
  const hFrameR = reg(gl.patch(-1.06, -1.76, 0, T(0.16), M.paint));
  const hFrameL = reg(gl.patch(-1.06, -1.76, T(0.84), 1, M.paint));
  const hFrameB = reg(gl.patch(-1.76, -1.9, 0, 1, M.paint));
  hInner.add(hGlass, hFrameA, hFrameR, hFrameL, hFrameB);
  glass.push(hGlass);
  root.add(hatchPivot);
  B.bind('body.rear_glass', hGlass);
  for (const m of [hFrameA, hFrameR, hFrameL, hFrameB]) B.bind('body.hatch', m);
  const tail = reg(gl.patch(-1.9, -2.235, 0, 1, M.paint));
  root.add(tail);
  B.bind('body.shell', tail);
  // Chrome drip rails along roof edge
  for (const s of [1, -1]) {
    const pts: THREE.Vector3[] = [];
    for (const x of [0.48, 0.3, 0.05, -0.3, -0.62, -1.0]) { const q = gl.at(x, s > 0 ? 0.235 : 0.765); pts.push(q.p.add(q.n.multiplyScalar(-0.006))); }
    root.add(tube(pts, 0.006, M.chrome, 40, 6));
  }
  // Tail panel closing the rear between the tub sides
  {
    const x0 = tubLoft.xs[tubLoft.xs.length - 1];
    const sec = tubLoft.secs[tubLoft.secs.length - 1];
    const shape = new THREE.Shape(sec.map((p) => new THREE.Vector2(p.z, p.y)));
    const m = reg(new THREE.Mesh(new THREE.ShapeGeometry(shape), M.paint));
    m.rotation.y = -Math.PI / 2; m.position.x = x0 + 0.002;
    root.add(m);
    B.bind('body.shell', m);
    // Number plate & badges
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.066), new THREE.MeshStandardMaterial({ map: TEX.plate('CTE 4E'), roughness: 0.4 }));
    plate.rotation.y = -Math.PI / 2; plate.position.set(x0 - 0.004, 0.43, 0);
    root.add(plate);
    const script = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.05), new THREE.MeshStandardMaterial({ map: TEX.text(BRANDING.marque.toUpperCase(), 512, 128, 'italic bold 80px Georgia', '#eeeeee'), transparent: true, metalness: 0.9, roughness: 0.2 }));
    const tp = gl.at(-1.98, 0.5);
    script.position.copy(tp.p).add(tp.n.clone().multiplyScalar(-0.004)); script.lookAt(script.position.clone().add(tp.n.clone().multiplyScalar(-1)));
    root.add(script);
  }
  // Rear bumpers, tail lamps
  for (const [sd, s] of [['R', 1], ['L', -1]] as const) {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * 1.2;
      pts.push(V(-2.17 + Math.sin(a) * 0.36 - 0.04, 0.4, s * (0.18 + (1 - Math.cos(a)) * 0.2 + k * 0.026)));
    }
    const bump = tube(pts, 0.021, M.chrome, 40, 12);
    bump.scale.y = 0.75; bump.position.y = 0.1;
    root.add(bump);
    B.bind(`body.bumper_R${sd}`, bump);
    const lamp = group(new THREE.Mesh(roundedBox(0.09, 0.05, 0.08, 0.02), M.red));
    const lp = tubLoft.at(-2.1, s > 0 ? 0.36 : 0.64);
    lamp.position.copy(lp.p).add(lp.n.clone().multiplyScalar(0.0));
    lamp.position.y = 0.57;
    root.add(lamp);
    B.bind(`body.taillamp_${sd}`, lamp);
    const tip = cyl(0.03, 0.12, M.chrome, 'x', 16); tip.position.set(-2.24, 0.23, s * 0.07);
    root.add(tip);
  }
  // Wipers
  for (let i = 1; i <= 3; i++) {
    const z = (i - 2) * 0.36;
    const w = group(box(0.015, 0.008, 0.34, M.chrome, 0, 0, 0), box(0.012, 0.012, 0.32, M.black, 0.01, 0.006, 0));
    w.position.set(0.45, 0.89, z - 0.06); w.rotation.set(0, 0.22, -0.32);
    root.add(w);
    B.bind(`body.wiper_${i}`, w);
  }
  // Fuel filler (left rear deck)
  {
    const fp = gl.at(-1.55, 0.94);
    const f = cyl(0.045, 0.012, M.chrome, 'y', 24);
    f.position.copy(fp.p); f.lookAt(fp.p.clone().add(fp.n)); f.rotateX(Math.PI / 2);
    root.add(f);
    B.bind('body.fuel_filler', f);
  }
  // Floor pan, sills underside, bulkhead, transmission tunnel
  root.add(box(2.55, 0.01, 1.42, M.underside, -0.35, 0.185, 0));
  const tunnel = box(1.6, 0.22, 0.32, M.carpet, -0.1, 0.3, 0, 0.06);
  root.add(tunnel);
  const bulk = box(0.02, 0.62, 1.38, M.paintInner, 0.62, 0.52, 0);
  root.add(bulk);
  B.bind('body.bulkhead', bulk);
  root.add(box(0.25, 0.02, 1.4, M.paintInner, 0.5, 0.84, 0));
  // Rear bulkhead behind seats and boot floor
  root.add(box(0.02, 0.32, 1.36, M.carpet, -0.82, 0.42, 0));
  const bootFloor = new THREE.Group();
  const bootPanel = box(0.9, 0.012, 1.1, M.carpet, -1.4, 0.43, 0);
  bootFloor.add(bootPanel);
  bootFloor.position.set(0, 0, 0);
  root.add(bootFloor);
  B.bind('body.boot_floor', bootPanel);
  root.add(box(1.0, 0.012, 1.16, M.underside, -1.45, 0.27, 0));

  // ═════════ INTERIOR ═════════
  const interior = new THREE.Group();
  root.add(interior);
  // Dashboard
  const dash = box(0.2, 0.2, 1.36, M.leather, 0.38, 0.72, 0, 0.04);
  interior.add(dash);
  B.bind('int.dashboard', dash);
  const gauges: BodyParts['gauges'] = {} as any;
  const mkGauge = (r: number, label: string, max: number, ticks: number, x: number, y: number, z: number, unit: string) => {
    const face = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshStandardMaterial({ map: TEX.dial(label, max, ticks, unit), roughness: 0.3 }));
    face.rotation.y = -Math.PI / 2;
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.08, 8, 32), M.chrome); bezel.rotation.y = Math.PI / 2;
    const needle = box(0.002, r * 0.8, 0.004, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x777777 }), 0, r * 0.4, 0);
    const nPivot = new THREE.Group(); nPivot.add(needle); nPivot.position.x = -0.004;
    const g = group(face, bezel, nPivot);
    g.position.set(x, y, z);
    g.rotation.z = 0.25;
    interior.add(g);
    return nPivot;
  };
  gauges.speedo = mkGauge(0.065, 'MPH', 160, 16, 0.275, 0.76, 0.42, '');
  gauges.tach = mkGauge(0.065, 'RPM x100', 60, 12, 0.275, 0.76, 0.27, '');
  // centre aluminium panel (hinges down for fuse access)
  const panelPivot = new THREE.Group();
  panelPivot.position.set(0.28, 0.66, 0);
  interior.add(panelPivot);
  const alu = box(0.012, 0.15, 0.46, M.polished, 0, 0.075, 0);
  panelPivot.add(alu);
  for (let i = 0; i < 7; i++) {
    const tg = cyl(0.004, 0.035, M.chrome, 'x', 8); tg.position.set(-0.02, 0.03, -0.18 + i * 0.06); tg.rotation.z = -Math.PI / 2 + 0.3;
    panelPivot.add(tg);
  }
  const g4 = (lab: string, max: number, z: number) => {
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.03, 24), new THREE.MeshStandardMaterial({ map: TEX.dial(lab, max, 4), roughness: 0.3 }));
    face.rotation.y = -Math.PI / 2; face.position.set(-0.007, 0.105, z);
    const nP = new THREE.Group(); nP.position.set(-0.009, 0.105, z);
    nP.add(box(0.002, 0.024, 0.003, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x666666 }), 0, 0.012, 0));
    panelPivot.add(face, nP);
    return nP;
  };
  gauges.amps = g4('AMPS', 60, -0.16);
  gauges.fuel = g4('FUEL', 4, -0.055);
  gauges.temp = g4('TEMP', 120, 0.055);
  gauges.oil = g4('OIL', 100, 0.16);
  B.bind('int.center_panel', alu);
  B.bind('int.gauges', group());
  // Thumb screws (top corners of the centre panel)
  for (const [n, z] of [[1, -0.21], [2, 0.21]] as const) {
    const scr = cyl(0.009, 0.014, M.chrome, 'x', 16);
    scr.position.set(0.272, 0.8, z);
    interior.add(scr);
    B.bind(`int.panel_screw_${n}`, scr, { axis: V(-1, 0, 0), pitch: 0.0025 });
  }
  // Fuse block behind the panel
  const fuseBlock = box(0.03, 0.06, 0.2, M.black, 0.33, 0.73, 0);
  interior.add(fuseBlock);
  for (let f = 1; f <= 6; f++) {
    const fz = -0.075 + (f - 1) * 0.03;
    const fuse = group(cyl(0.004, 0.03, M.lampGlass, 'y', 10), at(cyl(0.0045, 0.006, M.chrome, 'y', 10), 0, 0.013, 0), at(cyl(0.0045, 0.006, M.chrome, 'y', 10), 0, -0.013, 0), cyl(0.0006, 0.026, M.copper, 'y', 4));
    fuse.position.set(0.312, 0.73, fz);
    interior.add(fuse);
    B.bind(`elec.fuse_${f}`, fuse);
  }
  // Ignition key, starter button, choke
  const ignitionKey = group(cyl(0.012, 0.01, M.chrome, 'x', 16), at(box(0.005, 0.022, 0.012, M.chrome), -0.012, 0.0, 0));
  ignitionKey.position.set(0.27, 0.69, -0.12);
  interior.add(ignitionKey);
  B.bind('int.ignition', ignitionKey);
  const starter = cyl(0.009, 0.012, M.black, 'x', 16); starter.position.set(0.27, 0.69, 0.12);
  interior.add(starter);
  B.bind('int.starter_button', starter);
  const choke = group(box(0.05, 0.01, 0.01, M.chrome, -0.025, 0, 0), at(cyl(0.007, 0.012, M.black, 'z', 10), -0.05, 0, 0));
  choke.position.set(0.3, 0.62, 0.32);
  interior.add(choke);
  B.bind('int.choke', choke);
  // Steering
  const wheelGrp = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.013, 12, 64), M.wood);
  rim.rotation.y = Math.PI / 2;
  wheelGrp.add(rim);
  for (let i = 0; i < 3; i++) {
    const a = i * (Math.PI * 2 / 3) - Math.PI / 2;
    const sp = box(0.004, 0.19, 0.03, M.polished, 0, Math.cos(a) * 0.095, Math.sin(a) * 0.095);
    sp.rotation.x = -a;
    wheelGrp.add(sp);
  }
  wheelGrp.add(cyl(0.035, 0.03, M.polished, 'x', 20));
  wheelGrp.position.set(0.12, 0.74, 0.35);
  wheelGrp.rotation.z = 0.42;
  interior.add(wheelGrp);
  B.bind('int.steering_wheel', wheelGrp);
  const col = cyl(0.025, 0.45, M.black, 'x'); col.position.set(0.32, 0.67, 0.35); col.rotation.z = -Math.PI / 2 + 0.42 + Math.PI / 2;
  col.rotation.set(0, 0, 0.42);
  interior.add(col);
  B.bind('int.steering_column', col);
  // Seats
  for (const [sd, z] of [['L', -0.35], ['R', 0.35]] as const) {
    const seat = group(
      box(0.5, 0.08, 0.44, M.leather, 0, 0, 0, 0.03),
      at(box(0.08, 0.55, 0.44, M.leather, 0, 0, 0, 0.03), -0.25, 0.26, 0, 0, 0, -0.22),
      at(box(0.5, 0.03, 0.4, M.black), 0, -0.06, 0),
    );
    seat.position.set(-0.45, 0.28, z);
    interior.add(seat);
    B.bind(`int.seat_${sd}`, seat);
  }
  interior.add(box(1.4, 0.01, 1.3, M.carpet, -0.25, 0.2, 0));
  // Console, gear lever, handbrake, pedals, bonnet releases
  const console_ = box(0.5, 0.1, 0.24, M.leather, 0.05, 0.43, 0, 0.03);
  interior.add(console_);
  B.bind('int.console', console_);
  const gear = group(cyl(0.006, 0.22, M.chrome), at(new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), M.black), 0, 0.12, 0));
  gear.position.set(-0.05, 0.56, 0); gear.rotation.z = 0.15;
  interior.add(gear);
  B.bind('int.gear_lever', gear);
  const hb = group(box(0.22, 0.02, 0.025, M.chrome, 0.11, 0, 0, 0.008), at(box(0.06, 0.03, 0.03, M.black, 0.2, 0, 0, 0.01), 0, 0, 0));
  hb.position.set(-0.3, 0.42, -0.16); hb.rotation.z = 0.25;
  interior.add(hb);
  B.bind('int.handbrake', hb);
  const pedals = group(box(0.01, 0.07, 0.05, M.black, 0, 0, 0.0), box(0.01, 0.07, 0.05, M.black, 0, 0, 0.12), box(0.01, 0.09, 0.04, M.black, 0, 0, -0.12));
  pedals.position.set(0.48, 0.3, 0.35);
  interior.add(pedals);
  B.bind('int.pedals', pedals);
  for (const [sd, s] of [['L', -1], ['R', 1]] as const) {
    const rel = group(box(0.05, 0.012, 0.012, M.chrome), at(box(0.012, 0.03, 0.012, M.black), 0.025, -0.015, 0));
    rel.position.set(0.44, 0.33, s * 0.66);
    interior.add(rel);
    B.bind(`int.bonnet_release_${sd}`, rel);
  }
  const mirror = box(0.01, 0.05, 0.16, M.chrome, 0.06, 1.1, 0, 0.01);
  interior.add(mirror);
  B.bind('body.mirror', mirror);

  shadows(root);
  for (const g of glass) { g.castShadow = false; g.renderOrder = 2; }
  return { root, bonnetPivot, doorPivot, hatchPivot, panelPivot, bootFloor, bodyMeshes, glass, gauges, ignitionKey, bonnetLoft, tubLoft };
}
