import { describe, expect, it } from 'vitest';
import {
  DirectorClock,
  Timeline,
  barIndexAt,
  barMs,
  beatMs,
  clampBpm,
  nextBarAt,
  stepMs,
  swingOffsetSteps,
} from '@/audio/v3/timing';

describe('v3 bar/step maths', () => {
  it('derives step, beat and bar lengths from bpm', () => {
    expect(beatMs(120)).toBe(500);
    expect(stepMs(120)).toBe(125);
    expect(barMs(120)).toBe(2000);
    expect(barMs(130)).toBeCloseTo(1846.15, 1);
  });

  it('finds the bar index and the next bar line on a grid anchored at the section start', () => {
    const at = 1000;
    expect(barIndexAt(at, 120, 1000)).toBe(0);
    expect(barIndexAt(at, 120, 2999)).toBe(0);
    expect(barIndexAt(at, 120, 3000)).toBe(1);
    expect(nextBarAt(at, 120, 1000)).toBe(1000);
    expect(nextBarAt(at, 120, 1001)).toBe(3000);
    expect(nextBarAt(at, 120, 4999.9999999)).toBe(5000);
  });

  it('swings only odd integer 16ths', () => {
    expect(swingOffsetSteps(0, 0.1)).toBe(0);
    expect(swingOffsetSteps(1, 0.1)).toBe(0.1);
    expect(swingOffsetSteps(3, 0.1)).toBe(0.1);
    expect(swingOffsetSteps(12.5, 0.1)).toBe(0);
    expect(swingOffsetSteps(5, 0)).toBe(0);
  });

  it('clamps silly tempos', () => {
    expect(clampBpm(NaN)).toBe(120);
    expect(clampBpm(20)).toBe(60);
    expect(clampBpm(500)).toBe(200);
    expect(clampBpm(128)).toBe(128);
  });
});

describe('v3 director → AudioContext clock', () => {
  it('sets the offset on the first update and maps both ways', () => {
    const c = new DirectorClock();
    expect(c.ready).toBe(false);
    c.update(10, 2000); // ctx 10 s while director is at 2 s
    expect(c.offset).toBeCloseTo(8);
    expect(c.toCtx(2500)).toBeCloseTo(10.5);
    expect(c.toDir(10.5)).toBeCloseTo(2500);
  });

  it('smooths frame jitter instead of jumping', () => {
    const c = new DirectorClock(0.05, 0.08);
    c.update(10, 2000);
    c.update(10.02, 2000); // 20 ms of jitter
    expect(c.offset).toBeCloseTo(8 + 0.02 * 0.05, 6);
  });

  it('hard-resyncs when the drift exceeds 80 ms (pause, hitch, restart)', () => {
    const c = new DirectorClock(0.05, 0.08);
    c.update(10, 2000);
    c.update(12, 2000); // director paused for 2 s
    expect(c.offset).toBeCloseTo(10);
  });

  it('converges on a steady offset over many frames', () => {
    const c = new DirectorClock();
    c.update(5, 0);
    for (let i = 1; i <= 300; i++) c.update(5.03 + i / 60, (i / 60) * 1000);
    expect(c.offset).toBeCloseTo(5.03, 3);
  });
});

describe('v3 section timeline', () => {
  it('keeps the current section until a future section starts', () => {
    const tl = new Timeline();
    tl.set('roof', 130, 0);
    tl.set('roofDrop', 130, 3692.3);
    expect(tl.active(1000)?.id).toBe('roof');
    expect(tl.active(3692.3)?.id).toBe('roofDrop');
    expect(tl.active(-5)).toBeNull();
  });

  it('lets a later announcement supersede everything from its start on', () => {
    const tl = new Timeline();
    tl.set('roof', 130, 0);
    tl.set('roofBuild', 130, 4000);
    tl.set('roofDrop', 130, 8000);
    tl.set('cameo', 130, 4000); // director changed its mind
    expect(tl.all.map((e) => e.id)).toEqual(['roof', 'cameo']);
  });

  it('records the optional bars hint and links prev/next', () => {
    const tl = new Timeline();
    const a = tl.set('intro', 128, 0, 4);
    const b = tl.set('roof', 128, barMs(128) * 4);
    expect(a.bars).toBe(4);
    expect(b.bars).toBeUndefined();
    expect(tl.next(a)).toBe(b);
    expect(tl.prev(b)).toBe(a);
    expect(tl.prev(a)).toBeNull();
  });

  it('slices a window into per-bar pieces and stops at section boundaries', () => {
    const tl = new Timeline();
    const bar = barMs(120); // 2000 ms
    tl.set('train', 120, 0);
    tl.set('trainDrop', 120, 3 * bar);
    const s = tl.slices(1500, 6500);
    expect(s.map((x) => [x.entry.id, x.bar, x.from, x.to])).toEqual([
      ['train', 0, 1500, 2000],
      ['train', 1, 2000, 4000],
      ['train', 2, 4000, 6000],
      ['trainDrop', 0, 6000, 6500],
    ]);
    expect(s[2].next?.id).toBe('trainDrop');
    expect(s[3].prev?.id).toBe('train');
  });

  it('cuts a section short when the next one starts mid-bar', () => {
    const tl = new Timeline();
    tl.set('boss', 120, 0);
    tl.set('bossRage', 120, 2500);
    const s = tl.slices(2000, 3000);
    expect(s.map((x) => [x.entry.id, x.bar, x.barStart, x.from, x.to])).toEqual([
      ['boss', 1, 2000, 2000, 2500],
      ['bossRage', 0, 2500, 2500, 3000],
    ]);
  });

  it('skips forward to the first section when the window starts before it', () => {
    const tl = new Timeline();
    tl.set('menu', 100, 1000);
    const s = tl.slices(0, 1500);
    expect(s).toHaveLength(1);
    expect(s[0].from).toBe(1000);
    expect(tl.slices(0, 900)).toHaveLength(0);
  });

  it('covers a long run with contiguous, non-overlapping windows (exactly-once scheduling)', () => {
    const tl = new Timeline();
    tl.set('roof', 133, 0);
    tl.set('roofBuild', 133, 8 * barMs(133));
    tl.set('roofDrop', 133, 12 * barMs(133));
    let cursor = 0;
    let covered = 0;
    for (let now = 0; now < 30000; now += 16.7) {
      const until = now + 120;
      for (const sl of tl.slices(cursor, until)) {
        expect(sl.from).toBeGreaterThanOrEqual(cursor - 1e-6);
        covered += sl.to - sl.from;
      }
      cursor = until;
    }
    expect(covered).toBeCloseTo(cursor, 0);
  });

  it('prunes old sections but keeps one predecessor', () => {
    const tl = new Timeline();
    tl.set('intro', 120, 0);
    tl.set('roof', 120, 2000);
    tl.set('roofBuild', 120, 4000);
    tl.set('roofDrop', 120, 6000);
    tl.prune(7000);
    expect(tl.all.map((e) => e.id)).toEqual(['roofBuild', 'roofDrop']);
  });
});
