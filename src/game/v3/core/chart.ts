import type { VoiceCue } from '@/voice/lines';
import { pickWeighted, subRng } from './random';
import {
  DIRS,
  OPPOSITE,
  type ActId,
  type AnomalyKind,
  type BossMove,
  type CameoId,
  type Dir,
  type EnemyKind,
  type HintKind,
  type ModeId,
  type SectionId,
  type SegmentId,
  type Side,
} from './types';

/**
 * The battle chart: everything that will happen in a run, in beats, derived from (seed, mode, ease).
 * Like a rhythm-game chart, but every note is a body — an enemy arriving on a beat from a side,
 * from above or below, a boss swing, an execution cut.
 */

// ------------------------------------------------------------------ tuning

export interface Tuning {
  bpm: number;
  /** ±ms around the impact that count as PERFECT. */
  perfectMs: number;
  /** How early / late a correct slash still counts (GOOD). */
  earlyMs: number;
  lateMs: number;
  /** Multiplier on note density. */
  density: number;
  /** Half-beat spacing allowed in drops. */
  eighths: boolean;
  /** Beats the boss winds up before a swing lands. */
  bossTelegraph: number;
  /** Cuts in the execution sequence. */
  execCuts: number;
  /** Extra approach time (beats) for every enemy. */
  approachBonus: number;
  bars: Partial<Record<SegmentId, number>>;
}

const BASE_TUNING: Record<ModeId, Tuning> = {
  spark: { bpm: 128, perfectMs: 65, earlyMs: 140, lateMs: 125, density: 1, eighths: true, bossTelegraph: 1, execCuts: 4, approachBonus: 0, bars: {} },
  flow: { bpm: 120, perfectMs: 65, earlyMs: 140, lateMs: 125, density: 0.9, eighths: true, bossTelegraph: 1, execCuts: 5, approachBonus: 0, bars: { roofA: 12, trainA: 12, duel: 12 } },
  calm: { bpm: 100, perfectMs: 85, earlyMs: 180, lateMs: 160, density: 0.7, eighths: false, bossTelegraph: 2, execCuts: 3, approachBonus: 0.5, bars: {} },
};

export const EASE_MIN = 0.85;
export const EASE_MAX = 1.25;

/** `ease` > 1: slower tempo, wider windows, fewer notes. One adaptation step is 0.05. */
export function buildTuning(mode: ModeId, ease = 1): Tuning {
  const e = Math.max(EASE_MIN, Math.min(EASE_MAX, ease));
  const b = BASE_TUNING[mode];
  return {
    ...b,
    bpm: Math.round(b.bpm / Math.sqrt(e)),
    perfectMs: Math.round(b.perfectMs * e),
    earlyMs: Math.round(b.earlyMs * e),
    lateMs: Math.round(b.lateMs * e),
    density: b.density / e,
    bars: { ...b.bars },
  };
}

// ------------------------------------------------------------------ mission script

export type SegmentRole = 'intro' | 'waves' | 'fall' | 'cameo' | 'bossIntro' | 'duel' | 'rage' | 'exec' | 'finale';

interface SegmentSpec {
  id: SegmentId;
  act: ActId;
  section: SectionId;
  bars: number;
  role: SegmentRole;
  teach?: EnemyKind[];
  weights?: Partial<Record<EnemyKind, number>>;
  /** Notes per bar outside teaching blocks (before the mode multiplier). */
  density?: number;
  eighths?: boolean;
  restBeats?: number;
}

