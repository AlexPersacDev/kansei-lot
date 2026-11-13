import type { Car } from '../physics/car';

/**
 * Synthesised sound (Web Audio, no samples):
 *  - engine: firing-frequency oscillators (4-cyl: 2 pulses / rev) through a soft clipper and a
 *    load/rpm-tracking low-pass, plus band-passed intake noise;
 *  - tyres: band-passed noise + a wobbling tone driven by contact-patch sliding speed.
 * The context starts suspended until a user gesture (browser autoplay rules, iOS).
 */
export class CarAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engGain!: GainNode;
  private engFilter!: BiquadFilterNode;
  private oscs: OscillatorNode[] = [];
  private intakeBp!: BiquadFilterNode;
  private intakeGain!: GainNode;
  private sqGain!: GainNode;
  private sqBp1!: BiquadFilterNode;
  private sqBp2!: BiquadFilterNode;
  private sqTone!: OscillatorNode;
  private sqToneGain!: GainNode;
  private volume = 0.7;
  private wobble = 0;

  constructor() {
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend(); else void this.ctx.resume();
    });
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Create / resume the context. Safe to call repeatedly; must run inside a user gesture once. */
  unlock(): void {
    if (this.ctx) { if (this.ctx.state !== 'running') void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // ---- engine
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(2.2);
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 1.1;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    shaper.connect(this.engFilter).connect(this.engGain).connect(this.master);
    const parts: [OscillatorType, number, number][] = [['sawtooth', 1, 0.5], ['sawtooth', 0.5, 0.35], ['square', 2, 0.08], ['triangle', 0.25, 0.3]];
    for (const [type, mul, g] of parts) {
      const o = ctx.createOscillator();
      o.type = type;
      const gn = ctx.createGain();
      gn.gain.value = g;
      o.connect(gn).connect(shaper);
      o.start();
      (o as OscillatorNode & { mul: number }).mul = mul;
      this.oscs.push(o);
    }
    const noise = noiseSource(ctx);
    this.intakeBp = ctx.createBiquadFilter();
    this.intakeBp.type = 'bandpass';
    this.intakeBp.Q.value = 1.5;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    noise.connect(this.intakeBp).connect(this.intakeGain).connect(this.master);

    // ---- tyre squeal
    const sqNoise = noiseSource(ctx);
    this.sqBp1 = ctx.createBiquadFilter(); this.sqBp1.type = 'bandpass'; this.sqBp1.Q.value = 7;
    this.sqBp2 = ctx.createBiquadFilter(); this.sqBp2.type = 'bandpass'; this.sqBp2.Q.value = 12;
    this.sqGain = ctx.createGain(); this.sqGain.gain.value = 0;
    sqNoise.connect(this.sqBp1).connect(this.sqGain);
    sqNoise.connect(this.sqBp2).connect(this.sqGain);
    this.sqGain.connect(this.master);
    this.sqTone = ctx.createOscillator(); this.sqTone.type = 'sine';
    this.sqToneGain = ctx.createGain(); this.sqToneGain.gain.value = 0;
    this.sqTone.connect(this.sqToneGain).connect(this.master);
    this.sqTone.start();
  }

  get running(): boolean { return this.ctx?.state === 'running'; }

  /** Gearbox grind: short burst of harsh, band-passed noise. */
  grind(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    const len = Math.floor(ctx.sampleRate * 0.35);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i / 9));
    src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.33);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
  }

  update(dt: number, car: Car, paused: boolean): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const k = 0.03;
    const rpm = car.rpm;
    const f = (rpm / 60) * 2; // 4 cylinders, 4-stroke: 2 firing pulses per revolution
    for (const o of this.oscs) o.frequency.setTargetAtTime(f * (o as OscillatorNode & { mul: number }).mul, t, 0.012);
    const load = paused ? 0 : car.throttleApplied;
    const cut = car.limiterCut;
    this.engFilter.frequency.setTargetAtTime(260 + rpm * 0.3 + load * 1700, t, k);
    this.engGain.gain.setTargetAtTime(paused ? 0 : (cut ? 0.07 : 0.16 + 0.3 * load), t, cut ? 0.008 : k);
    this.intakeBp.frequency.setTargetAtTime(f * 4, t, k);
    this.intakeGain.gain.setTargetAtTime(paused ? 0 : 0.05 * load * Math.min(1, rpm / 3000), t, k);

    // squeal follows the busiest tyre, weighted by load
    let sq = 0, sp = 0;
    for (const w of car.wheels) {
      const s = Math.min(1, Math.max(0, (w.slideSpeed - 1.5) / 9)) * Math.min(1, w.fz / 2500);
      if (s > sq) { sq = s; sp = w.slideSpeed; }
    }
    if (car.speed < 1.5) sq *= car.speed / 1.5;
    this.wobble += dt * (5 + Math.random() * 3);
    const pitch = 950 + Math.min(500, sp * 18) + Math.sin(this.wobble) * 40;
    this.sqBp1.frequency.setTargetAtTime(pitch, t, 0.05);
    this.sqBp2.frequency.setTargetAtTime(pitch * 1.62, t, 0.05);
    this.sqTone.frequency.setTargetAtTime(pitch * 0.62, t, 0.05);
    const g = paused ? 0 : sq;
    this.sqGain.gain.setTargetAtTime(g * 0.55, t, 0.06);
    this.sqToneGain.gain.setTargetAtTime(g * 0.035, t, 0.06);
  }
}

function softClip(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return c;
}

function noiseSource(ctx: AudioContext): AudioBufferSourceNode {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.start();
  return src;
}
