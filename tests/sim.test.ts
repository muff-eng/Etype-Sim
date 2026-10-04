import { describe, it, expect } from 'vitest';
import { createVehicle, partIn, slotVars, sumpOil } from '../src/sim/vehicle';
import { evaluate, elecInputsFrom, meterOhms, meterVolts } from '../src/sim/electrical';
import { simulate } from '../src/sim/engine';
import { FAULTS } from '../src/data/faults';
import { assemblyCheck, analyzeVehicle } from '../src/sim/diagnostics';
import { driveCheck, workFastener, torqueVerdict } from '../src/sim/threads';
import { SLOTS } from '../src/data/slots';

function run(v: ReturnType<typeof createVehicle>, seconds: number, scale = 6, cb?: (t: number) => void) {
  let eng = false;
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    cb?.(t);
    const o = simulate(v, dt, scale, eng);
    eng = o.elec.solenoidEngaged;
  }
}

describe('electrical', () => {
  it('rest voltage of a charged battery', () => {
    const v = createVehicle();
    const r = evaluate(v, { ...elecInputsFrom(v) });
    expect(r.V['B+'] - r.V['B-']).toBeGreaterThan(12.5);
  });
  it('healthy cranking', () => {
    const v = createVehicle();
    slotVars(v, 'int.ignition').on = 1;
    const r = evaluate(v, { ...elecInputsFrom(v), ignOn: true, starter: true });
    expect(r.solenoidEngaged).toBe(true);
    expect(r.motorV).toBeGreaterThan(8);
    expect(r.motorV).toBeLessThan(10.5);
  });
  it('corroded terminal causes poor cranking and a measurable drop', () => {
    const v = createVehicle();
    FAULTS.batt_terminal.apply(v);
    const r = evaluate(v, { ...elecInputsFrom(v), ignOn: true, starter: true });
    const healthy = evaluate(createVehicle(), { ...elecInputsFrom(v), ignOn: true, starter: true });
    expect(r.motorV).toBeLessThan(healthy.motorV - 2);
    const drop = meterVolts(v, { ...elecInputsFrom(v), ignOn: true, starter: true }, 'B+', 'T+');
    expect(drop).toBeGreaterThan(0.5);
  });
  it('ohmmeter refuses live circuits and reads continuity on dead ones', () => {
    const v = createVehicle();
    expect(Number.isNaN(meterOhms(v, elecInputsFrom(v), 'B+', 'B-'))).toBe(true);
    slotVars(v, 'elec.term_neg').off = 1;
    const r = meterOhms(v, elecInputsFrom(v), 'F1i', 'F1o');
    expect(r).toBeLessThan(1);
    partIn(v, 'elec.fuse_1')!.flags.push('blown');
    expect(meterOhms(v, elecInputsFrom(v), 'F1i', 'F1o')).toBe(Infinity);
  });
});