const SPECS: SegmentSpec[] = [
  { id: 'intro', act: 'roof', section: 'intro', bars: 2, role: 'intro' },
  { id: 'roofA', act: 'roof', section: 'roof', bars: 8, role: 'waves', teach: ['grunt', 'brute'], weights: { grunt: 3, brute: 1 }, density: 2.2 },
  { id: 'roofB', act: 'roof', section: 'roofBuild', bars: 4, role: 'waves', teach: ['leaper'], weights: { grunt: 2.5, leaper: 1.5, brute: 1 }, density: 2.8 },
  { id: 'roofDrop', act: 'roof', section: 'roofDrop', bars: 8, role: 'waves', weights: { grunt: 3, brute: 1.2, leaper: 1.5 }, density: 3.8, eighths: true, restBeats: 4 },
  { id: 'fall', act: 'fall', section: 'fall', bars: 4, role: 'fall', teach: ['crawler'], weights: { leaper: 2, crawler: 2, grunt: 1 }, density: 2.6, restBeats: 2 },
  { id: 'trainA', act: 'train', section: 'train', bars: 8, role: 'waves', teach: ['dodger', 'gunner'], weights: { grunt: 2, dodger: 1.5, gunner: 0.8, crawler: 1, leaper: 1 }, density: 2.8 },
  { id: 'trainDrop', act: 'train', section: 'trainDrop', bars: 8, role: 'waves', teach: ['feinter'], weights: { grunt: 2, brute: 1, dodger: 1.2, feinter: 1.3, leaper: 1, crawler: 1, gunner: 0.6 }, density: 3.8, eighths: true, restBeats: 2 },
  { id: 'cameo', act: 'train', section: 'cameo', bars: 4, role: 'cameo', weights: { grunt: 2, leaper: 1, crawler: 1 }, density: 2.2, restBeats: 2 },
  { id: 'bossIntro', act: 'temple', section: 'bossIntro', bars: 4, role: 'bossIntro' },
  { id: 'duel', act: 'temple', section: 'boss', bars: 8, role: 'duel' },
  { id: 'rage', act: 'temple', section: 'bossRage', bars: 8, role: 'rage' },
  { id: 'exec', act: 'temple', section: 'execution', bars: 4, role: 'exec' },
  { id: 'finale', act: 'temple', section: 'finale', bars: 2, role: 'finale' },
];

/** Beats from appearing on screen to striking range. */
export const APPROACH: Record<EnemyKind, number> = { grunt: 3, brute: 3.5, dodger: 1.5, feinter: 3, leaper: 1.5, crawler: 2.5, gunner: 3, butcher: 4 };

/** Execution timeline inside the `exec` segment (beats from its start). */
export const EXEC_SHOW_AT = 0;
export const EXEC_PERFORM_AT = 8;

// ------------------------------------------------------------------ chart types

export interface PlannedNote {
  beat: number;
  dir: Dir;
  feint: boolean;
}

export interface PlannedEnemy {
  id: number;
  kind: EnemyKind;
  side: Side;
  spawnBeat: number;
  notes: PlannedNote[];
  variant: number;
  assist: CameoId | null;
  act: ActId;
  segment: SegmentId;
  teach: boolean;
}

export interface PlannedSegment {
  id: SegmentId;
  act: ActId;
  section: SectionId;
  role: SegmentRole;
  startBeat: number;
  bars: number;
}

export interface PlannedString {
  phase: 'duel' | 'rage';
  index: number;
  moves: { beat: number; move: BossMove }[];
  /** Index of the string this one repeats (pattern memory), or null for a first showing. */
  repeatOf: number | null;
}

export interface PlannedCameo {
  id: CameoId;
  role: 'assist' | 'miniboss';
  side: Side;
  enterBeat: number;
  exitBeat: number;
}

export interface PlannedAnomaly {
  kind: AnomalyKind;
  beat: number;
  beats: number;
}

export interface PlannedHint {
  kind: HintKind;
  /** Beat of the note the hint is about. */
  beat: number;
}

export interface PlannedVoice {
  cue: VoiceCue;
  beat: number;
  priority?: number;
}

export interface Chart {
  mode: ModeId;
  seed: number;
  tuning: Tuning;
  beatMs: number;
  segments: PlannedSegment[];
  /** All non-boss enemies (waves, fall, mini-boss), sorted by first note. */
  enemies: PlannedEnemy[];
  /** Enemies the boss summons during the rage phase (cancelled if he breaks early). */
  summons: PlannedEnemy[];
  strings: PlannedString[];
  exec: Dir[];
  cameos: PlannedCameo[];
  anomalies: PlannedAnomaly[];
  hints: PlannedHint[];
  voice: PlannedVoice[];
}

