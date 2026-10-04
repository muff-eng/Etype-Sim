import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/Game';
import { FAULTS } from '../src/data/faults';
import { partIn } from '../src/sim/vehicle';

const tick = (g: Game, n = 1) => { for (let i = 0; i < n; i++) g.tick(1 / 30); };
function turn(g: Game, slot: string, dir: 'undo' | 'do', tool: string | null, socket: string | null = null, tw?: number, ext = false) {
  g.selectTool(tool); if (socket) g.selectTool(socket);
  g.grip.extension = ext;
  g.dir = dir; if (tw) g.torqueSetting = tw;
  if (!g.beginWork(slot)) throw new Error(`cannot work ${slot}: ${g.driveFor(slot).reason}`);
  for (let n = 0; n < 4000; n++) {
    tick(g);
    const s = g.v.slots[slot];
    if (dir === 'undo' && !s.part) break;
    if (dir === 'undo' && g.work.lastEvents.includes('released' as any)) break;
    if (dir === 'do' && g.work.pull.clicked) break;
    if (dir === 'do' && !tw && (g.work.lastEvents.includes('stall' as any) || g.work.lastEvents.includes('seated' as any))) break;
    if (!g.work.slot) break;
  }
  g.endWork();
}
function job(id: string) {
  const g = new Game(Game.freshState('tier1'));
  g.state.money = 5000;
  g.startJob(id);
  for (const t of ['torque_wrench', 'multimeter', 'battery_charger', 'insulated_pliers', 'breaker_bar']) g.buyTool(t);
  return g;
}
const openBonnet = (g: Game) => { g.toggle('body.door_L'); g.toggle('body.door_R'); g.pullRelease('L'); g.pullRelease('R'); g.toggle('body.bonnet'); };
const fresh = (g: Game, def: string) => Object.values(g.state.inventory).find((p) => p.def === def && p.location === 'stock')!;

