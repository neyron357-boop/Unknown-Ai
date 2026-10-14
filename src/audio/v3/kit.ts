/**
 * Music one-shots rendered procedurally (once, lazily) into sample buffers:
 * phonk drums, 808-style cowbell multisamples, cymbals, impacts, beds and
 * fallback formant vocal chops. Pure DSP — no Web Audio here.
 */
import {
  TAU,
  Osc,
  addAt,
  addCrackle,
  addModal,
  addNoise,
  addPing,
  addTone,
  ad,
  bakeTail,
  brown,
  buf,
  dcBlock,
  drive,
  expDecay,
  fadeIn,
  fadeOut,
  filter,
  hardClip,
  makeLoopable,
  noise,
  normalize,
  reverse,
  wobble,
  SVF,
  type Channels,
} from './dsp';
import { rngFor, type Rng } from './rng';
import { mtof } from './theory';

export type KitId =
  | 'kick'
  | 'kickTight'
  | 'kickDist'
  | 'kickSoft'
  | 'heart'
  | 'snare'
  | 'clap'
  | 'rim'
  | 'hat0'
  | 'hat1'
  | 'hat2'
  | 'ohat'
  | 'perc0'
  | 'perc1'
  | 'perc2'
  | 'crash'
  | 'revCrash'
  | 'impact'
  | 'subDrop'
  | 'downlifter'
  | 'swell'
  | 'cowDirtyLo'
  | 'cowDirtyHi'
  | 'cowCleanLo'
  | 'cowCleanHi'
  | 'cowUniLo'
  | 'cowUniHi'
  | 'vinyl'
  | 'wind'
  | 'rain'
  | 'trainBed'
  | 'vox_hey'
  | 'vox_ha'
  | 'vox_ho'
  | 'vox_uh'
  | 'vox_vai';

/** MIDI note of the lower cowbell oscillator in each multisample. */
export const COWBELL_REF = { lo: 65, hi: 77 } as const;

/** Kit entries rendered at half the context rate (noise beds / low-frequency sounds): half the memory and render time. */
const HALF_RATE_KIT: ReadonlySet<KitId> = new Set<KitId>(['wind', 'rain', 'trainBed', 'vinyl', 'subDrop', 'heart', 'downlifter']);

/** Sample rate a kit entry is rendered at (≥ 22050 Hz, Safari's createBuffer minimum). */
export function kitRate(id: KitId, ctxRate: number): number {
  return HALF_RATE_KIT.has(id) ? Math.max(22050, Math.round(ctxRate / 2)) : ctxRate;
}

/** Every kit entry, in warm-up priority order (after CORE_KIT). */
export const ALL_KIT: readonly KitId[] = [
  'kick',
  'kickTight',
  'snare',
  'clap',
  'hat0',
  'hat1',
  'hat2',
  'cowDirtyLo',
  'cowDirtyHi',
  'crash',
  'revCrash',
  'impact',
  'subDrop',
  'perc0',
  'perc1',
  'perc2',
  'ohat',
  'rim',
  'kickDist',
  'cowUniLo',
  'cowUniHi',
  'heart',
  'kickSoft',
  'downlifter',
  'swell',
  'vox_hey',
  'vox_vai',
  'vox_ha',
  'vox_ho',
  'vox_uh',
  'cowCleanLo',
  'cowCleanHi',
  'vinyl',
  'wind',
  'rain',
  'trainBed',
];

/** Core kit rendered right at unlock (small). The rest renders in idle time or on first use. */
export const CORE_KIT: readonly KitId[] = ['kick', 'kickTight', 'snare', 'clap', 'hat0', 'hat1', 'hat2', 'cowDirtyLo', 'cowDirtyHi'];

// ---------------------------------------------------------------- drums

