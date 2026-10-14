/**
 * SFX recipes: every sound effect is synthesized procedurally (filtered
 * noise, modal partials, pitch sweeps, resonant droplets…) into a buffer the
 * first time it is needed (or in idle time). Pure DSP — no Web Audio here.
 */
import {
  TAU,
  SVF,
  addAt,
  addCrackle,
  addModal,
  addNoise,
  addPing,
  addTone,
  ad,
  bakeTail,
  bell,
  brown,
  buf,
  drive,
  expDecay,
  fadeOut,
  filter,
  hardClip,
  noise,
  normalize,
  reverse,
  wobble,
  type Channels,
} from './dsp';
import { rngFor, type Rng } from './rng';
import type { Sfx } from './types';

export interface SfxDef {
  variants: number;
  /** Playback gain (relative loudness between effects). */
  gain: number;
  /** Send into the SFX room reverb. */
  verb: number;
  /** 0 = may be dropped under load, 1 = normal, 2 = never dropped. */
  priority: number;
  /** Music ducking (amount, ms) when this plays — gives big hits room. */
  duck?: [number, number];
  render: (sr: number, rng: Rng, variant: number) => Channels;
}

// ---------------------------------------------------------------- building blocks

/** Random grain gate (0..1) — crackle / crunch / rustle texture. */
function grains(n: number, sr: number, rng: Rng, perSec: number, grainMs: number): Float32Array {
  const e = new Float32Array(n);
  const count = Math.max(1, Math.round((perSec * n) / sr));
  const len = Math.max(8, Math.floor((grainMs / 1000) * sr));
  for (let k = 0; k < count; k++) {
    const at = Math.floor(rng() * n);
    const a = 0.4 + 0.6 * rng();
    for (let i = 0; i < len && at + i < n; i++) {
      const w = Math.sin((Math.PI * i) / len);
      e[at + i] = Math.max(e[at + i], a * w);
    }
  }
  return e;
}

/** Bandpass noise sweep shaped like a blade arc (rise to `fHi`, settle at `fEnd`). */
function whoosh(
  d: Float32Array,
  sr: number,
  rng: Rng,
  at: number,
  dur: number,
  fLo: number,
  fHi: number,
  o: { fEnd?: number; q?: number; gain?: number; peak?: number; whistle?: number } = {},
): void {
  const pk = o.peak ?? 0.55;
  const fEnd = o.fEnd ?? fLo * 1.6;
  const f = (t: number) => {
    const x = Math.min(1, Math.max(0, t / dur));
    return x < pk ? fLo * Math.pow(fHi / fLo, x / pk) : fHi * Math.pow(fEnd / fHi, (x - pk) / (1 - pk));
  };
  addNoise(d, sr, at, dur, rng, {
    mode: 'bpn',
    f,
    q: (t) => (o.q ?? 1.6) * (0.7 + 0.6 * bell(t, dur, pk, 1)),
    env: (t) => bell(t, dur, pk, 1.6),
    gain: o.gain ?? 1,
  });
  if (o.whistle) {
    addNoise(d, sr, at, dur, rng, {
      mode: 'bpn',
      f: (t) => Math.min(11000, f(t) * 2.1),
      q: 10,
      env: (t) => bell(t, dur, Math.min(0.9, pk + 0.05), 2.5),
      gain: o.whistle,
    });
  }
}

/** Wet flesh cut: crisp transient + resonant squelch + meat thump + droplets. */
function fleshCut(d: Float32Array, sr: number, rng: Rng, t0: number, heavy: number, variant: number): void {
  addNoise(d, sr, t0, 0.035, rng, { mode: 'hp', f: 1900, env: (t) => ad(t, 0.0004, 0.007), gain: 0.9 * heavy });
  const n = Math.ceil(0.3 * sr);
  const wob = wobble(n, sr, 35, rng);
  const fStart = 1100 + variant * 180;
  addNoise(d, sr, t0 + 0.003, 0.3, rng, {
    mode: 'bpn',
    f: (t) => Math.max(220, fStart * Math.pow(0.22, t / 0.15)),
    q: 4.5,
    env: (t) => ad(t, 0.002, 0.06 * heavy) * (0.55 + 0.45 * wob[Math.min(n - 1, Math.floor(t * sr))]),
    gain: 1.35,
  });
  // meat: low-mid wet body with fast flutter
  addNoise(d, sr, t0 + 0.004, 0.16, rng, { mode: 'lp', f: 480, env: (t) => ad(t, 0.002, 0.04) * (0.4 + 0.6 * Math.max(0, wob[Math.min(n - 1, Math.floor((t + 0.1) * sr))])), gain: 0.8 * heavy });
  addNoise(d, sr, t0 + 0.01, 0.2, rng, {
    mode: 'bpn',
    f: (t) => 650 - 250 * Math.min(1, t / 0.2),
    q: 2,
    env: (t) => ad(t, 0.004, 0.05) * (0.5 + 0.5 * wob[Math.min(n - 1, Math.floor((t + 0.05) * sr))]),
    gain: 0.6,
  });
  addTone(d, sr, t0, 0.22, (t) => 45 + 65 * Math.exp(-t / 0.03), (t) => ad(t, 0.001, 0.055 * heavy), { gain: 1.2 * heavy });
  addNoise(d, sr, t0, 0.12, rng, { mode: 'lp', f: 400, env: (t) => ad(t, 0.001, 0.03), gain: 0.9 * heavy });
  addCrackle(d, sr, rng, { from: t0 + 0.04, to: t0 + 0.38, count: 5 + Math.round(3 * heavy), fLo: 900, fHi: 3400, amp: 0.2, tau: 0.012, ampDecay: 0.2 });
}

/** Sizzling blood spray: crackly band noise + droplets. */
function sizzle(d: Float32Array, sr: number, rng: Rng, at: number, dur: number, g: number): void {
  const n = Math.ceil(dur * sr);
  const gr = grains(n, sr, rng, 320, 3);
  addNoise(d, sr, at, dur, rng, {
    mode: 'bpn',
    f: 4600,
    q: 0.8,
    env: (t) => expDecay(t, dur * 0.3) * (0.25 + 0.75 * gr[Math.min(n - 1, Math.floor(t * sr))]),
    gain: g,
  });
  addCrackle(d, sr, rng, { from: at + 0.02, to: at + dur, count: 12, fLo: 1300, fHi: 4800, amp: 0.2 * g + 0.05, tau: 0.008, ampDecay: dur * 0.5 });
}

/** Pulsing arterial gush with gurgling bubbles. */
function gush(d: Float32Array, sr: number, rng: Rng, at: number, dur: number, g: number): void {
  const n = Math.ceil(dur * sr);
  const body = noise(n, rng);
  filter(body, sr, 'lp', 1500);
  filter(body, sr, 'bpn', 700, 1.1);
  const rate = 5 + rng() * 1.5;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const pulse = Math.pow(0.5 + 0.5 * Math.sin(TAU * rate * t - Math.PI / 2), 3);
    body[i] *= (0.25 + 0.75 * pulse) * Math.min(1, t / 0.01) * Math.exp(-t / (dur * 0.45)) * g * 1.6;
  }
  addAt(d, body, at * sr);
  for (let k = 0; k < 26; k++) {
    const t = at + 0.03 + rng() * dur * 0.85;
    addPing(d, sr, t, 260 + rng() * 520, 0.16 * g * Math.exp(-(t - at) / dur), 0.011, 0.7);
  }
  sizzle(d, sr, rng, at, dur * 0.8, 0.35 * g);
}

