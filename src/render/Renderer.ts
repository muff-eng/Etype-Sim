/** WebGL renderer, lighting, environment reflections and post-processing (hover outline). */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  composer: EffectComposer;
  outline: OutlinePass;
  selectOutline: OutlinePass;
  key: THREE.DirectionalLight;
  private camera: THREE.PerspectiveCamera;

  constructor(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, quality: 'low' | 'high') {
    this.camera = camera;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.localClippingEnabled = true;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
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
    this.key.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    const sc = this.key.shadow.camera;
    sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4; sc.near = 0.5; sc.far = 10;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.key, this.key.target);
    const fill = new THREE.PointLight(0xfff1dd, 4, 9, 1.6); fill.position.set(-2.5, 3.2, -1.5);
    const fill2 = new THREE.PointLight(0xfff1dd, 3.5, 9, 1.6); fill2.position.set(2.6, 3.2, 2.0);
    const under = new THREE.PointLight(0xfff1dd, 0.8, 3, 2); under.position.set(0.8, 0.15, 0);
    this.scene.add(fill, fill2, under);
    // Post-processing
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, camera));
    this.outline = new OutlinePass(new THREE.Vector2(w, h), this.scene, camera);
    this.outline.edgeStrength = 4; this.outline.edgeGlow = 0.2; this.outline.edgeThickness = 1.2;
    this.outline.visibleEdgeColor.set(0xffd27a); this.outline.hiddenEdgeColor.set(0x6a5020);
    this.selectOutline = new OutlinePass(new THREE.Vector2(w, h), this.scene, camera);
    this.selectOutline.edgeStrength = 5; this.selectOutline.edgeThickness = 1.6; this.selectOutline.pulsePeriod = 2.2;
    this.selectOutline.visibleEdgeColor.set(0x6ad7ff); this.selectOutline.hiddenEdgeColor.set(0x1d4a66);
    this.composer.addPass(this.selectOutline);
    this.composer.addPass(this.outline);
    this.composer.addPass(new OutputPass());
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.parentElement?.clientWidth || window.innerWidth;
    const h = c.parentElement?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() { this.composer.render(); }
}