function renderKick(sr: number, rng: Rng, kind: 'punch' | 'tight' | 'dist' | 'soft' | 'heart'): Channels {
  const P = {
    punch: { dur: 0.5, f0: 280, f1: 52, tp: 0.014, decay: 0.2, drive: 3.5, click: 0.85, lp: 13000 },
    tight: { dur: 0.32, f0: 260, f1: 55, tp: 0.013, decay: 0.11, drive: 3.2, click: 0.8, lp: 13000 },
    dist: { dur: 0.62, f0: 280, f1: 50, tp: 0.04, decay: 0.3, drive: 7, click: 0.85, lp: 8000 },
    soft: { dur: 0.36, f0: 190, f1: 50, tp: 0.03, decay: 0.15, drive: 1.3, click: 0.18, lp: 1800 },
    heart: { dur: 0.42, f0: 78, f1: 47, tp: 0.045, decay: 0.12, drive: 2.6, click: 0, lp: 520 },
  }[kind];
  const d = buf(sr, P.dur);
  const osc = new Osc(sr);
  const attack = kind === 'heart' ? 0.008 : 0.0015;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const f = P.f1 + (P.f0 - P.f1) * Math.exp(-t / P.tp);
    const hold = kind === 'dist' ? Math.min(1, Math.exp(-(t - 0.05) / P.decay)) : Math.exp(-t / P.decay);
    d[i] = osc.sine(f) * Math.min(1, t / attack) * Math.min(1, hold);
  }
  if (P.click) {
    addNoise(d, sr, 0, 0.012, rng, { mode: 'hp', f: 2200, env: (t) => expDecay(t, 0.0025), gain: P.click });
    addTone(d, sr, 0, 0.01, () => 3200, (t) => expDecay(t, 0.003), { gain: P.click * 0.45 });
    // the "knock": a short 165 Hz body that reads as punch on phone speakers
    if (kind !== 'soft') addTone(d, sr, 0, 0.12, (t) => 165 + 60 * Math.exp(-t / 0.01), (t) => ad(t, 0.0008, 0.035), { gain: 0.35 });
  }
  if (kind !== 'heart' && kind !== 'soft') {
    // 80–110 Hz body boost (+4 dB, parallel band) — punch that survives small speakers
    const body = d.slice();
    filter(body, sr, 'bpn', 95, 1.4);
    for (let i = 0; i < d.length; i++) d[i] += body[i] * 0.6;
  }
  drive(d, P.drive);
  if (kind === 'dist') hardClip(d, 0.82);
  filter(d, sr, 'lp', P.lp);
  fadeOut(d, sr, 0.03);
  return normalize([d], kind === 'heart' ? 0.9 : 0.95);
}

function renderSnare(sr: number, rng: Rng): Channels {
  const d = buf(sr, 0.36);
  addTone(d, sr, 0, 0.25, (t) => 220 + 80 * Math.exp(-t / 0.015), (t) => ad(t, 0.001, 0.05), { gain: 0.75 });
  addTone(d, sr, 0, 0.2, (t) => 340 + 40 * Math.exp(-t / 0.012), (t) => ad(t, 0.001, 0.03), { gain: 0.3 });
  addNoise(d, sr, 0, 0.3, rng, { mode: 'bpn', f: 4500, q: 0.7, env: (t) => ad(t, 0.0006, 0.05), gain: 1.15 });
  addNoise(d, sr, 0, 0.3, rng, { mode: 'bpn', f: 1800, q: 0.6, env: (t) => ad(t, 0.0006, 0.04), gain: 0.55 });
  addNoise(d, sr, 0, 0.02, rng, { mode: 'hp', f: 5000, env: (t) => expDecay(t, 0.003), gain: 0.7 });
  filter(d, sr, 'hp', 150);
  drive(d, 2.2);
  fadeOut(d, sr, 0.04);
  return normalize([d], 0.9);
}

function renderClap(sr: number, rng: Rng): Channels {
  const d = buf(sr, 0.55);
  const bursts = [0, 0.009, 0.019, 0.03];
  bursts.forEach((b, k) => {
    const last = k === bursts.length - 1;
    addNoise(d, sr, b, last ? 0.4 : 0.02, rng, { env: (t) => (last ? ad(t, 0.0005, 0.1) : ad(t, 0.0005, 0.0035)), gain: last ? 1 : 0.85 });
  });
  filter(d, sr, 'bpn', 1250, 1.1);
  filter(d, sr, 'hp', 650);
  bakeTail(d, sr, 0.35, 0.5, 0.3);
  drive(d, 1.6);
  fadeOut(d, sr, 0.05);
  return normalize([d], 0.9);
}

