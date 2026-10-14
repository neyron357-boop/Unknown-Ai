import type { BattleResult, Grade } from '@/game/v3/core/metrics';
import type { EnemyKind, ModeId } from '@/game/v3/core/types';

/**
 * UNKNOWN Cognitive Engine — adaptation rules.
 *
 * Deliberately simple and transparent: every adjustment is explained by a
 * human-readable reason. No medical or emotional inference is made from
 * gameplay statistics.
 */

export interface RunSummary {
  id: string;
  missionId: 'bloodmoon';
  mode: ModeId;
  /** Was the mode chosen by the player (vs. the default)? Used for preference stats. */
  modeChosen: boolean;
  startedAt: number;
  finishedAt: number;
  /** Difficulty factor used for this run (>1 easier). */
  ease: number;
  result: BattleResult;
}

export type AdaptationReason = 'baseline' | 'struggling' | 'mastered' | 'steady';

export interface Adaptation {
  /** >1 slower tempo and wider timing windows, <1 faster/tighter. */
  ease: number;
  reason: AdaptationReason;
  basedOn: number;
}

export const EASE_MIN = 0.85;
export const EASE_MAX = 1.25;
const STEP = 0.05;

/**
 * Rule (per mode, last 3 runs):
 *  - fewer than 2 runs → baseline
 *  - mean rating < 0.55 or ≥ 1 reboot per run → +0.05 (wider windows, slower approach)
 *  - mean rating ≥ 0.88 and no reboots → −0.05 (tighter)
 *  - otherwise keep the last value.
 * One step per run, clamped to [0.85, 1.25], so difficulty never jumps.
 */
export function computeAdaptation(history: RunSummary[], mode: ModeId): Adaptation {
  const runs = history
    .filter((r) => r.mode === mode)
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, 3);
  const last = runs[0]?.ease ?? 1;
  if (runs.length < 2) return { ease: round2(last), reason: 'baseline', basedOn: runs.length };
  const rating = runs.reduce((s, r) => s + r.result.rating, 0) / runs.length;
  const reboots = runs.reduce((s, r) => s + r.result.reboots, 0) / runs.length;
  if (rating < 0.55 || reboots >= 1) return { ease: clamp(last + STEP), reason: 'struggling', basedOn: runs.length };
  if (rating >= 0.88 && reboots === 0) return { ease: clamp(last - STEP), reason: 'mastered', basedOn: runs.length };
  return { ease: round2(last), reason: 'steady', basedOn: runs.length };
}

const clamp = (v: number) => round2(Math.max(EASE_MIN, Math.min(EASE_MAX, v)));
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface ProfileStats {
  runs: number;
  totalMinutes: number;
  bestGrade: Grade | null;
  bestScore: number;
  bestAccuracy: number;
  /** Lowest mean |timing error| of a run (ms). */
  bestTimingMs: number | null;
  /** Share of feints correctly let through. */
  inhibition: number | null;
  /** Share of repeated boss strings answered correctly (pattern memory). */
  patternMemory: number | null;
  /** Share of correct execution cuts (call-and-response memory). */
  execAccuracy: number | null;
  totalKills: number;
  totalDecaps: number;
  chosenModes: Record<ModeId, number>;
  accuracySeries: number[];
  timingSeries: number[];
  masteredModes: ModeId[];
}

const GRADE_ORDER: Grade[] = ['C', 'B', 'A', 'S'];

export function computeProfileStats(history: RunSummary[]): ProfileStats {
  const runs = [...history].sort((a, b) => a.finishedAt - b.finishedAt);
  const chosenModes: Record<ModeId, number> = { spark: 0, flow: 0, calm: 0 };
  const sum = { feints: 0, ignored: 0, repeats: 0, repeatOk: 0, cuts: 0, cutsOk: 0, kills: 0, decaps: 0 };
  const mastered = new Set<ModeId>();
  let best: Grade | null = null;
  for (const r of runs) {
    const x = r.result;
    if (r.modeChosen) chosenModes[r.mode]++;
    sum.feints += x.feints.total;
    sum.ignored += x.feints.ignored;
    sum.repeats += x.patterns.repeats;
    sum.repeatOk += x.patterns.repeatOk;
    sum.cuts += x.exec.cuts;
    sum.cutsOk += x.exec.correct;
    sum.kills += x.kills;
    sum.decaps += x.decaps;
    if (x.grade === 'S' || x.grade === 'A') mastered.add(r.mode);
    if (!best || GRADE_ORDER.indexOf(x.grade) > GRADE_ORDER.indexOf(best)) best = x.grade;
  }
  const ratio = (ok: number, n: number) => (n ? ok / n : null);
  const timing = runs.map((r) => r.result.timing.meanAbsMs).filter((v): v is number => v !== null);
  return {
    runs: runs.length,
    totalMinutes: Math.round(runs.reduce((s, r) => s + r.result.durationMs, 0) / 6000) / 10,
    bestGrade: best,
    bestScore: runs.reduce((m, r) => Math.max(m, r.result.score), 0),
    bestAccuracy: runs.reduce((m, r) => Math.max(m, r.result.accuracy), 0),
    bestTimingMs: timing.length ? Math.min(...timing) : null,
    inhibition: ratio(sum.ignored, sum.feints),
    patternMemory: ratio(sum.repeatOk, sum.repeats),
    execAccuracy: ratio(sum.cutsOk, sum.cuts),
    totalKills: sum.kills,
    totalDecaps: sum.decaps,
    chosenModes,
    accuracySeries: runs.map((r) => r.result.accuracy),
    timingSeries: timing,
    masteredModes: [...mastered],
  };
}

export type ErrorPatternKind = 'typeWeakness' | 'impulsive' | 'feintBait' | 'patternGap' | 'execGap' | 'early' | 'late';

export interface ErrorPattern {
  kind: ErrorPatternKind;
  detail: EnemyKind | 'boss' | 'exec' | 'timing' | 'feints' | 'input';
  count: number;
}

/** Repeated error patterns of a run — the facts an AI mentor may comment on. */
export function detectErrorPatterns(r: BattleResult): ErrorPattern[] {
  const out: ErrorPattern[] = [];
  for (const [kind, t] of Object.entries(r.byKind) as [EnemyKind | 'boss', { n: number; ok: number }][]) {
    const miss = t.n - t.ok;
    if (t.n >= 3 && miss >= 2 && miss / t.n >= 0.35) out.push({ kind: 'typeWeakness', detail: kind, count: miss });
  }
  if (r.impulsive >= 3) out.push({ kind: 'impulsive', detail: 'input', count: r.impulsive });
  if (r.feints.fooled >= 2) out.push({ kind: 'feintBait', detail: 'feints', count: r.feints.fooled });
  if (r.patterns.repeats >= 4 && r.patterns.repeats - r.patterns.repeatOk >= 2) out.push({ kind: 'patternGap', detail: 'boss', count: r.patterns.repeats - r.patterns.repeatOk });
  if (r.exec.cuts - r.exec.correct >= 1) out.push({ kind: 'execGap', detail: 'exec', count: r.exec.cuts - r.exec.correct });
  if (r.timing.biasMs !== null && r.timing.biasMs <= -35) out.push({ kind: 'early', detail: 'timing', count: Math.abs(r.timing.biasMs) });
  if (r.timing.biasMs !== null && r.timing.biasMs >= 35) out.push({ kind: 'late', detail: 'timing', count: r.timing.biasMs });
  return out;
}
