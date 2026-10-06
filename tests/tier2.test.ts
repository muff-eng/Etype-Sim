import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/Game';
import { FAULTS } from '../src/data/faults';
import { ENGINE_CONNECTIONS } from '../src/data/slots';
import { PARTS, bearingClearance } from '../src/data/parts';
import { torqueVerdict } from '../src/sim/threads';
import { connected, sumpOil } from '../src/sim/vehicle';
import { total } from '../src/data/fluids';
const dbg = (g: Game, ks: string[]) => console.log('DBG', JSON.stringify(Object.fromEntries(ks.map((k) => [k, torqueVerdict(g.v, k)]))), 'cool', total(g.v.coolant.comp), 'tap', g.v.slots['cool.radiator'].vars.tap, 'conn', ENGINE_CONNECTIONS.filter((k) => !connected(g.v, k)), 'oil', sumpOil(g.v), 'clr', bearingClearance(g.v,'main'), bearingClearance(g.v,'rod'), 'loc', g.v.engineLoc, 'gasket', JSON.stringify(g.v.parts[g.v.slots['eng.head_gasket'].part!]?.flags), 'leads', [1,2,3,4,5,6].map(c=>connected(g.v,`ign.lead_${c}`)));

const tick = (g: Game, n = 1) => { for (let i = 0; i < n; i++) g.tick(1 / 30); };
function turn(g: Game, slot: string, dir: 'undo' | 'do', tool: string | null, socket: string | null = null, tw?: number) {
  g.selectTool(tool); if (socket) g.selectTool(socket);
  g.dir = dir; if (tw) g.torqueSetting = tw;
  if (!g.beginWork(slot)) throw new Error(`cannot work ${slot}: ${g.driveFor(slot).reason}`);
  for (let n = 0; n < 6000; n++) {
    tick(g);
    const s = g.v.slots[slot];
    if (dir === 'undo' && !s.part) break;
    if (dir === 'undo' && g.work.lastEvents.includes('released' as any)) break;
    if (dir === 'undo' && s.torque === 0 && g.toolKind() && !g.work.dc?.hand && s.turnsIn < 4 && !SLOTSCaptive(slot)) { g.endWork(); g.selectTool(null); if (!g.beginWork(slot)) break; }
    if (dir === 'do' && g.work.pull.clicked) break;
    if (dir === 'do' && !tw && (g.work.lastEvents.includes('stall' as any) || g.work.lastEvents.includes('seated' as any))) break;
    if (!g.work.slot) break;
  }
  g.endWork();
}
const SLOTSCaptive = (s: string) => ['eng.mount_bolts', 'elec.term_neg', 'elec.term_pos'].includes(s);
const inv = (g: Game) => Object.values(g.state.inventory);
const fresh = (g: Game, def: string) => inv(g).find((p) => p.def === def && p.location === 'stock')!;
const tray = (g: Game, def: string) => inv(g).find((p) => p.def === def && p.location === 'tray')!;
function job(id: string) {
  const g = new Game(Game.freshState('tier1'));
  g.state.money = 20000;
  g.startJob(id);
  for (const t of ['torque_wrench', 'breaker_bar', 'engine_hoist', 'engine_stand', 'micrometer', 'plastigauge', 'compression_tester']) g.buyTool(t);
  g.toggle('body.door_L'); g.toggle('body.door_R'); g.pullRelease('L'); g.pullRelease('R'); g.toggle('body.bonnet');
  return g;
}
const refillCoolant = (g: Game) => {
  turn(g, 'cool.header_cap', 'undo', null);
  g.buyPart('coolant_premix_5l', 4);
  for (const c of inv(g).filter((p) => p.def === 'coolant_premix_5l')) { g.hold(c.uid); g.startPour('coolant'); tick(g, 400); g.stopPour(); }
  g.hold(null);
  g.fitPart('cool.header_cap', inv(g).find((p) => p.def === 'header_cap')!.uid); turn(g, 'cool.header_cap', 'do', null);
};