function renderRim(sr: number, rng: Rng): Channels {
  const d = buf(sr, 0.12);
  addPing(d, sr, 0, 1750, 0.8, 0.012);
  addPing(d, sr, 0, 820, 0.5, 0.02);
  addNoise(d, sr, 0, 0.01, rng, { mode: 'hp', f: 3000, env: (t) => expDecay(t, 0.002), gain: 0.5 });
  fadeOut(d, sr, 0.02);
  return normalize([d], 0.8);
}

const HAT_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];

function renderHat(sr: number, rng: Rng, open: boolean, variant: number): Channels {
  const dur = open ? 0.55 : 0.1;
  const d = buf(sr, dur);
  const oscs = HAT_FREQS.map(() => new Osc(sr, rng()));
  const detune = 1 + (variant - 1) * 0.025;
  const tau = open ? 0.16 : 0.011 + variant * 0.002;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let v = 0;
    for (let k = 0; k < oscs.length; k++) v += oscs[k].square(HAT_FREQS[k] * 1.7 * detune);
    v = v / 6 + (rng() * 2 - 1) * 0.55;
    d[i] = v * ad(t, 0.0004, tau);
  }
  filter(d, sr, 'bpn', 9800 + variant * 700, 0.7);
  filter(d, sr, 'hp', 7000, 0.707, 2);
  filter(d, sr, 'lp', 14500);
  fadeOut(d, sr, open ? 0.08 : 0.01);
  return normalize([d], 0.8);
}

function renderPerc(sr: number, rng: Rng, variant: number): Channels {
  const f = [168, 246, 338][variant] ?? 246;
  const d = buf(sr, 0.32);
  addTone(d, sr, 0, 0.3, (t) => f * (1 + 0.55 * Math.exp(-t / 0.018)), (t) => ad(t, 0.001, 0.085));
  addTone(d, sr, 0, 0.2, () => f * 2.04, (t) => ad(t, 0.001, 0.03), { gain: 0.18 });
  addNoise(d, sr, 0, 0.03, rng, { mode: 'bpn', f: 1400, q: 1.2, env: (t) => expDecay(t, 0.006), gain: 0.55 });
  drive(d, 1.7);
  fadeOut(d, sr, 0.03);
  return normalize([d], 0.85);
}

// ---------------------------------------------------------------- cymbals & fx

function renderCrash(sr: number, seed: number, dur = 2.4): Channels {
  const chs: Channels = [];
  for (let ch = 0; ch < 2; ch++) {
    const rng = rngFor(seed, 'crash', ch);
    const d = buf(sr, dur);
    const n = noise(d.length, rng);
    filter(n, sr, 'lp', (t) => 15000 - 8000 * Math.min(1, t / 1.6));
    filter(n, sr, 'hp', 3200, 0.6);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      d[i] = n[i] * ad(t, 0.0015, 0.7) * (0.75 + 0.25 * Math.exp(-t / 0.08));
    }
    const partials: [number, number, number][] = [];
    for (let k = 0; k < 9; k++) partials.push([1 + k * 0.37 + rng() * 0.2, 0.05 + rng() * 0.04, 0.5 + rng() * 0.9]);
    addModal(d, sr, 0, 3100 + rng() * 300, partials);
    fadeOut(d, sr, 0.4);
    chs.push(d);
  }
  return normalize(chs, 0.8);
}

function renderRevCrash(sr: number, seed: number): Channels {
  const chs = renderCrash(sr, seed + 7, 2.2);
  for (const d of chs) {
    reverse(d);
    // emphasise the late rise
    for (let i = 0; i < d.length; i++) d[i] *= Math.pow(i / d.length, 1.4);
    fadeOut(d, sr, 0.004);
  }
  return normalize(chs, 0.8);
}

