/**
 * Procedural audio: every sound is synthesised (no asset files). The engine is an AudioWorklet that
 * fires one exhaust pulse per cylinder event in firing order — misfiring cylinders leave audible gaps,
 * so the sound genuinely reflects engine condition.
 */
import { bus } from '../core/events';
import type { Game } from '../game/Game';

const WORKLET = `
class EngineProc extends AudioWorkletProcessor {
  constructor() {
    super();
    this.p = { rpm: 0, running: 0, cranking: 0, mis: [0,0,0,0,0,0], rough: 0, knock: 0, belt: 0, fan: 0 };
    this.angle = 0; this.env = 0; this.tone = 0; this.ph = 0; this.sph = 0; this.lp = 0; this.lp2 = 0; this.k = -1; this.kn = 0; this.fanph = 0;
    this.order = [1,5,3,6,2,4];
    this.port.onmessage = (e) => Object.assign(this.p, e.data);
  }
  process(inputs, outputs) {
    const out = outputs[0][0]; const sr = sampleRate; const p = this.p;
    for (let i = 0; i < out.length; i++) {
      this.angle = (this.angle + p.rpm * 6 / sr) % 720;
      const k = Math.floor(this.angle / 120);
      if (k !== this.k) {
        this.k = k;
        const cyl = this.order[k];
        if (p.running && !p.mis[cyl - 1]) { this.env = 0.75 + (Math.random() - 0.5) * p.rough * 0.9; this.tone = 1; }
        else if (p.cranking) { this.env = 0.28; this.tone = 0.6; }
        if (p.knock > 0.05 && Math.random() < p.knock) this.kn = 0.6;
      }
      const n = Math.random() * 2 - 1;
      this.lp += (n - this.lp) * 0.08;
      this.lp2 += (this.lp - this.lp2) * 0.2;
      this.ph += (55 + p.rpm * 0.02) / sr;
      let s = this.env * (this.lp2 * 2.2 + Math.sin(this.ph * 6.283) * 0.6 * this.tone);
      this.env *= Math.exp(-1 / (sr * (0.012 + 6 / Math.max(300, p.rpm) * 0.01)));
      if (p.cranking) { this.sph += (180 + p.rpm * 1.4) / sr; s += Math.sin(this.sph * 6.283) * 0.07 + Math.sin(this.sph * 12.566) * 0.04 + n * 0.02; }
      if (this.kn > 0.001) { s += Math.sin(this.ph * 6.283 * 18) * this.kn * 0.5; this.kn *= 0.996; }
      if (p.belt > 0) s += Math.sin(this.ph * 6.283 * 40 + Math.sin(this.ph * 30)) * 0.04 * p.belt;
      if (p.fan) { this.fanph += 140 / sr; s += (this.lp * 0.08 + Math.sin(this.fanph * 6.283) * 0.01); }
      if (p.running) s += this.lp * 0.08;
      out[i] = Math.tanh(s * 1.3) * 0.6;
    }
    return true;
  }
}
registerProcessor('engine-proc', EngineProc);
`;

type Synth = (ctx: BaseAudioContext) => AudioBuffer;

function buf(ctx: BaseAudioContext, dur: number, fn: (t: number, i: number) => number) {
  const n = Math.floor(ctx.sampleRate * dur);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = fn(i / ctx.sampleRate, i);
  return b;
}
const rnd = () => Math.random() * 2 - 1;
const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));

