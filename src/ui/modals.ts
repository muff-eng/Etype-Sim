/** Modal windows: main menu, job board, manual, notebook, inventory, tools, parts computer, status, settings, reports. */
import { h, clear, holdButton, fmtTime } from './dom';
import { bus } from '../core/events';
import type { Game, JobReport } from '../game/Game';
import type { AppApi } from './UI';
import { BRANDING, fmtMoney } from '../config/branding';
import { SPEC, TORQUE, MAINTENANCE, type SpecValue } from '../data/spec';
import { CIRCUITS, FLUIDS, total, compatibility, antifreeze, type FluidId } from '../data/fluids';
import { PROCEDURES } from '../data/procedures';
import { FUSE_CIRCUITS } from '../sim/electrical';
import { JOBS, JOB_BY_ID, LABOUR_RATE } from '../data/jobs';
import { DIAGNOSES, FAULTS } from '../data/faults';
import { PARTS } from '../data/parts';
import { SLOTS, SLOT_LIST, torqueSpecNm } from '../data/slots';
import { TOOL_LIST, TOOLS, type ToolCategory } from '../data/tools';
import { EDU } from '../data/education';
import { conditionLabel, FLAG_LABEL, SYSTEM_LABEL, ASSIST_LABEL, CORNERS, type AssistLevel, type SystemId } from '../sim/types';
import { assemblyCheck, analyzeVehicle } from '../sim/diagnostics';
import { canFit } from '../sim/access';
import { OIL_MAX, OIL_MIN, sumpOil, COOLANT_FULL, partIn, onGround } from '../sim/vehicle';
import { fmt } from '../core/units';
import { storage } from '../save/Save';

const PAINTS: [string, string][] = [
  ['Opalescent Dark Green', '#1d3a2c'], ['British Racing Green', '#12301f'], ['Carmen Red', '#7e0f12'], ['Signal Red', '#a8161a'],
  ['Old English White', '#e3dcc7'], ['Opalescent Silver Grey', '#9aa0a3'], ['Opalescent Gunmetal', '#3a3f44'], ['Primrose Yellow', '#e3cd76'], ['Black', '#0d0d0e'], ['Opalescent Dark Blue', '#18233f'],
];

const DIAG_GUIDES: { title: string; steps: string[] }[] = [
  { title: 'Engine cranks slowly or only clicks', steps: ['Measure battery voltage at the POSTS, engine off: 12.6 V full · 12.4 V ≈ 75 % · 12.2 V ≈ 50 %.', 'Measure at the posts while cranking: should stay above ≈ 9.6 V.', 'Voltage-drop test while cranking: post → clamp (each terminal), body → engine block. More than ≈ 0.2–0.3 V across any single joint = high resistance.', 'Inspect and clean clamps/posts; check the earth strap.', 'Charge the battery; load-test it. Replace only if it fails a load test when fully charged.'] },
  { title: 'Cranks normally but will not start', steps: ['Fuel: with ignition ON the pump should tick then slow as the float chambers fill.', 'Coil supply: voltage at the coil SW terminal while cranking (> 8 V).', 'Distributor cap & rotor present and undamaged.', 'Plugs: condition and gaps; HT leads in firing order 1-5-3-6-2-4 (No.1 at the rear).', 'Cold engine: choke ON. Hot engine: choke OFF (flooding).'] },
  { title: 'Rough idle / misfire', steps: ['Warm the engine. With INSULATED pliers pull one HT lead at a time: a healthy cylinder makes the rpm drop; no change = that cylinder was already dead.', 'Remove and read the dead cylinder’s plug (sooty / oily / worn).', 'Check lead routing against the firing order.', 'Compression test if the plug looks oily or the problem persists.'] },
  { title: 'Overheating', steps: ['Only with the engine COLD: check the header-tank level.', 'Look for crusty residue at hoses, clips, radiator seams and water-pump weep hole. Pressure-test the cold system.', 'Watch the electric fan cut in at ≈ 88 °C.', 'Check fan-belt tension (it also drives the water pump).', 'Thermostat and radiator flow next.'] },
  { title: 'Battery keeps going flat', steps: ['Charging voltage at the battery posts at ≈ 2000 rpm: 14.0–14.4 V.', 'If low: belt deflection (10–13 mm) and condition (glazing).', 'Then alternator output and regulator.', 'Parasitic drain test with ignition off (Phase 4).'] },
  { title: 'An electrical item is dead', steps: ['Confirm the symptom and which circuit it is on (wiring diagram).', 'Lower the centre panel. Test lamp to earth: live on the supply side but dead on the load side = open fuse.', 'Replace with the SAME rating. If it blows again, look for a short circuit.'] },
  { title: 'Car pulls to one side', steps: ['Tyre pressures COLD, all four (32 psi).', 'Inspect the low tyre all the way round — raise the wheel to rotate it.', 'Feel for a dragging brake after a short drive.', 'Alignment checks (Phase 4).'] },
];

const HINTS: Record<string, string> = {
  batt_terminal: 'Foreman: "Your numbers say the battery isn’t the whole story. Put the meter across each connection — post to clamp — while someone cranks it. Every tenth of a volt there is lost to the starter."',
  plug_fouled: 'Foreman: "Five cylinders working and one passenger. Pull the leads one at a time with the insulated pliers — the one that changes nothing is your culprit. Then read its plug."',
  hose_clip: 'Foreman: "Lost coolant has to go somewhere. Look for that crusty blue-white tide-mark — clips back off over time. Pressure-test it cold if you’ve got the kit."',
  slack_belt: 'Foreman: "Fourteen volts at 2000 rpm or there’s a problem upstream of the battery. What turns the alternator?"',
  horn_fuse: 'Foreman: "Before you pull the horns apart — is there power getting to them? Start at the fuse block."',
  puncture_fl: 'Foreman: "A car that pulls usually has a soft tyre. Gauge all four cold — then look hard at the low one."',
};

export class Modals {
  wrap = h('div', { class: 'modal-wrap', style: 'display:none' });
  menuEl = h('div', { id: 'menu', style: 'display:none' });
  private current: { name: string; render: () => void } | null = null;

  constructor(private app: AppApi, root: HTMLElement) {
    root.append(this.wrap, this.menuEl);
    this.wrap.addEventListener('pointerdown', (e) => { if (e.target === this.wrap) this.close(); });
    for (const ev of ['inventory:changed', 'tools:changed', 'money:changed', 'test:recorded', 'job:changed'] as const) bus.on(ev, () => {
      if (this.current && ['inventory', 'toolbox', 'parts', 'notebook', 'jobBoard', 'pan'].includes(this.current.name)) this.current.render();
    });
    bus.on('ui:open', ({ panel, arg }) => this.openPanel(panel, arg));
  }

