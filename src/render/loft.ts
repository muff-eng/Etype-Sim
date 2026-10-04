import * as THREE from 'three';
import { pchip } from './geom';

export type Sec = { z: number; y: number }[];

/**
 * A lofted surface built from cross-sections at a list of X stations. All sections share a point count,
 * so sub-patches (doors, glass, hatch) can be cut out with exact, crack-free seams and shared normals.
 */
export class Loft {
  xs: number[];
  secs: Sec[];
  nt: number;
  private normals: THREE.Vector3[][] = [];

  constructor(xs: number[], section: (x: number) => Sec) {
    this.xs = xs;
    this.secs = xs.map(section);
    this.nt = this.secs[0].length;
    this.computeNormals();
  }

  private computeNormals() {
    const nx = this.xs.length, nt = this.nt;
    const P = (i: number, j: number) => new THREE.Vector3(this.xs[i], this.secs[i][j].y, this.secs[i][j].z);
    for (let i = 0; i < nx; i++) {
      const row: THREE.Vector3[] = [];
      for (let j = 0; j < nt; j++) {
        const a = P(Math.max(0, i - 1), j), b = P(Math.min(nx - 1, i + 1), j);
        const c = P(i, Math.max(0, j - 1)), d = P(i, Math.min(nt - 1, j + 1));
        const du = b.sub(a), dv = d.sub(c);
        const n = du.cross(dv).normalize();
        row.push(n);
      }
      this.normals.push(row);
    }
  }

  idxX(x: number) {
    let best = 0, bd = Infinity;
    this.xs.forEach((v, i) => { const d = Math.abs(v - x); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  idxT(t: number) { return Math.round(t * (this.nt - 1)); }

  /** Patch between stations nearest xa..xb and section fractions ta..tb. flip reverses winding. */
  patch(xa: number, xb: number, ta: number, tb: number, mat: THREE.Material, flip = false): THREE.Mesh {
    let i0 = this.idxX(xa), i1 = this.idxX(xb);
    if (i0 > i1) [i0, i1] = [i1, i0];
    let j0 = this.idxT(ta), j1 = this.idxT(tb);
    if (j0 > j1) [j0, j1] = [j1, j0];
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const s = this.secs[i][j];
      pos.push(this.xs[i], s.y, s.z);
      const n = this.normals[i][j];
      nor.push(flip ? -n.x : n.x, flip ? -n.y : n.y, flip ? -n.z : n.z);
      uv.push((i - i0) / Math.max(1, i1 - i0), (j - j0) / Math.max(1, j1 - j0));
    }
    const w = j1 - j0 + 1;
    for (let i = 0; i < i1 - i0; i++) for (let j = 0; j < j1 - j0; j++) {
      const a = i * w + j, b = a + 1, c = a + w, d = c + 1;
      if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  /** Surface point and normal at (x, t) — nearest station, interpolated across t. */
  at(x: number, t: number): { p: THREE.Vector3; n: THREE.Vector3 } {
    const i = this.idxX(x);
    const f = t * (this.nt - 1);
    const j = Math.min(this.nt - 2, Math.floor(f)), k = f - j;
    const a = this.secs[i][j], b = this.secs[i][j + 1];
    const p = new THREE.Vector3(this.xs[i], a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    const n = this.normals[i][j].clone().lerp(this.normals[i][j + 1], k).normalize();
    return { p, n };
  }

  /** Find the section fraction t on station x where |z| is closest to zTarget on the requested half. */
  tForZ(x: number, z: number, side: 1 | -1, upper = true): number {
    const i = this.idxX(x);
    let best = 0, bd = Infinity;
    const sec = this.secs[i];
    for (let j = 0; j < sec.length; j++) {
      const s = sec[j];
      if (Math.sign(s.z) !== side && Math.abs(s.z) > 1e-4) continue;
      const d = Math.abs(s.z - z) + (upper ? -s.y * 0.001 : 0);
      if (d < bd) { bd = d; best = j; }
    }
    return best / (this.nt - 1);
  }
}

/** Resamples a polyline uniformly by arc length into n points. */
export function resample(pts: { z: number; y: number }[], n: number): Sec {
  const L: number[] = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i].z - pts[i - 1].z, pts[i].y - pts[i - 1].y));
  const tot = L[L.length - 1] || 1;
  const out: Sec = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * tot;
    while (k < L.length - 2 && L[k + 1] < s) k++;
    const f = (s - L[k]) / Math.max(1e-9, L[k + 1] - L[k]);
    out.push({ z: pts[k].z + (pts[k + 1].z - pts[k].z) * f, y: pts[k].y + (pts[k + 1].y - pts[k].y) * f });
  }
  return out;
}

/** Cuts a bottom→top polyline at height yCut (keeps the part above), returning the remaining polyline. */
export function trimBelow(pts: { z: number; y: number }[], yCut: number) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i + 1].y >= yCut) {
      if (pts[i].y >= yCut) return pts.slice(i);
      const f = (yCut - pts[i].y) / Math.max(1e-9, pts[i + 1].y - pts[i].y);
      const cut = { z: pts[i].z + (pts[i + 1].z - pts[i].z) * f, y: yCut };
      return [cut, ...pts.slice(i + 1)];
    }
  }
  return pts.slice(-2);
}

export function stations(a: number, b: number, n: number, extra: number[] = []) {
  const s = new Set<number>();
  for (let i = 0; i <= n; i++) s.add(+(a + (b - a) * (i / n)).toFixed(4));
  for (const e of extra) s.add(+e.toFixed(4));
  return [...s].sort((p, q) => q - p);
}

export { pchip };