function renderImpact(sr: number, seed: number): Channels {
  const rng = rngFor(seed, 'impact');
  const mono = buf(sr, 2.6);
  const o = new Osc(sr);
  for (let i = 0; i < mono.length; i++) {
    const t = i / sr;
    const f = 38 + 110 * Math.exp(-t / 0.06);
    mono[i] = o.sine(f) * ad(t, 0.001, 0.5);
  }
  drive(mono, 3);
  addTone(mono, sr, 0, 2.4, (t) => 30 + 12 * Math.exp(-t / 0.4), (t) => ad(t, 0.01, 0.9), { gain: 0.5 });
  addNoise(mono, sr, 0, 0.02, rng, { mode: 'hp', f: 1500, env: (t) => expDecay(t, 0.006), gain: 0.7 });
  addNoise(mono, sr, 0, 0.9, rng, { mode: 'lp', f: 420, env: (t) => ad(t, 0.002, 0.22), gain: 0.9 });
  const chs: Channels = [];
  for (let ch = 0; ch < 2; ch++) {
    const d = mono.slice();
    const r2 = rngFor(seed, 'impactTail', ch);
    addNoise(d, sr, 0.01, 2.4, r2, { mode: 'lp', f: (t) => 1600 - 1000 * Math.min(1, t / 2), env: (t) => ad(t, 0.02, 0.55), gain: 0.22 });
    fadeOut(d, sr, 0.3);
    chs.push(d);
  }
  return normalize(chs, 0.95);
}

function renderSubDrop(sr: number): Channels {
  const d = buf(sr, 2.3);
  const o = new Osc(sr);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    d[i] = o.sine(29 + 58 * Math.exp(-t / 0.42)) * ad(t, 0.004, 0.85);
  }
  drive(d, 2.4);
  filter(d, sr, 'lp', 900);
  fadeOut(d, sr, 0.25);
  return normalize([d], 0.9);
}

function renderDownlifter(sr: number, seed: number): Channels {
  const chs: Channels = [];
  for (let ch = 0; ch < 2; ch++) {
    const rng = rngFor(seed, 'down', ch);
    const d = buf(sr, 2);
    addNoise(d, sr, 0, 2, rng, {
      mode: 'bpn',
      f: (t) => 200 * Math.pow(26, 1 - Math.min(1, t / 1.8)),
      q: 1.4,
      env: (t) => Math.min(1, t / 0.02) * Math.max(0, 1 - t / 2),
    });
    addTone(d, sr, 0, 1.6, (t) => 60 + 260 * Math.exp(-t / 0.5), (t) => ad(t, 0.01, 0.6), { gain: 0.25 });
    chs.push(d);
  }
  return normalize(chs, 0.7);
}

function renderSwell(sr: number, seed: number): Channels {
  const chs: Channels = [];
  for (let ch = 0; ch < 2; ch++) {
    const rng = rngFor(seed, 'swell', ch);
    const d = buf(sr, 2.6);
    addNoise(d, sr, 0, 0.6, rng, { mode: 'bpn', f: 1100, q: 0.8, env: (t) => ad(t, 0.002, 0.18), gain: 0.8 });
    addNoise(d, sr, 0, 0.4, rng, { mode: 'hp', f: 6000, env: (t) => ad(t, 0.001, 0.08), gain: 0.4 });
    addModal(d, sr, 0, 349.2, [
      [1, 0.25, 0.9],
      [1.5, 0.18, 0.8],
      [2, 0.12, 0.7],
      [3.01, 0.06, 0.5],
    ]);
    bakeTail(d, sr, 2.4, 1.4, 0.4, ch * 23);
    reverse(d);
    fadeOut(d, sr, 0.004);
    chs.push(d);
  }
  return normalize(chs, 0.7);
}

// ---------------------------------------------------------------- cowbell (808-style, pitched)

/**
 * 808-style cowbell: two square oscillators (≈587/845 Hz ratio) → narrow
 * band-pass (≈3.75× the base, Q 2.5) → HARD clip (blown-out, crunchy) → 6.5 kHz
 * low-pass, with the decay envelope applied AFTER the clipper so the tail stays
 * gritty instead of ringing like a clean FM chime.
 */
