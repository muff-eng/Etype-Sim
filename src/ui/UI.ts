/** Workshop HUD: top bar, job card & checklist, component panel, tool belt, work/meter/cockpit HUDs, tooltips, toasts. */
import { h, clear, holdButton, fmtTime } from './dom';
import { bus, type PickTarget } from '../core/events';
import type { Game } from '../game/Game';
import { actionsFor } from '../game/actions';
import { SLOTS } from '../data/slots';
import { PARTS } from '../data/parts';
import { TOOLS, TOOL_LIST } from '../data/tools';
import { PROCEDURES } from '../data/procedures';
import { canReach } from '../sim/access';
import { partIn, specTorque, isReleased } from '../sim/vehicle';
import { conditionLabel, FLAG_LABEL, SYSTEM_LABEL, ASSIST_LABEL, type AssistLevel } from '../sim/types';
import { fmtMoney, BRANDING } from '../config/branding';
import { EDU } from '../data/education';
import { fmt } from '../core/units';
import type { Modals } from './modals';
import type { CamMode } from '../render/CameraController';

export interface AppApi {
  game: Game;
  setCam(m: CamMode): void;
  camMode(): CamMode;
  focusSlot(slot: string): void;
  view: { xray: boolean; cutaway: boolean; exploded: boolean };
  setView(k: 'xray' | 'cutaway' | 'exploded', on: boolean): void;
  toMenu(): void;
  quickSave(): void;
  hoverPos(): { x: number; y: number };
  selected(): PickTarget | null;
  select(t: PickTarget | null): void;
  isolate(slot: string): void;
}

export class UI {
  root: HTMLElement;
  top = h('div', { id: 'topbar' });
  left = h('div', { id: 'left', class: 'panel' });
  right = h('div', { id: 'right', class: 'panel' });
  belt = h('div', { id: 'toolbelt', class: 'panel' });
  work = h('div', { id: 'workhud', class: 'panel' });
  meter = h('div', { id: 'meter', class: 'panel' });
  cockpit = h('div', { id: 'cockpit', class: 'panel' });
  tooltip = h('div', { id: 'tooltip', class: 'panel' });
  toasts = h('div', { id: 'toasts' });
  modals!: Modals;
  private hover: PickTarget | null = null;
  private dirty = { left: true, right: true, belt: true };
  private t = 0;
  showCockpit = false;
  private lastCrank = false;
  private leftCollapsed = false;

  constructor(private app: AppApi) {
    this.root = document.getElementById('ui')!;
    this.root.append(this.top, this.left, this.right, this.belt, this.work, this.meter, this.cockpit, this.tooltip, this.toasts);
    bus.on('notify', ({ text, kind }) => this.toast(text, kind));
    bus.on('hover:changed', ({ target }) => { this.hover = target; this.renderTooltip(); });
    bus.on('selection:changed', () => { this.dirty.right = true; });
    for (const ev of ['vehicle:changed', 'inventory:changed', 'tools:changed', 'job:changed', 'workshop:changed', 'test:recorded'] as const) bus.on(ev, () => { this.dirty.left = true; this.dirty.right = true; this.dirty.belt = true; });
    window.addEventListener('keydown', (e) => this.key(e));
  }

  get g() { return this.app.game; }

  toast(text: string, kind: string = 'info') {
    if (!text) return;
    const el = h('div', { class: `toast ${kind}` }, text);
    this.toasts.prepend(el);
    while (this.toasts.children.length > 5) this.toasts.lastChild!.remove();
    setTimeout(() => el.remove(), 4600);
  }

  setVisible(inGame: boolean) {
    for (const el of [this.top, this.left, this.right, this.belt]) el.style.display = inGame ? '' : 'none';
    if (!inGame) { this.work.style.display = 'none'; this.meter.style.display = 'none'; this.cockpit.style.display = 'none'; }
    this.dirty = { left: true, right: true, belt: true };
  }

