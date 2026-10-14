/**
 * Small deterministic DSP toolkit used to pre-render one-shots (drums, cowbell
 * multisamples, SFX, impulse responses) into Float32Arrays once, so playback
 * at runtime is just `AudioBufferSourceNode → GainNode` (cheap on iPhone).
 * Pure — no Web Audio, unit-testable in Node.
 */
import { mulberry32, type Rng } from './rng';

export const TAU = Math.PI * 2;

/** Mono or stereo sample data. */
export type Channels = Float32Array[];

export function buf(sr: number, seconds: number): Float32Array {
  return new Float32Array(Math.max(1, Math.ceil(sr * seconds)));
}

/** Topology-preserving-transform state variable filter (Zavalishin/Simper). Stable under modulation. */
export class SVF {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  lp = 0;
  bp = 0;
  hp = 0;
  /** Unity-gain band-pass. */
  bpn = 0;

  constructor(
    private sr: number,
    f = 1000,
    q = 0.707,
  ) {
    this.set(f, q);
  }

  set(f: number, q: number): this {
    const fc = Math.max(10, Math.min(f, this.sr * 0.47));
    const g = Math.tan((Math.PI * fc) / this.sr);
    const k = 1 / Math.max(0.05, q);
    this.k = k;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
    return this;
  }

  tick(x: number): void {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.bpn = this.k * v1;
    this.hp = x - this.k * v1 - v2;
  }

  reset(): void {
    this.ic1 = this.ic2 = 0;
  }
}

export type FilterMode = 'lp' | 'hp' | 'bp' | 'bpn';

function svfCoef(out: Float64Array, sr: number, f: number, q: number): void {
  const fc = Math.max(10, Math.min(f, sr * 0.47));
  const g = Math.tan((Math.PI * fc) / sr);
  const k = 1 / Math.max(0.05, q);
  const a1 = 1 / (1 + g * (g + k));
  out[0] = a1;
  out[1] = g * a1;
  out[2] = g * g * a1;
  out[3] = k;
}

/** Filters a buffer in place with a (possibly time-varying) TPT SVF (closure-free hot loop). */
export function filter(
  data: Float32Array,
  sr: number,
  mode: FilterMode,
  f: number | ((t: number) => number),
  q: number | ((t: number) => number) = 0.707,
  stages = 1,
): Float32Array {
  const fv = typeof f === 'function' ? f : null;
  const qv = typeof q === 'function' ? q : null;
  const fs = typeof f === 'number' ? f : 1000;
  const qs = typeof q === 'number' ? q : 0.707;
  const dynamic = fv !== null || qv !== null;
  const m = mode === 'lp' ? 0 : mode === 'hp' ? 1 : mode === 'bp' ? 2 : 3;
  const n = data.length;
  const c = new Float64Array(4);
  for (let s = 0; s < stages; s++) {
    let ic1 = 0;
    let ic2 = 0;
    svfCoef(c, sr, fv ? fv(0) : fs, qv ? qv(0) : qs);
    let a1 = c[0];
    let a2 = c[1];
    let a3 = c[2];
    let k = c[3];
    for (let i = 0; i < n; i++) {
      if (dynamic && (i & 31) === 0 && i > 0) {
        const t = i / sr;
        svfCoef(c, sr, fv ? fv(t) : fs, qv ? qv(t) : qs);
        a1 = c[0];
        a2 = c[1];
        a3 = c[2];
        k = c[3];
      }
      const x = data[i];
      const v3 = x - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      data[i] = m === 0 ? v2 : m === 1 ? x - k * v1 - v2 : m === 2 ? v1 : k * v1;
    }
  }
  return data;
}

/** One-pole DC blocker in place. */
export function dcBlock(data: Float32Array, r = 0.995): Float32Array {
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = x - x1 + r * y1;
    x1 = x;
    y1 = y;
    data[i] = y;
  }
  return data;
}

export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** Band-limited oscillator (polyBLEP). */
export class Osc {
  phase: number;
  constructor(
    private sr: number,
    phase = 0,
  ) {
    this.phase = phase;
  }