function renderCowbell(sr: number, ref: number, mode: 'dirty' | 'clean' | 'unison'): Channels {
  const f1 = mtof(ref);
  const ratio = 845 / 587;
  const dirty = mode !== 'clean';
  const dur = dirty ? 0.55 : 0.45;
  const d = buf(sr, dur);
  const det = mode === 'unison' ? [Math.pow(2, -14 / 1200), Math.pow(2, 13 / 1200)] : [1];
  const oscs = det.map((k, i) => [new Osc(sr, i * 0.37), new Osc(sr, 0.3 + i * 0.21), k] as const);
  const w = 1 / det.length;
  for (let i = 0; i < d.length; i++) {
    let v = 0;
    for (const [o1, o2, k] of oscs) v += o1.square(f1 * k) * 0.6 + o2.square(f1 * ratio * k) * 0.6;
    d[i] = v * w;
  }
  filter(d, sr, 'bpn', f1 * 3.75, 2.5);
  filter(d, sr, 'bpn', f1 * 3.75, 1.2);
  // pre-gain into a hard clipper (soft knee) — the crunch
  const pre = dirty ? (mode === 'unison' ? 9 : 7) : 1.6;
  for (let i = 0; i < d.length; i++) {
    const x = d[i] * pre;
    d[i] = dirty ? Math.max(-1, Math.min(1, x * (1.15 - 0.15 * Math.min(1, Math.abs(x))))) : Math.tanh(x);
  }
  filter(d, sr, 'lp', 6500, 0.707, 2);
  filter(d, sr, 'hp', 300);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    d[i] *= (0.72 * Math.exp(-t / 0.014) + 0.42 * Math.exp(-t / (dirty ? 0.15 : 0.11))) * Math.min(1, t / 0.0008);
  }
  dcBlock(d);
  fadeOut(d, sr, 0.05);
  return normalize([d], 0.9);
}

// ---------------------------------------------------------------- beds (loops)

function renderVinyl(sr: number, seed: number): Channels {
  const rng = rngFor(seed, 'vinyl');
  const d = buf(sr, 4.2);
  const hiss = noise(d.length, rng);
  filter(hiss, sr, 'bpn', 5200, 0.7);
  for (let i = 0; i < d.length; i++) d[i] = hiss[i] * 0.05;
  addCrackle(d, sr, rng, { from: 0, to: 4.2, count: 60, fLo: 1800, fHi: 7000, amp: 0.35, tau: 0.0007 });
  addCrackle(d, sr, rng, { from: 0, to: 4.2, count: 7, fLo: 600, fHi: 1800, amp: 0.7, tau: 0.0015 });
  const rum = brown(d.length, rng);
  filter(rum, sr, 'lp', 70);
  addAt(d, rum, 0, 0.4);
  return [makeLoopable(d, sr, 0.2)];
}

function renderWind(sr: number, seed: number): Channels {
  const chs: Channels = [];
  for (let ch = 0; ch < 2; ch++) {
    const rng = rngFor(seed, 'wind', ch);
    const n = Math.ceil(sr * 6.5);
    const src = noise(n, rng);
    const mod = wobble(n, sr, 0.6, rng);
    const gust = wobble(n, sr, 0.25, rng);
    const svf = new SVF(sr, 600, 1.2);
    const lo = new SVF(sr, 220, 0.6);
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if ((i & 31) === 0) svf.set(520 + 380 * mod[i] + 260 * gust[i], 1.1 + 0.9 * Math.max(0, gust[i]));
      svf.tick(src[i]);
      lo.tick(src[i]);
      d[i] = (svf.bpn * 0.7 + lo.lp * 0.5) * (0.55 + 0.45 * (gust[i] * 0.5 + 0.5));
    }
    chs.push(makeLoopable(d, sr, 0.5));
  }
  return normalize(chs, 0.6);
}

function renderRain(sr: number, seed: number): Channels {
  const chs: Channels = [];
  for (let ch = 0; ch < 2; ch++) {
    const rng = rngFor(seed, 'rain', ch);
    const n = Math.ceil(sr * 4.2);
    const d = noise(n, rng);
    filter(d, sr, 'hp', 1100);
    filter(d, sr, 'lp', 9000);
    for (let i = 0; i < n; i++) d[i] *= 0.16;
    addCrackle(d, sr, rng, { from: 0, to: 4.2, count: 600, fLo: 1500, fHi: 6500, amp: 0.12, tau: 0.0025 });
    addCrackle(d, sr, rng, { from: 0, to: 4.2, count: 48, fLo: 500, fHi: 1400, amp: 0.25, tau: 0.006 });
    const low = noise(n, rng);
    filter(low, sr, 'lp', 380);
    addAt(d, low, 0, 0.18);
    chs.push(makeLoopable(d, sr, 0.3));
  }
  return normalize(chs, 0.55);
}