  private key(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
    if (this.g.state.mode === 'menu') return;
    const k = e.key.toLowerCase();
    const m = this.modals;
    if (k === 'escape') { if (m.isOpen()) m.close(); else if (this.app.selected()) this.app.select(null); else this.app.toMenu(); return; }
    if (m.isOpen()) return;
    const map: Record<string, () => void> = {
      r: () => this.g.toggleDir(), h: () => this.g.selectTool(null), m: () => m.manual(), n: () => m.notebook(), i: () => m.inventory(), t: () => m.toolbox(),
      p: () => m.parts(), j: () => m.jobBoard(), l: () => m.components(), v: () => m.status(),
      x: () => this.app.setView('xray', !this.app.view.xray), c: () => this.app.setView('cutaway', !this.app.view.cutaway), b: () => this.app.setView('exploded', !this.app.view.exploded),
      o: () => this.app.setCam('orbit'), g: () => this.app.setCam(this.app.camMode() === 'free' ? 'orbit' : 'free'), u: () => this.app.setCam(this.app.camMode() === 'under' ? 'orbit' : 'under'),
      k: () => { const on = this.app.camMode() !== 'cockpit'; this.app.setCam(on ? 'cockpit' : 'orbit'); this.showCockpit = on; },
      f: () => { const s = this.app.selected(); if (s?.kind === 'slot') this.app.focusSlot(s.id); },
      ' ': () => { this.showCockpit = !this.showCockpit; },
    };
    if (map[k]) { e.preventDefault(); map[k](); }
  }

  /** Called every frame. Heavier panels rebuild only when dirty. */
  update(dt: number) {
    if (this.g.state.mode === 'menu') return;
    this.t += dt;
    if (this.t > 0.2) { this.t = 0; this.renderTop(); this.renderHuds(); if (this.hover) this.renderTooltip(); }
    if (this.dirty.left) { this.dirty.left = false; this.renderLeft(); }
    if (this.dirty.right) { this.dirty.right = false; this.renderRight(); }
    if (this.dirty.belt) { this.dirty.belt = false; this.renderBelt(); }
    if (this.g.work.slot) this.renderWork();
    else this.work.style.display = 'none';
    const p = this.app.hoverPos();
    this.tooltip.style.left = `${p.x + 16}px`; this.tooltip.style.top = `${p.y + 14}px`;
    // Live meter while probes are attached; log the reading when cranking begins
    const g = this.g;
    if (g.meter.red && g.meter.black) {
      const cranking = !!g.sim?.elec.solenoidEngaged;
      g.readMeter(cranking && !this.lastCrank);
      this.lastCrank = cranking;
    }
  }

  // ───────── Top bar ─────────
  private topBuilt = false;
  private stats: Record<string, HTMLElement> = {};
  private renderTop() {
    const g = this.g;
    if (!this.topBuilt) {
      this.topBuilt = true;
      const st = (k: string, title: string) => (this.stats[k] = h('span', { class: 'stat', title }));
      const btn = (label: string, key: string, fn: () => void, title = '') => h('button', { onclick: fn, title }, label, key ? h('span', { class: 'k' }, key) : null);
      const waitSel = h('select', { title: 'Let time pass (oil draining, charging, cooling)', onchange: (e: Event) => { const v = +(e.target as HTMLSelectElement).value; if (v) g.wait(v); (e.target as HTMLSelectElement).value = '0'; } },
        h('option', { value: '0' }, '⏱ Wait…'), ...[2, 5, 10, 30, 60, 120, 240].map((m) => h('option', { value: String(m) }, `${m} min`)));
      const camBtns = h('span', { class: 'grp' },
        btn('Orbit', 'O', () => this.app.setCam('orbit')), btn('Fly', 'G', () => this.app.setCam('free')), btn('Under', 'U', () => this.app.setCam('under')), btn('Cockpit', 'K', () => { this.app.setCam('cockpit'); this.showCockpit = true; }));
      const viewBtns = h('span', { class: 'grp' },
        (this.stats.xray = btn('X-ray', 'X', () => this.app.setView('xray', !this.app.view.xray))),
        (this.stats.cut = btn('Cutaway', 'C', () => this.app.setView('cutaway', !this.app.view.cutaway))),
        (this.stats.exp = btn('Exploded', 'B', () => this.app.setView('exploded', !this.app.view.exploded))));
      this.top.append(
        h('span', { class: 'brand' }, BRANDING.gameTitle.replace(' WORKSHOP', '')),
        st('job', 'Current work order'), st('clock', 'Workshop clock'), st('money', 'Balance'), st('rep', 'Reputation'),
        h('span', { class: 'grow' }),
        camBtns, viewBtns, waitSel,
        h('span', { class: 'grp' }, btn('Jobs', 'J', () => this.modals.jobBoard()), btn('Manual', 'M', () => this.modals.manual()), btn('Notebook', 'N', () => this.modals.notebook()), btn('Parts list', 'L', () => this.modals.components()),
          btn('Inventory', 'I', () => this.modals.inventory()), btn('Tools', 'T', () => this.modals.toolbox()), btn('Parts PC', 'P', () => this.modals.parts()), btn('Status', 'V', () => this.modals.status())),
        btn('💾', '', () => this.app.quickSave(), 'Quick save'), btn('⚙', '', () => this.modals.settings(), 'Settings'), btn('Menu', 'Esc', () => this.app.toMenu()),
      );
    }
    this.stats.job.textContent = g.jobDef ? g.jobDef.title : g.state.mode === 'sandbox' ? 'Free workshop' : '—';
    this.stats.clock.textContent = fmtTime(g.state.time);
    this.stats.money.textContent = fmtMoney(g.state.money);
    this.stats.rep.textContent = `Rep ${Math.round(g.state.progress.rep)}`;
    this.stats.xray.classList.toggle('on', this.app.view.xray);
    this.stats.cut.classList.toggle('on', this.app.view.cutaway);
    this.stats.exp.classList.toggle('on', this.app.view.exploded);
  }