  private adv(dt: number): void {
    this.phase += dt;
    if (this.phase >= 1) this.phase -= Math.floor(this.phase);
  }

  sine(f: number): number {
    const v = Math.sin(TAU * this.phase);
    this.adv(f / this.sr);
    return v;
  }

  saw(f: number): number {
    const dt = Math.min(0.5, f / this.sr);
    const v = 2 * this.phase - 1 - polyBlep(this.phase, dt);
    this.adv(dt);
    return v;
  }

  square(f: number, pw = 0.5): number {
    const dt = Math.min(0.5, f / this.sr);
    let v = this.phase < pw ? 1 : -1;
    v += polyBlep(this.phase, dt);
    let t2 = this.phase + 1 - pw;
    t2 -= Math.floor(t2);
    v -= polyBlep(t2, dt);
    this.adv(dt);
    return v;
  }

  tri(f: number): number {
    const p = this.phase;
    const v = p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    this.adv(f / this.sr);
    return v;
  }
}

// ---------------------------------------------------------------- envelopes

export function expDecay(t: number, tau: number): number {
  return t < 0 ? 0 : Math.exp(-t / tau);
}

/** Attack (linear) then exponential decay. */
export function ad(t: number, attack: number, tau: number): number {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / tau);
}

/** Smooth bell over [0, dur] peaking at `peak` (0..1 of dur). */
export function bell(t: number, dur: number, peak = 0.5, sharp = 2): number {
  if (t <= 0 || t >= dur) return 0;
  const x = t / dur;
  const v = x < peak ? x / peak : (1 - x) / (1 - peak);
  return Math.pow(Math.sin((v * Math.PI) / 2), sharp);
}

// ---------------------------------------------------------------- shaping & utilities

/** Fast tanh (Padé 7/6 with clamp at ±4.97; |error| < 1e-4 everywhere — inaudible). */
export function ftanh(x: number): number {
  if (x > 4.97) return 1;
  if (x < -4.97) return -1;
  const x2 = x * x;
  return (x * (135135 + x2 * (17325 + x2 * (378 + x2)))) / (135135 + x2 * (62370 + x2 * (3150 + 28 * x2)));
}

export function tanhDrive(x: number, drive: number): number {
  return ftanh(x * drive);
}

export function softClip(x: number): number {
  if (x > 1) return 2 / 3;
  if (x < -1) return -2 / 3;
  return x - (x * x * x) / 3;
}

export function drive(data: Float32Array, amount: number, asym = 0): Float32Array {
  const norm = 1 / Math.tanh(amount);
  const off = asym ? Math.tanh(asym * amount) : 0;
  for (let i = 0; i < data.length; i++) data[i] = (ftanh((data[i] + asym) * amount) - off) * norm;
  return data;
}

export function hardClip(data: Float32Array, ceiling = 1): Float32Array {
  for (let i = 0; i < data.length; i++) data[i] = Math.max(-ceiling, Math.min(ceiling, data[i]));
  return data;
}

export function peak(data: Float32Array): number {
  let p = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > p) p = a;
  }
  return p;
}

export function rms(data: Float32Array): number {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, data.length));
}

export function scale(data: Float32Array, g: number): Float32Array {
  for (let i = 0; i < data.length; i++) data[i] *= g;
  return data;
}

/** Normalizes all channels together to a peak. */
export function normalize(chs: Channels, target = 0.9): Channels {
  let p = 0;
  for (const c of chs) p = Math.max(p, peak(c));
  if (p > 1e-9) for (const c of chs) scale(c, target / p);
  return chs;
}

export function fadeOut(data: Float32Array, sr: number, seconds: number): Float32Array {
  const n = Math.min(data.length, Math.floor(sr * seconds));
  for (let i = 0; i < n; i++) data[data.length - 1 - i] *= i / n;
  return data;
}

export function fadeIn(data: Float32Array, sr: number, seconds: number): Float32Array {
  const n = Math.min(data.length, Math.floor(sr * seconds));
  for (let i = 0; i < n; i++) data[i] *= i / n;
  return data;
}

export function reverse(data: Float32Array): Float32Array {
  data.reverse();
  return data;
}

