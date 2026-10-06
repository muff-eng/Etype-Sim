/** Context actions for a selected component. Pure game logic — the UI just renders the list. */
import type { Game } from './Game';
import { SLOTS } from '../data/slots';
import { PARTS } from '../data/parts';
import { canFit, canReach, canRemove } from '../sim/access';
import { isReleased, partIn, wheelOffGround, threadReleased } from '../sim/vehicle';
import { TOOLS } from '../data/tools';
import { torqueVerdict } from '../sim/threads';
import type { Corner } from '../sim/types';
import { bus } from '../core/events';
import { EDU } from '../data/education';

export interface Action {
  id: string;
  label: string;
  enabled: boolean;
  reason?: string;
  run?: () => void;
  hold?: { down: () => void; up: () => void };
  kind?: 'primary' | 'danger' | 'info';
}

export function actionsFor(g: Game, slotId: string): Action[] {
  const v = g.v;
  const d = SLOTS[slotId];
  const s = v.slots[slotId];
  const p = partIn(v, slotId);
  const A: Action[] = [];
  const reach = canReach(v, slotId);
  const kind = g.toolKind();
  const add = (a: Action) => A.push(a);

  // Toggles
  if (d.toggle) {
    const on = (s.vars[d.toggle.var] ?? 0) > 0.5;
    add({ id: 'toggle', label: on ? d.toggle.off : d.toggle.on, enabled: true, run: () => g.toggle(slotId), kind: 'primary' });
  }
  if (slotId === 'int.bonnet_release_L' || slotId === 'int.bonnet_release_R') {
    add({ id: 'release', label: 'Pull bonnet release', enabled: true, run: () => g.pullRelease(slotId.endsWith('L') ? 'L' : 'R'), kind: 'primary' });
  }
  if (slotId === 'int.starter_button') add({ id: 'start', label: 'Hold to crank', enabled: true, hold: { down: () => g.setStarter(true), up: () => g.setStarter(false) }, kind: 'primary' });
  if (slotId === 'int.steering_wheel') add({ id: 'horn', label: 'Press horn push', enabled: true, run: () => g.horn(true) });

  // Inspect / learn
  if (p) {
    const phaseOnly = (d.access ?? []).every((a) => a.type === 'phase');
    add({ id: 'inspect', label: 'Inspect closely', enabled: reach.ok || phaseOnly, reason: reach.reasons[0], run: () => g.inspectSlot(slotId) });
  }
  const eduKey = d.edu ?? (p ? PARTS[p.def].edu : undefined);
  if (eduKey && EDU[eduKey] && g.state.settings.edu) add({ id: 'learn', label: 'Learn about this', enabled: true, run: () => bus.emit('ui:open', { panel: 'edu', arg: eduKey }), kind: 'info' });

  // Threaded fasteners: hold-to-work buttons mirror holding the mouse on the part
  if (d.thread && p && !(d.connector && (s.vars.off ?? 0) > 0.5)) {
    const dc = g.driveFor(slotId);
    const label = g.dir === 'undo' ? (d.thread.captive ? 'Slacken' : 'Undo') : 'Tighten';
    add({
      id: 'work', label: `Hold: ${label} (${dc.ok ? dc.label : 'no suitable tool'})`, enabled: reach.ok && dc.ok, reason: !reach.ok ? reach.reasons[0] : dc.reason,
      hold: { down: () => { g.beginWork(slotId); }, up: () => g.endWork() }, kind: 'primary',
    });
    if (s.turnsIn > 0.5 && s.torque > 0 && g.owns('penetrating_oil')) add({ id: 'pen', label: 'Apply penetrating oil', enabled: reach.ok, run: () => g.applyPenetrating(slotId) });
  }
  // Connectors
  if (d.connector && p) {
    const off = (s.vars.off ?? 0) > 0.5;
    if (!off) add({ id: 'disc', label: slotId.startsWith('ign.lead_') ? (v.engine.running ? 'Pull lead off plug (idle-drop test)' : 'Pull lead off plug') : 'Lift clamp off post', enabled: reach.ok && (!d.thread || threadReleased(v, slotId)), reason: !reach.ok ? reach.reasons[0] : `Slacken the pinch bolt first`, run: () => g.setConnector(slotId, false) });
    else if (slotId.startsWith('ign.lead_')) {
      const n = +slotId.slice(-1);
      for (const t of [n - 1, n, n + 1].filter((x) => x >= 1 && x <= 6)) add({ id: `conn${t}`, label: `Push onto plug ${t}${t === n ? '' : ' (lead reaches)'}`, enabled: reach.ok, reason: reach.reasons[0], run: () => g.setConnector(slotId, true, t), kind: t === n ? 'primary' : undefined });
    } else add({ id: 'conn', label: 'Fit clamp onto post', enabled: reach.ok, reason: reach.reasons[0], run: () => g.setConnector(slotId, true), kind: 'primary' });
    if (slotId.startsWith('elec.term_')) {
      add({ id: 'clean', label: 'Clean clamp (wire brush)', enabled: off && kind === 'wire_brush', reason: !off ? 'Disconnect it first' : 'Select the wire brush', run: () => g.cleanPart(slotId) });
      add({ id: 'grease', label: 'Apply terminal grease', enabled: g.owns('terminal_grease') && !off, reason: 'Connect it first', run: () => g.greaseTerminal(slotId) });
    }
  }
  // Removal / fitting
  if (p && d.removable !== false && !(d.thread && !d.thread.captive && s.turnsIn > 0.01) && !d.connector && !d.toggle) {
    const r = canRemove(v, slotId);
    add({ id: 'remove', label: d.heavy ? `Lift out (${PARTS[p.def].mass} kg)` : 'Remove', enabled: r.ok, reason: r.reasons[0], run: () => g.removePart(slotId) });
  }
  if (!p) {
    const cands = Object.values(g.state.inventory).filter((it) => d.accepts.includes(it.def));
    if (!cands.length) add({ id: 'none', label: `No suitable part in stock (${d.accepts.map((a) => PARTS[a].name).join(' / ')})`, enabled: false });
    for (const it of cands.slice(0, 6)) {
      const r = canFit(v, slotId, it.def);
      const cond = it.origin === 'new' ? 'new' : it.location === 'tray' ? 'removed earlier' : it.origin;
      add({ id: `fit_${it.uid}`, label: `Fit ${PARTS[it.def].name} (${cond}${it.flags.length ? ', ' + it.flags.join(', ') : ''})`, enabled: r.ok, reason: r.reasons[0], run: () => g.fitPart(slotId, it.uid), kind: 'primary' });
    }
  }

  // Measurements on installed parts
  if (p) for (const m of PARTS[p.def].measurements ?? []) {
    if (m.where === 'removed') continue;
    const corner = slotId.match(/^whl\.(\w\w)$/)?.[1];
    const needsReach = !corner && !slotId.startsWith('body.spare');
    const ok = (!needsReach || reach.ok) && !!kind && m.tools.includes(kind as any);
    add({ id: `meas_${m.id}`, label: `Measure: ${m.label}`, enabled: ok, reason: !reach.ok && needsReach ? reach.reasons[0] : `Select ${m.tools.map((t) => Object.values(TOOLS).find((x) => x.kind === t)?.name ?? t).join(' or ')}`, run: () => g.measure(p, m, slotId) });
  }

  // Slot-specific procedures
  switch (slotId) {
    case 'lub.dipstick': add({ id: 'dip', label: 'Withdraw, wipe, re-insert and read', enabled: reach.ok && !!p, reason: reach.reasons[0], run: () => g.readDipstick(), kind: 'primary' }); break;
    case 'lub.filler_cap':
      if (!p) {
        add({ id: 'funnel', label: v.funnelIn ? 'Remove funnel' : 'Insert funnel', enabled: g.owns('funnel'), run: () => g.toggleFunnel() });
        add({ id: 'pour', label: g.heldContainer() ? `Hold: pour ${PARTS[g.heldContainer()!.def].name}` : 'Pour oil (hold a container first)', enabled: !!g.heldContainer(), hold: { down: () => g.startPour('oil'), up: () => g.stopPour() } });
      }
      break;
    case 'cool.header_cap':
      if (p && d.thread && g.dir === 'undo' && v.engine.coolantC > 90) A.unshift({ id: 'warn', label: '⚠ Engine HOT — pressurised coolant', enabled: false, kind: 'danger' });
      if (!p) {
        add({ id: 'level', label: 'Look at coolant level', enabled: reach.ok, run: () => g.coolantCheck() });
        add({ id: 'hydro', label: 'Antifreeze hydrometer test', enabled: kind === 'hydrometer', reason: 'Select the hydrometer', run: () => g.hydrometer() });
        add({ id: 'ptest', label: 'Pressure test (cold)', enabled: g.owns('pressure_tester'), reason: 'Requires a cooling-system pressure tester', run: () => g.pressureTest() });
        add({ id: 'pourc', label: g.heldContainer() ? `Hold: pour ${PARTS[g.heldContainer()!.def].name}` : 'Pour coolant (hold a container first)', enabled: !!g.heldContainer(), hold: { down: () => g.startPour('coolant'), up: () => g.stopPour() } });
      }
      break;
    case 'brk.reservoir': case 'clu.reservoir': {
      const c = slotId === 'brk.reservoir' ? 'brake' : 'clutch';
      add({ id: 'lvl', label: 'Check fluid level', enabled: reach.ok, reason: reach.reasons[0], run: () => { const l = Object.values(v[c].comp).reduce((a, b) => a + (b ?? 0), 0) / (c === 'brake' ? 1.0 : 0.35); g.recordTest(`${c}.level`, `${c === 'brake' ? 'Brake' : 'Clutch'} fluid level`, l > 0.85 ? 'At MAX line' : l > 0.7 ? 'Between MIN and MAX' : 'Below MIN', c === 'brake' ? 'brakes' : 'transmission'); } });
      add({ id: 'top', label: g.heldContainer() ? `Hold: top up with ${PARTS[g.heldContainer()!.def].name}` : 'Top up (hold a container first)', enabled: reach.ok && !!g.heldContainer(), hold: { down: () => g.startPour(c), up: () => g.stopPour() } });
      break;
    }
    case 'trn.gbx_level': case 'trn.diff_level':
      if (!p) {
        const c = slotId === 'trn.gbx_level' ? 'gearbox' : 'diff';
        add({ id: 'feel', label: 'Check level with a finger', enabled: reach.ok, run: () => { const l = Object.values(v[c].comp).reduce((a, b) => a + (b ?? 0), 0) / (c === 'gearbox' ? 1.42 : 1.56); g.recordTest(`${c}.level`, `${c === 'gearbox' ? 'Gearbox' : 'Differential'} oil level`, l > 0.97 ? 'Oil at the bottom of the plug hole — correct' : l > 0.85 ? 'Oil just reachable with a fingertip — slightly low' : 'Cannot reach oil — low'); } });
        add({ id: 'fill', label: 'Hold: pump in gear oil', enabled: reach.ok && !!g.heldContainer() && g.owns('fluid_pump'), reason: 'Hold a gear-oil container and own a fluid pump', hold: { down: () => g.startPour(c), up: () => g.stopPour() } });
      }
      break;
    case 'eng.fan_belt':
      if (p) add({ id: 'adjust', label: 'Adjust tension (lever the alternator)', enabled: g.canFitBelt(), reason: 'Slacken the pivot and link bolts first', run: () => bus.emit('ui:open', { panel: 'belt' }) });
      break;
    case 'elec.battery':
      if (p) {
        add({ id: 'charger', label: g.state.workshop.charger.connected ? 'Disconnect battery charger' : 'Connect battery charger', enabled: g.owns('battery_charger') && reach.ok, reason: 'You do not own a charger', run: () => g.toggleCharger() });
        add({ id: 'cleanp', label: 'Clean battery posts (wire brush)', enabled: kind === 'wire_brush', reason: 'Select the wire brush', run: () => g.cleanPart('elec.battery') });
      }
      break;
    case 'whl.FL': case 'whl.FR': case 'whl.RL': case 'whl.RR': case 'body.spare_wheel':
      if (p) {
        const corner = slotId === 'body.spare_wheel' ? 'spare' : slotId.slice(4);
        add({ id: 'inflate', label: 'Hold: inflate (air line)', enabled: g.owns('air_line'), hold: { down: () => g.startInflate(corner, 1), up: () => g.stopInflate() } });
        add({ id: 'deflate', label: 'Hold: bleed air (gauge button)', enabled: kind === 'tyre_gauge', reason: 'Select the tyre gauge', hold: { down: () => g.startInflate(corner, -1), up: () => g.stopInflate() } });
        if (corner !== 'spare' && !wheelOffGround(v, corner as Corner)) A.push({ id: 'note', label: 'Tip: raise the wheel to rotate and inspect the whole tread', enabled: false, kind: 'info' });
      }
      break;
    case 'body.bonnet':
      if (v.oil.oilOnEngine > 0) add({ id: 'wipe', label: 'Wipe spilt oil off the engine (rag)', enabled: kind === 'rag', reason: 'Select a rag', run: () => g.cleanEngineBay() });
      break;
  }
  if (slotId === 'eng.block') {
    const loc = v.engineLoc ?? 'car';
    if (loc === 'car') {
      const b = g.engineBlockers();
      add({ id: 'lift', label: 'Hoist: lift engine & gearbox out', enabled: g.owns('engine_hoist'), reason: 'Buy an engine hoist (Tools)', run: () => g.liftEngine(), kind: 'primary' });
      if (b.length && g.assist !== 'master') add({ id: 'blk', label: `${b.length} item(s) still holding the engine`, enabled: false, reason: b.slice(0, 4).join(' · '), kind: 'danger' });
    }
    if (loc === 'hoist') {
      add({ id: 'stand', label: 'Mount engine on the engine stand', enabled: g.owns('engine_stand'), reason: 'Buy an engine stand (Tools)', run: () => g.mountOnStand(), kind: 'primary' });
      add({ id: 'lower', label: 'Lower engine back into the car', enabled: true, run: () => g.lowerEngine() });
    }
    if (loc === 'stand') add({ id: 'unstand', label: 'Lift engine off the stand onto the hoist', enabled: g.owns('engine_hoist'), run: () => g.liftFromStand() });
  }
  if (slotId === 'exh.system') add({ id: 'smoke', label: 'Observe the exhaust (engine running)', enabled: v.engine.running, reason: 'Start the engine', run: () => g.observeExhaust() });
  if (slotId.startsWith('ign.plug_') && !p && g.owns('compression_tester')) add({ id: 'comp', label: 'Compression test this cylinder', enabled: reach.ok, run: () => g.compressionTest(+slotId.slice(-1)) });
  if (d.thread && p && s.turnsIn >= d.thread.turns - 0.05 && (g.assist === 'beginner')) {
    const vd = torqueVerdict(v, slotId);
    A.push({ id: 'tq', label: `Torque status: ${vd}`, enabled: false, kind: 'info' });
  }
  return A;
}
