import type { Dir, EnemyKind, Judgement, ModeId, SegmentId } from './types';

/** One answered (or missed) note. */
export interface NoteRecord {
  kind: EnemyKind | 'boss' | 'exec';
  judgement: Judgement;
  /** Input time − note time (ms); null when not answered. */
  offset: number | null;
  feint: boolean;
  dir: Dir;
  at: number;
  segment: SegmentId;
  /** Part of a repeated boss string (pattern memory). */
  repeat: boolean;
}

export type BestMoment = 'flawlessExec' | 'patternRead' | 'ironWill' | 'perfectStreak' | 'comboKing' | 'bloodlust' | 'butcherSlayer' | 'persistence';

export type Grade = 'S' | 'A' | 'B' | 'C';

export interface BattleResult {
  version: 3;
  mode: ModeId;
  seed: number;
  durationMs: number;
  score: number;
  grade: Grade;
  /** Transparent 0..1 rating behind the grade. */
  rating: number;
  /** Share of notes answered correctly (perfect/good/ignored feint). */
  accuracy: number;
  notes: { total: number; perfect: number; good: number; miss: number; fooled: number; ignored: number };
  /** Mean |offset| and mean signed offset of hits (negative = early). */
  timing: { meanAbsMs: number | null; biasMs: number | null };
  byKind: Record<EnemyKind | 'boss', { n: number; ok: number }>;
  feints: { total: number; ignored: number; fooled: number };
  /** Notes of boss strings shown for the second time. */
  patterns: { repeats: number; repeatOk: number };
  exec: { cuts: number; correct: number };
  maxCombo: number;
  longestPerfect: number;
  kills: number;
  assists: number;
  decaps: number;
  bloodlusts: number;
  hitsTaken: number;
  reboots: number;
  /** Slashes thrown at an enemy that wasn't in range yet. */
  impulsive: number;
  weakestKind: EnemyKind | 'boss' | null;
  best: { kind: BestMoment; value: number };
}

export interface ResultInput {
  mode: ModeId;
  seed: number;
  durationMs: number;
  score: number;
  records: NoteRecord[];
  maxCombo: number;
  kills: number;
  assists: number;
  decaps: number;
  bloodlusts: number;
  hitsTaken: number;
  reboots: number;
  impulsive: number;
  execCuts: number;
  execCorrect: number;
  butcherPerfect: boolean;
}

const VALUE: Record<Judgement, number> = { perfect: 1, good: 0.75, ignored: 1, miss: 0, fooled: 0 };
const KINDS: (EnemyKind | 'boss')[] = ['grunt', 'brute', 'dodger', 'feinter', 'leaper', 'crawler', 'gunner', 'butcher', 'boss'];

export const ok = (j: Judgement) => j === 'perfect' || j === 'good' || j === 'ignored';

export function gradeOf(rating: number): Grade {
  if (rating >= 0.9) return 'S';
  if (rating >= 0.75) return 'A';
  if (rating >= 0.55) return 'B';
  return 'C';
}

export function computeResult(i: ResultInput): BattleResult {
  const recs = i.records.filter((r) => r.kind !== 'exec');
  const count = (j: Judgement) => recs.filter((r) => r.judgement === j).length;
  const total = recs.length;
  const accScore = total ? recs.reduce((s, r) => s + VALUE[r.judgement], 0) / total : 0;
  const accuracy = total ? recs.filter((r) => ok(r.judgement)).length / total : 0;
  const execAcc = i.execCuts ? i.execCorrect / i.execCuts : 0;
  const rating = Math.round((0.8 * accScore + 0.1 * execAcc + 0.1 * (1 - Math.min(1, i.hitsTaken / 20))) * 1000) / 1000;

  const hits = recs.filter((r) => (r.judgement === 'perfect' || r.judgement === 'good') && r.offset !== null);
  const meanAbs = hits.length ? Math.round(hits.reduce((s, r) => s + Math.abs(r.offset!), 0) / hits.length) : null;
  const bias = hits.length ? Math.round(hits.reduce((s, r) => s + r.offset!, 0) / hits.length) : null;

  const byKind = Object.fromEntries(KINDS.map((k) => [k, { n: 0, ok: 0 }])) as BattleResult['byKind'];
  for (const r of recs) {
    if (r.kind === 'exec') continue;
    byKind[r.kind].n++;
    if (ok(r.judgement)) byKind[r.kind].ok++;
  }
  const feintRecs = recs.filter((r) => r.feint);
  const repeats = recs.filter((r) => r.repeat);

  let longest = 0;
  let run = 0;
  for (const r of [...i.records].sort((a, b) => a.at - b.at)) {
    if (r.judgement === 'perfect') longest = Math.max(longest, ++run);
    else if (r.judgement !== 'ignored') run = 0;
  }

  let weakest: EnemyKind | 'boss' | null = null;
  let worst = 0.8;
  for (const k of KINDS) {
    const { n, ok: good } = byKind[k];
    if (n >= 2 && good / n < worst) {
      worst = good / n;
      weakest = k;
    }
  }

  const feints = { total: feintRecs.length, ignored: feintRecs.filter((r) => r.judgement === 'ignored').length, fooled: feintRecs.filter((r) => r.judgement === 'fooled').length };
  const patterns = { repeats: repeats.length, repeatOk: repeats.filter((r) => ok(r.judgement)).length };

  let best: BattleResult['best'] = { kind: 'persistence', value: i.reboots };
  if (i.execCuts > 0 && i.execCorrect === i.execCuts) best = { kind: 'flawlessExec', value: i.execCuts };
  else if (patterns.repeats >= 6 && patterns.repeatOk === patterns.repeats) best = { kind: 'patternRead', value: patterns.repeats };
  else if (feints.total >= 3 && feints.fooled === 0) best = { kind: 'ironWill', value: feints.total };
  else if (longest >= 12) best = { kind: 'perfectStreak', value: longest };
  else if (i.maxCombo >= 30) best = { kind: 'comboKing', value: i.maxCombo };
  else if (i.butcherPerfect) best = { kind: 'butcherSlayer', value: 1 };
  else if (i.bloodlusts >= 2) best = { kind: 'bloodlust', value: i.bloodlusts };

  return {
    version: 3,
    mode: i.mode,
    seed: i.seed,
    durationMs: Math.round(i.durationMs),
    score: Math.round(i.score),
    grade: gradeOf(rating),
    rating,
    accuracy: Math.round(accuracy * 1000) / 1000,
    notes: { total, perfect: count('perfect'), good: count('good'), miss: count('miss'), fooled: count('fooled'), ignored: count('ignored') },
    timing: { meanAbsMs: meanAbs, biasMs: bias },
    byKind,
    feints,
    patterns,
    exec: { cuts: i.execCuts, correct: i.execCorrect },
    maxCombo: i.maxCombo,
    longestPerfect: longest,
    kills: i.kills,
    assists: i.assists,
    decaps: i.decaps,
    bloodlusts: i.bloodlusts,
    hitsTaken: i.hitsTaken,
    reboots: i.reboots,
    impulsive: i.impulsive,
    weakestKind: weakest,
    best,
  };
}