function renderTrainBed(sr: number, seed: number): Channels {
  const rng = rngFor(seed, 'train');
  const dur = 4.4;
  const n = Math.ceil(sr * dur);
  const chs: Channels = [];
  const base = brown(n, rng);
  filter(base, sr, 'lp', 140);
  const hiss = noise(n, rng);
  filter(hiss, sr, 'bpn', 2800, 0.9);
  const clacks = new Float32Array(n);
  for (const t0 of [0.1, 0.24, 2.3, 2.44]) {
    addModal(clacks, sr, t0, 520, [
      [1, 0.6, 0.04],
      [2.31, 0.35, 0.03],
      [3.7, 0.2, 0.02],
    ]);
    addTone(clacks, sr, t0, 0.12, (t) => 70 + 40 * Math.exp(-t / 0.02), (t) => ad(t, 0.001, 0.04), { gain: 0.9 });
  }
  for (let ch = 0; ch < 2; ch++) {
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      d[i] = base[i] * 3 + hiss[(i + ch * 997) % n] * 0.05 * (0.6 + 0.4 * Math.sin(TAU * t * 0.9)) + clacks[i] * 0.55;
    }
    chs.push(makeLoopable(d, sr, 0.15));
  }
  return normalize(chs, 0.6);
}

// ---------------------------------------------------------------- fallback vocal chops (formant synth)

type Vowel = 'a' | 'e' | 'i' | 'o' | 'u' | 'uh';
const FORMANTS: Record<Vowel, [number, number, number]> = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [300, 2200, 2950],
  o: [570, 840, 2410],
  u: [320, 870, 2240],
  uh: [640, 1190, 2390],
};

interface ChopSpec {
  dur: number;
  f0: [number, number];
  /** [time, vowel] keyframes */
  path: [number, Vowel][];
  /** aspiration ('h') length in seconds at the start */
  breath: number;
  /** voiced fricative 'v' at the start */
  buzz?: number;
}

function renderChop(sr: number, seed: number, spec: ChopSpec): Channels {
  const rng = rngFor(seed, 'chop', spec.path.map((p) => p[1]).join(''));
  const d = buf(sr, spec.dur + 0.25);
  const n = Math.ceil(spec.dur * sr);
  const osc = new Osc(sr);
  const tilt = new SVF(sr, 1400, 0.6);
  const fs = [new SVF(sr), new SVF(sr), new SVF(sr)];
  const amps = [1, 0.55, 0.28];
  const vib = wobble(n, sr, 6, rng);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t / spec.dur;
    // vowel interpolation
    let k = 0;
    while (k < spec.path.length - 1 && spec.path[k + 1][0] <= t) k++;
    const [t0, v0] = spec.path[k];
    const [t1, v1] = spec.path[Math.min(k + 1, spec.path.length - 1)];
    const x = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0;
    const s = x * x * (3 - 2 * x);
    if ((i & 15) === 0) {
      for (let j = 0; j < 3; j++) {
        const f = FORMANTS[v0][j] + (FORMANTS[v1][j] - FORMANTS[v0][j]) * s;
        fs[j].set(f, f / (j === 0 ? 70 : 100));
      }
    }
    const f0 = spec.f0[0] + (spec.f0[1] - spec.f0[0]) * u + vib[i] * 2.5;
    const voicedOn = t < spec.breath ? 0 : Math.min(1, (t - spec.breath) / 0.02);
    tilt.tick(osc.saw(f0));
    const voiced = tilt.lp * voicedOn;
    const breath = (rng() * 2 - 1) * (t < spec.breath + 0.03 ? 0.9 : 0.12);
    const buzz = spec.buzz && t < spec.buzz ? (rng() * 2 - 1) * 0.35 : 0;
    const exc = voiced + breath * 0.5 + buzz;
    let y = 0;
    for (let j = 0; j < 3; j++) {
      fs[j].tick(exc);
      y += fs[j].bpn * amps[j];
    }
    const env = Math.min(1, t / 0.008) * (u < 0.7 ? 1 : Math.max(0, 1 - (u - 0.7) / 0.3));
    d[i] = y * env;
  }
  drive(d, 2.8);
  filter(d, sr, 'hp', 140);
  filter(d, sr, 'lp', 5200);
  bakeTail(d, sr, 0.5, 0.35, 0.4);
  fadeIn(d, sr, 0.002);
  fadeOut(d, sr, 0.05);
  return normalize([d], 0.85);
}

