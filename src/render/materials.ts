import * as THREE from 'three';

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number], srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, base: string, n: number, alpha: number, size = 2) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = Math.floor(Math.random() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, size * Math.random() + 0.5, size * Math.random() + 0.5);
  }
}

export const TEX = {
  concrete: () => canvasTex(1024, 1024, (g) => {
    noise(g, 1024, 1024, '#77756f', 90000, 0.08, 3);
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * 1024, y = Math.random() * 1024, r = 20 + Math.random() * 120;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(30,25,20,${0.08 + Math.random() * 0.12})`); grd.addColorStop(1, 'rgba(30,25,20,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(40,38,34,0.5)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 512); g.lineTo(1024, 512); g.moveTo(512, 0); g.lineTo(512, 1024); g.stroke();
  }, [6, 5]),
  brick: () => canvasTex(512, 512, (g) => {
    g.fillStyle = '#d8d4c8'; g.fillRect(0, 0, 512, 512);
    for (let r = 0; r < 16; r++) for (let c = 0; c < 9; c++) {
      const x = c * 64 - (r % 2) * 32, y = r * 32;
      const v = 200 + Math.random() * 30;
      g.fillStyle = `rgb(${v},${v - 4},${v - 14})`; g.fillRect(x + 2, y + 2, 60, 28);
    }
  }, [8, 2]),
  wood: () => canvasTex(512, 64, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, '#5a2e12'); grd.addColorStop(0.5, '#7a4220'); grd.addColorStop(1, '#4e260e');
    g.fillStyle = grd; g.fillRect(0, 0, 512, 64);
    for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(40,18,6,${Math.random() * 0.4})`; g.lineWidth = Math.random() * 2; g.beginPath(); const y = Math.random() * 64; g.moveTo(0, y); g.bezierCurveTo(170, y + 8 * Math.random(), 340, y - 8 * Math.random(), 512, y); g.stroke(); }
  }, [4, 1]),
  tread: () => canvasTex(256, 64, (g) => {
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#060606';
    for (let i = 0; i < 16; i++) { g.fillRect(i * 16, 10, 3, 44); g.fillRect(i * 16 + 8, 0, 2, 64); }
    g.fillRect(0, 18, 256, 4); g.fillRect(0, 42, 256, 4);
  }, [18, 1]),
  pegboard: () => canvasTex(256, 256, (g) => {
    g.fillStyle = '#b8a27a'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#3a3026';
    for (let x = 8; x < 256; x += 16) for (let y = 8; y < 256; y += 16) { g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill(); }
  }, [6, 3]),
  text: (text: string, w = 512, h = 128, font = 'bold 72px Georgia', color = '#e8e8e8', bg = 'rgba(0,0,0,0)') => canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.font = font; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2);
  }),
  plate: (text: string) => canvasTex(512, 112, (g) => {
    g.fillStyle = '#111'; g.fillRect(0, 0, 512, 112);
    g.strokeStyle = '#ccc'; g.lineWidth = 4; g.strokeRect(6, 6, 500, 100);
    g.font = 'bold 74px "Courier New", monospace'; g.fillStyle = '#e8e8e8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, 60);
  }),
  dial: (label: string, max: number, ticks: number, unit = '') => canvasTex(256, 256, (g) => {
    g.fillStyle = '#0b0b0b'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ddd'; g.lineWidth = 2;
    for (let i = 0; i <= ticks; i++) {
      const a = Math.PI * 0.75 + (i / ticks) * Math.PI * 1.5;
      g.beginPath(); g.moveTo(128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100); g.lineTo(128 + Math.cos(a) * 116, 128 + Math.sin(a) * 116); g.stroke();
      g.fillStyle = '#ddd'; g.font = '18px Helvetica'; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (ticks <= 12 || i % 2 === 0) g.fillText(String(Math.round((i / ticks) * max)), 128 + Math.cos(a) * 82, 128 + Math.sin(a) * 82);
    }
    g.fillStyle = '#bbb'; g.font = '16px Helvetica'; g.fillText(label, 128, 170); g.fillText(unit, 128, 190);
  }),
};

export interface Mats {
  paint: THREE.MeshPhysicalMaterial;
  paintInner: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  polished: THREE.MeshStandardMaterial;
  alu: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  satin: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  tyre: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  lampGlass: THREE.MeshPhysicalMaterial;
  red: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  carpet: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  zinc: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  enamel: THREE.MeshStandardMaterial;
  hose: THREE.MeshStandardMaterial;
  battery: THREE.MeshStandardMaterial;
  wire: THREE.MeshStandardMaterial;
  wireRed: THREE.MeshStandardMaterial;
  paper: THREE.MeshStandardMaterial;
  underside: THREE.MeshStandardMaterial;
  radiator: THREE.MeshStandardMaterial;
  plastic: THREE.MeshStandardMaterial;
  oil: THREE.MeshStandardMaterial;
  coolant: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  toolRed: THREE.MeshStandardMaterial;
  toolChrome: THREE.MeshStandardMaterial;
  yellow: THREE.MeshStandardMaterial;
}