const SYNTH: Record<string, Synth> = {
  ratchet: (c) => buf(c, 0.06, (t) => (rnd() * 0.6 + Math.sin(t * 2 * Math.PI * 3200) * 0.4) * env(t, 0.001, 0.008)),
  thread: (c) => buf(c, 0.12, (t) => rnd() * 0.15 * env(t, 0.01, 0.05)),
  mallet: (c) => buf(c, 0.4, (t) => (Math.sin(t * 2 * Math.PI * 180) * 0.6 + Math.sin(t * 2 * Math.PI * 1250) * 0.3 + rnd() * 0.4 * Math.exp(-t / 0.01)) * env(t, 0.001, 0.08)),
  tw_click: (c) => buf(c, 0.08, (t) => (rnd() * 0.5 + Math.sin(t * 2 * Math.PI * 2400)) * env(t, 0.0005, 0.006)),
  crack: (c) => buf(c, 0.25, (t) => (rnd() * 0.9 + Math.sin(t * 2 * Math.PI * 300) * 0.4) * env(t, 0.001, 0.03)),
  seat: (c) => buf(c, 0.1, (t) => Math.sin(t * 2 * Math.PI * 900) * env(t, 0.001, 0.02) * 0.5),
  strain: (c) => buf(c, 0.3, (t) => Math.sin(t * 2 * Math.PI * (120 + 30 * Math.sin(t * 40))) * 0.3 * env(t, 0.03, 0.1)),
  strip: (c) => buf(c, 0.35, (t) => rnd() * env(t, 0.002, 0.08) * (0.6 + 0.4 * Math.sin(t * 300))),
  slip: (c) => buf(c, 0.25, (t) => (Math.sin(t * 2 * Math.PI * 1800) * 0.6 + rnd() * 0.4) * env(t, 0.001, 0.05)),
  tool_pick: (c) => buf(c, 0.25, (t) => (Math.sin(t * 2 * Math.PI * 2600) + Math.sin(t * 2 * Math.PI * 4100) * 0.5) * env(t, 0.001, 0.05) * 0.4),
  ratchet_flip: (c) => buf(c, 0.05, (t) => rnd() * env(t, 0.0005, 0.004)),
  jack_roll: (c) => buf(c, 0.6, (t) => rnd() * 0.15 * (0.5 + 0.5 * Math.sin(t * 60)) * env(t, 0.05, 0.3)),
  jack_pump: (c) => buf(c, 0.35, (t) => (Math.sin(t * 2 * Math.PI * 90) * 0.4 + rnd() * 0.15) * env(t, 0.02, 0.12)),
  hiss: (c) => buf(c, 0.4, (t) => rnd() * 0.2 * env(t, 0.02, 0.15)),
  metal_place: (c) => buf(c, 0.5, (t) => (Math.sin(t * 2 * Math.PI * 520) * 0.5 + Math.sin(t * 2 * Math.PI * 1370) * 0.3 + rnd() * 0.3 * Math.exp(-t / 0.01)) * env(t, 0.001, 0.12)),
  thud: (c) => buf(c, 0.3, (t) => (Math.sin(t * 2 * Math.PI * 70) + rnd() * 0.3) * env(t, 0.002, 0.06)),
  plastic: (c) => buf(c, 0.15, (t) => (rnd() * 0.4 + Math.sin(t * 2 * Math.PI * 400) * 0.3) * env(t, 0.001, 0.03)),
  part_remove: (c) => buf(c, 0.2, (t) => (Math.sin(t * 2 * Math.PI * 1500) * 0.3 + rnd() * 0.2) * env(t, 0.001, 0.04)),
  part_fit: (c) => buf(c, 0.2, (t) => (Math.sin(t * 2 * Math.PI * 800) * 0.4 + rnd() * 0.2) * env(t, 0.001, 0.04)),
  pour_start: (c) => buf(c, 0.8, (t) => rnd() * 0.25 * env(t, 0.05, 0.4) * (0.6 + 0.4 * Math.sin(t * 25))),
  glug: (c) => buf(c, 0.18, (t) => Math.sin(t * 2 * Math.PI * (180 + t * 600)) * 0.4 * env(t, 0.01, 0.05)),
  dipstick: (c) => buf(c, 0.4, (t) => rnd() * 0.12 * env(t, 0.05, 0.2)),
  latch: (c) => buf(c, 0.2, (t) => (rnd() * 0.5 + Math.sin(t * 2 * Math.PI * 300)) * env(t, 0.001, 0.03)),
  bonnet_open: (c) => buf(c, 1.2, (t) => (Math.sin(t * 2 * Math.PI * (90 + 40 * t)) * 0.2 + rnd() * 0.05) * env(t, 0.1, 0.6)),
  bonnet_close: (c) => buf(c, 0.6, (t) => (Math.sin(t * 2 * Math.PI * 60) + rnd() * 0.4) * env(t, 0.003, 0.1)),
  door_open: (c) => buf(c, 0.4, (t) => (rnd() * 0.3 + Math.sin(t * 2 * Math.PI * 220) * 0.2) * env(t, 0.005, 0.08)),
  door_close: (c) => buf(c, 0.5, (t) => (Math.sin(t * 2 * Math.PI * 80) + rnd() * 0.5) * env(t, 0.002, 0.07)),
  panel: (c) => buf(c, 0.2, (t) => rnd() * 0.3 * env(t, 0.002, 0.04)),
  switch: (c) => buf(c, 0.05, (t) => rnd() * env(t, 0.0005, 0.005)),
  solenoid: (c) => buf(c, 0.12, (t) => (rnd() * 0.6 + Math.sin(t * 2 * Math.PI * 700) * 0.4) * env(t, 0.0005, 0.015)),
  engine_catch: (c) => buf(c, 0.6, (t) => (rnd() * 0.5 + Math.sin(t * 2 * Math.PI * 70) * 0.5) * env(t, 0.01, 0.2)),
  engine_stop: (c) => buf(c, 0.6, (t) => (rnd() * 0.2 + Math.sin(t * 2 * Math.PI * 40) * 0.3) * env(t, 0.01, 0.25)),
  backfire: (c) => buf(c, 0.35, (t) => (rnd() + Math.sin(t * 2 * Math.PI * 90) * 0.6) * env(t, 0.0008, 0.05) * 1.2),
  cough: (c) => buf(c, 0.25, (t) => (rnd() * 0.6 + Math.sin(t * 2 * Math.PI * 80) * 0.4) * env(t, 0.003, 0.05)),
  pop: (c) => buf(c, 0.1, (t) => rnd() * env(t, 0.0005, 0.01)),
  knock: (c) => buf(c, 0.1, (t) => Math.sin(t * 2 * Math.PI * 1100) * env(t, 0.0005, 0.015)),
  steam: (c) => buf(c, 1.5, (t) => rnd() * 0.35 * env(t, 0.05, 0.8)),
  spark: (c) => buf(c, 0.2, (t) => rnd() * env(t, 0.0005, 0.02) * (Math.random() > 0.5 ? 1 : 0.2)),
  zap: (c) => buf(c, 0.3, (t) => (rnd() * 0.6 + Math.sin(t * 2 * Math.PI * 50) * 0.5) * env(t, 0.001, 0.08)),
  unplug: (c) => buf(c, 0.12, (t) => (rnd() * 0.4 + Math.sin(t * 2 * Math.PI * 600) * 0.3) * env(t, 0.001, 0.02)),
  plug_in: (c) => buf(c, 0.12, (t) => (rnd() * 0.3 + Math.sin(t * 2 * Math.PI * 900) * 0.3) * env(t, 0.001, 0.02)),
  spray: (c) => buf(c, 0.7, (t) => rnd() * 0.3 * env(t, 0.02, 0.4)),
  till: (c) => buf(c, 0.6, (t) => (Math.sin(t * 2 * Math.PI * 2100) + Math.sin(t * 2 * Math.PI * 2800) * 0.6) * env(t, 0.001, 0.15) * 0.3),
  horn: (c) => buf(c, 0.9, (t) => (Math.sign(Math.sin(t * 2 * Math.PI * 410)) * 0.25 + Math.sign(Math.sin(t * 2 * Math.PI * 510)) * 0.25) * env(t, 0.01, 2) * (t > 0.8 ? (0.9 - t) * 10 : 1)),
  beep: (c) => buf(c, 0.2, (t) => Math.sin(t * 2 * Math.PI * 2800) * 0.3 * (t < 0.18 ? 1 : 0)),
  air: (c) => buf(c, 0.3, (t) => rnd() * 0.25 * env(t, 0.02, 0.2)),
  brush: (c) => buf(c, 1.0, (t) => rnd() * 0.3 * (0.5 + 0.5 * Math.sin(t * 40)) * env(t, 0.05, 0.6)),
  measure: (c) => buf(c, 0.08, (t) => Math.sin(t * 2 * Math.PI * 3000) * env(t, 0.0005, 0.01) * 0.4),
  clip: (c) => buf(c, 0.1, (t) => (rnd() * 0.5 + Math.sin(t * 2 * Math.PI * 1500) * 0.4) * env(t, 0.0005, 0.015)),
  crank: (c) => buf(c, 0.2, (t) => (Math.sin(t * 2 * Math.PI * 120) * 0.3 + rnd() * 0.1) * env(t, 0.01, 0.06)),
};

