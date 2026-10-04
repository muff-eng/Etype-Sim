import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/Game';

function setup() {
  const g = new Game(Game.freshState('tier1'));
  g.state.settings.timeScale = 6;
  g.startJob('t1_service');
  g.buyTool('torque_wrench');
  return g;
}
const tick = (g: Game, n = 1) => { for (let i = 0; i < n; i++) g.tick(1 / 30); };
function turn(g: Game, slot: string, dir: 'undo' | 'do', tool: string | null, socket: string | null, tw?: number) {
  g.selectTool(tool); if (socket) g.selectTool(socket);
  g.dir = dir; if (tw) g.torqueSetting = tw;
  expect(g.beginWork(slot)).toBe(true);
  for (let n = 0; n < 3000; n++) {
    tick(g);
    const s = g.v.slots[slot];
    if (dir === 'undo' && !s.part) break;
    if (dir === 'undo' && s.torque === 0 && s.turnsIn < 5 && g.toolKind()) { g.endWork(); g.selectTool(null); expect(g.beginWork(slot)).toBe(true); }
    if (dir === 'do' && g.work.pull.clicked) break;
    if (dir === 'do' && !tw && s.turnsIn >= 6.99 && g.toolKind() === null) break;
    if (!g.work.slot) break;
  }
  g.endWork();
}

describe('oil change job', () => {
  it('the starting kit has no torque wrench — a ratchet can over-torque and strip the alloy sump', () => {
    const g = new Game(Game.freshState('tier1'));
    g.startJob('t1_service');
    expect(g.owns('torque_wrench')).toBe(false);
  });
  it('torque wrench clicks at the set value', () => {
    const g = setup();
    g.toggle('body.door_L'); g.toggle('body.door_R'); g.pullRelease('L'); g.pullRelease('R'); g.toggle('body.bonnet');
    g.toggleChocks(); g.placeJack('F'); for (let i = 0; i < 60; i++) g.pumpJack(1, 0.1);
    g.placeStand('FL'); g.placeStand('FR'); for (let i = 0; i < 30; i++) g.pumpJack(-1, 0.2); g.removeJack();
    turn(g, 'lub.drain_plug', 'undo', 'ratchet_38', 'socket_1516af');
    expect(g.v.slots['lub.drain_plug'].part).toBeNull();
    const plug = Object.values(g.state.inventory).find((p) => p.def === 'drain_plug')!;
    const washer = Object.values(g.state.inventory).find((p) => p.def === 'washer_drain');
    void washer;
    g.fitPart('lub.drain_plug', plug.uid);
    turn(g, 'lub.drain_plug', 'do', null, null);
    expect(g.v.slots['lub.drain_plug'].turnsIn).toBeGreaterThan(6.9);
    turn(g, 'lub.drain_plug', 'do', 'torque_wrench', 'socket_1516af', 34);
    const s = g.v.slots['lub.drain_plug'];
    expect(s.threadDamage).toBe(0);
    expect(s.torque).toBeGreaterThan(30);
    expect(s.torque).toBeLessThan(38);
  });
});

describe('complete Tier I oil service', () => {
  it('earns a good grade when done properly', () => {
    const g = setup();
    g.toggle('body.door_L'); g.toggle('body.door_R'); g.pullRelease('L'); g.pullRelease('R'); g.toggle('body.bonnet');
    g.toggleChocks(); g.placeJack('F'); for (let i = 0; i < 60; i++) g.pumpJack(1, 0.1);
    g.placeStand('FL'); g.placeStand('FR'); for (let i = 0; i < 30; i++) g.pumpJack(-1, 0.2); g.removeJack();
    g.placeDrainPan(0.72 + 0.11, 0.1);
    turn(g, 'lub.drain_plug', 'undo', 'ratchet_38', 'socket_1516af');
    g.wait(12);
    g.removePart('lub.drain_washer');
    g.buyPart('washer_drain'); g.buyPart('filter_kit'); g.buyPart('oil_20w50_5l', 2);
    const inv = () => Object.values(g.state.inventory);
    const fresh = (def: string) => inv().find((p) => p.def === def && p.origin === 'new' && p.location === 'stock')!;
    g.fitPart('lub.drain_washer', fresh('washer_drain').uid);
    g.fitPart('lub.drain_plug', inv().find((p) => p.def === 'drain_plug')!.uid);
    turn(g, 'lub.drain_plug', 'do', null, null);
    turn(g, 'lub.drain_plug', 'do', 'torque_wrench', 'socket_1516af', 34);
    turn(g, 'lub.filter_bolt', 'undo', 'ratchet_38', 'socket_34af');
    g.removePart('lub.filter_canister'); g.removePart('lub.filter_element');
    g.selectTool('pick'); g.removePart('lub.filter_seal');
    g.fitPart('lub.filter_seal', fresh('filter_seal').uid);
    g.fitPart('lub.filter_element', fresh('filter_element').uid);
    g.fitPart('lub.filter_canister', inv().find((p) => p.def === 'filter_canister')!.uid);
    g.fitPart('lub.filter_bolt', inv().find((p) => p.def === 'filter_bolt')!.uid);
    turn(g, 'lub.filter_bolt', 'do', null, null);
    turn(g, 'lub.filter_bolt', 'do', 'torque_wrench', 'socket_34af', 20);
    g.placeJack('F'); for (let i = 0; i < 20; i++) g.pumpJack(1, 0.1);
    g.removeStand('FL'); g.removeStand('FR'); for (let i = 0; i < 60; i++) g.pumpJack(-1, 0.2); g.removeJack(); g.toggleChocks();
    turn(g, 'lub.filler_cap', 'undo', null, null);
    g.toggleFunnel();
    for (const j of inv().filter((p) => p.def === 'oil_20w50_5l')) {
      g.hold(j.uid); g.startPour('oil');
      for (let n = 0; n < 3000 && g.pouring; n++) { tick(g); if (Object.values(g.v.oil.comp).reduce((a, b) => a + (b ?? 0), 0) > 8.45) break; }
      g.stopPour();
    }
    g.hold(null);
    g.wait(3); g.readDipstick();
    g.toggleFunnel();
    g.fitPart('lub.filler_cap', inv().find((p) => p.def === 'filler_cap')!.uid);
    turn(g, 'lub.filler_cap', 'do', null, null);
    g.toggle('int.ignition'); g.toggle('int.choke'); g.setStarter(true);
    for (let n = 0; n < 300 && !g.v.engine.running; n++) tick(g);
    g.setStarter(false);
    expect(g.v.engine.running).toBe(true);
    tick(g, 200); g.toggle('int.choke'); tick(g, 200);
    expect(g.v.engine.oilPressure).toBeGreaterThan(15);
    g.toggle('int.ignition'); tick(g, 30);
    g.wait(3); g.readDipstick();
    g.toggle('body.bonnet');
    g.toggle('body.door_L'); g.toggle('body.door_R');
    const r = g.completeJob()!;
    expect(r.damage).toEqual([]);
    expect(r.faults.every((f) => f.fixed)).toBe(true);
    expect(r.checks.filter((c) => !c.ok && c.severity === 'fail').map((c) => c.label)).toEqual([]);
    expect(['A', 'B']).toContain(r.grade);
  });
});