  // ───────── Left: job card & procedure checklist ─────────
  private renderLeft() {
    const g = this.g;
    clear(this.left);
    const jd = g.jobDef, j = g.state.job;
    const head = h('div', { style: 'display:flex;align-items:center;gap:6px' }, h('h3', { style: 'flex:1;margin:0' }, jd ? 'Work order' : 'Free workshop'), h('button', { onclick: () => { this.leftCollapsed = !this.leftCollapsed; this.dirty.left = true; } }, this.leftCollapsed ? '▸' : '▾'));
    this.left.append(head);
    if (this.leftCollapsed) return;
    if (!jd || !j) {
      this.left.append(h('p', { class: 'dim' }, 'No customer, no clock. Take anything apart, test, measure and experiment. All Phase 1–2 tools are unlocked.'),
        h('button', { onclick: () => this.modals.jobBoard() }, 'Open job board'));
      return;
    }
    this.left.append(
      h('div', null, h('b', null, jd.title), ' — ', h('span', { class: 'dim' }, jd.customer)),
      h('div', { class: 'complaint' }, jd.complaint),
      h('div', { class: 'dim' }, `Odometer ${jd.mileage.toLocaleString()} mi · Book time ${jd.bookHours} h`),
      h('ul', null, ...jd.requests.map((r) => h('li', null, r))),
    );
    if (jd.requireDiagnosis) this.left.append(h('div', { style: 'margin:6px 0' }, 'Diagnosis: ', j.diagnosis ? h('b', null, '✎ recorded') : h('span', { class: 'warn' }, 'not yet recorded'), ' ', h('button', { onclick: () => this.modals.notebook() }, 'Notebook')));
    this.left.append(h('div', { style: 'display:flex;gap:6px;margin:6px 0 10px' }, h('button', { class: 'primary', onclick: () => this.modals.handOver() }, 'Hand vehicle back…'), h('button', { onclick: () => this.modals.status() }, 'Assembly check')));
    const a = g.assist;
    if (a === 'expert' || a === 'master') {
      this.left.append(h('div', { class: 'dim' }, 'Procedure guidance is off at this assistance level. Consult the workshop manual (M).'));
      return;
    }
    for (const pid of jd.procedures) {
      const pr = PROCEDURES[pid];
      this.left.append(h('h3', { style: 'margin-top:8px' }, pr.title));
      let nextMarked = false;
      for (const s of pr.steps) {
        const done = j.latched.includes(`${pid}:${s.id}`);
        const isNext = !done && !nextMarked && !s.optional;
        if (isNext) nextMarked = true;
        this.left.append(h('div', { class: `step ${done ? 'done' : ''} ${isNext ? 'next' : ''}` }, h('span', { class: 'tick' }, done ? '✓' : isNext ? '▸' : '○'),
          h('span', null, s.text, s.optional ? h('span', { class: 'dim' }, ' (optional)') : null, a === 'beginner' && s.why ? h('span', { class: 'why' }, s.why) : null)));
      }
    }
  }

