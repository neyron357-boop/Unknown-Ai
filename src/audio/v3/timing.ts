/**
 * Conductor maths: bar/step grid, director→AudioContext time mapping and the
 * section timeline. Pure (no Web Audio) — covered by unit tests.
 *
 * The game's director owns the clock (milliseconds). Sections are announced
 * with `setSection(id, bpm, at)`; `at` may be in the past (switch now, keep the
 * bar grid anchored at `at`) or in the future (keep playing the current
 * section until `at`, which lets the engine prepare pre-drop gaps/reverse
 * cymbals that end exactly on the downbeat).
 */
import type { SectionId } from './types';

export const STEPS_PER_BAR = 16;

export function stepMs(bpm: number): number {
  return 60000 / bpm / 4;
}

export function beatMs(bpm: number): number {
  return 60000 / bpm;
}

export function barMs(bpm: number): number {
  return 240000 / bpm;
}

const EPS = 1e-6;

/** Index of the bar (relative to a section start) that contains director time `t`. */
export function barIndexAt(sectionAt: number, bpm: number, t: number): number {
  return Math.floor((t - sectionAt) / barMs(bpm) + EPS);
}

/** First bar line at or after `t` on the grid anchored at `sectionAt`. */
export function nextBarAt(sectionAt: number, bpm: number, t: number): number {
  const b = barMs(bpm);
  const k = Math.ceil((t - sectionAt) / b - EPS);
  return sectionAt + k * b;
}

/** Swing: odd 16ths are delayed by `amount` of a step (0 = straight). */
export function swingOffsetSteps(step: number, amount: number): number {
  if (!amount) return 0;
  const frac = step - Math.floor(step);
  if (frac > EPS) return 0; // only integer grid positions swing
  return Math.floor(step) % 2 === 1 ? amount : 0;
}

/**
 * Maps the director clock to AudioContext time. The offset (ctx s − director s)
 * is smoothed to absorb frame jitter and hard-resynced when the drift exceeds
 * `resyncSec` (pauses, hitches, director restarts).
 */
export class DirectorClock {
  offset: number | null = null;

  constructor(
    public smoothing = 0.05,
    public resyncSec = 0.08,
  ) {}

  update(ctxNowSec: number, dirNowMs: number): number {
    const measured = ctxNowSec - dirNowMs / 1000;
    if (this.offset === null || Math.abs(measured - this.offset) > this.resyncSec) this.offset = measured;
    else this.offset += (measured - this.offset) * this.smoothing;
    return this.offset;
  }

  /** Fixed mapping (free-running clock / offline render). */
  set(offsetSec: number): void {
    this.offset = offsetSec;
  }

  reset(): void {
    this.offset = null;
  }

  get ready(): boolean {
    return this.offset !== null;
  }

  toCtx(dirMs: number): number {
    return (this.offset ?? 0) + dirMs / 1000;
  }

  toDir(ctxSec: number): number {
    return (ctxSec - (this.offset ?? 0)) * 1000;
  }
}

export interface SectionEntry {
  /** Unique, increasing id (cache key for generated bars). */
  seq: number;
  id: SectionId;
  bpm: number;
  /** Director ms of the first downbeat. */
  at: number;
  /** Known length in bars (optional hint). */
  bars?: number;
}

export interface Slice {
  entry: SectionEntry;
  prev: SectionEntry | null;
  next: SectionEntry | null;
  /** Bar index within the section. */
  bar: number;
  /** Director ms of that bar's downbeat. */
  barStart: number;
  /** Window [from, to) of this slice in director ms. */
  from: number;
  to: number;
}

/** Ordered list of announced sections. */
export class Timeline {
  private entries: SectionEntry[] = [];
  private seq = 0;

  get all(): readonly SectionEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }

  /**
   * Announces a section. Entries starting at or after `at` are superseded
   * (the latest announcement defines the future from `at` on).
   */
  set(id: SectionId, bpm: number, at: number, bars?: number): SectionEntry {
    const entry: SectionEntry = { seq: ++this.seq, id, bpm: clampBpm(bpm), at, bars: bars && bars > 0 ? bars : undefined };
    this.entries = this.entries.filter((e) => e.at < at - EPS);
    this.entries.push(entry);
    return entry;
  }

  /** Section playing at director time `t` (null before the first one). */
  active(t: number): SectionEntry | null {
    let found: SectionEntry | null = null;
    for (const e of this.entries) {
      if (e.at <= t + EPS) found = e;
      else break;
    }
    return found;
  }

  next(e: SectionEntry): SectionEntry | null {
    const i = this.entries.indexOf(e);
    return i >= 0 && i + 1 < this.entries.length ? this.entries[i + 1] : null;
  }

  prev(e: SectionEntry): SectionEntry | null {
    const i = this.entries.indexOf(e);
    return i > 0 ? this.entries[i - 1] : null;
  }

  /** Drops entries that ended before `t`, keeping one predecessor of the active section. */
  prune(t: number): void {
    let activeIdx = -1;
    for (let i = 0; i < this.entries.length; i++) if (this.entries[i].at <= t + EPS) activeIdx = i;
    if (activeIdx > 1) this.entries = this.entries.slice(activeIdx - 1);
  }

  /** Splits [from, to) into per-bar slices of the active sections. */
  slices(from: number, to: number): Slice[] {
    const out: Slice[] = [];
    let t = from;
    let guard = 0;
    while (t < to - EPS && guard++ < 256) {
      const e = this.active(t);
      if (!e) {
        const first = this.entries.find((x) => x.at > t + EPS);
        if (!first || first.at >= to) break;
        t = first.at;
        continue;
      }
      const next = this.next(e);
      const end = Math.min(to, next ? next.at : Infinity);
      const b = barMs(e.bpm);
      const bar = Math.max(0, Math.floor((t - e.at) / b + EPS));
      const barStart = e.at + bar * b;
      const sliceEnd = Math.min(end, barStart + b);
      if (sliceEnd <= t + EPS) {
        t = sliceEnd + EPS;
        continue;
      }
      out.push({ entry: e, prev: this.prev(e), next, bar, barStart, from: t, to: sliceEnd });
      t = sliceEnd;
    }
    return out;
  }
}

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.max(60, Math.min(200, bpm));
}