  get g(): Game { return this.app.game; }
  isOpen() { return this.wrap.style.display !== 'none'; }
  close() { this.wrap.style.display = 'none'; clear(this.wrap); this.current = null; }

  private open(name: string, title: string, build: (body: HTMLElement) => void, opts: { narrow?: boolean; actions?: Node[] } = {}) {
    clear(this.wrap);
    const body = h('div', { class: 'body' });
    const modal = h('div', { class: `modal panel ${opts.narrow ? 'narrow' : ''}` }, h('header', null, h('h2', null, title), ...(opts.actions ?? []), h('button', { onclick: () => this.close() }, '✕')), body);
    this.wrap.append(modal);
    this.wrap.style.display = 'flex';
    const render = () => { const scroll = body.scrollTop; clear(body); build(body); body.scrollTop = scroll; };
    this.current = { name, render };
    render();
  }

  openPanel(panel: string, arg?: unknown) {
    switch (panel) {
      case 'toolchest': return this.toolbox();
      case 'computer': return this.parts();
      case 'jobboard': return this.jobBoard();
      case 'inventory': return this.inventory(arg as string);
      case 'tray': return this.inventory();
      case 'pan': return this.pan();
      case 'dipstick': return this.dipstick();
      case 'inspect': return this.inspect(arg as any);
      case 'measure': return this.measureResult(arg as any);
      case 'edu': return this.edu(arg as string);
      case 'belt': return this.belt();
    }
  }

  // ───────────── Main menu ─────────────
  async showMenu(show: boolean) {
    this.menuEl.style.display = show ? 'flex' : 'none';
    if (!show) return;
    const g = this.g;
    const saves = await storage.list();
    const auto = saves.find((s) => s.id === 'autosave');
    const t1done = JOBS.filter((j) => j.tier === 1 && g.state.progress.completed[j.id]).length;
    clear(this.menuEl).append(h('div', { class: 'inner' },
      h('h1', null, BRANDING.gameTitle.replace(' WORKSHOP', '')), h('div', { style: 'font-family:Georgia,serif;letter-spacing:0.4em;color:#cfc6b0;margin:-2px 0 4px' }, 'W O R K S H O P'),
      h('div', { class: 'sub' }, `${BRANDING.variant} · ${BRANDING.engineName} · ${BRANDING.modelYear}`),
      auto ? h('button', { class: 'big primary', onclick: () => bus.emit('ui:open', { panel: 'continue' }) }, 'Continue', h('small', null, `Autosave — ${new Date(auto.savedAt).toLocaleString()}`)) : null,
      h('button', { class: 'big', onclick: () => this.jobBoard(1) }, 'Tier I — Maintenance', h('small', null, `A running car that needs servicing and fault-finding · ${t1done}/${JOBS.filter((j) => j.tier === 1).length} work orders complete`)),
      h('button', { class: 'big', onclick: () => this.jobBoard(2) }, 'Tier II — Fixer Upper', h('small', null, `Head off, engine out on the hoist, bottom end measured, machined & rebuilt · ${JOBS.filter((j) => j.tier === 2 && g.state.progress.completed[j.id]).length}/${JOBS.filter((j) => j.tier === 2).length} complete`)),
      h('button', { class: 'big', disabled: true, title: 'Phase 5' }, 'Tier III — Junkyard Save 🔒', h('small', null, 'Bare shell, seized engine core, body restoration & machine shop. Phase 5.')),
      h('button', { class: 'big', onclick: () => bus.emit('ui:open', { panel: 'sandbox' }) }, 'Free Workshop', h('small', null, 'Sandbox — no customer, all Phase 1–2 tools. Explore, dismantle, test.')),
      h('div', { class: 'row' }, h('button', { onclick: () => this.toolbox() }, 'Workshop'), h('button', { onclick: () => this.parts() }, 'Parts'), h('button', { onclick: () => this.manual() }, 'Manual'), h('button', { onclick: () => this.settings() }, 'Settings'), h('button', { onclick: () => this.saveLoad() }, 'Load')),
      h('div', { class: 'legal' }, `${BRANDING.fullName} and the ${BRANDING.engineName} are fictional names for a simulated 1960s British sports car. Technical data is compiled from public owner-club and supplier references; values marked † in the manual are provisional and awaiting verification against factory documentation. See docs/VEHICLE_SPEC.md.`),
    ));
  }

  // ───────────── Job board ─────────────
  jobBoard(tier: 1 | 2 = 1) {
    this.open('jobBoard', `Job board — ${tier === 1 ? 'Tier I (Maintenance)' : 'Tier II (Fixer Upper)'}`, (b) => {
      const g = this.g;
      const prog = g.state.progress;
      b.append(h('div', { class: 'tabs' },
        h('button', { class: tier === 1 ? 'on' : '', onclick: () => this.jobBoard(1) }, 'Tier I — Maintenance'),
        h('button', { class: tier === 2 ? 'on' : '', onclick: () => this.jobBoard(2) }, 'Tier II — Fixer Upper'),
        h('span', { style: 'flex:1' }),
        h('button', { class: 'info', onclick: () => { this.close(); bus.emit('ui:open', { panel: 'tutorial', arg: tier }); } }, `▶ Guided tutorial (Tier ${tier === 1 ? 'I' : 'II'})`)));
      if (tier === 2) b.append(h('p', { class: 'warn' }, 'Tier II needs an engine hoist, engine stand, micrometer and Plastigauge (Tools). Completing Tier I first is recommended.'));
      b.append(h('p', { class: 'dim' }, `Labour is paid at book time (£${LABOUR_RATE}/h) × quality. Customers pay for the parts the job needed — not for guesses. Reputation ${Math.round(prog.rep)}.`));
      const grid = h('div', { class: 'grid2' });
      for (const j of JOBS.filter((x) => x.tier === tier)) {
        const done = prog.completed[j.id];
        const locked = j.unlock?.jobs?.some((x) => !prog.completed[x]);
        grid.append(h('div', { class: `card ${locked ? 'locked' : ''}` },
          h('div', { style: 'display:flex;gap:6px;align-items:center' }, h('b', { style: 'flex:1' }, j.title), done ? h('span', { class: 'tag good' }, `Grade ${done.grade}`) : null),
          h('div', { class: 'dim' }, j.customer),
          h('p', { style: 'font-style:italic' }, j.complaint),
          h('div', { class: 'dim' }, `Book time ${j.bookHours} h · ${j.skills.map((s) => SYSTEM_LABEL[s]).join(', ')}`),
          locked ? h('div', { class: 'warn' }, `Requires: ${j.unlock!.jobs!.map((x) => JOB_BY_ID[x].title).join(', ')}`) :
            h('button', { class: 'primary', style: 'margin-top:6px', onclick: () => { this.close(); bus.emit('ui:open', { panel: 'startJob', arg: j.id }); } }, done ? 'Redo this job' : 'Accept job'),
        ));
      }
      b.append(grid);
    });
  }

