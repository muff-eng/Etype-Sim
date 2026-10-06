/**
 * Entry point: wires simulation (Game), presentation (three.js), audio, UI and persistence together.
 */
import * as THREE from 'three';
import { Game } from './game/Game';
import { Renderer } from './render/Renderer';
import { CameraController, type CamMode } from './render/CameraController';
import { buildWorkshop } from './render/Workshop';
import { CarModel } from './render/CarModel';
import { Equipment } from './render/Equipment';
import { Interaction } from './render/Interaction';
import { AudioSystem } from './audio/Audio';
import { UI, type AppApi } from './ui/UI';
import { Modals } from './ui/modals';
import { Tutorial } from './ui/Tutorial';
import { bus, notify, type PickTarget } from './core/events';
import { storage } from './save/Save';
import { BRANDING } from './config/branding';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const game = new Game();
(window as any).game = game; // debugging & automated tests

async function boot() {
  try { const s = await storage.load('autosave'); if (s) game.state = s; } catch (e) { console.warn('autosave unreadable', e); }
  const cam = new CameraController(canvas, window.innerWidth / window.innerHeight);
  const R = new Renderer(canvas, cam.camera, game.state.settings.quality);
  const car = new CarModel(game.state.settings.paint);
  const ws = buildWorkshop(car.M);
  R.scene.add(ws.root);
  R.scene.add(car.root);
  const eq = new Equipment(car.M, car);
  R.scene.add(eq.root);
  const extra: THREE.Object3D[] = [];
  for (const o of [ws.toolChest, ws.computer, ws.jobBoard, ws.trayTable]) o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.userData.pick = o.userData.pick; extra.push(m); } });
  const inter = new Interaction(canvas, game, cam, car, eq, ws.floor, extra);
  const audio = new AudioSystem(game);
  let mouse = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => (mouse = { x: e.clientX, y: e.clientY }));
  let inMenu = true;

  const app: AppApi = {
    game,
    setCam: (m: CamMode) => {
      if (m === 'inspect') return;
      cam.setMode(m);
      if (m === 'under' && !(game.v.support.FL.height > 0.15 || game.v.support.RL.height > 0.15)) notify('The car is on the ground — raise it to get a useful view underneath.', 'info');
    },
    camMode: () => cam.mode,
    focusSlot: (slot) => {
      const o = car.objectFor(slot);
      if (!o) return notify('This component has no 3D model yet.', 'info');
      const box = new THREE.Box3().setFromObject(o);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      cam.focus(sphere.center, Math.max(0.35, sphere.radius * 3.2));
    },
    view: car.view,
    setView: (k, on) => {
      car.view[k] = on;
      car.refreshView();
      if (k === 'exploded' && on) cam.focus(new THREE.Vector3(0.97, 1.3, 0), 3.0);
      if (k === 'cutaway' && on && (game.v.slots['body.bonnet'].vars.open ?? 0) < 0.5) car.view.xray = true;
      if (k === 'exploded' && !on) car.clearHidden();
    },
    toMenu: () => { save(); showMenu(true); },
    quickSave: () => { save(); notify('Saved.', 'good'); },
    hoverPos: () => mouse,
    selected: () => inter.selected,
    select: (t: PickTarget | null) => inter.select(t),
    isolate: (slot) => car.setHidden(slot, !car.isHidden(slot)),
  };
  const ui = new UI(app);
  const modals = new Modals(app, ui.root);
  ui.modals = modals;
  const tutorial = new Tutorial(app, ui.root);

  async function save() {
    try { await storage.save('autosave', game.state, game.jobDef?.title ?? (game.state.mode === 'sandbox' ? 'Free workshop' : 'Workshop')); } catch { notify('Could not save (browser storage unavailable).', 'bad'); }
  }
  function showMenu(show: boolean) {
    inMenu = show;
    modals.showMenu(show);
    ui.setVisible(!show && game.state.mode !== 'menu');
    cam.menuSpin = show;
    inter.enabled = !show;
    if (show) { cam.setMode('orbit'); modals.close(); }
  }
  function enterGame() {
    showMenu(false);
    ui.setVisible(true);
    ui.markDirty();
    inter.select(null);
    cam.setMode('orbit');
  }
  bus.on('ui:open', async ({ panel, arg }) => {
    if (panel === 'startJob') { game.startJob(arg as string); enterGame(); notify(`Work order accepted: ${game.jobDef?.title}`, 'good'); save(); }
    if (panel === 'tutorial') {
      const tier = arg as 1 | 2;
      game.startJob(tier === 1 ? 't1_service' : 't2_knock');
      enterGame();
      tutorial.start(tier);
      save();
    }
    if (panel === 'sandbox') { game.startSandbox(); enterGame(); }
    if (panel === 'continue' || panel === 'load') {
      const s = await storage.load(panel === 'load' ? (arg as string) : 'autosave');
      if (!s) return notify('No save found.', 'warn');
      game.state = s;
      game.jack = { at: null, lift: 0 };
      bus.emit('state:loaded', {});
      if (s.mode === 'menu') { showMenu(true); modals.jobBoard(); } else enterGame();
      car.setPaint(s.settings.paint);
    }
  });
  bus.on('settings:changed', () => { car.setPaint(game.state.settings.paint); audio.setVolume(game.state.settings.volume); ui.markDirty(); });
  bus.on('job:changed', () => { if (!game.state.job && game.state.mode === 'menu') { ui.setVisible(false); } });
  setInterval(() => { if (!inMenu && game.state.mode !== 'menu') save(); }, 60000);
  window.addEventListener('beforeunload', () => { try { localStorage.setItem('cte-workshop:autosave', JSON.stringify(game.state)); } catch { /* ignore */ } });

  showMenu(true);
  document.title = `${BRANDING.fullName} Workshop`;

  let last = performance.now();
  let frames = 0;
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const paused = inMenu || modals.isOpen();
    if (!paused) {
      inter.update(dt);
      game.tick(dt);
    }
    cam.update(dt);
    car.cutSide = cam.camera.position.z >= 0 ? 1 : -1;
    car.sync(game, dt);
    eq.update(game, dt, cam.camera, inter.ghost);
    ui.update(dt);
    if (!paused) tutorial.update(dt);
    tutorial.el.style.visibility = inMenu ? 'hidden' : 'visible';
    audio.update();
    // Outlines: hover (amber) and selection (blue)
    R.outline.selectedObjects = inter.hoverObject && !inMenu ? [inter.hoverObject] : [];
    const sel = inter.selected?.kind === 'slot' ? car.bindings.get(inter.selected.id)?.objs ?? [] : [];
    R.selectOutline.selectedObjects = sel.filter((o) => o.visible);
    R.render();
    frames++;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  (window as any).__app = { car, cam, R, inter, eq, ui, modals, frames: () => frames };
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;color:#f88;background:#111;padding:20px;white-space:pre-wrap;z-index:999">Failed to start: ${String(e?.stack ?? e)}</pre>`);
});