export const BOSS_SIDE: Side = 'right';

/** The slash that answers a boss move: high → up, low → down, thrust (or its feint) → toward him. */
export function bossMoveDir(move: BossMove): Dir {
  if (move === 'high') return 'up';
  if (move === 'low') return 'down';
  return BOSS_SIDE;
}

// ------------------------------------------------------------------ builder

/** One-bar rhythm motifs (beat offsets). */
const MOTIFS_Q: number[][] = [[0, 2], [0, 1, 2, 3], [0, 2, 3], [0, 1, 3], [1, 3], [0, 3], [0, 1, 2], [0, 2, 3]];
const MOTIFS_8: number[][] = [[0, 1.5, 3], [0, 0.5, 2, 3], [0, 1, 2, 2.5], [0, 1.5, 2, 3], [0, 0.5, 1, 2, 3], [0, 1, 1.5, 3], [0, 2, 2.5, 3.5], [0, 1, 2, 3, 3.5]];

const EPS = 1e-6;

class Builder {
  readonly enemies: PlannedEnemy[] = [];
  readonly summons: PlannedEnemy[] = [];
  readonly hints: PlannedHint[] = [];
  readonly voice: PlannedVoice[] = [];
  readonly anomalies: PlannedAnomaly[] = [];
  readonly cameos: PlannedCameo[] = [];
  readonly taught = new Set<EnemyKind>();
  private noteBeats: number[] = [];
  private nextId = 1;
  private lastSides: Side[] = [];
  private gunnerUntil = -Infinity;

  constructor(
    readonly seed: number,
    readonly mode: ModeId,
    readonly tuning: Tuning,
    readonly segments: PlannedSegment[],
  ) {}

  rng(...salt: number[]): () => number {
    return subRng(this.seed, ...salt);
  }

  seg(id: SegmentId): PlannedSegment {
    return this.segments.find((s) => s.id === id)!;
  }

  private minGap(eighths: boolean): number {
    return eighths && this.tuning.eighths ? 0.5 : 1;
  }

  private isFree(beat: number, gap: number): boolean {
    return this.noteBeats.every((b) => Math.abs(b - beat) >= gap - EPS);
  }

  claim(beats: number[]): void {
    this.noteBeats.push(...beats);
  }

  pickSide(rng: () => number, prefer?: Side): Side {
    if (prefer) return prefer;
    const last = this.lastSides[this.lastSides.length - 1];
    const streak = this.lastSides.slice(-3).every((s) => s === last) && this.lastSides.length >= 3;
    let side: Side = !last ? (rng() < 0.5 ? 'left' : 'right') : rng() < 0.62 || streak ? (last === 'left' ? 'right' : 'left') : last;
    if (streak) side = last === 'left' ? 'right' : 'left';
    this.lastSides.push(side);
    return side;
  }

  addEnemy(e: Omit<PlannedEnemy, 'id'>, list: PlannedEnemy[] = this.enemies): PlannedEnemy {
    const enemy = { ...e, id: this.nextId++ };
    list.push(enemy);
    this.claim(enemy.notes.map((n) => n.beat));
    if (enemy.kind === 'gunner') this.gunnerUntil = enemy.notes[0].beat + 4;
    return enemy;
  }

  approach(kind: EnemyKind, teach = false): number {
    return APPROACH[kind] + this.tuning.approachBonus + (teach ? 1 : 0);
  }

