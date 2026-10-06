/** Optional guided tutorials. Each step advances by itself when the player has actually done the thing. */
import { h, clear } from './dom';
import type { AppApi } from './UI';
import { ENGINE_CONNECTIONS } from '../data/slots';
import { bonnetOpen, connected, endOnStands, endRaised, sumpOil } from '../sim/vehicle';
import { total } from '../data/fluids';

interface Step { title: string; text: string; done?: (a: AppApi) => boolean }

const sel = (a: AppApi, id: string) => a.selected()?.kind === 'slot' && a.selected()!.id === id;

const TIER1: Step[] = [
  { title: 'Welcome to the workshop', text: 'This tutorial walks you through your first oil service. Each step completes itself when you have actually done it. Press Next when you are ready.' },
  { title: 'Moving the camera', text: 'Drag on empty space (or hold the right mouse button) to orbit. Scroll to zoom. Middle-drag or Shift-drag to pan. W A S D also move the view. Have a look around the car, then press Next.' },
  { title: 'Open the doors', text: 'Click the LEFT door of the car, then click "Open door" in the panel on the right. Do the same for the right door. The bonnet releases are in the footwells.', done: (a) => (a.game.v.slots['body.door_L'].vars.open ?? 0) > 0.5 && (a.game.v.slots['body.door_R'].vars.open ?? 0) > 0.5 },
  { title: 'Release the bonnet catches', text: 'Zoom into the left footwell, near the bottom of the door opening, and click the small chrome bonnet release handle. Then click "Pull bonnet release". Repeat on the right. Tip: press L for the parts list, find "Bonnet release handle", and it selects and focuses it for you.', done: (a) => (a.game.v.slots['body.bonnet'].vars.latchL ?? 1) < 0.5 && (a.game.v.slots['body.bonnet'].vars.latchR ?? 1) < 0.5 },
  { title: 'Open the bonnet', text: 'Click the bonnet and choose "Open bonnet". The whole nose hinges forward — the engine bay is now open.', done: (a) => bonnetOpen(a.game.v) },
  { title: 'Check the oil level', text: 'Find the dipstick (yellow loop, left side of the engine) and click it. Choose "Withdraw, wipe, re-insert and read". Every test you do is logged automatically.', done: (a) => a.game.hasMilestone('dipstick') },
  { title: 'Your notebook', text: 'Press N (or the Notebook button) to see the dipstick reading in your test log. Close it with Esc, then press Next.' },
  { title: 'Chock the wheels', text: 'In the tool belt at the bottom, click "Chocks" to chock the rear wheels before lifting the car.', done: (a) => a.game.v.chocks },
  { title: 'Jack up the front', text: 'Select the "Trolley jack". Yellow dots show the jacking points. Click the dot under the FRONT cross-member to place the jack, then press and HOLD on the dot (or hold "▲ Pump jack") until the front is well up.', done: (a) => endRaised(a.game.v, 'front', 0.2) },
  { title: 'Axle stands — safety first', text: 'Select "Axle stands" and click both blue front stand points. Then hold "▼ Lower" so the car settles onto the stands. Never work under a car held only by a jack.', done: (a) => endOnStands(a.game.v, 'front') },
  { title: 'Position the drain pan', text: 'Press U for the underbody view. Select "Drain pan" and click the floor directly under the sump drain plug (the hex plug at the rear of the sump).', done: (a) => a.game.hasMilestone('pan_ok') || (a.game.state.job?.latched.includes('oil_change:pan_drain') ?? false) },
  { title: 'Undo the drain plug', text: 'Select the Ratchet, then pick the 15/16 AF socket from the socket menu. Make sure the direction shows "↺ Undo". Now press and HOLD the mouse on the drain plug — the tool turns it. When it cracks loose, switch to Hand (H) and keep holding to spin it out.', done: (a) => !a.game.v.slots['lub.drain_plug'].part },
  { title: 'Let it drain', text: 'Use "⏱ Wait…" in the top bar to let 10 minutes pass while the oil drains into the pan.', done: (a) => sumpOil(a.game.v) < 0.35 },
  { title: 'You have the basics', text: 'Follow the checklist on the left to finish: new washer and filter (buy at the Parts PC, P), torque everything (buy a torque wrench at Tools, T), lower the car, refill through a funnel, check the dipstick, run the engine and hand the car back. The Manual (M) has every spec. Good luck!' },
];