  // ───────── Right: selected component ─────────
  private renderRight() {
    clear(this.right);
    const sel = this.app.selected();
    if (!sel || sel.kind !== 'slot') { this.right.style.display = 'none'; return; }
    this.right.style.display = '';
    const g = this.g, v = g.v, a = g.assist;
    const d = SLOTS[sel.id];
    const s = v.slots[sel.id];
    const p = partIn(v, sel.id);
    const pd = p ? PARTS[p.def] : null;
    const known = !!p?.known.inspected;
    const showCond = a === 'beginner' || (a === 'experienced' && known);
    const reach = canReach(v, sel.id);
    let status = p ? 'Installed' : 'Empty — part removed';
    if (p && d.thread) {
      const turns = d.thread.turns;
      if (d.thread.captive) status = isReleased(v, sel.id) ? 'Slackened' : s.turnsIn >= turns - 0.05 ? (s.torque > 0 ? 'Tight' : 'Snug') : 'Partly slackened';
      else status = s.turnsIn >= turns - 0.05 ? (s.torque > 0.05 ? 'Tightened' : 'Seated, not torqued') : s.turnsIn > 0 ? `Threaded ${fmt(s.turnsIn, 1)}/${turns} turns` : 'Loose in hole';
      if (s.threadDamage >= 1) status += ' — THREAD STRIPPED';
      if (s.crossThreaded) status += ' — cross-threaded';
    }
    if (d.connector && p) status = (s.vars.off ?? 0) > 0.5 ? 'Disconnected' : 'Connected';
    const kv: (string | Node)[] = [];
    const row = (k: string, val: string | Node) => kv.push(h('div', null, k), h('div', null, val));
    if (pd) row('Part', `${pd.name}`);
    if (pd) row('Part no.', pd.partNo);
    row('System', SYSTEM_LABEL[d.system]);
    row('Status', status);
    if (p) row('Condition', showCond ? conditionLabel(p.condition, p.flags) : known ? 'See inspection notes' : 'Unknown — inspect it');
    if (p && (known || a === 'beginner') && p.flags.length) row('Notes', h('span', null, ...p.flags.map((f) => h('span', { class: 'tag' }, FLAG_LABEL[f]))));
    if (d.thread) {
      const spec = specTorque(sel.id);
      if (a === 'beginner' || a === 'experienced') row('Fastener', `${d.thread.size}${d.thread.driveSize ? `, ${d.thread.driveSize} hex` : d.thread.drive === 'slot' ? ', slotted' : d.thread.drive === 'spinner' ? ', eared spinner' : ''}${d.thread.leftHand ? ', LEFT-HAND thread' : ''}`);
      if (a === 'beginner' && spec) row('Torque spec', d.thread.drive === 'spinner' ? 'Mallet-tight on the ground' : d.thread.handTight ? 'Hand tight' : `${spec} Nm`);
      if (a === 'beginner') row('Suggested tool', suggestTool(d.thread));
    }
    if (d.heldBy?.length && a !== 'master') row('Held by', d.heldBy.map((x) => SLOTS[x].name).join(', '));
    if (!reach.ok) row('Access', h('span', { class: 'warn' }, reach.reasons.join('; ')));
    if (reach.unsafe) row('Safety', h('span', { class: 'bad' }, reach.unsafe));
    this.right.append(
      h('div', { style: 'display:flex;gap:6px;align-items:center' }, h('h3', { style: 'flex:1;margin:0' }, a === 'master' && !known ? 'Component' : d.name), h('button', { title: 'Focus camera (F)', onclick: () => this.app.focusSlot(sel.id) }, '◎'), h('button', { onclick: () => this.app.select(null) }, '✕')),
      h('div', { class: 'kv' }, ...kv),
    );
    if (d.hint && a === 'beginner') this.right.append(h('div', { class: 'dim', style: 'margin:4px 0' }, `💡 ${d.hint}`));
    const acts = h('div', { class: 'actions' });
    for (const act of actionsFor(g, sel.id)) {
      const btn = act.hold ? holdButton(act.label, act.hold.down, act.hold.up, act.kind ?? '', !act.enabled) : h('button', { class: act.kind ?? '', disabled: !act.enabled, onclick: () => { act.run?.(); this.dirty.right = true; } }, act.label);
      acts.append(btn);
      if (!act.enabled && act.reason && act.kind !== 'info') acts.append(h('div', { class: 'reason' }, act.reason));
    }
    if (this.app.view.exploded) acts.append(h('button', { onclick: () => this.app.isolate(sel.id) }, 'Hide / show this component'));
    this.right.append(acts);
    const eduKey = d.edu ?? pd?.edu;
    if (g.state.settings.edu && eduKey && EDU[eduKey]) this.right.append(h('div', { class: 'dim', style: 'margin-top:8px;font-size:12px' }, EDU[eduKey].purpose));
  }