describe('engine', () => {
  it('starts and idles, builds oil pressure and charges', () => {
    const v = createVehicle();
    slotVars(v, 'int.ignition').on = 1;
    slotVars(v, 'int.choke').on = 1;
    run(v, 3, 6, (t) => { slotVars(v, 'int.starter_button').pressed = t > 0.5 && t < 2.8 && !v.engine.running ? 1 : 0; });
    expect(v.engine.running).toBe(true);
    run(v, 4);
    expect(v.engine.rpm).toBeGreaterThan(600);
    expect(v.engine.oilPressure).toBeGreaterThan(15);
    expect(v.engine.chargeV).toBeGreaterThan(13.5);
  });
  it('fouled plug causes a misfire', () => {
    const v = createVehicle();
    FAULTS.plug_fouled.apply(v);
    slotVars(v, 'int.ignition').on = 1; slotVars(v, 'int.choke').on = 1;
    run(v, 3, 6, (t) => { slotVars(v, 'int.starter_button').pressed = t > 0.5 && !v.engine.running ? 1 : 0; });
    run(v, 2);
    expect(v.engine.running).toBe(true);
    expect(v.engine.misfire[3]).toBe(1);
  });
  it('corroded terminal + half-flat battery will not start', () => {
    const v = createVehicle();
    FAULTS.batt_terminal.apply(v);
    slotVars(v, 'int.ignition').on = 1; slotVars(v, 'int.choke').on = 1;
    run(v, 4, 6, (t) => { slotVars(v, 'int.starter_button').pressed = t > 0.5 ? 1 : 0; });
    expect(v.engine.running).toBe(false);
  });
  it('slack belt reduces charging voltage', () => {
    const v = createVehicle();
    FAULTS.slack_belt.apply(v);
    slotVars(v, 'int.ignition').on = 1; slotVars(v, 'int.choke').on = 1;
    run(v, 3, 6, (t) => { slotVars(v, 'int.starter_button').pressed = t > 0.5 && !v.engine.running ? 1 : 0; });
    v.engine.throttle = 0.28;
    run(v, 4);
    expect(v.engine.running).toBe(true);
    expect(v.engine.chargeV).toBeLessThan(13.4);
  });
  it('loose hose clip overheats', () => {
    const v = createVehicle();
    FAULTS.hose_clip.apply(v);
    slotVars(v, 'int.ignition').on = 1; slotVars(v, 'int.choke').on = 1;
    run(v, 3, 6, (t) => { slotVars(v, 'int.starter_button').pressed = t > 0.5 && !v.engine.running ? 1 : 0; });
    slotVars(v, 'int.choke').on = 0;
    run(v, 240, 6);
    expect(v.engine.coolantC).toBeGreaterThan(100);
    const ok = createVehicle();
    slotVars(ok, 'int.ignition').on = 1; slotVars(ok, 'int.choke').on = 1;
    run(ok, 3, 6, (t) => { slotVars(ok, 'int.starter_button').pressed = t > 0.5 && !ok.engine.running ? 1 : 0; });
    slotVars(ok, 'int.choke').on = 0;
    run(ok, 240, 6);
    expect(ok.engine.coolantC).toBeLessThan(96);
    expect(ok.engine.coolantC).toBeGreaterThan(75);
  });
  it('drains oil when the plug is removed', () => {
    const v = createVehicle();
    const s = v.slots['lub.drain_plug'];
    s.part = null;
    run(v, 120, 6);
    expect(sumpOil(v)).toBeLessThan(0.5);
  });
});

describe('fasteners', () => {
  it('cross-threads when started with a ratchet, torques correctly with a torque wrench', () => {
    const v = createVehicle();
    const s = v.slots['lub.drain_plug'];
    s.turnsIn = 0; s.torque = 0; s.handStarted = false;
    const dcR = driveCheck(SLOTS['lub.drain_plug'], { primary: 'ratchet_38', socket: 'socket_1516af', extension: false });
    expect(dcR.ok).toBe(true);
    const pull = { t: 0, clicked: false, applied: 0, broke: false };
    workFastener(v, 'lub.drain_plug', dcR, { dir: 'do', dt: 0.1, pull }, 'ratchet');
    expect(s.crossThreaded).toBe(true);
    // fresh: hand start then torque wrench
    s.turnsIn = 0; s.crossThreaded = false; s.threadDamage = 0;
    const hand = driveCheck(SLOTS['lub.drain_plug'], { primary: null, socket: null, extension: false });
    for (let i = 0; i < 200 && s.turnsIn < 7; i++) workFastener(v, 'lub.drain_plug', hand, { dir: 'do', dt: 0.1, pull }, null);
    expect(s.handStarted).toBe(true);
    const tw = driveCheck(SLOTS['lub.drain_plug'], { primary: 'torque_wrench', socket: 'socket_1516af', extension: false });
    const p2 = { t: 0, clicked: false, applied: 0, broke: false };
    for (let i = 0; i < 400 && !p2.clicked; i++) workFastener(v, 'lub.drain_plug', tw, { dir: 'do', dt: 0.05, pull: p2, torqueSetting: 34 }, 'torque_wrench');
    expect(torqueVerdict(v, 'lub.drain_plug')).toBe('correct');
  });
  it('fresh vehicle passes assembly check and error analysis', () => {
    const v = createVehicle();
    const fails = assemblyCheck(v).filter((c) => !c.ok);
    expect(fails.map((f) => f.label)).toEqual([]);
    const bad = analyzeVehicle(v).filter((c) => !c.ok);
    expect(bad.map((b) => b.label + ': ' + b.detail)).toEqual([]);
  });
});
