import { describe, expect, it } from 'vitest';
import { Osc, addPing, filter, ftanh, makeLoopable, peak, rms } from '@/audio/v3/dsp';
import { IR_PLATE, asymCurve, hardCurve, makeIR, softClipCurve, tanhCurve } from '@/audio/v3/fx';
import { ALL_KIT, CORE_KIT, renderKit, type KitId } from '@/audio/v3/kit';
import { SFX_DEFS, renderSfx } from '@/audio/v3/sfxlib';
import { SFX_NAMES } from '@/audio/v3/types';
import { mixSeed, mulberry32 } from '@/audio/v3/rng';

const SR = 48000;
const sine = (f: number, sec = 0.2) => {
  const o = new Osc(SR);
  const d = new Float32Array(Math.floor(SR * sec));
  for (let i = 0; i < d.length; i++) d[i] = o.sine(f);
  return d;
};

describe('v3 DSP primitives', () => {
  it('seeded RNG is deterministic and well spread', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(mixSeed(1, 'a')).not.toBe(mixSeed(1, 'b'));
  });

  it('SVF low-pass keeps lows and removes highs', () => {
    const lo = filter(sine(100), SR, 'lp', 1000);
    const hi = filter(sine(8000), SR, 'lp', 1000);
    expect(rms(lo.subarray(2000))).toBeGreaterThan(0.6);
    expect(rms(hi.subarray(2000))).toBeLessThan(0.02);
    const hp = filter(sine(50), SR, 'hp', 2000);
    expect(rms(hp.subarray(2000))).toBeLessThan(0.01);
  });

  it('fast tanh matches Math.tanh', () => {
    for (let x = -8; x <= 8; x += 0.01) expect(Math.abs(ftanh(x) - Math.tanh(x))).toBeLessThan(1e-4);
  });

  it('recursive ping equals a decaying sine', () => {
    const d = new Float32Array(4800);
    addPing(d, SR, 0, 1000, 1, 0.02);
    for (const i of [100, 500, 1500, 3000]) {
      const t = i / SR;
      expect(d[i]).toBeCloseTo(Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-t / 0.02), 3);
    }
  });

  it('waveshaper curves are bounded and monotonic; the output clipper never exceeds its ceiling', () => {
    for (const c of [tanhCurve(5), hardCurve(9), asymCurve(7), softClipCurve(0.92, 0.72)]) {
      expect(Math.max(...c.map(Math.abs))).toBeLessThanOrEqual(1.0000001);
      for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1] - 1e-6);
    }
    expect(Math.max(...softClipCurve(0.92, 0.72).map(Math.abs))).toBeLessThanOrEqual(0.92);
    const lin = softClipCurve(0.92, 0.72);
    expect(lin[Math.round((lin.length - 1) * 0.75)]).toBeCloseTo(0.5, 2); // linear below the knee
  });

  it('builds stereo, decaying, normalized impulse responses', () => {
    const ir = makeIR(SR, { ...IR_PLATE, seed: 7 });
    expect(ir).toHaveLength(2);
    expect(peak(ir[0])).toBeLessThanOrEqual(0.9001);
    const n = ir[0].length;
    expect(rms(ir[0].subarray(0, n / 4))).toBeGreaterThan(rms(ir[0].subarray((3 * n) / 4)) * 10);
    const i = Math.ceil(SR * IR_PLATE.predelay) + 1000;
    expect(ir[0][i]).not.toBe(ir[1][i]); // decorrelated channels
  });

  it('makes seamless loops', () => {
    const d = makeLoopable(sine(440, 1), SR, 0.1);
    expect(Math.abs(d[0] - d[d.length - 1])).toBeLessThan(0.1);
  });
});

const KITS: KitId[] = [
  'kick',
  'kickTight',
  'kickDist',
  'kickSoft',
  'heart',
  'snare',
  'clap',
  'rim',
  'hat0',
  'hat1',
  'hat2',
  'ohat',
  'perc0',
  'perc1',
  'perc2',
  'crash',
  'revCrash',
  'impact',
  'subDrop',
  'downlifter',
  'swell',
  'cowDirtyLo',
  'cowDirtyHi',
  'cowCleanLo',
  'cowCleanHi',
  'cowUniLo',
  'cowUniHi',
  'vinyl',
  'wind',
  'rain',
  'trainBed',
  'vox_hey',
  'vox_ha',
  'vox_ho',
  'vox_uh',
  'vox_vai',
];

describe('v3 procedural sound bank', () => {
  it('warms every kit entry (no synchronous render spikes mid-mission)', () => {
    expect([...ALL_KIT].sort()).toEqual([...KITS].sort());
    for (const k of CORE_KIT) expect(ALL_KIT).toContain(k);
  });

  it('renders every music one-shot: finite, bounded, audible', () => {
    for (const id of KITS) {
      const chs = renderKit(id, SR, 1);
      for (const c of chs) {
        expect(c.every(Number.isFinite), id).toBe(true);
        expect(peak(c), id).toBeLessThanOrEqual(1);
        expect(rms(c), id).toBeGreaterThan(1e-3);
      }
    }
  });

  it('renders every SFX variant: finite, bounded, audible, deterministic', () => {
    for (const name of SFX_NAMES) {
      for (let v = 0; v < SFX_DEFS[name].variants; v++) {
        const chs = renderSfx(name, SR, 99, v);
        expect(chs.length === 1 || chs.length === 2, name).toBe(true);
        for (const c of chs) {
          expect(c.every(Number.isFinite), name).toBe(true);
          expect(peak(c), name).toBeLessThanOrEqual(1);
          expect(rms(c), name).toBeGreaterThan(1e-3);
          expect(c.length / SR, name).toBeLessThan(4);
        }
      }
      const a = renderSfx(name, SR, 5, 0)[0];
      const b = renderSfx(name, SR, 5, 0)[0];
      expect(a.subarray(0, 512)).toEqual(b.subarray(0, 512));
    }
  });

  it('keeps SFX short and punchy: attack within 60 ms for hits', () => {
    for (const name of ['slashFlesh', 'boneCrack', 'parry', 'heroHit', 'gunshot', 'impact', 'land'] as const) {
      const c = renderSfx(name, SR, 3, 0)[0];
      const p = peak(c);
      const firstLoud = c.findIndex((x) => Math.abs(x) > p * 0.5);
      expect(firstLoud / SR, name).toBeLessThan(0.06);
    }
  });
});