/** Sharp bone clicks + distorted crunch + snap thump. */
function bone(d: Float32Array, sr: number, rng: Rng, t0: number, g: number): void {
  let t = t0;
  for (let k = 0; k < 4; k++) {
    addPing(d, sr, t, 2600 + rng() * 2400, 0.75 * g, 0.003);
    addNoise(d, sr, t, 0.004, rng, { mode: 'hp', f: 2500, env: (x) => expDecay(x, 0.0007), gain: 0.8 * g });
    t += 0.005 + rng() * 0.009;
  }
  const n = Math.ceil(0.11 * sr);
  const gr = grains(n, sr, rng, 420, 3.5);
  const c = new Float32Array(n);
  addNoise(c, sr, 0, 0.11, rng, { mode: 'bpn', f: 1500, q: 0.9, env: (x) => ad(x, 0.001, 0.035) * gr[Math.min(n - 1, Math.floor(x * sr))], gain: 1 });
  drive(c, 6);
  addAt(d, c, (t0 + 0.004) * sr, 0.75 * g);
  addTone(d, sr, t0, 0.09, (x) => 85 + 110 * Math.exp(-x / 0.012), (x) => ad(x, 0.0005, 0.025), { gain: 0.7 * g });
  addCrackle(d, sr, rng, { from: t0 + 0.03, to: t0 + 0.2, count: 6, fLo: 1500, fHi: 4000, amp: 0.14 * g, tau: 0.004 });
}

function thud(d: Float32Array, sr: number, rng: Rng, at: number, g: number, f = 85): void {
  addTone(d, sr, at, 0.3, (t) => f * 0.53 + f * 0.47 * Math.exp(-t / 0.04), (t) => ad(t, 0.001, 0.075), { gain: g });
  addNoise(d, sr, at, 0.2, rng, { mode: 'lp', f: 230, env: (t) => ad(t, 0.001, 0.045), gain: g });
}

/** Steel clang partials (inharmonic, slightly beating). */
const CLANG: [number, number, number][] = [
  [1, 0.5, 0.45],
  [1.53, 0.42, 0.36],
  [2.31, 0.36, 0.32],
  [2.89, 0.3, 0.26],
  [3.77, 0.26, 0.22],
  [4.62, 0.2, 0.18],
  [5.94, 0.16, 0.14],
  [7.13, 0.12, 0.1],
  [8.31, 0.09, 0.08],
];

function clang(d: Float32Array, sr: number, rng: Rng, f0: number, decayMul: number, g: number): void {
  addNoise(d, sr, 0, 0.02, rng, { mode: 'hp', f: 6000, env: (t) => expDecay(t, 0.0025), gain: 1.1 * g });
  // blade scrape
  addNoise(d, sr, 0, 0.07, rng, { mode: 'bpn', f: (t) => 5200 - 2600 * Math.min(1, t / 0.06), q: 2, env: (t) => ad(t, 0.001, 0.022), gain: 0.5 * g });
  addModal(
    d,
    sr,
    0,
    f0,
    CLANG.map(([r, a, tau]) => [r, a * g, tau * decayMul] as const),
    0.004,
  );
  addTone(d, sr, 0, 0.09, (t) => 90 + 90 * Math.exp(-t / 0.012), (t) => ad(t, 0.0005, 0.02), { gain: 0.5 * g });
}

/** Liquid splat: short low-mid burst + resonant downward "splut". */
function splat(d: Float32Array, sr: number, rng: Rng, at: number, g: number): void {
  addNoise(d, sr, at, 0.06, rng, { mode: 'lp', f: 900, env: (t) => ad(t, 0.0005, 0.014), gain: 1.1 * g });
  addNoise(d, sr, at, 0.09, rng, { mode: 'bpn', f: (t) => 1500 * Math.pow(0.28, Math.min(1, t / 0.05)), q: 3.5, env: (t) => ad(t, 0.0008, 0.022), gain: 1.2 * g });
}

/** Concrete/rubble impact: thud + gritty crack. */
function chunk(d: Float32Array, sr: number, rng: Rng, at: number, g: number): void {
  thud(d, sr, rng, at, g, 60 + rng() * 50);
  addNoise(d, sr, at, 0.05, rng, { mode: 'bpn', f: 1400 + rng() * 1600, q: 1, env: (t) => ad(t, 0.0004, 0.008), gain: 0.9 * g });
  addCrackle(d, sr, rng, { from: at, to: at + 0.08, count: 5, fLo: 1500, fHi: 5000, amp: 0.25 * g, tau: 0.003 });
}

function stereoOf(mono: Float32Array, sr: number, seed: number, tail: number, wet: number): Channels {
  const l = mono.slice();
  const r = mono.slice();
  if (tail > 0) {
    bakeTail(l, sr, tail, wet, 0.35, 0);
    bakeTail(r, sr, tail, wet, 0.35, 23 + (seed % 7));
  }
  return [l, r];
}

function finish(chs: Channels, sr: number, peakTarget = 0.92, fade = 0.03): Channels {
  for (const c of chs) fadeOut(c, sr, fade);
  return normalize(chs, peakTarget);
}

// ---------------------------------------------------------------- recipes