  /** Notes an enemy of `kind` would occupy if its first note lands on `beat`. */
  pattern(kind: EnemyKind, beat: number, side: Side, rng: () => number, eighths: boolean): PlannedNote[] {
    const s: Dir = side;
    switch (kind) {
      case 'brute':
        return [
          { beat, dir: s, feint: false },
          { beat: beat + 1, dir: s, feint: false },
        ];
      case 'dodger': {
        const gap = eighths && this.tuning.eighths && rng() < 0.4 ? 1.5 : rng() < 0.5 ? 1 : 2;
        return [
          { beat, dir: s, feint: false },
          { beat: beat + gap, dir: OPPOSITE[s], feint: false },
        ];
      }
      case 'feinter':
        return [
          { beat, dir: s, feint: true },
          { beat: beat + 1, dir: s, feint: false },
        ];
      case 'leaper':
        return [{ beat, dir: 'up', feint: false }];
      case 'crawler':
        return [{ beat, dir: 'down', feint: false }];
      case 'butcher':
        return [
          { beat, dir: s, feint: false },
          { beat: beat + 1, dir: s, feint: false },
          { beat: beat + 2, dir: s, feint: true },
          { beat: beat + 3, dir: s, feint: false },
        ];
      default:
        return [{ beat, dir: s, feint: false }];
    }
  }

  /** Rhythm for [from, to): bar motifs chosen to approach `perBar` notes per bar. */
  rhythm(rng: () => number, from: number, to: number, perBar: number, eighths: boolean): number[] {
    const out: number[] = [];
    const pool = eighths && this.tuning.eighths ? [...MOTIFS_Q, ...MOTIFS_8, ...MOTIFS_8] : MOTIFS_Q;
    const barStart = Math.floor(from / 4) * 4;
    for (let bar = barStart; bar < to; bar += 4) {
      // pick the motif whose size is closest to the target, with some randomness
      const target = perBar + (rng() - 0.5) * 1.2;
      const ranked = [...pool].sort((a, b) => Math.abs(a.length - target) - Math.abs(b.length - target) + (rng() - 0.5) * 1.5);
      const motif = ranked[0];
      for (const off of motif) {
        const b = bar + off;
        if (b >= from - EPS && b < to - EPS) out.push(b);
      }
    }
    return out;
  }