const TIER2: Step[] = [
  { title: 'Tier II — Fixer Upper', text: 'This tutorial covers the big jobs: getting the engine out, onto a stand, measuring the bottom end and using the machine shop. Press Next.' },
  { title: 'Buy the heavy equipment', text: 'Open Tools (T) and buy the Engine hoist, Engine stand, a Micrometer set and Plastigauge. A breaker bar helps with the main bearing bolts.', done: (a) => ['engine_hoist', 'engine_stand', 'micrometer', 'plastigauge'].every((t) => a.game.owns(t)) },
  { title: 'Open up and make safe', text: 'Open the doors, release the bonnet and open it (as in Tier I). Disconnect the battery NEGATIVE terminal: slacken its pinch bolt with a 7/16 AF spanner, then "Lift clamp off post".', done: (a) => bonnetOpen(a.game.v) && (a.game.v.slots['elec.term_neg'].vars.off ?? 0) > 0.5 },
  { title: 'Drain the fluids', text: 'Drain the engine oil (drain plug) and the coolant: click the radiator and "Open drain tap". The pan holds 12 L — empty it into the waste drum (click the pan) as it fills.', done: (a) => sumpOil(a.game.v) < 0.6 && total(a.game.v.coolant.comp) < 1.0 },
  { title: 'Disconnect the engine', text: 'Press L (Parts list) → Engine → "Engine connections". Each item must be disconnected — some are reached from below, so raise the front onto stands. The cylinder block panel lists whatever is still holding the engine.', done: (a) => ENGINE_CONNECTIONS.every((k) => !connected(a.game.v, k)) },
  { title: 'Undo the engine mountings', text: 'From underneath, slacken the engine mounting bolts (9/16 AF).', done: (a) => a.game.engineBlockers().length === 0 || a.game.v.engineLoc !== 'car' },
  { title: 'Lift it out', text: 'Click the cylinder block and choose "Hoist: lift engine & gearbox out". If anything is still attached the hoist will tell you.', done: (a) => a.game.v.engineLoc !== 'car' },
  { title: 'Onto the stand', text: 'Click the block again → "Mount engine on the engine stand". The engine now sits on the stand by the back wall, and the bottom end can be worked on.', done: (a) => a.game.v.engineLoc === 'stand' },
  { title: 'Strip the bottom end', text: 'Remove the sump bolts and sump, the oil pump, all six big-end nuts, then the main bearing bolts (breaker bar). Lift the crankshaft out — it goes to the parts tray.', done: (a) => !a.game.v.slots['eng.crankshaft'].part },
  { title: 'Measure — don’t guess', text: 'Select the Micrometer. Open the Inventory (I) and measure the crankshaft main journals. Compare against the manual (M → Specifications). Below the service limit means it needs regrinding.', done: (a) => a.game.hasMilestone('measure.main') },
  { title: 'Machine shop', text: 'Open the Parts PC (P) → Machine shop. Regrinding costs money and three days on the clock. A reground crank needs UNDERSIZE shells — buy the matching set.', done: (a) => a.game.hasMilestone('machine_shop') || a.game.hasMilestone('new_crank') },
  { title: 'Rebuild and verify', text: 'Fit matching shells, refit the crank, torque the mains (113 Nm), check the clearance with Plastigauge, then big-ends (50 Nm), pump and sump. Hoist the engine back in, reconnect everything, refill and test. The checklist on the left tracks it all.' },
];

export class Tutorial {
  el = h('div', { id: 'tutorial', class: 'panel', style: 'display:none' });
  private steps: Step[] = [];
  private i = 0;
  private t = 0;

  constructor(private app: AppApi, root: HTMLElement) { root.append(this.el); }

  start(tier: 1 | 2) {
    this.steps = tier === 1 ? TIER1 : TIER2;
    this.i = 0;
    this.el.style.display = 'block';
    this.render();
  }
  stop() { this.el.style.display = 'none'; this.steps = []; }
  get active() { return this.steps.length > 0; }

  update(dt: number) {
    if (!this.active) return;
    this.t += dt;
    if (this.t < 0.3) return;
    this.t = 0;
    const s = this.steps[this.i];
    if (s?.done && s.done(this.app)) { this.next(); }
  }
  private next() {
    if (this.i >= this.steps.length - 1) { this.stop(); return; }
    this.i++;
    this.render();
  }
  private render() {
    const s = this.steps[this.i];
    clear(this.el).append(
      h('div', { style: 'display:flex;align-items:center;gap:8px' }, h('b', { style: 'flex:1;color:var(--accent)' }, `Tutorial ${this.i + 1}/${this.steps.length} — ${s.title}`), h('button', { onclick: () => this.stop() }, 'Skip tutorial')),
      h('p', { style: 'margin:6px 0' }, s.text),
      h('div', { style: 'display:flex;gap:6px;justify-content:flex-end' },
        this.i > 0 ? h('button', { onclick: () => { this.i--; this.render(); } }, 'Back') : null,
        s.done ? h('span', { class: 'dim', style: 'align-self:center' }, 'Waiting for you to do it…') : null,
        h('button', { class: s.done ? '' : 'primary', onclick: () => this.next() }, s.done ? 'Skip step' : this.i === this.steps.length - 1 ? 'Finish' : 'Next')),
    );
  }
}
export { sel };
