/**
 * Draw-call reduction: merges rigid, non-referenced meshes that share a material into one mesh per
 * container. Any object that code animates or toggles (bindings, pivots, parts referenced by the
 * model structs) becomes its own container, so its pose/visibility still applies to everything in it.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const matKey = (m: THREE.Material) => {
  const s = m as THREE.MeshPhysicalMaterial;
  return [m.type, s.color?.getHexString(), s.emissive?.getHexString(), s.emissiveIntensity, s.roughness, s.metalness, s.map?.uuid, s.normalMap?.uuid,
    s.clearcoat, m.transparent, m.opacity, m.side, m.depthWrite, m.depthTest, m.alphaTest, m.blending, s.envMapIntensity, (s as any).flatShading, m.clippingPlanes ? m.uuid : '', m.userData && Object.keys(m.userData).length ? m.uuid : ''].join('|');
};

/** Collects every Object3D reachable through plain objects/arrays in a model-parts struct. */
export function collectRefs(v: unknown, out = new Set<THREE.Object3D>(), depth = 0): Set<THREE.Object3D> {
  if (!v || typeof v !== 'object' || depth > 4) return out;
  if ((v as THREE.Object3D).isObject3D) { out.add(v as THREE.Object3D); return out; }
  if ((v as THREE.Material).isMaterial || (v as THREE.Vector3).isVector3 || (v as THREE.Plane).isPlane) return out;
  for (const x of Array.isArray(v) ? v : Object.values(v as object)) collectRefs(x, out, depth + 1);
  return out;
}

export function mergeStatic(root: THREE.Object3D, dynamic: Set<THREE.Object3D>) {
  root.updateMatrixWorld(true);
  const containers: THREE.Object3D[] = [root];
  let before = 0, after = 0;
  while (containers.length) {
    const c = containers.pop()!;
    const meshes: THREE.Mesh[] = [];
    const walk = (o: THREE.Object3D) => {
      for (const ch of o.children) {
        if (dynamic.has(ch)) { containers.push(ch); continue; }
        const m = ch as THREE.Mesh;
        if (m.isMesh && !m.children.length && !(m as THREE.InstancedMesh).isInstancedMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && !Array.isArray(m.material) && m.visible && !m.geometry.morphAttributes.position) meshes.push(m);
        if (ch.visible) walk(ch);
      }
    };
    walk(c);
    const groups = new Map<string, THREE.Mesh[]>();
    for (const m of meshes) {
      const k = [matKey(m.material as THREE.Material), m.castShadow, m.receiveShadow, m.renderOrder, m.frustumCulled, JSON.stringify(m.userData), Object.keys(m.geometry.attributes).sort().join(','), m.geometry.index ? 1 : 0].join('#');
      let g = groups.get(k); if (!g) groups.set(k, (g = [])); g.push(m);
    }
    const inv = new THREE.Matrix4().copy(c.matrixWorld).invert();
    for (const list of groups.values()) {
      before += list.length;
      if (list.length < 2) { after += list.length; continue; }
      const geos = list.map((m) => {
        const mx = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
        let g = m.geometry.clone().applyMatrix4(mx);
        if (mx.determinant() < 0) {
          if (!g.index) g = g.toNonIndexed();
          const idx = g.index ? (g.index.array as ArrayLike<number>) : null;
          if (idx) { const a = Array.from(idx); for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.setIndex(a); }
          else { const n = g.attributes.position.count; const a: number[] = []; for (let i = 0; i < n; i += 3) a.push(i, i + 2, i + 1); g.setIndex(a); }
        }
        g.clearGroups();
        return g;
      });
      const anyIdx = geos.some((g) => g.index);
      const norm = geos.map((g) => (anyIdx && !g.index ? g.setIndex([...Array(g.attributes.position.count).keys()]) : g));
      const merged = mergeGeometries(norm, false);
      if (!merged) { after += list.length; continue; }
      merged.computeBoundingSphere();
      const src = list[0];
      const mesh = new THREE.Mesh(merged, src.material);
      mesh.castShadow = src.castShadow; mesh.receiveShadow = src.receiveShadow; mesh.renderOrder = src.renderOrder; mesh.frustumCulled = src.frustumCulled;
      mesh.userData = { ...src.userData };
      mesh.name = 'merged';
      for (const m of list) m.removeFromParent();
      c.add(mesh);
      after++;
    }
  }
  return { before, after };
}

/** Small meshes contribute almost nothing to the key-light shadow but cost a draw call each. */
export function trimShadowCasters(root: THREE.Object3D, minRadius = 0.025) {
  const s = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.castShadow || (m as THREE.InstancedMesh).isInstancedMesh) return;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    m.getWorldScale(s);
    if (m.geometry.boundingSphere!.radius * Math.max(s.x, s.y, s.z) < minRadius) m.castShadow = false;
  });
}
