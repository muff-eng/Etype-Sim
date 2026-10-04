import * as THREE from 'three';

/** Monotone cubic (PCHIP) interpolation through (xs, ys); xs may be ascending or descending. */
export function pchip(xsIn: number[], ysIn: number[]) {
  let xs = xsIn, ys = ysIn;
  if (xs[0] > xs[xs.length - 1]) { xs = [...xs].reverse(); ys = [...ys].reverse(); }
  const n = xs.length;
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const hh = xs[i + 1] - xs[i], t = (x - xs[i]) / hh;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1];
  };
}

/** Builds a smooth grid surface from a parametric function p(s, t), s,t ∈ [0,1]. */
export function surface(fn: (s: number, t: number) => THREE.Vector3, ns: number, nt: number, s0 = 0, s1 = 1, t0 = 0, t1 = 1): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= ns; i++) {
    const s = s0 + (s1 - s0) * (i / ns);
    for (let j = 0; j <= nt; j++) {
      const t = t0 + (t1 - t0) * (j / nt);
      const p = fn(s, t);
      pos.push(p.x, p.y, p.z);
      uv.push(s, t);
    }
  }
  const w = nt + 1;
  for (let i = 0; i < ns; i++) for (let j = 0; j < nt; j++) {
    const a = i * w + j, b = a + 1, c = a + w, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function tube(points: THREE.Vector3[], r: number, mat: THREE.Material, seg = 32, radial = 10, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, radial, closed), mat);
  m.castShadow = true;
  return m;
}

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, bevel = 0) {
  const g = bevel > 0 ? roundedBox(w, h, d, bevel) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function roundedBox(w: number, h: number, d: number, r: number, seg = 3) {
  const shape = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1e-4, d - 2 * Math.min(r, d / 2 - 1e-4)), bevelEnabled: true, bevelThickness: Math.min(r, d / 2 - 1e-4), bevelSize: Math.min(r, d / 2 - 1e-4) * 0.6, bevelSegments: seg, curveSegments: seg });
  g.translate(0, 0, -(d - 2 * Math.min(r, d / 2 - 1e-4)) / 2);
  g.computeVertexNormals();
  return g;
}

export function cyl(r: number, h: number, mat: THREE.Material, axis: 'x' | 'y' | 'z' = 'y', seg = 20, r2?: number) {
  const g = new THREE.CylinderGeometry(r2 ?? r, r, h, seg);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function hexNut(af: number, h: number, mat: THREE.Material, axis: 'x' | 'y' | 'z' = 'y') {
  const r = af / Math.sqrt(3);
  return cyl(r, h, mat, axis, 6);
}

/** Lathe from a 2D profile [r, y] around Y. */
export function lathe(profile: [number, number][], mat: THREE.Material, seg = 32) {
  const m = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function group(...children: THREE.Object3D[]) {
  const g = new THREE.Group();
  for (const c of children) g.add(c);
  return g;
}

export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): T {
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  return o;
}

/** Extrude a 2D YZ profile along X. */
export function extrudeX(pts: [number, number][], length: number, mat: THREE.Material, bevel = 0.004) {
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: length, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2 });
  g.rotateY(Math.PI / 2);
  g.translate(-length / 2, 0, 0);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function shadows(o: THREE.Object3D, cast = true, receive = true) {
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive; } });
  return o;
}