export const SFX_DEFS: Record<Sfx, SfxDef> = {
  swing: {
    variants: 3,
    gain: 0.62,
    verb: 0.05,
    priority: 1,
    render: (sr, rng, v) => {
      const dur = [0.24, 0.28, 0.32][v];
      const d = buf(sr, dur + 0.05);
      whoosh(d, sr, rng, 0, dur, 480, [3500, 3900, 4400][v], { fEnd: 1500, q: 1.8, whistle: 0.6 });
      whoosh(d, sr, rng, 0, dur, 220, 700, { fEnd: 380, q: 1.2, gain: 0.55, peak: 0.5 });
      addTone(d, sr, 0, dur, (t) => 125 - 50 * (t / dur), (t) => bell(t, dur, 0.5, 2), { gain: 0.22 });
      return finish([d], sr, 0.9, 0.02);
    },
  },
  swingHeavy: {
    variants: 2,
    gain: 0.75,
    verb: 0.06,
    priority: 1,
    render: (sr, rng, v) => {
      const dur = 0.42 + v * 0.05;
      const d = buf(sr, dur + 0.06);
      whoosh(d, sr, rng, 0, dur, 260, 2500 + v * 300, { fEnd: 850, q: 1.3, whistle: 0.3 });
      addNoise(d, sr, 0, dur, rng, { mode: 'hp', f: 5200, env: (t) => bell(t, dur, 0.6, 2), gain: 0.18 });
      addTone(d, sr, 0, dur, (t) => 95 - 40 * (t / dur), (t) => bell(t, dur, 0.55, 1.5), { gain: 0.45 });
      drive(d, 1.5);
      return finish([d], sr, 0.9, 0.03);
    },
  },
  whiff: {
    variants: 2,
    gain: 0.45,
    verb: 0.04,
    priority: 0,
    render: (sr, rng, v) => {
      const d = buf(sr, 0.2);
      whoosh(d, sr, rng, 0, 0.14, 950 + v * 150, 4600, { fEnd: 2000, q: 2.4, whistle: 0.35, gain: 0.85 });
      return finish([d], sr, 0.85, 0.02);
    },
  },
  slashFlesh: {
    variants: 3,
    gain: 0.95,
    verb: 0.08,
    priority: 1,
    render: (sr, rng, v) => {
      const d = buf(sr, 0.6);
      whoosh(d, sr, rng, 0, 0.07, 2500, 6000, { fEnd: 4000, q: 2, gain: 0.45, peak: 0.8 });
      fleshCut(d, sr, rng, 0.05, 1, v);
      drive(d, 1.6);
      return finish([d], sr, 0.95, 0.05);
    },
  },
  slashCrit: {
    variants: 2,
    gain: 1,
    verb: 0.12,
    priority: 2,
    duck: [0.25, 220],
    render: (sr, rng, v) => {
      const d = buf(sr, 1);
      whoosh(d, sr, rng, 0, 0.09, 1800, 6500, { fEnd: 3500, q: 1.8, gain: 0.55, peak: 0.8 });
      const t0 = 0.06;
      fleshCut(d, sr, rng, t0, 1.35, v);
      addModal(d, sr, t0, 3100 + v * 200, [
        [1, 0.22, 0.09],
        [1.48, 0.18, 0.07],
        [2.03, 0.14, 0.05],
        [2.71, 0.1, 0.04],
      ]);
      addTone(d, sr, t0, 0.35, (t) => 36 + 40 * Math.exp(-t / 0.05), (t) => ad(t, 0.001, 0.09), { gain: 1 });
      sizzle(d, sr, rng, t0 + 0.08, 0.6, 0.45);
      drive(d, 1.8);
      return finish([d], sr, 0.95, 0.08);
    },
  },
  bloodSplash: {
    variants: 3,
    gain: 1,
    verb: 0.06,
    priority: 0,
    render: (sr, rng, v) => {
      const d = buf(sr, 0.85);
      // several distinct liquid splats, then droplets — not a hiss
      const hits = [0, 0.028 + v * 0.006, 0.065, 0.11 + rng() * 0.03];
      hits.forEach((t, k) => splat(d, sr, rng, t, k === 0 ? 1 : 0.7 - k * 0.12));
      addCrackle(d, sr, rng, { from: 0.08, to: 0.75, count: 16, fLo: 1000, fHi: 4200, amp: 0.3, tau: 0.009, ampDecay: 0.3 });
      sizzle(d, sr, rng, 0.02, 0.45, 0.25);
      drive(d, 1.4);
      return finish([d], sr, 0.9, 0.06);
    },
  },
  bloodGush: {
    variants: 2,
    gain: 0.75,
    verb: 0.08,
    priority: 0,
    render: (sr, rng) => {
      const d = buf(sr, 1.6);
      addNoise(d, sr, 0, 0.12, rng, { mode: 'bpn', f: 900, q: 1.2, env: (t) => ad(t, 0.002, 0.04), gain: 0.9 });
      gush(d, sr, rng, 0.02, 1.45, 1);
      return finish([d], sr, 0.9, 0.12);
    },
  },
  boneCrack: {
    variants: 3,
    gain: 0.85,
    verb: 0.06,
    priority: 1,
    render: (sr, rng) => {
      const d = buf(sr, 0.45);
      bone(d, sr, rng, 0, 1);
      return finish([d], sr, 0.93, 0.05);
    },
  },
  decap: {
    variants: 1,
    gain: 1,
    verb: 0.12,
    priority: 2,
    duck: [0.3, 320],
    render: (sr, rng, v) => {
      const d = buf(sr, 1.7);
      whoosh(d, sr, rng, 0, 0.15, 400, 4200, { fEnd: 1600, q: 1.5, gain: 0.7, whistle: 0.3 });
      const t0 = 0.11;
      fleshCut(d, sr, rng, t0, 1.4, v);
      bone(d, sr, rng, t0 + 0.012, 1.1);
      addTone(d, sr, t0, 0.45, (t) => 32 + 34 * Math.exp(-t / 0.06), (t) => ad(t, 0.001, 0.13), { gain: 1 });
      gush(d, sr, rng, t0 + 0.05, 1.35, 1.1);
      thud(d, sr, rng, 0.98, 0.5, 115);
      drive(d, 1.5);
      return finish([d], sr, 0.95, 0.1);
    },
  },
  bodyFall: {
    variants: 2,
    gain: 0.75,
    verb: 0.08,
    priority: 0,
    render: (sr, rng) => {
      const d = buf(sr, 1.0);
      const fallThud = (at: number, g: number) => {
        addTone(d, sr, at, 0.4, (t) => 40 + 38 * Math.exp(-t / 0.05), (t) => ad(t, 0.001, 0.12), { gain: 1.1 * g });
        // audible body (120–180 Hz) + flesh/cloth "fwump"
        addTone(d, sr, at, 0.15, (t) => 95 + 70 * Math.exp(-t / 0.02), (t) => ad(t, 0.001, 0.04), { gain: 0.8 * g });
        addNoise(d, sr, at, 0.12, rng, { mode: 'bpn', f: 500, q: 0.8, env: (t) => ad(t, 0.002, 0.03), gain: 0.9 * g });
        addNoise(d, sr, at, 0.2, rng, { mode: 'lp', f: 180, env: (t) => ad(t, 0.001, 0.06), gain: g });
      };
      fallThud(0, 1);
      fallThud(0.16 + rng() * 0.03, 0.55);
      fallThud(0.33 + rng() * 0.04, 0.3);
      // cloth slide / friction
      const n = Math.ceil(0.5 * sr);
      const gr = grains(n, sr, rng, 90, 18);
      addNoise(d, sr, 0.01, 0.5, rng, { mode: 'bpn', f: 2200, q: 0.5, env: (t) => bell(t, 0.5, 0.25, 1) * (0.4 + 0.6 * gr[Math.min(n - 1, Math.floor(t * sr))]), gain: 0.45 });
      addCrackle(d, sr, rng, { from: 0, to: 0.35, count: 12, fLo: 2000, fHi: 6000, amp: 0.07, tau: 0.002 });
      drive(d, 2);
      return finish([d], sr, 0.92, 0.08);
    },
  },
  parry: {
    variants: 3,
    gain: 0.8,
    verb: 0.18,
    priority: 2,
    render: (sr, rng, v) => {
      const d = buf(sr, 1.0);
      clang(d, sr, rng, [1380, 1480, 1600][v], 1, 1);
      drive(d, 1.3);
      bakeTail(d, sr, 0.6, 0.3);
      return finish([d], sr, 0.9, 0.1);
    },
  },
  parryPerfect: {
    variants: 1,
    gain: 0.85,
    verb: 0.25,
    priority: 2,
    duck: [0.2, 260],
    render: (sr, rng) => {
      const chs: Channels = [];
      for (let ch = 0; ch < 2; ch++) {
        const r = rngFor(rng() * 1e9, ch);
        const d = buf(sr, 2.1);
        clang(d, sr, r, 1560, 1.4, 1);
        // shimmering ring with tremolo
        const n = Math.ceil(1.9 * sr);
        const sh = new Float32Array(n);
        addModal(sh, sr, 0, 2700 * (1 + ch * 0.003), [
          [1, 0.14, 1.2],
          [1.5, 0.1, 1.0],
          [2.07, 0.08, 0.9],
          [2.63, 0.06, 0.7],
        ]);
        for (let i = 0; i < n; i++) sh[i] *= 0.6 + 0.4 * Math.sin(TAU * (7 + ch * 0.7) * (i / sr));
        addAt(d, sh, 0);
        // subtle reverse swell into a soft "ting"
        const sw = new Float32Array(Math.ceil(0.42 * sr));
        addNoise(sw, sr, 0, 0.42, r, { mode: 'bpn', f: 6000, q: 1.5, env: (t) => expDecay(t, 0.12), gain: 0.18 });
        addPing(sw, sr, 0, 2700, 0.1, 0.15);
        addPing(sw, sr, 0, 5400, 0.06, 0.12);
        reverse(sw);
        addAt(d, sw, 0.1 * sr);
        addPing(d, sr, 0.52, 2700, 0.16, 0.3);
        addPing(d, sr, 0.52, 5400, 0.09, 0.22);
        bakeTail(d, sr, 1.2, 0.4, 0.3, ch * 19);
        chs.push(d);
      }
      return finish(chs, sr, 0.9, 0.2);
    },
  },
  armorBreak: {
    variants: 1,
    gain: 0.95,
    verb: 0.14,
    priority: 2,
    duck: [0.2, 200],
    render: (sr, rng) => {
      const mono = buf(sr, 1.3);
      // heavy, dense plate clang
      addModal(mono, sr, 0, 300, [
        [1, 0.6, 0.25],
        [1.59, 0.55, 0.2],
        [2.31, 0.5, 0.16],
        [2.97, 0.4, 0.13],
        [3.83, 0.35, 0.1],
        [5.12, 0.25, 0.07],
        [6.4, 0.2, 0.05],
      ], 0.006);
      addNoise(mono, sr, 0, 0.012, rng, { mode: 'hp', f: 2500, env: (t) => expDecay(t, 0.0025), gain: 1.2 });
      const n = Math.ceil(0.13 * sr);
      const c = new Float32Array(n);
      const gr = grains(n, sr, rng, 420, 3);
      addNoise(c, sr, 0, 0.13, rng, { mode: 'bpn', f: 1700, q: 0.9, env: (t) => ad(t, 0.001, 0.04) * gr[Math.min(n - 1, Math.floor(t * sr))], gain: 1 });
      drive(c, 6);
      addAt(mono, c, 0.002 * sr, 0.9);
      addTone(mono, sr, 0, 0.25, (t) => 45 + 45 * Math.exp(-t / 0.03), (t) => ad(t, 0.001, 0.08), { gain: 0.9 });
      const chs: Channels = [];
      for (let ch = 0; ch < 2; ch++) {
        const d = mono.slice();
        const r = rngFor(rng() * 1e9, 'debris', ch);
        addCrackle(d, sr, r, { from: 0.05, to: 0.6, count: 18, fLo: 2500, fHi: 7000, amp: 0.15, tau: 0.03, ampDecay: 0.25 });
        addCrackle(d, sr, r, { from: 0.15, to: 0.8, count: 5, fLo: 800, fHi: 1500, amp: 0.2, tau: 0.015 });
        chs.push(d);
      }
      return finish(chs, sr, 0.92, 0.1);
    },
  },
  heroHit: {
    variants: 3,
    gain: 0.95,
    verb: 0.05,
    priority: 2,
    render: (sr, rng) => {
      const d = buf(sr, 0.45);
      addTone(d, sr, 0, 0.3, (t) => 55 + 90 * Math.exp(-t / 0.025), (t) => ad(t, 0.0008, 0.07), { gain: 1.1 });
      addTone(d, sr, 0, 0.2, (t) => 90 + 30 * Math.exp(-t / 0.02), (t) => ad(t, 0.0008, 0.06), { gain: 0.55 });
      addNoise(d, sr, 0, 0.014, rng, { mode: 'hp', f: 2500, env: (t) => expDecay(t, 0.0025), gain: 1 });
      addNoise(d, sr, 0.002, 0.05, rng, { mode: 'bpn', f: 1200, q: 1.2, env: (t) => ad(t, 0.0005, 0.012), gain: 0.8 });
      addNoise(d, sr, 0, 0.12, rng, { mode: 'lp', f: 600, env: (t) => ad(t, 0.001, 0.03), gain: 0.8 });
      drive(d, 2.8);
      filter(d, sr, 'lp', 12000);
      return finish([d], sr, 0.9, 0.05);
    },
  },
  heroHitHeavy: {
    variants: 1,
    gain: 1,
    verb: 0.1,
    priority: 2,
    duck: [0.35, 380],
    render: (sr, rng) => {
      const mono = buf(sr, 1.6);
      addTone(mono, sr, 0, 0.8, (t) => 32 + 75 * Math.exp(-t / 0.06), (t) => ad(t, 0.001, 0.25), { gain: 1.2 });
      drive(mono, 3.5);
      addNoise(mono, sr, 0, 0.01, rng, { mode: 'hp', f: 2500, env: (t) => expDecay(t, 0.0025), gain: 1.5 });
      addNoise(mono, sr, 0, 0.04, rng, { mode: 'bpn', f: 1100, q: 1.2, env: (t) => ad(t, 0.0005, 0.01), gain: 0.9 });
      const n = Math.ceil(0.12 * sr);
      const c = new Float32Array(n);
      addNoise(c, sr, 0, 0.12, rng, { mode: 'bpn', f: 1400, q: 1, env: (t) => ad(t, 0.0008, 0.035), gain: 1 });
      drive(c, 5);
      addAt(mono, c, 0, 0.7);
      const rum = brown(Math.ceil(1.2 * sr), rng);
      filter(rum, sr, 'lp', 90);
      for (let i = 0; i < rum.length; i++) rum[i] *= ad(i / sr, 0.03, 0.5) * 3;
      addAt(mono, rum, 0);
      const chs = stereoOf(mono, sr, 3, 0, 0);
      chs.forEach((d, ch) => {
        addTone(d, sr, 0.04, 1.45, () => 3700 + ch * 9, (t) => bell(t, 1.4, 0.12, 1) * 0.22);
        addTone(d, sr, 0.04, 1.2, () => 7400 + ch * 13, (t) => bell(t, 1.2, 0.1, 1) * 0.06);
      });
      filter(chs[0], sr, 'lp', 12000);
      filter(chs[1], sr, 'lp', 12000);
      return finish(chs, sr, 0.94, 0.15);
    },
  },
  gunshot: {
    variants: 2,
    gain: 0.85,
    verb: 0.1,
    priority: 2,
    duck: [0.25, 180],
    render: (sr, rng) => {
      const mono = buf(sr, 1.4);
      // supersonic crack + muzzle blast + body punch
      addNoise(mono, sr, 0, 0.006, rng, { mode: 'hp', f: 1200, env: (t) => ad(t, 0.0001, 0.0015), gain: 1.6 });
      addTone(mono, sr, 0, 0.01, () => 1800, (t) => expDecay(t, 0.002), { gain: 0.6 });
      addNoise(mono, sr, 0, 0.25, rng, { mode: 'lp', f: (t) => 400 + 2600 * Math.exp(-t / 0.03), env: (t) => ad(t, 0.0003, 0.04), gain: 1.3 });
      addTone(mono, sr, 0, 0.2, (t) => 60 + 80 * Math.exp(-t / 0.015), (t) => ad(t, 0.0005, 0.05), { gain: 0.9 });
      drive(mono, 3);
      hardClip(mono, 0.9);
      filter(mono, sr, 'lp', 13000); // round off the clipped corners (no inter-sample overs)
      // slide/brass mechanics
      addPing(mono, sr, 0.04, 3200, 0.15, 0.004);
      addPing(mono, sr, 0.047, 2400, 0.12, 0.004);
      const chs: Channels = [];
      for (let ch = 0; ch < 2; ch++) {
        const d = mono.slice();
        const r = rngFor(rng() * 1e9, 'tail', ch);
        addNoise(d, sr, 0.008, 1.3, r, { mode: 'lp', f: 2200, env: (t) => ad(t, 0.008, 0.35), gain: 0.4 });
        const slaps = ch === 0 ? [0.03, 0.09] : [0.055, 0.12];
        slaps.forEach((sl, k) => addAt(d, mono.subarray(0, Math.ceil(0.1 * sr)), sl * sr, k === 0 ? 0.3 : 0.15));
        chs.push(d);
      }
      return finish(chs, sr, 0.95, 0.12);
    },
  },
  bulletDeflect: {
    variants: 3,
    gain: 0.75,
    verb: 0.12,
    priority: 1,
    render: (sr, rng, v) => {
      const d = buf(sr, 0.8);
      addModal(d, sr, 0, 2000 + v * 180, [
        [1, 0.5, 0.1],
        [1.61, 0.35, 0.07],
        [2.47, 0.25, 0.05],
      ]);
      addNoise(d, sr, 0, 0.04, rng, { mode: 'hp', f: 6000, env: (t) => ad(t, 0.0003, 0.008), gain: 0.6 });
      const f = (t: number) => 3300 * Math.pow(1100 / 3300, Math.min(1, t / 0.5)) * (1 + 0.012 * Math.sin(TAU * 31 * t));
      addTone(d, sr, 0.01, 0.6, f, (t) => bell(t, 0.58, 0.22, 1) * 0.35);
      addNoise(d, sr, 0.01, 0.6, rng, { mode: 'bpn', f, q: 14, env: (t) => bell(t, 0.58, 0.22, 1), gain: 0.3 });
      return finish([d], sr, 0.88, 0.08);
    },
  },
  chainsaw: {
    variants: 1,
    gain: 0.32,
    verb: 0.05,
    priority: 1,
    render: (sr, rng) => {
      const dur = 1.6;
      const rpm = (t: number) =>
        t < 0.15 ? 24 : t < 0.55 ? 24 + 56 * Math.pow((t - 0.15) / 0.4, 0.7) : t < 1.15 ? 80 + 3 * Math.sin(TAU * 6 * t) : 80 - 32 * Math.min(1, (t - 1.15) / 0.35);
      const chs: Channels = [];
      for (let ch = 0; ch < 2; ch++) {
        const r = rngFor(rng() * 1e9, 'saw', ch);
        const d = buf(sr, dur);
        // two-stroke engine pops + raspy harmonic exhaust + chain rattle
        const body = new SVF(sr, 320, 1);
        const rasp = new SVF(sr, 1500, 1.4);
        const chain = new SVF(sr, 2400, 1.2);
        let ph = 0;
        let ph3 = 0;
        let teeth = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          const f = rpm(t);
          ph += f / sr;
          if (ph >= 1) ph -= 1;
          ph3 += (f * 3.02) / sr;
          if (ph3 >= 1) ph3 -= 1;
          teeth += (f * 5) / sr;
          const fire = ph < 0.12 ? Math.sin((Math.PI * ph) / 0.12) : 0;
          const n = r() * 2 - 1;
          body.tick(fire * 2 + n * 0.15);
          rasp.tick((2 * ph3 - 1) * (0.5 + fire) + n * 0.3);
          chain.tick(n);
          const rattle = 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * teeth));
          d[i] = (body.lp * 1.3 + rasp.bpn * 0.9 * Math.min(1, f / 50) + chain.bpn * rattle * 0.45 * Math.min(1, f / 60)) * Math.min(1, t / 0.02);
        }
        drive(d, 6);
        filter(d, sr, 'lp', 5200);
        hardClip(d, 0.85);
        filter(d, sr, 'lp', 9000);
        chs.push(d);
      }
      return finish(chs, sr, 0.85, 0.12);
    },
  },
  dash: {
    variants: 2,
    gain: 0.55,
    verb: 0.05,
    priority: 0,
    render: (sr, rng, v) => {
      const d = buf(sr, 0.36);
      whoosh(d, sr, rng, 0, 0.3, 350, 5200 + v * 500, { fEnd: 3800, q: 1.4, peak: 0.6, gain: 1 });
      addNoise(d, sr, 0, 0.3, rng, { mode: 'hp', f: 6000, env: (t) => bell(t, 0.3, 0.6, 2), gain: 0.25 });
      addTone(d, sr, 0, 0.3, (t) => 110 - 40 * (t / 0.3), (t) => bell(t, 0.3, 0.45, 1.5), { gain: 0.3 });
      return finish([d], sr, 0.88, 0.02);
    },
  },
  blink: {
    variants: 1,
    gain: 0.6,
    verb: 0.2,
    priority: 0,
    render: (sr, rng) => {
      const chs: Channels = [];
      for (let ch = 0; ch < 2; ch++) {
        const r = rngFor(rng() * 1e9, 'blink', ch);
        const d = buf(sr, 0.6);
        addNoise(d, sr, 0, 0.12, r, { mode: 'bpn', f: (t) => 800 * Math.pow(11, t / 0.12), q: 1.3, env: (t) => Math.pow(t / 0.12, 2), gain: 0.8 });
        addTone(d, sr, 0.1, 0.09, (t) => 380 * Math.pow(4500 / 380, Math.min(1, t / 0.07)), (t) => ad(t, 0.001, 0.03), { gain: 0.3 });
        addTone(d, sr, 0.12, 0.06, (t) => 600 + 300 * Math.exp(-t / 0.01), (t) => ad(t, 0.0005, 0.012), { gain: 0.4 });
        addCrackle(d, sr, r, { from: 0.12, to: 0.5, count: 22, fLo: 5000, fHi: 12000, amp: 0.14, tau: 0.006, ampDecay: 0.2 });
        bakeTail(d, sr, 0.5, 0.25, 0.35, ch * 13);
        chs.push(d);
      }
      return finish(chs, sr, 0.85, 0.05);
    },
  },
  land: {
    variants: 2,
    gain: 0.75,
    verb: 0.05,
    priority: 0,
    render: (sr, rng) => {
      const d = buf(sr, 0.5);
      // boots on concrete: hard slap + audible body + grit
      addTone(d, sr, 0, 0.2, (t) => 55 + 60 * Math.exp(-t / 0.03), (t) => ad(t, 0.001, 0.06), { gain: 1 });
      addTone(d, sr, 0, 0.12, (t) => 140 + 60 * Math.exp(-t / 0.015), (t) => ad(t, 0.0008, 0.03), { gain: 0.7 });
      addNoise(d, sr, 0, 0.04, rng, { mode: 'bpn', f: 1100, q: 1, env: (t) => ad(t, 0.0004, 0.008), gain: 1 });
      addNoise(d, sr, 0, 0.012, rng, { mode: 'hp', f: 3000, env: (t) => expDecay(t, 0.002), gain: 0.6 });
      addCrackle(d, sr, rng, { from: 0.004, to: 0.18, count: 20, fLo: 1800, fHi: 6500, amp: 0.16, tau: 0.002 });
      const n = Math.ceil(0.16 * sr);
      const gr = grains(n, sr, rng, 220, 4);
      addNoise(d, sr, 0, 0.16, rng, { mode: 'bpn', f: 3200, q: 0.8, env: (t) => gr[Math.min(n - 1, Math.floor(t * sr))] * expDecay(t, 0.05), gain: 0.35 });
      drive(d, 1.8);
      return finish([d], sr, 0.9, 0.04);
    },
  },
  glassCrack: {
    variants: 2,
    gain: 0.65,
    verb: 0.12,
    priority: 1,
    render: (sr, rng) => {
      const d = buf(sr, 0.9);
      for (let k = 0; k < 16; k++) {
        const t = 0.12 * Math.pow(k / 16, 1.6) + rng() * 0.004;
        addPing(d, sr, t, 4000 + rng() * 5500, 0.4, 0.0025);
        addNoise(d, sr, t, 0.002, rng, { mode: 'hp', f: 3000, env: () => 1, gain: 0.5 });
      }
      addModal(d, sr, 0.01, 2800, [
        [1, 0.3, 0.1],
        [1.57, 0.25, 0.08],
        [2.39, 0.2, 0.06],
        [2.93, 0.15, 0.05],
      ]);
      const n = Math.ceil(0.25 * sr);
      const gr = grains(n, sr, rng, 260, 2);
      addNoise(d, sr, 0, 0.25, rng, { mode: 'hp', f: 6000, env: (t) => gr[Math.min(n - 1, Math.floor(t * sr))] * expDecay(t, 0.08), gain: 0.25 });
      addCrackle(d, sr, rng, { from: 0.2, to: 0.8, count: 6, fLo: 3000, fHi: 7000, amp: 0.15, tau: 0.04, ampDecay: 0.3 });
      return finish([d], sr, 0.88, 0.06);
    },
  },
  glitch: {
    variants: 3,
    gain: 0.85,
    verb: 0,
    priority: 0,
    render: (sr, rng) => {
      const g = buf(sr, 0.05);
      addTone(g, sr, 0, 0.05, (t) => 180 + 900 * (t / 0.05), () => 0.6, { wave: 'square' });
      addNoise(g, sr, 0, 0.05, rng, { env: () => 0.4 });
      const d = buf(sr, 0.5);
      const slices = [14, 14, 7, 7, 7, 22, 4, 4, 4, 4, 4, 30, 9, 9, 18, 6, 6, 40];
      const rates = [1, 1, 2, 2, 0.5, 1.5, 4, 4, 4, 4, 4, 0.25, 2, 1, 3, 1, 1, 0.5];
      let pos = 0;
      slices.forEach((ms, k) => {
        const len = Math.floor((ms / 1000) * sr);
        const r = rates[k % rates.length];
        const gate = rng() < 0.18 ? 0 : 1;
        const off = Math.floor(rng() * g.length * 0.5);
        for (let i = 0; i < len && pos + i < d.length; i++) d[pos + i] = g[(off + Math.floor(i * r)) % g.length] * gate;
        pos += len;
      });
      // hard bit-crush (4 bits) + sample-rate reduction (÷8)
      let held = 0;
      for (let i = 0; i < d.length; i++) {
        if (i % 8 === 0) held = Math.round(d[i] * 8) / 8;
        d[i] = held;
      }
      filter(d, sr, 'lp', 11000);
      return finish([d], sr, 0.8, 0.01);
    },
  },
  thunder: {
    variants: 1,
    gain: 0.9,
    verb: 0.15,
    priority: 1,
    render: (sr, rng) => {
      const chs: Channels = [];
      for (let ch = 0; ch < 2; ch++) {
        const r = rngFor(rng() * 1e9, 'thunder', ch);
        const d = buf(sr, 3.6);
        for (const [at, g] of [
          [0, 1.6],
          [0.05, 1],
          [0.13, 0.6],
        ] as const)
          addNoise(d, sr, at + ch * 0.004, 0.2, r, { mode: 'hp', f: 2000, env: (t) => ad(t, 0.0005, 0.03), gain: g });
        addTone(d, sr, 0.04, 2.5, (t) => 30 + 15 * Math.exp(-t / 0.4), (t) => ad(t, 0.08, 1), { gain: 0.5 });
        const n = Math.ceil(3.4 * sr);
        const rum = brown(n, r);
        filter(rum, sr, 'lp', 170);
        const am = wobble(n, sr, 3, r);
        for (let i = 0; i < n; i++) rum[i] *= (0.45 + 0.55 * (am[i] * 0.5 + 0.5)) * ad(i / sr, 0.15, 1.1) * 7;
        addAt(d, rum, 0.05 * sr);
        const mid = noise(n, r);
        filter(mid, sr, 'lp', 600);
        const am2 = wobble(n, sr, 5, r);
        for (let i = 0; i < n; i++) mid[i] *= (0.3 + 0.7 * Math.max(0, am2[i])) * ad(i / sr, 0.05, 0.6) * 0.5;
        addAt(d, mid, 0.03 * sr);
        chs.push(d);
      }
      return finish(chs, sr, 0.92, 0.4);
    },
  },
  impact: {
    variants: 2,
    gain: 1,
    verb: 0.15,
    priority: 2,
    duck: [0.3, 260],
    render: (sr, rng) => {
      const mono = buf(sr, 1.5);
      addTone(mono, sr, 0, 0.9, (t) => 42 + 110 * Math.exp(-t / 0.05), (t) => ad(t, 0.001, 0.32), { gain: 1 });
      drive(mono, 3);
      addTone(mono, sr, 0, 1.4, (t) => 30 + 10 * Math.exp(-t / 0.3), (t) => ad(t, 0.01, 0.6), { gain: 0.5 });
      addNoise(mono, sr, 0, 0.02, rng, { mode: 'hp', f: 2000, env: (t) => expDecay(t, 0.005), gain: 0.7 });
      addNoise(mono, sr, 0, 0.5, rng, { mode: 'lp', f: 300, env: (t) => ad(t, 0.001, 0.08), gain: 0.6 });
      addNoise(mono, sr, 0, 0.03, rng, { mode: 'bpn', f: 1800, q: 1, env: (t) => ad(t, 0.0005, 0.008), gain: 0.7 });
      const chs: Channels = [];
      for (let ch = 0; ch < 2; ch++) {
        const d = mono.slice();
        addNoise(d, sr, 0.01, 1.3, rngFor(rng() * 1e9, ch), { mode: 'lp', f: 1400, env: (t) => ad(t, 0.02, 0.35), gain: 0.18 });
        chs.push(d);
      }
      return finish(chs, sr, 0.95, 0.2);
    },
  },
  slowmoIn: {
    variants: 1,
    gain: 0.75,
    verb: 0.2,
    priority: 1,
    render: (sr, rng) => {
      const d = buf(sr, 1.1);
      const t1 = buf(sr, 1);
      addTone(t1, sr, 0, 0.95, (t) => 240 * Math.pow(40 / 240, Math.min(1, t / 0.85)), (t) => ad(t, 0.02, 0.35), { wave: 'saw', gain: 0.9 });
      filter(t1, sr, 'lp', 900);
      drive(t1, 2);
      addAt(d, t1, 0);
      addNoise(d, sr, 0, 0.9, rng, { mode: 'bpn', f: (t) => 7000 * Math.pow(300 / 7000, Math.min(1, t / 0.8)), q: 1.3, env: (t) => bell(t, 0.9, 0.25, 1), gain: 0.6 });
      bakeTail(d, sr, 0.8, 0.35);
      return finish([d], sr, 0.88, 0.08);
    },
  },
  slowmoOut: {
    variants: 1,
    gain: 0.65,
    verb: 0.15,
    priority: 1,
    render: (sr, rng) => {
      const d = buf(sr, 0.65);
      const t1 = buf(sr, 0.55);
      addTone(t1, sr, 0, 0.5, (t) => 60 * Math.pow(260 / 60, Math.min(1, t / 0.4)), (t) => bell(t, 0.5, 0.7, 1.2), { wave: 'saw', gain: 0.6 });
      filter(t1, sr, 'lp', 1200);
      addAt(d, t1, 0);
      addNoise(d, sr, 0, 0.5, rng, { mode: 'bpn', f: (t) => 400 * Math.pow(7000 / 400, Math.min(1, t / 0.45)), q: 1.3, env: (t) => bell(t, 0.5, 0.75, 1), gain: 0.6 });
      return finish([d], sr, 0.85, 0.04);
    },
  },
  riser: {
    variants: 1,
    gain: 0.6,
    verb: 0.2,
    priority: 1,
    render: (sr, rng) => {
      const dur = 1.7;
      const d = buf(sr, dur + 0.05);
      addNoise(d, sr, 0, dur, rng, { mode: 'bpn', f: (t) => 300 * Math.pow(25, t / dur), q: (t) => 1.5 + 2.5 * (t / dur), env: (t) => Math.pow(t / dur, 2), gain: 1 });
      const s = buf(sr, dur);
      addTone(s, sr, 0, dur, (t) => 174.6 * Math.pow(2, t / dur), (t) => Math.pow(t / dur, 1.5), { wave: 'saw', gain: 0.25 });
      addTone(s, sr, 0, dur, (t) => 174.6 * 1.006 * Math.pow(2, t / dur), (t) => Math.pow(t / dur, 1.5), { wave: 'saw', gain: 0.25, phase: 0.3 });
      filter(s, sr, 'lp', (t) => 400 * Math.pow(15, t / dur));
      addAt(d, s, 0, 0.6);
      return finish([d], sr, 0.85, 0.01);
    },
  },
  subDrop: {
    variants: 1,
    gain: 0.6,
    verb: 0,
    priority: 1,
    render: (sr) => {
      const d = buf(sr, 2.1);
      addTone(d, sr, 0, 2.05, (t) => 28 + 47 * Math.exp(-t / 0.45), (t) => ad(t, 0.004, 0.8));
      drive(d, 2.4);
      filter(d, sr, 'lp', 900);
      // punchy onset so it reads on small speakers
      addTone(d, sr, 0, 0.05, () => 100, (t) => ad(t, 0.0005, 0.012), { gain: 0.5 });
      addNoise(d, sr, 0, 0.01, rngFor(7, 'subclick'), { mode: 'lp', f: 2500, env: (t) => expDecay(t, 0.002), gain: 0.4 });
      return finish([d], sr, 0.92, 0.25);
    },
  },
  ui: {
    variants: 1,
    gain: 0.3,
    verb: 0,
    priority: 2,
    render: (sr, rng) => {
      const d = buf(sr, 0.08);
      addTone(d, sr, 0, 0.07, () => 1650, (t) => ad(t, 0.0008, 0.012), { gain: 0.6 });
      addNoise(d, sr, 0, 0.004, rng, { mode: 'hp', f: 4000, env: (t) => expDecay(t, 0.0008), gain: 0.3 });
      return finish([d], sr, 0.8, 0.01);
    },
  },
  uiConfirm: {
    variants: 1,
    gain: 0.35,
    verb: 0.05,
    priority: 2,
    render: (sr) => {
      const d = buf(sr, 0.35);
      addTone(d, sr, 0, 0.08, () => 1320, (t) => ad(t, 0.001, 0.03), { gain: 0.5 });
      addTone(d, sr, 0.06, 0.15, () => 1980, (t) => ad(t, 0.001, 0.05), { gain: 0.5 });
      bakeTail(d, sr, 0.4, 0.2);
      return finish([d], sr, 0.8, 0.05);
    },
  },
  combo: {
    variants: 1,
    gain: 0.45,
    verb: 0.15,
    priority: 1,
    render: (sr, rng) => {
      const d = buf(sr, 0.5);
      addModal(d, sr, 0, 880, [
        [1, 0.45, 0.18],
        [2, 0.3, 0.12],
        [3, 0.2, 0.08],
        [4.17, 0.12, 0.05],
      ]);
      addNoise(d, sr, 0, 0.006, rng, { mode: 'hp', f: 5000, env: (t) => expDecay(t, 0.0015), gain: 0.4 });
      bakeTail(d, sr, 0.4, 0.25);
      return finish([d], sr, 0.85, 0.05);
    },
  },
  bloodlust: {
    variants: 1,
    gain: 0.95,
    verb: 0.15,
    priority: 2,
    duck: [0.3, 600],
    render: (sr, rng) => {
      const mono = buf(sr, 2);
      // clear heartbeat: thump + valve click
      for (const [at, g] of [
        [0, 1],
        [0.22, 0.75],
      ] as const) {
        addTone(mono, sr, at, 0.3, (t) => 48 + 30 * Math.exp(-t / 0.04), (t) => ad(t, 0.005, 0.09), { gain: g * 1.1 });
        addNoise(mono, sr, at, 0.008, rng, { mode: 'bpn', f: 1200, q: 1, env: (t) => expDecay(t, 0.0015), gain: g * 0.5 });
      }
      // demonic growl: detuned saws through an "aah" formant, tremolo, distortion
      const gr = buf(sr, 1.3);
      addTone(gr, sr, 0, 1.3, (t) => 52 + 22 * (t / 1.3), (t) => Math.pow(Math.min(1, t / 0.75), 2) * (0.55 + 0.45 * Math.sin(TAU * 9 * t)), { wave: 'saw' });
      addTone(gr, sr, 0, 1.3, (t) => (52 + 22 * (t / 1.3)) * 1.012, (t) => Math.pow(Math.min(1, t / 0.75), 2), { wave: 'saw', gain: 0.8, phase: 0.4 });
      const f1 = gr.slice();
      filter(f1, sr, 'bpn', 650, 2);
      filter(gr, sr, 'bpn', 1100, 3);
      for (let i = 0; i < gr.length; i++) gr[i] = gr[i] * 0.6 + f1[i];
      drive(gr, 5);
      addAt(mono, gr, 0.2 * sr, 0.7);
      // swell into the hit
      const sw = buf(sr, 0.6);
      addNoise(sw, sr, 0, 0.6, rng, { mode: 'bpn', f: 1400, q: 1.5, env: (t) => expDecay(t, 0.15), gain: 0.4 });
      reverse(sw);
      addAt(mono, sw, 0.4 * sr);
      addTone(mono, sr, 1.0, 0.6, (t) => 42 + 70 * Math.exp(-t / 0.04), (t) => ad(t, 0.001, 0.2), { gain: 1.2 });
      addNoise(mono, sr, 1.0, 0.006, rng, { mode: 'hp', f: 2000, env: (t) => expDecay(t, 0.0015), gain: 1 });
      addNoise(mono, sr, 1.0, 0.3, rng, { mode: 'lp', f: 600, env: (t) => ad(t, 0.001, 0.06), gain: 0.8 });
      drive(mono, 1.5);
      const chs = stereoOf(mono, sr, 5, 0.9, 0.25);
      chs.forEach((d, ch) => addTone(d, sr, 1.02, 0.8, () => 3200 + ch * 5, (t) => bell(t, 0.75, 0.1, 1) * 0.06));
      return finish(chs, sr, 0.94, 0.15);
    },
  },
  execCut: {
    variants: 1,
    gain: 1,
    verb: 0.2,
    priority: 2,
    duck: [0.45, 600],
    render: (sr, rng) => {
      const chs: Channels = [];
      const mono = buf(sr, 2.1);
      whoosh(mono, sr, rng, 0, 0.18, 280, 3000, { fEnd: 1100, q: 1.4, gain: 0.9, whistle: 0.4 });
      const t0 = 0.15;
      // blade "shing": rising metallic glide + bright noise sweep
      addTone(mono, sr, t0 - 0.02, 0.1, (t) => 2500 * Math.pow(2.6, Math.min(1, t / 0.08)), (t) => bell(t, 0.1, 0.3, 1), { gain: 0.35 });
      addNoise(mono, sr, t0 - 0.01, 0.07, rng, { mode: 'bpn', f: (t) => 4000 * Math.pow(2.2, t / 0.07), q: 2, env: (t) => bell(t, 0.07, 0.5, 1), gain: 0.7 });
      addModal(mono, sr, t0, 3400, [
        [1, 0.24, 0.18],
        [1.5, 0.18, 0.12],
        [2.2, 0.14, 0.09],
      ]);
      fleshCut(mono, sr, rng, t0, 1.6, 1);
      bone(mono, sr, rng, t0 + 0.01, 1.3);
      const sub = buf(sr, 0.9);
      addTone(sub, sr, 0, 0.9, (t) => 28 + 52 * Math.exp(-t / 0.07), (t) => ad(t, 0.001, 0.32), { gain: 1.3 });
      drive(sub, 2.5);
      addAt(mono, sub, t0 * sr);
      gush(mono, sr, rng, t0 + 0.06, 1.5, 1.2);
      drive(mono, 1.4);
      for (const d of stereoOf(mono, sr, 9, 1.2, 0.35)) chs.push(d);
      return finish(chs, sr, 0.95, 0.15);
    },
  },
  execFail: {
    variants: 1,
    gain: 0.8,
    verb: 0.12,
    priority: 2,
    render: (sr, rng) => {
      const d = buf(sr, 1.0);
      addModal(d, sr, 0, 310, [
        [1, 0.5, 0.12],
        [1.4, 0.35, 0.09],
        [2.2, 0.2, 0.06],
      ]);
      thud(d, sr, rng, 0, 0.6, 90);
      addTone(d, sr, 0, 0.7, (t) => 30 + 25 * Math.exp(-t / 0.08), (t) => ad(t, 0.002, 0.25), { gain: 0.9 });
      const b = buf(sr, 0.6);
      addTone(b, sr, 0, 0.55, (t) => 280 * Math.pow(85 / 280, Math.min(1, t / 0.5)), (t) => ad(t, 0.005, 0.25), { wave: 'saw', gain: 0.6 });
      filter(b, sr, 'lp', 700);
      addAt(d, b, 0.05 * sr);
      // stutter of the tail
      const grain = d.slice(Math.floor(0.12 * sr), Math.floor(0.15 * sr));
      for (let k = 0; k < 6; k++) addAt(d, grain, (0.55 + k * 0.035) * sr, 0.5 * (1 - k / 6));
      return finish([d], sr, 0.88, 0.08);
    },
  },
  heartbeat: {
    variants: 1,
    gain: 0.6,
    verb: 0.05,
    priority: 1,
    render: (sr) => {
      const d = buf(sr, 0.75);
      for (const [at, g, f] of [
        [0, 1, 58],
        [0.26, 0.75, 66],
      ] as const) {
        addTone(d, sr, at, 0.35, () => f, (t) => ad(t, 0.008, 0.11), { gain: g });
        addTone(d, sr, at, 0.3, () => f * 2, (t) => ad(t, 0.008, 0.07), { gain: g * 0.35 });
      }
      drive(d, 2.4);
      filter(d, sr, 'lp', 520);
      return finish([d], sr, 0.92, 0.05);
    },
  },
  collapse: {
    variants: 1,
    gain: 1,
    verb: 0.15,
    priority: 1,
    duck: [0.3, 900],
    render: (sr, rng) => {
      const chs: Channels = [];
      for (let ch = 0; ch < 2; ch++) {
        const r = rngFor(rng() * 1e9, 'collapse', ch);
        const d = buf(sr, 2.8);
        // distinct crashing impacts (clusters), concrete cracks, debris, less rumble
        [0, 0.12, 0.21, 0.38, 0.52, 0.7, 0.95, 1.3].forEach((at, k) => chunk(d, sr, r, at + ch * 0.007 + r() * 0.02, 1.1 - k * 0.11));
        addCrackle(d, sr, r, { from: 0.03, to: 2.0, count: 55, fLo: 600, fHi: 3500, amp: 0.2, tau: 0.008, ampDecay: 0.9 });
        const n = Math.ceil(2 * sr);
        const gr = grains(n, sr, r, 120, 10);
        addNoise(d, sr, 0.02, 2, r, { mode: 'bpn', f: 900, q: 0.6, env: (t) => gr[Math.min(n - 1, Math.floor(t * sr))] * expDecay(t, 0.6), gain: 0.35 });
        const rum = brown(Math.ceil(2.4 * sr), r);
        filter(rum, sr, 'lp', 100);
        for (let i = 0; i < rum.length; i++) rum[i] *= ad(i / sr, 0.05, 0.8) * 2;
        addAt(d, rum, 0);
        chs.push(d);
      }
      return finish(chs, sr, 0.93, 0.3);
    },
  },
  trainHorn: {
    variants: 1,
    gain: 0.75,
    verb: 0.25,
    priority: 1,
    render: (sr) => {
      const chs: Channels = [];
      for (let ch = 0; ch < 2; ch++) {
        const d = buf(sr, 2.7);
        const env = (t: number) => Math.min(1, t / 0.08) * (t < 1.9 ? 1 : Math.max(0, 1 - (t - 1.9) / 0.45));
        for (const [f, k] of [
          [277.2, 0],
          [329.6, 1],
          [415.3, 2],
        ] as const) {
          const det = 1 + (ch ? 0.004 : -0.004) * (k + 1);
          addTone(d, sr, 0, 2.4, (t) => f * det * (1 - 0.03 * Math.min(1, t / 2.2)), env, { wave: 'saw', gain: 0.3, phase: 0.1 * k + ch * 0.37 });
        }
        filter(d, sr, 'lp', 2400);
        filter(d, sr, 'bpn', 1100, 0.6);
        drive(d, 1.5);
        bakeTail(d, sr, 1.5, 0.4, 0.3, ch * 17);
        chs.push(d);
      }
      return finish(chs, sr, 0.88, 0.25);
    },
  },
  tapeStop: {
    variants: 1,
    gain: 0.5,
    verb: 0,
    priority: 2,
    render: (sr) => {
      const d = buf(sr, 0.9);
      addTone(d, sr, 0, 0.85, (t) => 30 + 520 * Math.pow(Math.max(0, 1 - t / 0.8), 2), (t) => Math.max(0, 1 - t / 0.85), { wave: 'saw', gain: 0.7 });
      filter(d, sr, 'lp', 2000);
      return finish([d], sr, 0.8, 0.05);
    },
  },
};

/** SFX rendered at half the context rate (low-frequency dominated, long): half the memory. */
const HALF_RATE_SFX: ReadonlySet<Sfx> = new Set<Sfx>(['thunder', 'collapse', 'subDrop', 'heartbeat']);

export function sfxRate(name: Sfx, ctxRate: number): number {
  return HALF_RATE_SFX.has(name) ? Math.max(22050, Math.round(ctxRate / 2)) : ctxRate;
}

/** Renders one SFX variant (deterministic per seed/variant). */
export function renderSfx(name: Sfx, sr: number, seed: number, variant: number): Channels {
  const def = SFX_DEFS[name];
  const v = Math.max(0, Math.min(def.variants - 1, variant));
  return def.render(sr, rngFor(seed, 'sfx', name, v), v);
}