export function makeMaterials(paintColor: string): Mats {
  const S = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: paintColor, metalness: 0.2, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.035, side: THREE.DoubleSide }),
    paintInner: S({ color: paintColor, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide }),
    chrome: S({ color: 0xffffff, metalness: 1, roughness: 0.05 }),
    polished: S({ color: 0xe2e5e8, metalness: 1, roughness: 0.14 }),
    alu: S({ color: 0xb5b8bb, metalness: 0.8, roughness: 0.48 }),
    iron: S({ color: 0x2c2d30, metalness: 0.35, roughness: 0.62 }),
    black: S({ color: 0x0e0e0f, metalness: 0.2, roughness: 0.55 }),
    satin: S({ color: 0x1b1c1e, metalness: 0.5, roughness: 0.42 }),
    rubber: S({ color: 0x111111, metalness: 0, roughness: 0.92 }),
    tyre: S({ color: 0x1c1c1c, metalness: 0, roughness: 0.88, map: TEX.tread() }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x8fa2b0, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6 }),
    lampGlass: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.0, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 2 }),
    red: S({ color: 0x9a0d0d, metalness: 0.1, roughness: 0.25, emissive: 0x220000, transparent: true, opacity: 0.92 }),
    amber: S({ color: 0xd07a10, metalness: 0.1, roughness: 0.25, emissive: 0x201000 }),
    leather: S({ color: 0x232021, metalness: 0, roughness: 0.68 }),
    wood: S({ color: 0xffffff, map: TEX.wood(), metalness: 0, roughness: 0.32 }),
    carpet: S({ color: 0x1d1b1a, metalness: 0, roughness: 1 }),
    steel: S({ color: 0x8b8e92, metalness: 0.9, roughness: 0.35 }),
    zinc: S({ color: 0xbfc4b4, metalness: 0.85, roughness: 0.32 }),
    copper: S({ color: 0xb87333, metalness: 1, roughness: 0.3 }),
    brass: S({ color: 0xb5a642, metalness: 1, roughness: 0.32 }),
    enamel: S({ color: 0x262627, metalness: 0.3, roughness: 0.45 }),
    hose: S({ color: 0x151515, metalness: 0, roughness: 0.78 }),
    battery: S({ color: 0x151515, metalness: 0.05, roughness: 0.55 }),
    wire: S({ color: 0x0c0c0c, metalness: 0, roughness: 0.6 }),
    wireRed: S({ color: 0x8e1c14, metalness: 0, roughness: 0.6 }),
    paper: S({ color: 0xd8c9a0, metalness: 0, roughness: 0.95 }),
    underside: S({ color: 0x171716, metalness: 0.1, roughness: 0.9, side: THREE.DoubleSide }),
    radiator: S({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.5 }),
    plastic: S({ color: 0xd8d4c4, metalness: 0, roughness: 0.4, transparent: true, opacity: 0.85 }),
    oil: S({ color: 0x2a1906, metalness: 0.1, roughness: 0.05 }),
    coolant: S({ color: 0x2a64d8, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.85 }),
    white: S({ color: 0xe8e6e0, metalness: 0, roughness: 0.6 }),
    toolRed: S({ color: 0xa8161a, metalness: 0.4, roughness: 0.35 }),
    toolChrome: S({ color: 0xdadada, metalness: 1, roughness: 0.18 }),
    yellow: S({ color: 0xe0b020, metalness: 0.2, roughness: 0.4 }),
  };
}

/** Condition tinting: clones the material once per mesh and blends towards rust/dirt/oil. */
const RUST = new THREE.Color(0x7a3b16);
const DIRT = new THREE.Color(0x3a332a);
export function applyConditionLook(root: THREE.Object3D, flags: string[], condition: number) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.noTint) return;
    const base = (m.userData.baseMat ?? m.material) as THREE.MeshStandardMaterial;
    if (!m.userData.baseMat) m.userData.baseMat = base;
    if (!(base as any).color) return;
    const corroded = flags.includes('corroded'), dirty = flags.includes('dirty') || flags.includes('fouled'), glazed = flags.includes('glazed'), blown = flags.includes('blown'), hardened = flags.includes('hardened');
    if (!corroded && !dirty && !glazed && !blown && !hardened && condition > 0.6) { m.material = base; return; }
    const key = `${flags.join(',')}|${Math.round(condition * 10)}`;
    if (m.userData.tintKey === key) return;
    const mat = base.clone() as THREE.MeshStandardMaterial;
    if (corroded) { mat.color.lerp(RUST, 0.5); mat.roughness = 0.95; mat.metalness = 0.2; }
    if (dirty) { mat.color.lerp(DIRT, 0.45); mat.roughness = Math.min(1, mat.roughness + 0.2); }
    if (glazed) { mat.roughness = 0.15; }
    if (blown) { mat.color.set(0x2a2a2a); }
    if (hardened) { mat.color.lerp(new THREE.Color(0x3b3b3b), 0.3); mat.roughness = 0.4; }
    if (condition < 0.6) mat.color.lerp(DIRT, (0.6 - condition) * 0.5);
    m.material = mat;
    m.userData.tintKey = key;
  });
}