export class AudioSystem {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private cache = new Map<string, AudioBuffer>();
  private engine: AudioWorkletNode | null = null;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private drain!: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null;
  private ambience: GainNode | null = null;
  private ready = false;
  private lastTimes = new Map<string, number>();

  constructor(private game: Game) {
    const start = () => { this.init(); window.removeEventListener('pointerdown', start); window.removeEventListener('keydown', start); };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    bus.on('sound', ({ name, gain, rate }) => this.play(name, gain, rate));
  }

  async init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.game.state.settings.volume;
      this.master.connect(this.ctx.destination);
      // Ambience: brown noise + mains hum from the strip lights
      const n = this.ctx.sampleRate * 4;
      const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < n; i++) { last = (last + 0.02 * rnd()) * 0.995; d[i] = last * 3 + Math.sin(i / this.ctx.sampleRate * 2 * Math.PI * 100) * 0.004; }
      const amb = this.ctx.createBufferSource(); amb.buffer = b; amb.loop = true;
      this.ambience = this.ctx.createGain(); this.ambience.gain.value = 0.12;
      amb.connect(this.ambience).connect(this.master); amb.start();
      // Drain trickle loop
      const nb = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = rnd() * (0.6 + 0.4 * Math.sin(i * 0.002));
      const src = this.ctx.createBufferSource(); src.buffer = nb; src.loop = true;
      const filter = this.ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 900; filter.Q.value = 0.8;
      const gain = this.ctx.createGain(); gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master); src.start();
      this.drain = { src, gain, filter };
      // Engine worklet
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      this.engine = new AudioWorkletNode(this.ctx, 'engine-proc');
      this.engineFilter = this.ctx.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 600;
      this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0.8;
      this.engine.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
      this.ready = true;
    } catch (e) {
      console.warn('Audio unavailable', e);
    }
  }

  setVolume(v: number) { if (this.master) this.master.gain.value = v; }

  play(name: string, gain = 1, rate = 1) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const lt = this.lastTimes.get(name) ?? 0;
    if (now - lt < 0.03) return;
    this.lastTimes.set(name, now);
    const synth = SYNTH[name];
    if (!synth) return;
    let b = this.cache.get(name);
    if (!b) { b = synth(this.ctx); this.cache.set(name, b); }
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(this.master);
    s.start();
  }

  update() {
    if (!this.ready || !this.engine || !this.ctx) return;
    const v = this.game.state.vehicle;
    const e = v.engine;
    const belt = this.game.state.vehicle.parts[this.game.state.vehicle.slots['eng.fan_belt'].part ?? '']?.vars.deflection ?? 12;
    this.engine.port.postMessage({
      rpm: e.running ? e.rpm : (this.game.sim?.crankRpm ?? 0), running: e.running ? 1 : 0, cranking: e.cranking ? 1 : 0,
      mis: e.misfire, rough: e.roughness, knock: e.bearingDamage, belt: e.running && belt > 18 && e.rpm > 1200 ? Math.min(1, (belt - 18) / 8) : 0, fan: e.fanOn ? 1 : 0,
    });
    this.engineFilter.frequency.value = 350 + (e.rpm / 6000) * 2400;
    const flow = this.game.flows['drain'] ?? 0;
    if (this.drain) this.drain.gain.gain.value = Math.min(0.35, flow * 6);
  }
}
