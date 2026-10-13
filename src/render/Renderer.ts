/**
 * WebGL renderer, lighting, environment reflections and the post pipeline:
 * scene → (MSAA, HDR) target → composite with hover/selection outlines → tone-mapped screen.
 * Performance: shadows re-render only when a caster moves, outlines draw only the highlighted meshes
 * (depth-tested against the scene's own depth texture), and resolution adapts to the frame rate.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const HL_LAYER = 31;
const SNAP_IDX = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14];

const maskMat = new THREE.ShaderMaterial({
  uniforms: { tDepth: { value: null }, res: { value: new THREE.Vector2() }, nearFar: { value: new THREE.Vector2() }, vis: { value: new THREE.Vector4() }, hid: { value: new THREE.Vector4() } },
  vertexShader: /* glsl */ `
    #include <common>
    void main() {
      #include <begin_vertex>
      #include <project_vertex>
    }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDepth; uniform vec2 res; uniform vec2 nearFar; uniform vec4 vis; uniform vec4 hid;
    void main() {
      float sceneZ = -perspectiveDepthToViewZ(texture2D(tDepth, gl_FragCoord.xy / res).x, nearFar.x, nearFar.y);
      float fragZ = -perspectiveDepthToViewZ(gl_FragCoord.z, nearFar.x, nearFar.y);
      gl_FragColor = fragZ <= sceneZ + 0.004 + fragZ * 0.004 ? vis : hid;
    }`,
  depthTest: false, depthWrite: false,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
  side: THREE.DoubleSide,
});