  // ───────────── Workshop manual ─────────────
  manual(tab = 'spec') {
    const tabs: [string, string][] = [['spec', 'Specifications'], ['torque', 'Torque'], ['fluids', 'Capacities & fluids'], ['proc', 'Procedures'], ['wiring', 'Wiring diagram'], ['diag', 'Diagnostics'], ['maint', 'Maintenance'], ['diagram', 'Component diagrams']];
    this.open('manual', `Workshop manual — ${BRANDING.fullName} ${BRANDING.variant}`, (b) => {
      b.append(h('div', { class: 'tabs' }, ...tabs.map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; this.current?.render(); } }, l))));
      const specRow = (s: SpecValue) => h('tr', null, h('td', null, s.label), h('td', { class: 'mono' }, `${s.value}${s.unit ? ' ' + s.unit : ''}${s.status === 'provisional' ? ' †' : ''}`), h('td', { class: 'dim' }, s.alt ?? ''), h('td', { class: 'dim' }, s.note ?? ''));
      if (tab === 'spec') {
        for (const [sec, vals] of Object.entries(SPEC)) {
          b.append(h('h3', { style: 'margin-top:10px' }, sec.replace(/([A-Z])/g, ' $1')), h('table', null, ...Object.values(vals as Record<string, SpecValue>).map(specRow)));
        }
        b.append(h('p', { class: 'dim' }, '† provisional — awaiting verification against the factory service manual.'));
      }
      if (tab === 'torque') {
        b.append(h('table', null, h('tr', null, h('th', null, 'Fastener'), h('th', null, 'Nm'), h('th', null, 'lb ft'), h('th', null, 'Note')),
          ...Object.values(TORQUE).map((t) => h('tr', null, h('td', null, t.label), h('td', { class: 'mono' }, `${t.nm}${t.status === 'provisional' ? ' †' : ''}`), h('td', { class: 'mono' }, String(t.lbft)), h('td', { class: 'dim' }, t.note ?? '')))));
        b.append(h('h3', { style: 'margin-top:12px' }, 'Fastener schedule (this vehicle)'), h('table', null, h('tr', null, h('th', null, 'Location'), h('th', null, 'Thread'), h('th', null, 'Drive'), h('th', null, 'Torque')),
          ...SLOT_LIST.filter((s) => s.thread).map((s) => h('tr', null, h('td', null, s.name), h('td', null, s.thread!.size + (s.thread!.leftHand ? ' (LH)' : '')), h('td', null, s.thread!.driveSize ?? s.thread!.drive), h('td', { class: 'mono' }, s.thread!.drive === 'spinner' ? 'mallet tight' : s.thread!.handTight ? 'hand tight' : `${torqueSpecNm(s.thread!) ?? '—'} Nm`)))));
      }
      if (tab === 'fluids') {
        b.append(h('table', null, h('tr', null, h('th', null, 'System'), h('th', null, 'Capacity'), h('th', null, 'Correct fluid')),
          ...Object.values(CIRCUITS).map((c) => h('tr', null, h('td', null, c.name), h('td', { class: 'mono' }, `${c.capacityL} L`), h('td', null, c.correct.map((f) => FLUIDS[f].name).join(' / '))))));
        b.append(h('h3', { style: 'margin-top:12px' }, 'Incompatibilities'), h('ul', null, ...Object.values(CIRCUITS).flatMap((c) => Object.entries(c.harmful).map(([fam, msg]) => h('li', null, h('b', null, `${c.name}: `), `${fam.replace('_', ' ')} — ${msg}`)))));
        b.append(h('p', null, `Dipstick: MIN ≈ ${OIL_MIN} L, MAX ≈ ${OIL_MAX} L in the sump (static). Read with the car level and the engine stopped for at least two minutes.`));
      }
      if (tab === 'proc') {
        for (const p of Object.values(PROCEDURES)) {
          b.append(h('details', { class: 'card', style: 'margin-bottom:6px' }, h('summary', null, h('b', null, p.title), h('span', { class: 'dim' }, ` — ${p.system}, ${p.time}`)),
            h('div', { class: 'dim' }, 'Tools: ', p.tools.join(', ')), p.parts.length ? h('div', { class: 'dim' }, 'Parts: ', p.parts.join(', ')) : null,
            h('ol', null, ...p.steps.map((s) => h('li', null, s.text, s.why ? h('div', { class: 'dim', style: 'font-size:12px' }, s.why) : null)))));
        }
      }
      if (tab === 'wiring') b.append(h('div', { class: 'svgwrap', html: wiringSvg() }), h('p', { class: 'dim' }, 'Simplified schematic generated from the live circuit model. Negative earth. Fuse grouping simplified in this build.'));
      if (tab === 'diag') for (const d of DIAG_GUIDES) b.append(h('div', { class: 'card', style: 'margin-bottom:6px' }, h('b', null, d.title), h('ol', null, ...d.steps.map((s) => h('li', null, s)))));
      if (tab === 'maint') for (const m of MAINTENANCE) b.append(h('div', { class: 'card', style: 'margin-bottom:6px' }, h('b', null, m.interval), h('ul', null, ...m.items.map((i) => h('li', null, i)))));
      if (tab === 'diagram') {
        b.append(h('p', null, 'Engine assembly stack (top to bottom) — use the Exploded view (B) to see it in 3D:'));
        b.append(h('ol', null, ...['Air cleaner & ram pipe', '3 × SU HD8 carburettors', 'Inlet manifold', 'Camshaft covers', 'Camshafts', 'Valves, springs, tappets', 'Cylinder head', 'Head gasket', 'Cylinder block', 'Pistons & rings', 'Connecting rods', 'Crankshaft & flywheel', 'Oil pump & pick-up', 'Sump & drain plug'].map((x) => h('li', null, x))));
        b.append(h('button', { class: 'primary', onclick: () => { this.close(); this.app.setView('exploded', true); } }, 'Show exploded engine'));
      }
    });
  }

  // ───────────── Notebook ─────────────
  notebook() {
    this.open('notebook', 'Diagnostic notebook', (b) => {
      const g = this.g, j = g.state.job, jd = g.jobDef;
      if (!j || !jd) { b.append(h('p', { class: 'dim' }, 'Tests you perform are logged here during a work order.')); return; }
      b.append(h('div', { class: 'card', style: 'margin-bottom:8px' }, h('b', null, 'Customer: '), jd.complaint));
      b.append(h('h3', null, 'Tests & observations'));
      if (!j.tests.length) b.append(h('p', { class: 'dim' }, 'Nothing recorded yet. Inspections, measurements, meter readings, dipstick checks and the idle-drop test are logged automatically.'));
      else b.append(h('table', null, h('tr', null, h('th', null, 'Time'), h('th', null, 'Test'), h('th', null, 'Result')),
        ...j.tests.slice().reverse().map((t) => h('tr', null, h('td', { class: 'mono dim' }, fmtTime(t.t).slice(-5)), h('td', null, t.label), h('td', { class: 'mono' }, t.value)))));
      b.append(h('h3', { style: 'margin-top:10px' }, 'Notes'));
      const ta = h('textarea', { rows: '3', style: 'width:100%', oninput: (e: Event) => { j.notes = (e.target as HTMLTextAreaElement).value; } }, j.notes) as HTMLTextAreaElement;
      b.append(ta);
      if (jd.requireDiagnosis) {
        b.append(h('h3', { style: 'margin-top:10px' }, 'Diagnosis'));
        const sel = h('select', { style: 'width:100%' }, h('option', { value: '' }, '— select the root cause —'),
          ...([...new Set(DIAGNOSES.map((d) => d.system))] as SystemId[]).map((sys) => h('optgroup', { label: SYSTEM_LABEL[sys] }, ...DIAGNOSES.filter((d) => d.system === sys).map((d) => h('option', { value: d.id, selected: j.diagnosis === d.id }, d.label))))) as HTMLSelectElement;
        b.append(sel, h('button', { class: 'primary', style: 'margin-top:6px', onclick: () => sel.value && g.submitDiagnosis(sel.value) }, 'Record diagnosis'));
        if (j.diagnosis) b.append(h('div', { class: 'dim', style: 'margin-top:4px' }, `Recorded: ${DIAGNOSES.find((d) => d.id === j.diagnosis)?.label}`));
        if (g.assist === 'beginner') {
          const relevant = jd.faults.flatMap((f) => FAULTS[f].tests);
          const n = new Set(j.tests.filter((t) => relevant.some((r) => t.tag.startsWith(r))).map((t) => t.tag)).size;
          const hint = jd.faults.map((f) => HINTS[f]).find(Boolean);
          b.append(h('div', { class: 'card', style: 'margin-top:8px' }, n >= 1 && hint ? hint : h('span', { class: 'dim' }, 'Foreman: "Gather some evidence first — test, don’t guess."')));
        }
      }
    });
  }

  // ───────────── Inventory ─────────────
  inventory(focusUid?: string) {
    this.open('inventory', 'Inventory — parts tray & stock', (b) => {
      const g = this.g, a = g.assist;
      const items = Object.values(g.state.inventory).sort((x, y) => (x.location === y.location ? PARTS[x.def].name.localeCompare(PARTS[y.def].name) : x.location === 'tray' ? -1 : 1));
      if (!items.length) { b.append(h('p', { class: 'dim' }, 'Empty. Removed parts go to the tray; purchases arrive in stock.')); return; }
      const kind = g.toolKind();
      const tbl = h('table', null, h('tr', null, h('th', null, 'Item'), h('th', null, 'Where'), h('th', null, 'Condition'), h('th', null, 'Actions')));
      for (const p of items) {
        const d = PARTS[p.def];
        const known = p.known.inspected || p.origin === 'new';
        const cond = d.kind === 'container' ? `${fmt(p.vars.volume ?? 0, 2)} L left` : a === 'beginner' || (a === 'experienced' && known) ? conditionLabel(p.condition, p.flags) : known ? 'inspected' : 'unknown';
        const acts = h('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' });
        if (d.kind !== 'container') acts.append(h('button', { onclick: () => g.inspectPart(p, p.slot) }, 'Inspect'));
        for (const m of d.measurements ?? []) if (m.where !== 'installed') acts.append(h('button', { disabled: !kind || !m.tools.includes(kind as any), title: `Needs ${m.tools.join('/')}`, onclick: () => g.measure(p, m) }, `Measure ${m.label.toLowerCase()}`));
        if (p.def.startsWith('plug_')) {
          const gap = h('input', { type: 'number', step: '0.01', value: '0.64', style: 'width:60px' }) as HTMLInputElement;
          acts.append(h('span', null, gap, h('button', { disabled: kind !== 'gap_tool', title: 'Select the gapping tool', onclick: () => g.setPlugGap(p, +gap.value) }, 'Set gap')));
        }
        if (d.kind === 'container') acts.append(h('button', { class: g.held === p.uid ? 'on' : '', onclick: () => g.hold(g.held === p.uid ? null : p.uid) }, g.held === p.uid ? 'Holding' : 'Pick up'));
        const targets = SLOT_LIST.filter((s) => s.accepts.includes(p.def) && !g.v.slots[s.id].part);
        for (const s of targets.slice(0, 4)) {
          const r = canFit(g.v, s.id, p.def);
          acts.append(h('button', { class: 'primary', disabled: !r.ok, title: r.reasons.join('; '), onclick: () => g.fitPart(s.id, p.uid) }, `Fit → ${s.name}`));
        }
        acts.append(h('button', { class: 'danger', onclick: () => g.sellPart(p.uid) }, p.location === 'stock' && p.origin === 'new' && !(d.kind === 'container' && (p.vars.volume ?? 0) < total(d.fluid ?? {})) ? 'Return' : 'Scrap'));
        tbl.append(h('tr', { style: focusUid === p.uid ? 'background:rgba(217,164,65,0.12)' : '' }, h('td', null, d.name, h('div', { class: 'dim', style: 'font-size:11px' }, d.partNo, p.origin !== 'factory' ? ` · ${p.origin}` : '', known && p.flags.length ? ' · ' + p.flags.map((f) => FLAG_LABEL[f]).join(', ') : '')),
          h('td', null, p.location === 'tray' ? 'Tray' : 'Stock'), h('td', null, cond), h('td', null, acts)));
      }
      b.append(tbl);
    });
  }

  // ───────────── Tool chest ─────────────
  toolbox() {
    this.open('toolbox', 'Tool chest & workshop equipment', (b) => {
      const g = this.g;
      b.append(h('p', { class: 'dim' }, `Balance ${fmtMoney(g.state.money)}. Axle stands owned: ${g.state.workshop.standsOwned}. Torque wrench calibration: ${g.state.workshop.wrenchError > 1.02 ? h('span', { class: 'warn' }, 'suspect').outerHTML : 'OK'}.`.replace(/<[^>]+>/g, '')));
      if (g.state.workshop.wrenchError > 1.02) b.append(h('button', { onclick: () => g.recalibrateWrench() }, 'Send torque wrench for calibration (£25, 30 min)'));
      const cats = [...new Set(TOOL_LIST.map((t) => t.category))] as ToolCategory[];
      for (const c of cats) {
        b.append(h('h3', { style: 'margin-top:10px' }, c));
        const tbl = h('table');
        for (const t of TOOL_LIST.filter((x) => x.category === c)) {
          const owned = g.owns(t.id);
          const av = g.toolAvailable(t.id);
          tbl.append(h('tr', null, h('td', { style: 'width:34%' }, t.name), h('td', { class: 'dim' }, t.desc), h('td', { class: 'mono', style: 'width:70px' }, t.price ? fmtMoney(t.price) : '—'),
            h('td', { style: 'width:120px' }, owned && t.kind !== 'jack_stand' ? h('span', { class: 'good' }, 'Owned') : !av.ok ? h('span', { class: 'dim' }, av.reason) : h('button', { onclick: () => g.buyTool(t.id) }, owned ? 'Buy another pair' : 'Buy'))));
        }
        b.append(tbl);
      }
    });
  }

  // ───────────── Parts computer ─────────────
  parts(tab = 'new', filter = '') {
    this.open('parts', 'Parts computer', (b) => {
      const g = this.g;
      b.append(h('div', { class: 'tabs' }, ...([['new', 'New parts'], ['fluids', 'Fluids & consumables'], ['used', 'Used / junkyard'], ['machine', 'Machine shop']] as const).map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; this.current?.render(); } }, l))));
      if (tab === 'used') {
        b.append(h('div', { class: 'card' }, h('b', null, 'Used parts & junkyard search'), h('p', { class: 'dim' }, 'Used parts arrive with UNKNOWN condition until inspected and measured. Arrives with Tier III (Phase 5).')));
        return;
      }
      if (tab === 'machine') {
        const cranks = Object.values(g.state.inventory).filter((p) => p.def === 'crankshaft');
        b.append(h('p', { class: 'dim' }, 'Send removed components away for machining. Work costs money and days on the workshop clock. Measure first — the shop does what you ask, not what the part needs.'));
        if (!cranks.length) b.append(h('p', null, 'Nothing to send: remove the crankshaft (engine on the stand) and it will appear here.'));
        for (const p of cranks) b.append(h('div', { class: 'card', style: 'margin-bottom:6px' }, h('b', null, `${PARTS[p.def].name} (${p.location === 'tray' ? 'from this car' : p.origin})`),
          h('div', { class: 'dim' }, `Size: ${(p.vars.undersize ?? 0) > 0 ? `${((p.vars.undersize ?? 0) / 0.254 * 0.010).toFixed(3)} in undersize` : 'standard'}`),
          h('div', { style: 'display:flex;gap:6px;margin-top:6px' },
            h('button', { onclick: () => g.machineShop(p.uid, 'polish') }, 'Polish journals — £85, 1 day'),
            h('button', { onclick: () => g.machineShop(p.uid, 'regrind') }, 'Regrind 0.010 in undersize — £260, 3 days'))));
        b.append(h('div', { class: 'card dim' }, 'Boring, honing, head resurfacing, valve-seat work and balancing arrive with Tier III (Phase 5).'));
        return;
      }
      const jd = g.jobDef;
      if (jd && g.assist === 'beginner' && jd.partsHint.length && tab === 'new') b.append(h('div', { class: 'card', style: 'margin-bottom:8px' }, h('b', null, 'Likely needed for this job: '), [...new Set(jd.partsHint)].map((p) => PARTS[p].name).join(', ')));
      const search = h('input', { placeholder: 'Search…', value: filter, style: 'width:240px;margin-bottom:6px', oninput: (e: Event) => { filter = (e.target as HTMLInputElement).value; this.current?.render(); setTimeout(() => (this.wrap.querySelector('input') as HTMLInputElement)?.focus(), 0); } });
      b.append(search, h('span', { class: 'dim' }, `  Balance ${fmtMoney(g.state.money)}`));
      const list = Object.values(PARTS).filter((p) => p.catalog && (tab === 'fluids' ? p.kind === 'container' || p.kind === 'consumable' : p.kind !== 'container') && p.name.toLowerCase().includes(filter.toLowerCase()));
      const tbl = h('table', null, h('tr', null, h('th', null, 'Part'), h('th', null, 'Part no.'), h('th', null, 'System'), h('th', null, 'Price'), h('th', null, 'In stock'), h('th', null, '')));
      for (const p of list) {
        const stock = Object.values(g.state.inventory).filter((i) => i.def === p.id || (p.bundle?.includes(i.def) ?? false)).length;
        tbl.append(h('tr', null, h('td', null, p.name, p.wrongFor ? h('div', { class: 'dim', style: 'font-size:11px' }, 'Universal fit — check the application') : null), h('td', { class: 'mono dim' }, p.partNo), h('td', { class: 'dim' }, SYSTEM_LABEL[p.system]), h('td', { class: 'mono' }, fmtMoney(p.price)), h('td', null, String(stock)),
          h('td', null, h('button', { onclick: () => g.buyPart(p.id, 1) }, 'Buy 1'), ' ', p.price < 20 ? h('button', { onclick: () => g.buyPart(p.id, 6) }, '×6') : null)));
      }
      b.append(tbl);
    });
  }

  // ───────────── Status / assembly check ─────────────
  status() {
    this.open('status', 'Vehicle status & assembly check', (b) => {
      const g = this.g, v = g.v, a = g.assist;
      const sup = CORNERS.map((c) => `${c}: ${v.support[c].height > 0.005 ? `+${Math.round(v.support[c].height * 1000)} mm${v.support[c].stand ? ' (stand)' : v.support[c].jack ? ' (jack!)' : ''}` : 'ground'}`).join(' · ');
      b.append(h('div', { class: 'card' }, h('b', null, 'Support: '), sup, v.chocks ? ' · chocked' : ''));
      if (a === 'beginner' || g.state.mode === 'sandbox') {
        const sump = sumpOil(v) + v.oil.gallery;
        const cool = total(v.coolant.comp);
        const af = antifreeze(v.coolant.comp);
        b.append(h('div', { class: 'card', style: 'margin-top:6px' }, h('b', null, 'Fluids (assisted view): '),
          `Oil ${fmt(sump, 2)} L (${compatibility('engineOil', v.oil.comp).wrongFrac > 0.05 ? 'mixed/wrong grade' : 'grade OK'}) · Coolant ${fmt(cool, 1)}/${COOLANT_FULL} L, protects to ${Math.round(af.freezeC)} °C · Brake ${fmt(total(v.brake.comp), 2)} L · Fuel ${fmt(v.fuelL, 0)} L · Battery ${Math.round((partIn(v, 'elec.battery')?.vars.charge ?? 0) * 100)} %`));
      } else b.append(h('p', { class: 'dim' }, 'Fluid levels are not displayed at this assistance level — check them yourself.'));
      const checks = assemblyCheck(v, { requireTestRun: !!g.jobDef?.requireTestRun });
      b.append(h('h3', { style: 'margin-top:10px' }, 'Assembly check'));
      b.append(checkTable(checks));
      if (g.state.mode === 'sandbox') {
        b.append(h('h3', { style: 'margin-top:10px' }, 'Error detection (sandbox)'), checkTable(analyzeVehicle(v)));
      }
    });
  }

  handOver() {
    this.open('handover', 'Hand the vehicle back?', (b) => {
      const g = this.g;
      const checks = assemblyCheck(g.v, { requireTestRun: !!g.jobDef?.requireTestRun });
      const fails = checks.filter((c) => !c.ok);
      b.append(fails.length ? h('div', null, h('p', { class: 'warn' }, `${fails.length} item(s) are not right yet:`), checkTable(fails)) : h('p', { class: 'good' }, 'Assembly check passes.'));
      if (g.jobDef?.requireDiagnosis && !g.state.job?.diagnosis) b.append(h('p', { class: 'warn' }, 'You have not recorded a diagnosis in the notebook.'));
      b.append(h('div', { style: 'display:flex;gap:8px;margin-top:10px' }, h('button', { onclick: () => this.close() }, 'Keep working'), h('button', { class: 'primary', onclick: () => { const r = g.completeJob(); if (r) this.report(r); } }, 'Hand over & invoice')));
    }, { narrow: true });
  }

  report(r: JobReport) {
    this.open('report', `Job report — ${r.job.title}`, (b) => {
      const pct = (x: number) => `${Math.round(x * 100)} %`;
      b.append(h('div', { class: 'grid2' },
        h('div', { class: 'card' }, h('h3', null, `Grade ${r.grade}`), h('table', null,
          ...Object.entries({ 'Repair (faults actually fixed)': r.q.repair, 'Assembly correctness': r.q.assembly, 'Diagnosis & evidence': r.q.diagnosis, 'Safety': r.q.safety, 'Care (spills, damage)': r.q.care, 'Efficiency vs book time': r.q.efficiency }).map(([k, v]) => h('tr', null, h('td', null, k), h('td', { class: `mono ${v > 0.85 ? 'good' : v > 0.55 ? 'warn' : 'bad'}` }, pct(v)))))),
        h('div', { class: 'card' }, h('h3', null, 'Invoice'), h('table', null,
          h('tr', null, h('td', null, 'Labour (book time)'), h('td', { class: 'mono' }, fmtMoney(r.labour))), h('tr', null, h('td', null, 'Parts & fluids billed'), h('td', { class: 'mono' }, fmtMoney(r.partsBilled))),
          h('tr', null, h('td', null, h('b', null, 'Paid')), h('td', { class: 'mono' }, h('b', null, fmtMoney(r.pay)))), h('tr', null, h('td', null, 'Reputation'), h('td', { class: `mono ${r.repDelta >= 0 ? 'good' : 'bad'}` }, `${r.repDelta >= 0 ? '+' : ''}${r.repDelta}`)),
          h('tr', null, h('td', null, 'Time taken'), h('td', { class: 'mono' }, `${fmt(r.hours, 2)} h (book ${r.job.bookHours} h)`))),
          r.skillMsgs.length ? h('div', { class: 'good' }, r.skillMsgs.join(' · ')) : null),
      ));
      b.append(h('h3', { style: 'margin-top:10px' }, 'What was actually wrong'));
      for (const f of r.faults) b.append(h('div', { class: 'card', style: 'margin-bottom:6px' }, h('b', { class: f.fixed ? 'good' : 'bad' }, `${f.fixed ? '✓ Fixed' : '✗ NOT fixed'} — ${f.f.name}`), h('p', null, f.f.cause)));
      if (r.job.requireDiagnosis) b.append(h('p', null, 'Your diagnosis: ', h('b', { class: r.diagCorrect ? 'good' : 'bad' }, r.diagnosis ? DIAGNOSES.find((d) => d.id === r.diagnosis)?.label ?? r.diagnosis : 'none recorded'), r.diagCorrect ? ' — correct.' : ` — expected: ${DIAGNOSES.find((d) => d.id === r.diagExpected)?.label}.`));
      for (const e of r.evidence) b.append(h('p', { class: 'dim' }, `Evidence gathered before the fix (${e.count} relevant test types): ${e.tests.slice(0, 8).join('; ') || 'none'}`));
      if (r.unnecessary.length) b.append(h('p', { class: 'warn' }, `Parts replaced without cause (not billed): ${r.unnecessary.map((s) => SLOTS[s].name).join(', ')}`));
      if (r.violations.length) b.append(h('h3', null, 'Safety & procedure'), h('ul', null, ...r.violations.map((v) => h('li', { class: 'bad' }, v))));
      if (r.damage.length) b.append(h('h3', null, 'Damage caused'), h('ul', null, ...r.damage.map((v) => h('li', { class: 'bad' }, v))));
      b.append(h('h3', { style: 'margin-top:10px' }, 'Assembly check at hand-over'), checkTable(r.checks));
      b.append(h('h3', { style: 'margin-top:10px' }, 'Error-detection analysis of the car you returned'), checkTable(r.analysis));
      b.append(h('div', { style: 'margin-top:10px' }, h('button', { class: 'primary', onclick: () => { this.close(); this.jobBoard(r.job.tier as 1 | 2); } }, 'Back to the job board')));
    });
  }

  // ───────────── Settings & saves ─────────────
  settings() {
    this.open('settings', 'Settings', (b) => {
      const g = this.g, st = g.state.settings;
      const assist = h('select', { onchange: (e: Event) => { st.assist = (e.target as HTMLSelectElement).value as AssistLevel; bus.emit('settings:changed', {}); } },
        ...(Object.keys(ASSIST_LABEL) as AssistLevel[]).map((a) => h('option', { value: a, selected: st.assist === a }, ASSIST_LABEL[a])));
      b.append(h('div', { class: 'kv' },
        h('div', null, 'Assistance'), h('div', null, assist, h('div', { class: 'dim', style: 'font-size:11px' }, 'Beginner: names, conditions, tool & torque guidance, procedure hints · Experienced: fewer hints · Expert: no checklists or verdicts — consult the manual · Master: almost nothing.')),
        h('div', null, 'Educational mode'), h('div', null, h('input', { type: 'checkbox', checked: st.edu, onchange: (e: Event) => { st.edu = (e.target as HTMLInputElement).checked; bus.emit('settings:changed', {}); } })),
        h('div', null, 'Paint'), h('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' }, ...PAINTS.map(([n, c]) => h('button', { title: n, class: st.paint === c ? 'on' : '', style: `background:${c};width:28px;height:22px`, onclick: () => { st.paint = c; bus.emit('settings:changed', {}); this.current?.render(); } }))),
        h('div', null, 'Volume'), h('div', null, h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(st.volume), oninput: (e: Event) => { st.volume = +(e.target as HTMLInputElement).value; bus.emit('settings:changed', {}); } })),
        h('div', null, 'Time scale'), h('div', null, h('select', { onchange: (e: Event) => { st.timeScale = +(e.target as HTMLSelectElement).value; } }, ...[2, 4, 6, 10, 20].map((x) => h('option', { value: String(x), selected: st.timeScale === x }, `${x}× (1 real s = ${x} workshop s)`)))),
        h('div', null, 'Graphics'), h('div', null, h('select', { onchange: (e: Event) => { st.quality = (e.target as HTMLSelectElement).value as any; this.app.quickSave(); setTimeout(() => location.reload(), 300); } }, h('option', { value: 'high', selected: st.quality === 'high' }, 'High'), h('option', { value: 'low', selected: st.quality === 'low' }, 'Low (reloads)'))),
      ));
      b.append(h('h3', { style: 'margin-top:12px' }, 'Controls'), h('table', null, ...[
        ['Left click', 'Select component / use hotspot / place drain pan'], ['Hold left button on a fastener', 'Turn it with the tool in hand (R flips direction)'], ['Left drag empty space / right drag', 'Orbit camera'], ['Middle drag / Shift+drag', 'Pan'], ['Wheel', 'Zoom'],
        ['W A S D  Q E', 'Move camera (fly mode G)'], ['O / G / U / K / F', 'Orbit / Fly / Underbody / Cockpit / Focus selection'], ['X / C / B', 'X-ray / Cutaway / Exploded view'], ['M N I T P J L V', 'Manual, Notebook, Inventory, Tools, Parts PC, Jobs, Parts list, Status'], ['Space', 'Toggle driver controls'], ['Esc', 'Close / deselect / menu'],
      ].map(([k, d]) => h('tr', null, h('td', { class: 'mono' }, k), h('td', null, d)))));
      b.append(h('div', { style: 'margin-top:10px' }, h('button', { class: 'danger', onclick: () => { if (confirm('Erase all progress and saves?')) { localStorage.clear(); location.reload(); } } }, 'Reset all progress')));
    }, { narrow: true });
  }

  async saveLoad() {
    const saves = await storage.list();
    this.open('saves', 'Save / load', (b) => {
      for (const id of ['autosave', 'slot1', 'slot2', 'slot3']) {
        const s = saves.find((x) => x.id === id);
        b.append(h('div', { class: 'card', style: 'margin-bottom:6px;display:flex;gap:6px;align-items:center' }, h('b', { style: 'width:90px' }, id), h('span', { class: 'dim', style: 'flex:1' }, s ? `${s.label} — ${new Date(s.savedAt).toLocaleString()}` : 'empty'),
          id !== 'autosave' && this.g.state.mode !== 'menu' ? h('button', { onclick: async () => { await storage.save(id, this.g.state, this.g.jobDef?.title ?? this.g.state.mode); this.close(); bus.emit('notify', { text: `Saved to ${id}.`, kind: 'good' }); } }, 'Save here') : null,
          s ? h('button', { class: 'primary', onclick: () => { this.close(); bus.emit('ui:open', { panel: 'load', arg: id }); } }, 'Load') : null));
      }
    }, { narrow: true });
  }

  // ───────────── Small viewers ─────────────
  dipstick() {
    const d = this.g.lastDipstick;
    if (!d) return;
    this.open('dipstick', 'Dipstick', (b) => {
      const pos = Math.max(-0.4, Math.min(1.6, (d.level - OIL_MIN) / (OIL_MAX - OIL_MIN)));
      const x = (f: number) => 80 + f * 220;
      const col = d.color < 0.4 ? '#1a1206' : d.color < 0.8 ? '#5a3a0a' : '#b07a18';
      b.append(h('div', { html: `<svg class="dipstick" viewBox="0 0 560 70"><rect x="20" y="30" width="520" height="10" rx="3" fill="#bbb"/><circle cx="540" cy="35" r="14" fill="none" stroke="#e0b020" stroke-width="5"/><rect x="20" y="30" width="${Math.max(0, x(pos) - 20)}" height="10" fill="${col}" opacity="0.92"/><line x1="${x(0)}" y1="22" x2="${x(0)}" y2="48" stroke="#333" stroke-width="2"/><line x1="${x(1)}" y1="22" x2="${x(1)}" y2="48" stroke="#333" stroke-width="2"/><text x="${x(0)}" y="18" font-size="12" text-anchor="middle" fill="#ddd">MIN</text><text x="${x(1)}" y="18" font-size="12" text-anchor="middle" fill="#ddd">MAX</text></svg>` }));
      b.append(h('p', null, `Oil colour: ${d.color < 0.4 ? 'black, thin' : d.color < 0.8 ? 'dark brown' : 'clear amber'}.`));
      if (d.note) b.append(h('p', { class: 'warn' }, d.note));
      if (this.g.assist === 'beginner') b.append(h('p', { class: 'dim' }, `≈ ${fmt(d.level - OIL_MAX, 2)} L relative to MAX.`));
    }, { narrow: true });
  }
  inspect(a: { name: string; obs: string[] }) {
    this.open('inspect', `Inspection — ${a.name}`, (b) => { b.append(h('ul', null, ...a.obs.map((o) => h('li', null, o)))); b.append(h('p', { class: 'dim' }, 'Logged in the notebook.')); }, { narrow: true });
  }
  measureResult(a: { label: string; value: string; spec: string; verdict: string }) {
    const asst = this.g.assist;
    this.open('measure', 'Measurement', (b) => {
      b.append(h('div', { class: 'kv' }, h('div', null, a.label), h('div', null, ''), h('div', null, 'Measured'), h('div', { class: 'mono' }, a.value),
        h('div', null, 'Specification'), h('div', { class: 'mono' }, asst === 'master' ? 'see manual' : a.spec),
        h('div', null, 'Result'), h('div', { class: a.verdict.includes('WITHIN') ? 'good' : 'bad' }, asst === 'beginner' || asst === 'experienced' ? a.verdict || '—' : 'Compare with the manual')));
    }, { narrow: true });
  }
  edu(key: string) {
    const e = EDU[key];
    if (!e) return;
    this.open('edu', e.title, (b) => {
      const sec = (t: string, v?: string | string[]) => v && (Array.isArray(v) ? v.length : true) ? h('div', { style: 'margin-bottom:6px' }, h('h3', null, t), Array.isArray(v) ? h('ul', null, ...v.map((x) => h('li', null, x))) : h('p', { style: 'margin:0' }, v)) : null;
      b.append(sec('What it is', e.what) ?? '', sec('What it does', e.purpose) ?? '', sec('Why it exists', e.why) ?? '', sec('Interacts with', e.interacts) ?? '', sec('Common failures', e.failures) ?? '', sec('How to test it', e.test) ?? '', sec('How to repair it', e.repair) ?? '');
    }, { narrow: true });
  }
  pan() {
    this.open('pan', 'Drain pan', (b) => {
      const g = this.g, c = g.state.workshop.drainPan.comp;
      const l = total(c);
      b.append(h('p', null, `${fmt(l, 2)} L in the pan.`), l > 0 ? h('ul', null, ...Object.entries(c).map(([k, v]) => h('li', null, `${FLUIDS[k as FluidId].name}: ${fmt(v ?? 0, 2)} L`))) : '');
      b.append(h('div', { style: 'display:flex;gap:6px' }, h('button', { onclick: () => g.emptyDrainPan(), disabled: l <= 0 }, 'Empty into waste drum'), h('button', { onclick: () => g.cleanSpills(), disabled: !g.state.workshop.spills.length }, 'Clean up floor spills'),
        h('button', { onclick: () => { g.selectTool('drain_pan'); this.close(); } }, 'Move pan (click the floor)')));
      b.append(h('p', { class: 'dim' }, 'Tip: the stream lands directly below the drain plug; the filter canister sits a little forward and to the right.'));
    }, { narrow: true });
  }
  belt() {
    this.open('belt', 'Belt tension', (b) => {
      const g = this.g;
      const belt = partIn(g.v, 'eng.fan_belt');
      const val = h('span', { class: 'mono' }, `${fmt(belt?.vars.deflection ?? 12, 0)} mm`);
      const slider = h('input', { type: 'range', min: '5', max: '30', step: '0.5', value: String(belt?.vars.deflection ?? 12), style: 'width:100%', oninput: (e: Event) => { g.adjustBelt(+(e.target as HTMLInputElement).value); val.textContent = g.assist === 'beginner' ? `${fmt(partIn(g.v, 'eng.fan_belt')?.vars.deflection ?? 0, 1)} mm` : '(measure it with the rule)'; } });
      b.append(h('p', null, 'Lever the alternator outwards (left = tighter, right = slacker), then tighten the link and pivot bolts with the torque wrench.'), slider, h('div', null, 'Deflection: ', g.assist === 'beginner' ? val : h('span', { class: 'dim' }, 'measure it with the steel rule')));
    }, { narrow: true });
  }
  components() {
    this.open('components', 'Component list', (b) => {
      const g = this.g;
      const bySys = new Map<string, Map<string, typeof SLOT_LIST>>();
      for (const s of SLOT_LIST) {
        const sys = SYSTEM_LABEL[s.system];
        if (!bySys.has(sys)) bySys.set(sys, new Map());
        const grp = bySys.get(sys)!;
        if (!grp.has(s.group)) grp.set(s.group, []);
        grp.get(s.group)!.push(s);
      }
      b.append(h('p', { class: 'dim' }, `${SLOT_LIST.length} serviceable locations on this vehicle. Click to select & focus.`));
      const tree = h('div', { class: 'tree' });
      for (const [sys, groups] of bySys) {
        tree.append(h('details', null, h('summary', null, h('b', null, sys), h('span', { class: 'dim' }, ` (${[...groups.values()].reduce((a, x) => a + x.length, 0)})`),),
          ...[...groups].map(([grp, list]) => h('details', null, h('summary', null, grp), ...list.map((s) => h('div', { class: 'leaf', onclick: () => { this.close(); this.app.select({ kind: 'slot', id: s.id }); this.app.focusSlot(s.id); } }, s.name, g.v.slots[s.id].part ? '' : h('span', { class: 'warn' }, ' — removed')))))));
      }
      b.append(tree);
    });
  }
}