  // ───────── Tool belt ─────────
  private renderBelt() {
    const g = this.g;
    clear(this.belt);
    const owned = new Set(g.state.tools);
    const T = (id: string, label?: string) => owned.has(id) ? h('button', { class: g.grip.primary === id ? 'on' : '', title: TOOLS[id].desc, onclick: () => g.selectTool(id) }, label ?? TOOLS[id].name.split('(')[0].trim()) : null;
    const grip = g.held ? `Holding: ${PARTS[g.state.inventory[g.held]?.def]?.name ?? '—'} (${fmt(g.state.inventory[g.held]?.vars.volume ?? 0, 2)} L)` : (() => {
      if (!g.grip.primary) return 'Bare hands';
      const t = TOOLS[g.grip.primary];
      if (['ratchet', 'breaker_bar', 'torque_wrench'].includes(t.kind)) return `${t.name}${g.grip.extension ? ' + extension' : ''} + ${g.grip.socket ? TOOLS[g.grip.socket].size + (TOOLS[g.grip.socket].kind === 'plug_socket' ? ' plug socket' : ' socket') : 'NO SOCKET'}`;
      return t.name;
    })();
    const drives = ['ratchet', 'breaker_bar', 'torque_wrench'].includes(g.toolKind() ?? '');
    const socketSel = h('select', { title: 'Socket', onchange: (e: Event) => g.selectTool((e.target as HTMLSelectElement).value) },
      h('option', { value: '' }, 'Socket…'),
      ...TOOL_LIST.filter((t) => (t.kind === 'socket' || t.kind === 'plug_socket') && owned.has(t.id)).map((t) => h('option', { value: t.id, selected: g.grip.socket === t.id }, t.kind === 'plug_socket' ? `${t.size} plug` : t.size!)));
    const spannerSel = h('select', { title: 'Spanner', onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) g.selectTool(v); } },
      h('option', { value: '' }, 'Spanner…'),
      ...TOOL_LIST.filter((t) => (t.kind === 'spanner' || t.kind === 'adjustable') && owned.has(t.id)).map((t) => h('option', { value: t.id, selected: g.grip.primary === t.id }, t.size ?? 'Adjustable')));
    const tw = g.toolKind() === 'torque_wrench';
    const twInput = h('input', { type: 'number', min: '5', max: '110', step: '1', value: String(g.torqueSetting), style: 'width:56px', onchange: (e: Event) => { g.torqueSetting = Math.max(5, Math.min(110, +(e.target as HTMLInputElement).value || 5)); } });
    this.belt.append(
      h('div', { class: 'row' },
        h('span', { class: 'grip' }, '✋ ', grip),
        h('button', { class: g.dir === 'undo' ? 'on' : '', onclick: () => g.toggleDir(), title: 'Direction (R)' }, g.dir === 'undo' ? '↺ Undo / slacken' : '↻ Tighten', h('span', { class: 'k' }, 'R')),
        drives ? socketSel : null,
        drives && owned.has('extension_150') ? h('button', { class: g.grip.extension ? 'on' : '', onclick: () => g.selectTool('extension_150') }, 'Extension') : null,
        tw ? h('span', null, 'Set ', twInput, ' Nm', g.state.workshop.wrenchError > 1.02 ? h('span', { class: 'warn' }, ' (calibration suspect)') : null) : null,
        g.held ? h('button', { onclick: () => g.hold(null) }, 'Put down') : null,
      ),
      h('div', { class: 'row' },
        h('button', { class: !g.grip.primary && !g.held ? 'on' : '', onclick: () => g.selectTool(null) }, 'Hand', h('span', { class: 'k' }, 'H')),
        T('ratchet_38', 'Ratchet'), T('breaker_bar', 'Breaker bar'), T('torque_wrench', 'Torque wrench'), spannerSel, T('adjustable', 'Adjustable'),
        T('screwdriver_flat', 'Flat screwdriver'), T('copper_mallet', 'Mallet'), T('hammer', 'Hammer'), T('pick', 'Pick'), T('insulated_pliers', 'HT pliers'), T('fuse_puller', 'Fuse puller'),
        T('wire_brush', 'Wire brush'), T('rag', 'Rag'),
      ),
      h('div', { class: 'row' },
        T('multimeter', 'Multimeter'), T('test_light', 'Test lamp'), T('feeler_gauge', 'Feelers'), T('gap_tool', 'Gap tool'), T('ruler', 'Rule'), T('vernier', 'Vernier'),
        T('tyre_gauge', 'Tyre gauge'), T('tread_gauge', 'Tread gauge'), T('hydrometer', 'Hydrometer'), T('battery_tester', 'Load tester'),
        T('floor_jack', 'Trolley jack'), T('jack_stands', 'Axle stands'), T('drain_pan', 'Drain pan'),
        owned.has('chocks') ? h('button', { class: g.v.chocks ? 'on' : '', onclick: () => g.toggleChocks() }, 'Chocks') : null,
        g.jack.at ? h('span', null, holdButton('▲ Pump jack', () => (this.jackDir = 1), () => (this.jackDir = 0)), holdButton('▼ Lower', () => (this.jackDir = -1), () => (this.jackDir = 0)), h('button', { onclick: () => g.removeJack() }, 'Remove jack')) : null,
      ),
    );
  }
  jackDir: 1 | -1 | 0 = 0;

  // ───────── HUDs ─────────
  private renderWork() {
    const g = this.g, w = g.work;
    if (!w.slot) return;
    const d = SLOTS[w.slot], s = g.v.slots[w.slot];
    const th = d.thread!;
    const a = g.assist;
    const spec = specTorque(w.slot);
    const showNm = a === 'beginner' || (w.dc?.torqueWrench && a === 'experienced');
    const maxBar = Math.max(spec * 1.6, 10);
    const tq = g.dir === 'undo' && s.torque > 0 ? w.pull.applied : s.torque;
    this.work.style.display = 'block';
    clear(this.work).append(
      h('div', null, h('b', null, d.name), h('span', { class: 'dim' }, ` — ${w.dc?.label}`)),
      h('div', { class: 'dim', style: 'font-size:11px' }, `Thread engagement ${fmt(s.turnsIn, 1)} / ${th.turns} turns`),
      h('div', { class: 'bar' }, h('div', { style: `width:${(s.turnsIn / th.turns) * 100}%;background:var(--accent2)` })),
      h('div', { class: 'dim', style: 'font-size:11px' }, g.dir === 'undo' && s.torque > 0 ? 'Effort' : 'Tightness', showNm ? ` — ${fmt(tq, 0)} Nm${spec && g.dir === 'do' ? ` (spec ${spec})` : ''}` : ''),
      h('div', { class: 'bar' }, h('div', { style: `width:${Math.min(100, (tq / maxBar) * 100)}%;background:${tq > spec * 1.15 && g.dir === 'do' ? 'var(--bad)' : 'var(--accent)'}` }), showNm && spec && g.dir === 'do' ? h('div', { class: 'mark', style: `left:${(spec / maxBar) * 100}%` }) : null,
        w.dc?.torqueWrench ? h('div', { class: 'mark', style: `left:${(g.torqueSetting / maxBar) * 100}%;background:var(--accent2)` }) : null),
      h('div', { style: 'min-height:16px' }, w.pull.clicked ? h('b', { class: 'good' }, 'CLICK — release!') : w.msg),
    );
  }

  private renderHuds() {
    const g = this.g;
    const kind = g.toolKind();
    // Multimeter / test lamp
    if (kind === 'multimeter' || kind === 'test_light') {
      this.meter.style.display = 'block';
      const m = g.meter;
      clear(this.meter);
      if (kind === 'multimeter') {
        this.meter.append(h('h3', null, 'Multimeter'), h('div', { class: 'lcd' }, m.reading),
          h('div', { style: 'display:flex;gap:4px;margin:6px 0' }, ...(['V', 'R', 'C'] as const).map((md) => h('button', { class: m.mode === md ? 'on' : '', onclick: () => { m.mode = md; m.reading = '—'; if (m.red && m.black) g.readMeter(true); } }, md === 'V' ? 'DC V' : md === 'R' ? 'Ω' : 'Cont. ♪'))),
          h('div', { style: 'font-size:12px' }, h('span', { class: 'bad' }, '● Red: '), m.red ?? 'click a test point'), h('div', { style: 'font-size:12px' }, '● Black: ', m.black ?? (m.red ? 'click the second point' : '—')),
          h('div', { style: 'display:flex;gap:4px;margin-top:6px' }, h('button', { onclick: () => g.readMeter(true), disabled: !(m.red && m.black) }, 'Log reading'), h('button', { onclick: () => g.clearProbes() }, 'Remove probes')),
          h('div', { class: 'dim', style: 'font-size:11px;margin-top:4px' }, 'Red test points appear on the battery, starter, coil, alternator and (with the centre panel lowered) the fuse block.'));
      } else {
        this.meter.append(h('h3', null, 'Test lamp'), h('div', null, h('span', { class: `lamp ${m.lamp > 0.15 ? 'on amber' : ''}` }), m.lamp > 0.6 ? 'Bright' : m.lamp > 0.15 ? 'Dim' : 'Dark'), h('div', { class: 'dim', style: 'font-size:11px' }, 'Croc clip on body earth. Click a test point to probe.'));
      }
    } else this.meter.style.display = 'none';
    // Cockpit
    const cock = this.showCockpit || this.app.camMode() === 'cockpit';
    this.cockpit.style.display = cock ? 'block' : 'none';
    if (cock) this.renderCockpit();
    if (this.jackDir) g.pumpJack(this.jackDir, 0.2);
  }

  private cockBuilt = false;
  private cockEls: Record<string, HTMLElement> = {};
  private renderCockpit() {
    const g = this.g, v = g.v, e = v.engine;
    if (!this.cockBuilt) {
      this.cockBuilt = true;
      const gauge = (k: string, label: string) => (this.cockEls[k] = h('div', { class: 'g' }, h('b', null, '0'), h('span', null, label)));
      const thr = h('input', { type: 'range', min: '0', max: '100', value: '0', style: 'width:100%', oninput: (ev: Event) => g.setThrottle(+(ev.target as HTMLInputElement).value / 100) }) as HTMLInputElement;
      this.cockEls.thr = thr;
      this.cockpit.append(
        h('div', { style: 'display:flex;align-items:center' }, h('h3', { style: 'flex:1;margin:0' }, 'Driver controls'), h('button', { onclick: () => { this.showCockpit = false; if (this.app.camMode() === 'cockpit') this.app.setCam('orbit'); } }, '✕')),
        h('div', { class: 'gauges' }, gauge('rpm', 'RPM'), gauge('oil', 'OIL psi'), gauge('temp', 'WATER °C'), gauge('amps', 'AMPS'), gauge('fuel', 'FUEL'), gauge('volt', 'BATT V*')),
        (this.cockEls.lamps = h('div', { style: 'margin-bottom:6px' })),
        h('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' },
          (this.cockEls.ign = h('button', { onclick: () => g.toggle('int.ignition') }, 'Ignition')),
          holdButton('Starter (hold)', () => g.setStarter(true), () => g.setStarter(false), 'primary'),
          (this.cockEls.choke = h('button', { onclick: () => g.toggle('int.choke') }, 'Choke')),
          holdButton('Horn', () => g.horn(true), () => g.horn(false)),
          (this.cockEls.hb = h('button', { onclick: () => g.toggle('int.handbrake') }, 'Handbrake')),
        ),
        h('div', { style: 'margin-top:6px' }, 'Throttle', thr, h('div', { style: 'display:flex;gap:4px' }, h('button', { onclick: () => { thr.value = '0'; g.setThrottle(0); } }, 'Idle'), h('button', { onclick: () => { thr.value = '28'; g.setThrottle(0.28); } }, '≈ 2000 rpm'), h('button', { onclick: () => { thr.value = '50'; g.setThrottle(0.5); } }, '≈ 3000 rpm'))),
        h('div', { class: 'dim', style: 'font-size:10px;margin-top:4px' }, '*BATT V is not on the original dash — shown only at Beginner assistance.'),
      );
    }
    const set = (k: string, val: string) => { (this.cockEls[k].firstChild as HTMLElement).textContent = val; };
    const ign = (v.slots['int.ignition'].vars.on ?? 0) > 0.5;
    set('rpm', String(Math.round(e.rpm / 10) * 10));
    set('oil', ign ? fmt(e.oilPressure, 0) : '0');
    set('temp', ign ? fmt(e.coolantC, 0) : '—');
    set('amps', ign && g.sim ? fmt(-g.sim.elec.battI, 0) : '0');
    set('fuel', ign ? `${Math.round(v.fuelL / 63.6 * 100)}%` : '—');
    set('volt', g.assist === 'beginner' && g.sim ? fmt(g.sim.elec.V['B+'] - g.sim.elec.V['B-'], 1) : '—');
    this.cockEls.ign.classList.toggle('on', ign);
    this.cockEls.choke.classList.toggle('on', (v.slots['int.choke'].vars.on ?? 0) > 0.5);
    this.cockEls.hb.classList.toggle('on', (v.slots['int.handbrake'].vars.on ?? 0) > 0.5);
    const charging = (g.sim?.elec.battI ?? 0) < -0.5;
    clear(this.cockEls.lamps).append(
      h('span', { class: `lamp ${ign && !charging ? 'on red' : ''}` }), 'IGN ', h('span', { class: `lamp ${ign && e.oilPressure < 7 ? 'on amber' : ''}` }), 'OIL ',
      h('span', { class: `lamp ${ign && v.fuelL < 8 ? 'on amber' : ''}` }), 'FUEL ', h('span', { class: `lamp ${(v.slots['int.choke'].vars.on ?? 0) > 0.5 && ign ? 'on green' : ''}` }), 'CHOKE');
  }

  private renderTooltip() {
    const t = this.hover;
    if (!t || this.g.state.mode === 'menu') { this.tooltip.style.display = 'none'; return; }
    const g = this.g, a = g.assist;
    let html: (string | Node)[] = [];
    if (t.kind === 'slot') {
      const d = SLOTS[t.id];
      const p = partIn(g.v, t.id);
      const known = !!p?.known.inspected;
      const name = a === 'master' && !known ? 'Component' : d.name;
      html = [h('b', null, name)];
      if (p && (a === 'beginner' || (a === 'experienced' && known))) html.push(h('div', { class: 'dim' }, conditionLabel(p.condition, p.flags)));
      const r = canReach(g.v, t.id);
      if (!r.ok) html.push(h('div', { class: 'warn' }, r.reasons[0]));
      if (d.thread && p && r.ok) {
        const dc = g.driveFor(t.id);
        html.push(h('div', { class: dc.ok ? 'good' : 'dim' }, dc.ok ? `Hold mouse to ${g.dir === 'undo' ? 'undo' : 'tighten'} (${dc.label})` : (a === 'beginner' ? dc.reason ?? '' : 'Click to select')));
      } else html.push(h('div', { class: 'dim' }, 'Click to select'));
    } else if (t.kind === 'hotspot') {
      const [type, id] = t.id.split(':');
      html = [h('b', null, type === 'jack' ? `Jacking point ${id === 'F' ? '(front cross-member)' : id}` : type === 'stand' ? `Axle stand point ${id}` : `Test point: ${id}`),
        h('div', { class: 'dim' }, type === 'jack' ? (g.jack.at === id ? 'Hold to pump (Shift+hold to lower)' : 'Click to position the jack') : type === 'stand' ? 'Click to place a stand' : 'Click to touch probe')];
    } else if (t.kind === 'equipment') {
      const names: Record<string, string> = { toolchest: 'Tool chest — buy & browse tools', computer: 'Parts computer — order parts', jobboard: 'Job board', pan: 'Drain pan', tray: 'Parts tray' };
      html = [h('b', null, names[t.id] ?? (t.id.startsWith('stand:') ? 'Axle stand — click to remove' : t.id))];
    } else if (t.kind === 'tray') {
      const p = g.state.inventory[t.id];
      html = [h('b', null, p ? PARTS[p.def].name : 'Part'), h('div', { class: 'dim' }, 'On the parts tray — click to open inventory')];
    }
    clear(this.tooltip).append(...html);
    this.tooltip.style.display = 'block';
  }

  markDirty() { this.dirty = { left: true, right: true, belt: true }; }
  assistLabel(a: AssistLevel) { return ASSIST_LABEL[a]; }
}

function suggestTool(th: NonNullable<(typeof SLOTS)[string]['thread']>) {
  if (th.drive === 'hand' || th.handTight) return 'By hand';
  if (th.drive === 'slot') return 'Flat-blade screwdriver';
  if (th.drive === 'spinner') return 'Copper/hide mallet';
  return `${th.driveSize} ${th.needsExtension ? 'plug socket + extension' : 'socket or spanner'}; torque wrench to finish`;
}