describe('Tier I jobs are solvable', () => {
  it('reluctant starter: clean terminals + charge', () => {
    const g = job('t1_nostart');
    openBonnet(g);
    turn(g, 'elec.term_neg', 'undo', 'spanner_716af');
    g.setConnector('elec.term_neg', false);
    turn(g, 'elec.term_pos', 'undo', 'spanner_716af');
    g.setConnector('elec.term_pos', false);
    g.selectTool('wire_brush'); g.cleanPart('elec.term_pos'); g.cleanPart('elec.term_neg'); g.cleanPart('elec.battery');
    g.toggleCharger(); g.wait(300); g.toggleCharger();
    g.setConnector('elec.term_pos', true);
    turn(g, 'elec.term_pos', 'do', 'spanner_716af');
    turn(g, 'elec.term_pos', 'do', 'torque_wrench', 'socket_716af', 5);
    g.setConnector('elec.term_neg', true);
    turn(g, 'elec.term_neg', 'do', 'spanner_716af');
    turn(g, 'elec.term_neg', 'do', 'torque_wrench', 'socket_716af', 5);
    expect(FAULTS.batt_terminal.resolved(g.v)).toBe(true);
  });
  it('lumpy idle: renew and gap plugs', () => {
    const g = job('t1_misfire');
    openBonnet(g);
    g.buyPart('plug_n5', 6);
    for (let c = 1; c <= 6; c++) {
      g.setConnector(`ign.lead_${c}`, false);
      turn(g, `ign.plug_${c}`, 'undo', 'ratchet_38', 'plug_socket', undefined, true);
      expect(g.v.slots[`ign.plug_${c}`].part).toBeNull();
      const p = fresh(g, 'plug_n5');
      g.selectTool('gap_tool'); g.setPlugGap(p, 0.64);
      g.fitPart(`ign.plug_${c}`, p.uid);
      turn(g, `ign.plug_${c}`, 'do', null);
      turn(g, `ign.plug_${c}`, 'do', 'torque_wrench', 'plug_socket', 37, true);
      g.setConnector(`ign.lead_${c}`, true, c);
    }
    expect(FAULTS.plug_fouled.resolved(g.v)).toBe(true);
  });
  it('temperature creeping: tighten clip, top up', () => {
    const g = job('t1_hot');
    openBonnet(g);
    turn(g, 'cool.clip_rad', 'do', 'screwdriver_flat');
    g.v.slots['cool.clip_rad'].torque = Math.min(g.v.slots['cool.clip_rad'].torque, 3.8);
    turn(g, 'cool.header_cap', 'undo', null);
    g.buyPart('coolant_premix_5l', 1);
    g.hold(fresh(g, 'coolant_premix_5l').uid); g.startPour('coolant'); tick(g, 600); g.stopPour();
    g.fitPart('cool.header_cap', Object.values(g.state.inventory).find((p) => p.def === 'header_cap')!.uid);
    turn(g, 'cool.header_cap', 'do', null);
    expect(FAULTS.hose_clip.resolved(g.v)).toBe(true);
  });
  it('flat battery: renew belt and tension it', () => {
    const g = job('t1_charge');
    openBonnet(g);
    turn(g, 'elec.alt_pivot', 'undo', 'ratchet_38', 'socket_12af');
    turn(g, 'elec.alt_adjust', 'undo', 'ratchet_38', 'socket_12af');
    g.adjustBelt(30);
    g.removePart('eng.fan_belt');
    g.buyPart('fan_belt');
    g.fitPart('eng.fan_belt', fresh(g, 'fan_belt').uid);
    g.adjustBelt(11.5);
    turn(g, 'elec.alt_adjust', 'do', 'torque_wrench', 'socket_12af', 20);
    turn(g, 'elec.alt_pivot', 'do', 'torque_wrench', 'socket_12af', 27);
    expect(FAULTS.slack_belt.resolved(g.v)).toBe(true);
  });
  it('silent horn: replace fuse with same rating', () => {
    const g = job('t1_horn');
    turn(g, 'int.panel_screw_1', 'undo', null); turn(g, 'int.panel_screw_2', 'undo', null);
    g.toggle('int.center_panel');
    g.selectTool('fuse_puller'); g.removePart('elec.fuse_1');
    g.buyPart('fuse_50a');
    g.fitPart('elec.fuse_1', fresh(g, 'fuse_50a').uid);
    g.horn(true);
    expect(g.hasMilestone('horn_ok')).toBe(true);
    expect(FAULTS.horn_fuse.resolved(g.v)).toBe(true);
  });
  it('pulls left: swap to spare and set pressures', () => {
    const g = job('t1_pull');
    g.selectTool('copper_mallet'); g.dir = 'undo';
    turn(g, 'whl.spinner_FL', 'undo', 'copper_mallet');
    expect(g.v.slots['whl.spinner_FL'].part).toBeNull();
    g.placeJack('FL'); for (let i = 0; i < 40; i++) g.pumpJack(1, 0.1);
    g.removePart('whl.FL');
    g.toggle('body.hatch'); g.toggle('body.boot_floor');
    turn(g, 'body.spare_clamp', 'undo', null);
    g.removePart('body.spare_wheel');
    const spare = Object.values(g.state.inventory).find((p) => p.def === 'wheel_wire' && !p.flags.includes('punctured'))!;
    g.fitPart('whl.FL', spare.uid);
    g.fitPart('whl.spinner_FL', Object.values(g.state.inventory).find((p) => p.def === 'spinner_l')!.uid);
    turn(g, 'whl.spinner_FL', 'do', null);
    for (let i = 0; i < 60; i++) g.pumpJack(-1, 0.2); g.removeJack();
    turn(g, 'whl.spinner_FL', 'do', 'copper_mallet');
    for (const c of ['FL', 'FR', 'RL', 'RR']) { const w = partIn(g.v, `whl.${c}`)!; w.vars.pressure = 32; }
    expect(FAULTS.puncture_fl.resolved(g.v)).toBe(true);
  });
});