/** Adds `src` into `dst` starting at sample `at`. */
export function addAt(dst: Float32Array, src: Float32Array, at: number, gain = 1): void {
  const start = Math.max(0, Math.floor(at));
  const n = Math.min(src.length, dst.length - start);
  for (let i = 0; i < n; i++) dst[start + i] += src[i] * gain;
}

export function white(rng: Rng): number {
  return rng() * 2 - 1;
}

export function noise(n: number, rng: Rng): Float32Array {
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = rng() * 2 - 1;
  return d;
}

/** Brown-ish (integrated, leaky) noise — rumble. */
export function brown(n: number, rng: Rng): Float32Array {
  const d = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = 0.996 * y + 0.06 * (rng() * 2 - 1);
    d[i] = y;
  }
  return d;
}

/** Smoothed random modulation signal in [-1, 1] at roughly `rate` Hz. */
export function wobble(n: number, sr: number, rate: number, rng: Rng): Float32Array {
  const d = new Float32Array(n);
  const step = Math.max(1, Math.floor(sr / Math.max(0.1, rate)));
  let a = rng() * 2 - 1;
  let b = rng() * 2 - 1;
  for (let i = 0; i < n; i++) {
    const k = i % step;
    if (k === 0 && i > 0) {
      a = b;
      b = rng() * 2 - 1;
    }
    const x = k / step;
    const s = x * x * (3 - 2 * x);
    d[i] = a + (b - a) * s;
  }
  return d;
}

/** Decaying sine (modal partial / droplet / ping), optionally chirped. */
export function addPing(dst: Float32Array, sr: number, at: number, f: number, amp: number, tau: number, chirp = 0, phase = 0): void {
  const start = Math.max(0, Math.floor(at * sr));
  const n = Math.min(dst.length - start, Math.ceil(tau * sr * 7));
  if (n <= 0 || f >= sr * 0.49) return;
  const r = Math.exp(-1 / (tau * sr));
  const atk = sr * 0.0008;
  if (!chirp) {
    // recursive rotation: z[n] = z[n-1]·r·e^{iω} — no sin/exp per sample
    const w = (TAU * f) / sr;
    const c = r * Math.cos(w);
    const s = r * Math.sin(w);
    let re = Math.cos(TAU * phase) * amp;
    let im = Math.sin(TAU * phase) * amp;
    for (let i = 0; i < n; i++) {
      dst[start + i] += i < atk ? im * (i / atk) : im;
      const nre = re * c - im * s;
      im = re * s + im * c;
      re = nre;
    }
    return;
  }
  let ph = phase;
  let env = amp;
  const tauN = Math.max(1, tau * sr);
  for (let i = 0; i < n; i++) {
    const fi = f * (1 + chirp * Math.min(1, i / tauN));
    ph += fi / sr;
    dst[start + i] += Math.sin(TAU * ph) * (i < atk ? env * (i / atk) : env);
    env *= r;
  }
}

/** Sum of inharmonic decaying partials (metal, glass, bells). */
export function addModal(
  dst: Float32Array,
  sr: number,
  at: number,
  f0: number,
  partials: readonly (readonly [ratio: number, amp: number, tau: number])[],
  detuneBeat = 0,
): void {
  for (const [r, a, tau] of partials) {
    addPing(dst, sr, at, f0 * r, a, tau);
    if (detuneBeat) addPing(dst, sr, at, f0 * r * (1 + detuneBeat), a * 0.6, tau * 0.9, 0, 0.25);
  }
}

/** Filtered noise burst with an envelope function, added at `at` seconds. */
export function addNoise(
  dst: Float32Array,
  sr: number,
  at: number,
  dur: number,
  rng: Rng,
  opts: {
    mode?: FilterMode;
    f?: number | ((t: number) => number);
    q?: number | ((t: number) => number);
    env?: (t: number) => number;
    gain?: number;
    stages?: number;
  } = {},
): void {
  const n = Math.ceil(dur * sr);
  const d = noise(n, rng);
  if (opts.mode) filter(d, sr, opts.mode, opts.f ?? 1000, opts.q ?? 0.707, opts.stages ?? 1);
  const env = opts.env ?? ((t: number) => expDecay(t, dur / 4));
  const g = opts.gain ?? 1;
  for (let i = 0; i < n; i++) d[i] *= env(i / sr) * g;
  addAt(dst, d, at * sr);
}