  /**
   * Fills [from, to) with enemies. `spawnFloor`: nobody may appear before it (clean windows for
   * set pieces like the mirror). `assistSide`: enemies on that side are handled by a cameo.
   */
  fill(
    segment: PlannedSegment,
    salt: number,
    from: number,
    to: number,
    opts: { weights: Partial<Record<EnemyKind, number>>; perBar: number; eighths: boolean; spawnFloor?: number; assist?: { id: CameoId; side: Side; from: number; to: number }; preferSide?: Side; list?: PlannedEnemy[] },
  ): void {
    const rng = this.rng(salt, Math.round(from * 2));
    const gap = this.minGap(opts.eighths);
    const times = this.rhythm(rng, from, to, opts.perBar * this.tuning.density, opts.eighths);
    const allowed = Object.fromEntries(Object.entries(opts.weights).filter(([k]) => this.taught.has(k as EnemyKind))) as Partial<Record<EnemyKind, number>>;
    if (!Object.keys(allowed).length) return;
    const used = new Set<number>();
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (used.has(t)) continue;
      // try a few kinds until one fits
      for (let attempt = 0; attempt < 4; attempt++) {
        let kind: EnemyKind = pickWeighted(rng, allowed);
        if (kind === 'gunner' && t < this.gunnerUntil) kind = 'grunt';
        if (!allowed[kind] && kind !== 'grunt') continue;
        const inAssist = opts.assist && t >= opts.assist.from && t < opts.assist.to;
        const side = this.pickSide(rng, opts.preferSide);
        // while a cameo holds a flank, everything that comes from it is his
        if (inAssist && opts.assist && side === opts.assist.side && kind !== 'leaper' && kind !== 'crawler') kind = 'grunt';
        const notes = this.pattern(kind, t, side, rng, opts.eighths);
        const last = notes[notes.length - 1].beat;
        if (last >= to - EPS) continue;
        const spawnBeat = t - this.approach(kind);
        if (opts.spawnFloor !== undefined && spawnBeat < opts.spawnFloor - EPS) continue;
        if (!notes.every((n) => this.isFree(n.beat, gap))) continue;
        // multi-note kinds should use rhythm slots when they exist, but may add their own
        notes.forEach((n) => used.add(n.beat));
        const assist = inAssist && opts.assist && side === opts.assist.side && (kind === 'grunt' || kind === 'brute') ? opts.assist.id : null;
        this.addEnemy(
          { kind, side, spawnBeat, notes, variant: Math.floor(rng() * 4), assist, act: segment.act, segment: segment.id, teach: false },
          opts.list,
        );
        break;
      }
    }
  }

  /** Extra targets for a cameo on its flank, on off-beats the player isn't using. */
  assistTargets(segment: PlannedSegment, cameo: PlannedCameo, salt: number): void {
    const rng = this.rng(salt, 3);
    let placed = 0;
    for (let b = cameo.enterBeat + 1.5; b < cameo.exitBeat - 0.5 && placed < 6; b += 1) {
      if (!this.isFree(b, 0.5) || rng() < 0.25) continue;
      const notes: PlannedNote[] = [{ beat: b, dir: cameo.side, feint: false }];
      // assist notes don't occupy the player's rhythm, so they are not claimed
      this.enemies.push({ id: this.nextId++, kind: 'grunt', side: cameo.side, spawnBeat: b - this.approach('grunt'), notes, variant: Math.floor(rng() * 4), assist: cameo.id, act: segment.act, segment: segment.id, teach: false });
      placed++;
    }
  }

  /** A two-bar block that introduces one enemy type, with a voice hint and a ghost-swipe hint. */
  teachBlock(segment: PlannedSegment, kind: EnemyKind, start: number): void {
    const rng = this.rng(77, Math.round(start));
    const first = start + 4;
    const side: Side = rng() < 0.5 ? 'left' : 'right';
    const add = (beat: number, s: Side, teach: boolean) => {
      const notes = this.pattern(kind, beat, s, rng, false);
      this.addEnemy({ kind, side: s, spawnBeat: beat - this.approach(kind, teach), notes, variant: Math.floor(rng() * 4), assist: null, act: segment.act, segment: segment.id, teach });
    };
    add(first, side, true);
    const other: Side = side === 'left' ? 'right' : 'left';
    switch (kind) {
      case 'grunt':
        add(first + 2, other, false);
        add(first + 3, side, false);
        break;
      case 'leaper':
      case 'crawler':
        add(first + 2, other, false);
        break;
      case 'feinter':
        add(first + 2, other, false);
        break;
      default:
        break;
    }
    this.taught.add(kind);
    this.hints.push({ kind, beat: first });
    const cue: VoiceCue = kind === 'grunt' ? 'echo.swipe' : (`echo.${kind === 'feinter' ? 'feint' : kind}` as VoiceCue);
    this.voice.push({ cue, beat: first - this.approach(kind, true) - 0.5, priority: 2 });
  }

  waves(segment: PlannedSegment, spec: SegmentSpec, salt: number): void {
    const end = segment.startBeat + segment.bars * 4 - (spec.restBeats ?? 0);
    let cursor = segment.startBeat;
    const teach = spec.teach ?? [];
    const weights = spec.weights ?? { grunt: 1 };
    const perBar = spec.density ?? 2;
    const eighths = !!spec.eighths;

    // mirror window (train act): last two bars of trainA
    const mirror = segment.id === 'trainA' ? { from: segment.startBeat + (segment.bars - 2) * 4, to: segment.startBeat + segment.bars * 4 } : null;
    if (mirror) this.anomalies.push({ kind: 'mirror', beat: mirror.from, beats: 8 });

    teach.forEach((kind, i) => {
      if (i > 0) {
        this.fill(segment, salt * 10 + i, cursor, cursor + 8, { weights, perBar, eighths: false });
        cursor += 8;
      }
      this.teachBlock(segment, kind, cursor);
      cursor += 8;
    });

    const assistCameo = this.cameos.find((c) => c.role === 'assist' && c.enterBeat < end && c.exitBeat > segment.startBeat);
    const assist = assistCameo ? { id: assistCameo.id, side: assistCameo.side, from: assistCameo.enterBeat, to: assistCameo.exitBeat } : undefined;

    if (mirror) {
      // nobody may straddle the flip: enemies before it resolve before it, enemies inside spawn inside
      if (cursor < mirror.from) this.fill(segment, salt * 10 + 7, cursor, mirror.from - 0.5, { weights, perBar, eighths, assist });
      this.fill(segment, salt * 10 + 8, Math.max(cursor, mirror.from), Math.min(end, mirror.to - 1), { weights, perBar: perBar * 0.85, eighths, spawnFloor: mirror.from + 0.5 });
    } else {
      this.fill(segment, salt * 10 + 9, cursor, end, { weights, perBar, eighths, assist });
    }
  }
}