const compositeMat = new THREE.ShaderMaterial({
  uniforms: {
    tScene: { value: null }, tMask: { value: null }, texel: { value: new THREE.Vector2() }, uActive: { value: 0 }, thick: { value: 1 },
    hoverVis: { value: new THREE.Color(0xffd27a) }, hoverHid: { value: new THREE.Color(0x6a5020) },
    selVis: { value: new THREE.Color(0x6ad7ff) }, selHid: { value: new THREE.Color(0x1d4a66) }, pulse: { value: 1 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tScene; uniform sampler2D tMask; uniform vec2 texel; uniform float uActive; uniform float thick;
    uniform vec3 hoverVis; uniform vec3 hoverHid; uniform vec3 selVis; uniform vec3 selHid; uniform float pulse;
    varying vec2 vUv;
    vec4 ring(float r) {
      vec4 m = vec4(0.0);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        m = max(m, texture2D(tMask, vUv + vec2(cos(a), sin(a)) * texel * r));
      }
      return m;
    }
    void main() {
      vec3 col = texture2D(tScene, vUv).rgb;
      if (uActive > 0.5) {
        vec4 c = texture2D(tMask, vUv);
        vec4 inner = max(ring(thick) - c, 0.0);
        vec4 outer = max(ring(thick * 2.6) - c, 0.0) * 0.35;
        vec4 e = min(inner + outer, 1.0);
        col += hoverVis * e.r * 3.2 + hoverHid * e.g * 2.0 + (selVis * e.b * 3.8 + selHid * e.a * 2.4) * pulse;
      }
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false,
});

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  key: THREE.DirectionalLight;
  /** Objects outlined amber (hover) and blue (selection) this frame. */
  hover: THREE.Object3D[] = [];
  selection: THREE.Object3D[] = [];
  private camera: THREE.PerspectiveCamera;
  private sceneRT: THREE.WebGLRenderTarget;
  private maskRT: THREE.WebGLRenderTarget;
  private quad = new FullScreenQuad(compositeMat);
  private basePR: number;
  /** Adaptive resolution scale (0.6…1 of the quality cap). */
  scale = 1;
  private ft = 16.7;
  private sinceAdapt = 0;
  private shadowSnap = new Float32Array(0);
  private shadowN = 0;

  constructor(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, quality: 'low' | 'high') {
    this.camera = camera;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false, stencil: false });
    this.basePR = Math.min(window.devicePixelRatio, quality === 'high' ? 1.5 : 1);
    this.renderer.setPixelRatio(this.basePR);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.localClippingEnabled = true;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.75;
    this.scene.background = new THREE.Color(0x2b2d30);
    this.scene.fog = new THREE.Fog(0x2b2d30, 14, 30);
    // Lighting
    const hemi = new THREE.HemisphereLight(0xf2f0ea, 0x3a3630, 0.55);
    this.scene.add(hemi);
    this.key = new THREE.DirectionalLight(0xfff4e6, 1.6);
    this.key.position.set(2.5, 3.9, 1.8);
    this.key.target.position.set(0.2, 0, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4; sc.near = 0.5; sc.far = 10;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.key, this.key.target);
    const fill = new THREE.PointLight(0xfff1dd, 4, 9, 1.6); fill.position.set(-2.5, 3.2, -1.5);
    const fill2 = new THREE.PointLight(0xfff1dd, 3.5, 9, 1.6); fill2.position.set(2.6, 3.2, 2.0);
    const under = new THREE.PointLight(0xfff1dd, 0.8, 3, 2); under.position.set(0.8, 0.15, 0);
    this.scene.add(fill, fill2, under);
    // Render targets
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : 0, depthTexture: new THREE.DepthTexture(1, 1) });
    this.maskRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.parentElement?.clientWidth || window.innerWidth;
    const h = c.parentElement?.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.basePR * this.scale);
    this.renderer.setSize(w, h, false);
    const pw = Math.max(1, Math.floor(w * this.basePR * this.scale)), ph = Math.max(1, Math.floor(h * this.basePR * this.scale));
    this.sceneRT.setSize(pw, ph);
    this.maskRT.setSize(pw, ph);
    compositeMat.uniforms.texel.value.set(1 / pw, 1 / ph);
    compositeMat.uniforms.thick.value = Math.max(1, 1.3 * this.basePR * this.scale);
    maskMat.uniforms.res.value.set(pw, ph);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Feeds the measured frame time; lowers/raises internal resolution to hold ~50+ fps. */
  adapt(dtMs: number) {
    this.ft += (Math.min(dtMs, 100) - this.ft) * 0.05;
    this.sinceAdapt += dtMs;
    if (this.sinceAdapt < 1500) return;
    const prev = this.scale;
    if (this.ft > 21 && this.scale > 0.6) this.scale = Math.max(0.6, this.scale * 0.85);
    else if (this.ft < 15 && this.scale < 1 && this.sinceAdapt > 4000) this.scale = Math.min(1, this.scale * 1.12);
    else if (this.ft <= 21 && this.ft >= 15) return;
    if (this.scale !== prev) { this.sinceAdapt = 0; this.resize(); }
  }

  /** Re-render the shadow map only when a visible caster moved, changed or appeared/disappeared. */
  private checkShadows() {
    let i = 0, changed = false;
    const tol = 2e-3;
    this.scene.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.castShadow) return;
      if (i + 14 > this.shadowSnap.length) { const n = new Float32Array(Math.max(2048, this.shadowSnap.length * 2)); n.set(this.shadowSnap); this.shadowSnap = n; changed = true; }
      const snap = this.shadowSnap, e = m.matrixWorld.elements;
      if (snap[i] !== m.id || snap[i + 1] !== m.geometry.id) { changed = true; snap[i] = m.id; snap[i + 1] = m.geometry.id; }
      for (let k = 0; k < 12; k++) {
        const v = e[SNAP_IDX[k]];
        if (Math.abs(snap[i + 2 + k] - v) > tol) changed = true;
      }
      i += 14;
    });
    if (i !== this.shadowN) changed = true;
    if (!changed) return;
    // Store exact current values so slow drifts accumulate until they exceed the tolerance
    let j = 0;
    this.scene.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.castShadow) return;
      const snap = this.shadowSnap, e = m.matrixWorld.elements;
      snap[j] = m.id; snap[j + 1] = m.geometry.id;
      for (let k = 0; k < 12; k++) snap[j + 2 + k] = e[SNAP_IDX[k]];
      j += 14;
    });
    this.shadowN = i;
    this.renderer.shadowMap.needsUpdate = true;
  }

  private tagHighlights(list: THREE.Object3D[], on: boolean) {
    for (const o of list) o.traverseVisible((m) => { if ((m as THREE.Mesh).isMesh) { if (on) m.layers.enable(HL_LAYER); else m.layers.disable(HL_LAYER); } });
  }

  render() {
    const r = this.renderer, cam = this.camera;
    this.scene.updateMatrixWorld();
    this.scene.matrixWorldAutoUpdate = false;
    this.checkShadows();
    r.setRenderTarget(this.sceneRT);
    r.render(this.scene, cam);
    const active = this.hover.length > 0 || this.selection.length > 0;
    compositeMat.uniforms.uActive.value = active ? 1 : 0;
    if (active) {
      const bg = this.scene.background, fog = this.scene.fog, mask = cam.layers.mask;
      this.scene.background = null; this.scene.fog = null; this.scene.overrideMaterial = maskMat;
      maskMat.uniforms.tDepth.value = this.sceneRT.depthTexture;
      maskMat.uniforms.nearFar.value.set(cam.near, cam.far);
      cam.layers.set(HL_LAYER);
      r.setRenderTarget(this.maskRT);
      r.setClearColor(0x000000, 0);
      r.clear(true, false, false);
      const pass = (list: THREE.Object3D[], vis: [number, number, number, number], hid: [number, number, number, number]) => {
        if (!list.length) return;
        maskMat.uniforms.vis.value.set(...vis); maskMat.uniforms.hid.value.set(...hid);
        this.tagHighlights(list, true);
        r.render(this.scene, cam);
        this.tagHighlights(list, false);
      };
      const autoClear = r.autoClear; r.autoClear = false;
      pass(this.hover, [1, 0, 0, 0], [0, 1, 0, 0]);
      pass(this.selection, [0, 0, 1, 0], [0, 0, 0, 1]);
      r.autoClear = autoClear;
      cam.layers.mask = mask;
      this.scene.background = bg; this.scene.fog = fog; this.scene.overrideMaterial = null;
      compositeMat.uniforms.pulse.value = (1 + 0.25) / 2 + Math.cos(performance.now() * 0.01 / 2.2) * (1 - 0.25) / 2;
    }
    this.scene.matrixWorldAutoUpdate = true;
    compositeMat.uniforms.tScene.value = this.sceneRT.texture;
    compositeMat.uniforms.tMask.value = this.maskRT.texture;
    r.setRenderTarget(null);
    this.quad.render(r);
  }
}