/** Tone with a frequency function and envelope, added at `at` seconds. */
export function addTone(
  dst: Float32Array,
  sr: number,
  at: number,
  dur: number,
  f: (t: number) => number,
  env: (t: number) => number,
  opts: { wave?: 'sine' | 'saw' | 'square' | 'tri'; gain?: number; phase?: number } = {},
): void {
  const n = Math.ceil(dur * sr);
  const start = Math.floor(at * sr);
  const osc = new Osc(sr, opts.phase ?? 0);
  const g = opts.gain ?? 1;
  const wave = opts.wave ?? 'sine';
  for (let i = 0; i < n && start + i < dst.length; i++) {
    const t = i / sr;
    const fr = f(t);
    const v = wave === 'sine' ? osc.sine(fr) : wave === 'saw' ? osc.saw(fr) : wave === 'square' ? osc.square(fr) : osc.tri(fr);
    dst[start + i] += v * env(t) * g;
  }
}

/** Sparse random impulses through resonators: crackles, droplets, debris. */
export function addCrackle(
  dst: Float32Array,
  sr: number,
  rng: Rng,
  opts: { from: number; to: number; count: number; fLo: number; fHi: number; amp: number; tau: number; ampDecay?: number },
): void {
  for (let k = 0; k < opts.count; k++) {
    const u = rng();
    const t = opts.from + (opts.to - opts.from) * u;
    const decayAmp = opts.ampDecay ? Math.exp(-(t - opts.from) / opts.ampDecay) : 1;
    const f = opts.fLo * Math.pow(opts.fHi / opts.fLo, rng());
    const tau = opts.tau * (0.5 + rng());
    const chirp = (rng() - 0.3) * 0.3;
    addPing(dst, sr, t, f, opts.amp * (0.4 + 0.6 * rng()) * decayAmp, tau, tau > 0.01 ? chirp : 0, rng());
  }
}

/**
 * Freeverb-style mono tail (parallel damped combs + series allpasses) baked
 * into a buffer — cheap (≈10 ops/sample). `seconds` ≈ RT60.
 */
export function bakeTail(data: Float32Array, sr: number, seconds: number, wet: number, damp = 0.35, spread = 0): Float32Array {
  const k = sr / 44100;
  const combLens = [1116, 1188, 1277, 1356, 1422, 1491].map((l) => Math.floor((l + spread) * k));
  const apLens = [556, 441, 341, 225].map((l) => Math.floor((l + spread) * k));
  const combs = combLens.map((len) => ({ buf: new Float32Array(len), i: 0, lp: 0, g: Math.pow(10, (-3 * len) / (seconds * sr)) }));
  const aps = apLens.map((len) => ({ buf: new Float32Array(len), i: 0 }));
  const n = data.length;
  const g = wet * 0.12;
  for (let s = 0; s < n; s++) {
    const x = data[s];
    let acc = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.lp = y * (1 - damp) + c.lp * damp;
      c.buf[c.i] = x + c.lp * c.g;
      if (++c.i >= c.buf.length) c.i = 0;
      acc += y;
    }
    for (const a of aps) {
      const b = a.buf[a.i];
      const y = -acc + b;
      a.buf[a.i] = acc + b * 0.5;
      if (++a.i >= a.buf.length) a.i = 0;
      acc = y;
    }
    data[s] = x + acc * g;
  }
  return data;
}

/** Makes a buffer loop seamlessly by crossfading its tail into its head. */
export function makeLoopable(data: Float32Array, sr: number, xfade = 0.25): Float32Array {
  const n = Math.min(Math.floor(sr * xfade), Math.floor(data.length / 3));
  const out = data.slice(0, data.length - n);
  for (let i = 0; i < n; i++) {
    const a = i / n;
    out[i] = data[i] * Math.sqrt(a) + data[data.length - n + i] * Math.sqrt(1 - a);
  }
  return out;
}

export { mulberry32 };
export type { Rng };