function checkTable(checks: { group: string; label: string; ok: boolean; detail?: string }[]) {
  return h('table', null, ...checks.map((c) => h('tr', null, h('td', { class: c.ok ? 'good' : 'bad', style: 'width:20px' }, c.ok ? '✓' : '✗'), h('td', { class: 'dim', style: 'width:110px' }, c.group), h('td', null, c.label), h('td', { class: 'dim' }, c.detail ?? ''))));
}

function wiringSvg() {
  const W = 760, rowH = 46;
  let y = 70;
  const parts: string[] = [];
  parts.push(`<rect x="20" y="20" width="70" height="36" fill="#fff" stroke="#222"/><text x="55" y="43" font-size="12" text-anchor="middle">BATTERY</text><text x="28" y="16" font-size="10">+ / – (neg earth)</text>`);
  parts.push(`<line x1="90" y1="30" x2="200" y2="30" stroke="#b00" stroke-width="3"/><rect x="200" y="18" width="80" height="26" fill="#fff" stroke="#222"/><text x="240" y="35" font-size="11" text-anchor="middle">SOLENOID</text>`);
  parts.push(`<line x1="280" y1="30" x2="340" y2="30" stroke="#b00" stroke-width="3"/><circle cx="360" cy="30" r="18" fill="#fff" stroke="#222"/><text x="360" y="34" font-size="11" text-anchor="middle">M</text><text x="385" y="34" font-size="11">Starter → engine earth</text>`);
  parts.push(`<line x1="240" y1="44" x2="240" y2="60" stroke="#b00" stroke-width="2"/><text x="250" y="58" font-size="10">Alternator output joins here (via charge cable)</text>`);
  parts.push(`<line x1="55" y1="56" x2="55" y2="${70 + rowH * 6}" stroke="#222" stroke-width="2"/><text x="60" y="${80 + rowH * 6}" font-size="10">Body earth → engine earth strap</text>`);
  for (const f of FUSE_CIRCUITS) {
    const feed = f.feed === 'permanent' ? 'SOL (permanent)' : 'IGN switch';
    parts.push(`<text x="110" y="${y + 16}" font-size="11">${feed}</text><line x1="210" y1="${y + 12}" x2="300" y2="${y + 12}" stroke="#b00" stroke-width="2"/>`);
    parts.push(`<rect x="300" y="${y + 4}" width="46" height="16" rx="7" fill="#fff" stroke="#222"/><text x="323" y="${y + 16}" font-size="10" text-anchor="middle">F${f.n}</text>`);
    parts.push(`<line x1="346" y1="${y + 12}" x2="420" y2="${y + 12}" stroke="#b00" stroke-width="2"/><text x="425" y="${y + 10}" font-size="11" font-weight="bold">${f.label}</text><text x="425" y="${y + 24}" font-size="10" fill="#555">${f.loads}</text>`);
    y += rowH;
  }
  return `<svg viewBox="0 0 ${W} ${y + 40}" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica">${parts.join('')}</svg>`;
}

export { onGround, TOOLS };