const CHOPS: Record<'vox_hey' | 'vox_ha' | 'vox_ho' | 'vox_uh' | 'vox_vai', ChopSpec> = {
  vox_hey: {
    dur: 0.34,
    f0: [176, 138],
    breath: 0.045,
    path: [
      [0, 'e'],
      [0.12, 'e'],
      [0.28, 'i'],
    ],
  },
  vox_ha: {
    dur: 0.32,
    f0: [165, 118],
    breath: 0.05,
    path: [
      [0, 'a'],
      [0.32, 'a'],
    ],
  },
  vox_ho: {
    dur: 0.32,
    f0: [150, 116],
    breath: 0.04,
    path: [
      [0, 'o'],
      [0.2, 'o'],
      [0.32, 'u'],
    ],
  },
  vox_uh: {
    dur: 0.3,
    f0: [128, 98],
    breath: 0.012,
    path: [
      [0, 'uh'],
      [0.3, 'uh'],
    ],
  },
  vox_vai: {
    dur: 0.36,
    f0: [182, 150],
    breath: 0,
    buzz: 0.05,
    path: [
      [0, 'u'],
      [0.06, 'a'],
      [0.2, 'a'],
      [0.34, 'i'],
    ],
  },
};

// ---------------------------------------------------------------- registry

export function renderKit(id: KitId, sr: number, seed: number): Channels {
  const rng = rngFor(seed, 'kit', id);
  switch (id) {
    case 'kick':
      return renderKick(sr, rng, 'punch');
    case 'kickTight':
      return renderKick(sr, rng, 'tight');
    case 'kickDist':
      return renderKick(sr, rng, 'dist');
    case 'kickSoft':
      return renderKick(sr, rng, 'soft');
    case 'heart':
      return renderKick(sr, rng, 'heart');
    case 'snare':
      return renderSnare(sr, rng);
    case 'clap':
      return renderClap(sr, rng);
    case 'rim':
      return renderRim(sr, rng);
    case 'hat0':
      return renderHat(sr, rng, false, 0);
    case 'hat1':
      return renderHat(sr, rng, false, 1);
    case 'hat2':
      return renderHat(sr, rng, false, 2);
    case 'ohat':
      return renderHat(sr, rng, true, 1);
    case 'perc0':
      return renderPerc(sr, rng, 0);
    case 'perc1':
      return renderPerc(sr, rng, 1);
    case 'perc2':
      return renderPerc(sr, rng, 2);
    case 'crash':
      return renderCrash(sr, seed);
    case 'revCrash':
      return renderRevCrash(sr, seed);
    case 'impact':
      return renderImpact(sr, seed);
    case 'subDrop':
      return renderSubDrop(sr);
    case 'downlifter':
      return renderDownlifter(sr, seed);
    case 'swell':
      return renderSwell(sr, seed);
    case 'cowDirtyLo':
      return renderCowbell(sr, COWBELL_REF.lo, 'dirty');
    case 'cowDirtyHi':
      return renderCowbell(sr, COWBELL_REF.hi, 'dirty');
    case 'cowCleanLo':
      return renderCowbell(sr, COWBELL_REF.lo, 'clean');
    case 'cowCleanHi':
      return renderCowbell(sr, COWBELL_REF.hi, 'clean');
    case 'cowUniLo':
      return renderCowbell(sr, COWBELL_REF.lo, 'unison');
    case 'cowUniHi':
      return renderCowbell(sr, COWBELL_REF.hi, 'unison');
    case 'vinyl':
      return renderVinyl(sr, seed);
    case 'wind':
      return renderWind(sr, seed);
    case 'rain':
      return renderRain(sr, seed);
    case 'trainBed':
      return renderTrainBed(sr, seed);
    case 'vox_hey':
    case 'vox_ha':
    case 'vox_ho':
    case 'vox_uh':
    case 'vox_vai':
      return renderChop(sr, seed, CHOPS[id]);
  }
}

/** Fallback chop for a chant id when no TTS buffer was supplied. */
export function fallbackChop(chantId: string): KitId {
  switch (chantId) {
    case 'ch_hey':
      return 'vox_hey';
    case 'ch_vai':
      return 'vox_vai';
    case 'ch_ha':
    case 'ch_rvi':
      return 'vox_ha';
    case 'ch_go':
    case 'ch_toma':
      return 'vox_ho';
    default:
      return 'vox_uh';
  }
}