export function buildChart(seed: number, mode: ModeId, ease = 1): Chart {
  const tuning = buildTuning(mode, ease);
  const beatMs = 60000 / tuning.bpm;
  const segments: PlannedSegment[] = [];
  let beat = 0;
  for (const spec of SPECS) {
    const bars = tuning.bars[spec.id] ?? spec.bars;
    segments.push({ id: spec.id, act: spec.act, section: spec.section, role: spec.role, startBeat: beat, bars });
    beat += bars * 4;
  }
  const b = new Builder(seed, mode, tuning, segments);
  const spec = (id: SegmentId) => SPECS.find((s) => s.id === id)!;
  const rng = b.rng(1);

  // cameos: one assist on the roof, the butcher on the train
  const assistId = (['cleaner', 'fox', 'ronin'] as CameoId[])[Math.floor(rng() * 3)];
  const roofB = b.seg('roofB');
  const roofDrop = b.seg('roofDrop');
  const assistSide: Side = rng() < 0.5 ? 'left' : 'right';
  b.cameos.push({ id: assistId, role: 'assist', side: assistSide, enterBeat: roofB.startBeat + 8, exitBeat: roofDrop.startBeat + 8 });
  b.voice.push({ cue: `${assistId}.in` as VoiceCue, beat: roofB.startBeat + 7.5, priority: 3 });
  b.voice.push({ cue: `${assistId}.out` as VoiceCue, beat: roofDrop.startBeat + 8, priority: 3 });

  // intro
  b.voice.push({ cue: 'narr.episode', beat: 0.5, priority: 3 });

  // waves
  b.waves(b.seg('roofA'), spec('roofA'), 11);
  b.voice.push({ cue: 'echo.beat', beat: b.seg('roofA').startBeat + 9, priority: 2 });
  b.anomalies.push({ kind: 'lightning', beat: b.seg('roofA').startBeat + 12, beats: 1 });
  b.waves(roofB, spec('roofB'), 12);
  b.waves(roofDrop, spec('roofDrop'), 13);
  b.assistTargets(roofB, b.cameos[0], 17);
  b.anomalies.push({ kind: 'invert', beat: roofDrop.startBeat, beats: 2 });
  if (rng() < 0.6) b.anomalies.push({ kind: 'glitch', beat: roofDrop.startBeat + 20, beats: 1 });

  // the roof collapses: free-fall fight
  const fall = b.seg('fall');
  b.voice.push({ cue: 'narr.fall', beat: fall.startBeat, priority: 3 });
  b.anomalies.push({ kind: 'timeStop', beat: fall.startBeat, beats: 1 });
  b.waves(fall, spec('fall'), 14);

  // train
  const trainA = b.seg('trainA');
  b.voice.push({ cue: 'narr.train', beat: trainA.startBeat, priority: 3 });
  if (rng() < 0.65) b.anomalies.push({ kind: 'blackout', beat: trainA.startBeat + 8, beats: 4 });
  b.waves(trainA, spec('trainA'), 15);
  const trainDrop = b.seg('trainDrop');
  b.waves(trainDrop, spec('trainDrop'), 16);
  if (rng() < 0.6) b.anomalies.push({ kind: 'glitch', beat: trainDrop.startBeat + 12, beats: 1 });
  b.anomalies.push({ kind: 'panels', beat: trainDrop.startBeat + 16, beats: 4 });

  // the butcher
  const cameo = b.seg('cameo');
  const butcherSide: Side = rng() < 0.5 ? 'left' : 'right';
  b.cameos.push({ id: 'butcher', role: 'miniboss', side: butcherSide, enterBeat: cameo.startBeat, exitBeat: cameo.startBeat + 8 });
  b.voice.push({ cue: 'narr.cameo', beat: cameo.startBeat - 1.5, priority: 3 });
  b.voice.push({ cue: 'butcher.in', beat: cameo.startBeat + 1, priority: 3 });
  const bRng = b.rng(31);
  const bNotes = b.pattern('butcher', cameo.startBeat + 4, butcherSide, bRng, false);
  b.addEnemy({ kind: 'butcher', side: butcherSide, spawnBeat: cameo.startBeat, notes: bNotes, variant: 0, assist: null, act: 'train', segment: 'cameo', teach: false });
  const other: Side = butcherSide === 'left' ? 'right' : 'left';
  b.fill(cameo, 41, cameo.startBeat + 1, cameo.startBeat + 3.5, { weights: { grunt: 1 }, perBar: 1, eighths: false, preferSide: other });
  b.fill(cameo, 42, cameo.startBeat + 8.5, cameo.startBeat + cameo.bars * 4 - 2, { weights: spec('cameo').weights!, perBar: spec('cameo').density!, eighths: false });

  // temple: boss intro
  const bossIntro = b.seg('bossIntro');
  b.voice.push({ cue: 'narr.boss', beat: bossIntro.startBeat, priority: 3 });
  if (rng() < 0.75) b.anomalies.push({ kind: 'fakeCrash', beat: bossIntro.startBeat + 4, beats: 4 });
  else b.anomalies.push({ kind: 'whisper', beat: bossIntro.startBeat + 4, beats: 4 });
  b.voice.push({ cue: 'boss.intro', beat: bossIntro.startBeat + 8, priority: 3 });
  b.voice.push({ cue: 'boss.laugh', beat: bossIntro.startBeat + 14, priority: 3 });

  // duel and rage strings
  const duel = b.seg('duel');
  const rage = b.seg('rage');
  const strings: PlannedString[] = [];
  const sRng = b.rng(51);
  const pickMoves = (n: number, feints: number): BossMove[] => {
    const pool: BossMove[] = ['high', 'low', 'thrust'];
    let moves: BossMove[] = [];
    for (let tries = 0; tries < 30; tries++) {
      moves = Array.from({ length: n }, () => pool[Math.floor(sRng() * 3)]);
      const distinct = new Set(moves).size;
      const triple = moves.some((m, i) => i >= 2 && m === moves[i - 1] && m === moves[i - 2]);
      if (distinct >= Math.min(3, n - 1) && !triple) break;
    }
    // feints replace thrusts (or the last non-first move)
    for (let f = 0; f < feints; f++) {
      const idx = 1 + Math.floor(sRng() * (n - 1));
      moves[idx] = 'feint';
    }
    return moves;
  };
  const addString = (phase: 'duel' | 'rage', barBeat: number, offsets: number[], moves: BossMove[], repeatOf: number | null) => {
    strings.push({ phase, index: strings.length, moves: offsets.map((o, i) => ({ beat: barBeat + o, move: moves[i] })), repeatOf });
    return strings.length - 1;
  };
  const eighths = tuning.eighths;
  // duel: strings on odd bars, each shown twice
  const duelStrings = Math.floor(duel.bars / 4);
  for (let k = 0; k < duelStrings; k++) {
    const n = k === 0 ? 3 : 4;
    const moves = pickMoves(n, 0);
    const offsets = n === 3 ? [0, 1, 2] : [0, 1, 2, 3];
    const first = addString('duel', duel.startBeat + (k * 4 + 1) * 4, offsets, moves, null);
    addString('duel', duel.startBeat + (k * 4 + 3) * 4, offsets, moves, first);
    // rest bars: the boss repositions with one heavy blow on beat 3
    addString('duel', duel.startBeat + (k * 4 + 2) * 4 + 2, [0], [sRng() < 0.5 ? 'high' : 'low'], null);
    if (k < duelStrings - 1) addString('duel', duel.startBeat + (k * 4 + 4) * 4 + 2, [0], ['thrust'], null);
  }
  b.voice.push({ cue: 'echo.duel', beat: duel.startBeat + 0.5, priority: 2 });
  b.hints.push({ kind: 'duel', beat: duel.startBeat + 4 });
  b.anomalies.push({ kind: 'hudCut', beat: duel.startBeat, beats: 2 });
  if (rng() < 0.7) b.anomalies.push({ kind: 'moonEye', beat: duel.startBeat + 16, beats: 6 });
  // rage: faster strings with feints, and a summoned wave in the middle
  const rOff3 = eighths ? [0, 1, 1.5, 2.5, 3] : [0, 1, 2, 3];
  const r1 = addString('rage', rage.startBeat + 4, rOff3, pickMoves(rOff3.length, 1), null);
  addString('rage', rage.startBeat + 12, rOff3, strings[r1].moves.map((m) => m.move), r1);
  const rOff4 = eighths ? [0, 0.5, 1.5, 2, 3] : [0, 1, 2, 3];
  const r2 = addString('rage', rage.startBeat + 20, rOff4, pickMoves(rOff4.length, 1), null);
  addString('rage', rage.startBeat + 28, rOff4, strings[r2].moves.map((m) => m.move), r2);
  b.claim(strings.flatMap((st) => st.moves.map((m) => m.beat)));
  b.fill(rage, 61, rage.startBeat + 16, rage.startBeat + 19.5, { weights: { grunt: 3, leaper: 1 }, perBar: 3, eighths: false, list: b.summons });
  b.anomalies.push({ kind: 'invert', beat: rage.startBeat, beats: 1 });
  if (rng() < 0.6) b.anomalies.push({ kind: 'whisper', beat: rage.startBeat + 24, beats: 4 });

  // execution sequence
  const eRng = b.rng(71);
  const exec: Dir[] = [];
  for (let tries = 0; tries < 30; tries++) {
    exec.length = 0;
    for (let i = 0; i < tuning.execCuts; i++) {
      let d = DIRS[Math.floor(eRng() * 4)];
      if (i > 0 && d === exec[i - 1]) d = DIRS[(DIRS.indexOf(d) + 1 + Math.floor(eRng() * 3)) % 4];
      exec.push(d);
    }
    if (new Set(exec).size >= Math.min(3, exec.length)) break;
  }
  b.anomalies.push({ kind: 'bloodRain', beat: b.seg('finale').startBeat, beats: 8 });

  b.enemies.sort((x, y) => x.notes[0].beat - y.notes[0].beat);
  b.anomalies.sort((x, y) => x.beat - y.beat);
  b.voice.sort((x, y) => x.beat - y.beat);
  return {
    mode,
    seed,
    tuning,
    beatMs,
    segments,
    enemies: b.enemies,
    summons: b.summons,
    strings,
    exec,
    cameos: b.cameos,
    anomalies: b.anomalies,
    hints: b.hints,
    voice: b.voice,
  };
}

export function segmentAt(chart: Chart, beat: number): PlannedSegment {
  let cur = chart.segments[0];
  for (const s of chart.segments) if (s.startBeat <= beat + EPS) cur = s;
  return cur;
}