describe('Tier II', () => {
  it('head gasket job is diagnosable and fixable', () => {
    const g = job('t2_headgasket');
    g.compressionTest(3); // plug in → refused; just exercise
    g.v.slots['cool.radiator'].vars.tap = 1;
    g.wait(30);
    g.v.slots['cool.radiator'].vars.tap = 0;
    g.ws.drainPan.comp = {};
    g.setConnector('eng.conn_top_hose', false);
    for (let c = 1; c <= 6; c++) g.setConnector(`ign.lead_${c}`, false);
    g.v.engine.coolantC = 20;
    turn(g, 'lub.filler_cap', 'undo', null);
    for (const side of ['in', 'ex']) { turn(g, `eng.cover_nuts_${side}`, 'undo', 'ratchet_38', 'socket_716af'); g.removePart(`eng.cam_cover_${side}`); }
    expect(g.v.slots['eng.cam_cover_in'].part).toBeNull();
    for (let n = 1; n <= 14; n++) turn(g, `eng.head_nut_${n}`, 'undo', 'breaker_bar', 'socket_34af');
    g.removePart('eng.head');
    expect(g.v.slots['eng.head'].part).toBeNull();
    g.removePart('eng.head_gasket');
    g.buyPart('head_gasket');
    g.fitPart('eng.head_gasket', fresh(g, 'head_gasket').uid);
    g.fitPart('eng.head', tray(g, 'p.eng.head').uid);
    for (let n = 1; n <= 14; n++) { g.fitPart(`eng.head_nut_${n}`, tray(g, 'p.head_nut').uid); turn(g, `eng.head_nut_${n}`, 'do', null); turn(g, `eng.head_nut_${n}`, 'do', 'torque_wrench', 'socket_34af', 73); }
    for (const side of ['in', 'ex']) {
      g.fitPart(`eng.cam_cover_${side}`, tray(g, `p.eng.cam_cover_${side}`).uid);
      g.fitPart(`eng.cover_nuts_${side}`, tray(g, 'p.cover_nuts').uid);
      turn(g, `eng.cover_nuts_${side}`, 'do', null); turn(g, `eng.cover_nuts_${side}`, 'do', 'torque_wrench', 'socket_716af', 7);
    }
    g.fitPart('lub.filler_cap', tray(g, 'filler_cap').uid); turn(g, 'lub.filler_cap', 'do', null);
    g.setConnector('eng.conn_top_hose', true);
    for (let c = 1; c <= 6; c++) g.setConnector(`ign.lead_${c}`, true, c);
    refillCoolant(g);
    expect(g.state.job!.damage).toEqual([]);
    dbg(g, ['eng.head_nut_1','eng.head_nut_8','eng.cover_nuts_in','eng.cover_nuts_ex']);
    expect(FAULTS.head_gasket.resolved(g.v)).toBe(true);
  });

  it('bottom-end rebuild: engine out, measure, regrind, rebuild, refit', () => {
    const g = job('t2_knock');
    expect(g.v.engine.bearingDamage).toBeGreaterThan(0.3);
    // make safe & drain
    turn(g, 'elec.term_neg', 'undo', 'spanner_716af'); g.setConnector('elec.term_neg', false);
    g.v.oil.comp = {}; g.v.coolant.comp = {};
    g.toggleChocks(); g.placeJack('F'); for (let i = 0; i < 60; i++) g.pumpJack(1, 0.1); g.placeStand('FL'); g.placeStand('FR'); for (let i = 0; i < 30; i++) g.pumpJack(-1, 0.2); g.removeJack();
    g.liftEngine();
    expect(g.v.engineLoc).toBe('car'); // still connected
    for (const k of ENGINE_CONNECTIONS) g.setConnector(k, false);
    turn(g, 'eng.mount_bolts', 'undo', 'ratchet_38', 'socket_916af');
    expect(g.engineBlockers()).toEqual([]);
    g.liftEngine(); g.mountOnStand();
    expect(g.v.engineLoc).toBe('stand');
    turn(g, 'eng.sump_bolts', 'undo', 'ratchet_38', 'socket_12af'); g.removePart('eng.sump');
    g.removePart('eng.oil_pickup'); g.removePart('eng.oil_pump');
    for (let c = 1; c <= 6; c++) turn(g, `eng.rod_nuts_${c}`, 'undo', 'ratchet_38', 'socket_916af');
    g.removePart('eng.rod_bearings');
    turn(g, 'eng.main_bolts', 'undo', 'breaker_bar', 'socket_34af');
    g.removePart('eng.crankshaft');
    g.removePart('eng.main_bearings');
    const crank = tray(g, 'crankshaft');
    g.selectTool('micrometer'); g.measure(crank, PARTS.crankshaft.measurements![2]);
    expect(g.hasMilestone('measure.main')).toBe(true);
    g.machineShop(crank.uid, 'regrind');
    g.buyPart('main_bearings_010'); g.buyPart('rod_bearings_010');
    g.fitPart('eng.main_bearings', fresh(g, 'main_bearings_010').uid);
    g.fitPart('eng.crankshaft', crank.uid);
    g.fitPart('eng.main_bolts', tray(g, 'p.main_bolts').uid); turn(g, 'eng.main_bolts', 'do', null); turn(g, 'eng.main_bolts', 'do', 'torque_wrench', 'socket_34af', 113);
    g.fitPart('eng.rod_bearings', fresh(g, 'rod_bearings_010').uid);
    expect(bearingClearance(g.v, 'main')).toBeGreaterThan(0.064);
    expect(bearingClearance(g.v, 'main')).toBeLessThan(0.107);
    for (let c = 1; c <= 6; c++) { g.fitPart(`eng.rod_nuts_${c}`, tray(g, 'p.rod_nuts').uid); turn(g, `eng.rod_nuts_${c}`, 'do', null); turn(g, `eng.rod_nuts_${c}`, 'do', 'torque_wrench', 'socket_916af', 50); }
    g.fitPart('eng.oil_pump', tray(g, 'p.eng.oil_pump').uid); g.fitPart('eng.oil_pickup', tray(g, 'p.eng.oil_pickup').uid);
    g.fitPart('eng.sump', tray(g, 'p.eng.sump').uid);
    g.fitPart('eng.sump_bolts', tray(g, 'p.sump_bolts').uid); turn(g, 'eng.sump_bolts', 'do', null); turn(g, 'eng.sump_bolts', 'do', 'torque_wrench', 'socket_12af', 20);
    g.liftFromStand(); g.lowerEngine();
    turn(g, 'eng.mount_bolts', 'do', 'ratchet_38', 'socket_916af'); turn(g, 'eng.mount_bolts', 'do', 'torque_wrench', 'socket_916af', 40);
    for (const k of ENGINE_CONNECTIONS) g.setConnector(k, true);
    g.v.oil.comp = { oil_20w50: 7.95 }; g.v.oil.canister = 0.55;
    refillCoolant(g);
    expect(g.state.job!.damage).toEqual([]);
    expect(g.v.engine.bearingDamage).toBeLessThan(0.05);
    dbg(g, ['eng.main_bolts','eng.sump_bolts','eng.mount_bolts','eng.rod_nuts_1']);
    expect(FAULTS.bearing_knock.resolved(g.v)).toBe(true);
  });
});
