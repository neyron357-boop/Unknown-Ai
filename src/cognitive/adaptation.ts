import type { MissionResult } from '@/game/core/metrics';
import type { ModeId } from '@/game/core/types';

/**
 * UNKNOWN Cognitive Engine — adaptation rules.
 *
 * Deliberately simple and transparent: every adjustment is explained by a
 * human-readable reason. No medical or emotional inference is made from
 * gameplay statistics.
 */

export interface RunSummary {
  id: string;
  missionId: 'awakening';
  mode: ModeId;
  /** Was the mode chosen by the player (vs. the default)? Used for preference stats. */
  modeChosen: boolean;
  startedAt: number;
  finishedAt: number;
  telegraphScale: number;
  result: MissionResult;
}

export type AdaptationReason = 'baseline' | 'struggling' | 'mastered' | 'steady';

export interface Adaptation {
  /** Multiplier for telegraph durations of the next run (1 = default). */
  telegraphScale: number;
  reason: AdaptationReason;
  /** Number of recent runs the rule looked at. */
  basedOn: number;
}

export const SCALE_MIN = 0.85;
export const SCALE_MAX = 1.25;
const STEP = 0.05;

/**
 * Rule (per mode, last 3 runs):
 *  - fewer than 2 runs → baseline (1.0)
 *  - loop-stage accuracy < 60% or ≥1 reboot per run → +0.05 (more time to read)
 *  - accuracy ≥ 90% and median reaction ≤ 420ms and no assists → −0.05 (tighter)
 *  - otherwise keep the last scale.
 * One step per run, clamped to [0.85, 1.25], so difficulty never jumps.
 */
export function computeAdaptation(history: RunSummary[], mode: ModeId): Adaptation {
  const runs = history
    .filter((r) => r.mode === mode)
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, 3);
  const last = runs[0]?.telegraphScale ?? 1;
  if (runs.length < 2) return { telegraphScale: round2(last), reason: 'baseline', basedOn: runs.length };

  const loopTotals = runs.reduce(
    (acc, r) => {
      acc.n += r.result.byStage.pattern.n + r.result.byStage.ascension.n;
      acc.ok += r.result.byStage.pattern.ok + r.result.byStage.ascension.ok;
      return acc;
    },
    { n: 0, ok: 0 },
  );
  const accuracy = loopTotals.n ? loopTotals.ok / loopTotals.n : 0;
  const reboots = runs.reduce((s, r) => s + r.result.reboots, 0) / runs.length;
  const assists = runs.reduce((s, r) => s + r.result.assists, 0);
  const reactions = runs.map((r) => r.result.reactionMedianMs).filter((v): v is number => v !== null);
  const reaction = reactions.length ? reactions.reduce((a, b) => a + b, 0) / reactions.length : Infinity;

  if (accuracy < 0.6 || reboots >= 1) {
    return { telegraphScale: clampScale(last + STEP), reason: 'struggling', basedOn: runs.length };
  }
  if (accuracy >= 0.9 && reaction <= 420 && assists === 0) {
    return { telegraphScale: clampScale(last - STEP), reason: 'mastered', basedOn: runs.length };
  }
  return { telegraphScale: round2(last), reason: 'steady', basedOn: runs.length };
}

function clampScale(v: number): number {
  return round2(Math.max(SCALE_MIN, Math.min(SCALE_MAX, v)));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface ProfileStats {
  runs: number;
  totalMinutes: number;
  bestAccuracy: number;
  bestReactionMs: number | null;
  totalReads: number;
  /** Runs per mode that the player picked explicitly. */
  chosenModes: Record<ModeId, number>;
  /** Fraction of predictions that were right, across all runs. */
  predictionPrecision: number | null;
  /** Chronological series for sparklines. */
  accuracySeries: number[];
  reactionSeries: number[];
  /** Mastered = at least one run in that mode with ≥ 90% accuracy and no assist. */
  masteredModes: ModeId[];
}

export function computeProfileStats(history: RunSummary[]): ProfileStats {
  const runs = [...history].sort((a, b) => a.finishedAt - b.finishedAt);
  const chosenModes: Record<ModeId, number> = { spark: 0, flow: 0, calm: 0 };
  let predAttempts = 0;
  let predCorrect = 0;
  const mastered = new Set<ModeId>();
  for (const r of runs) {
    if (r.modeChosen) chosenModes[r.mode]++;
    predAttempts += r.result.predictions.attempts;
    predCorrect += r.result.predictions.correct;
    if (r.result.accuracy >= 0.9 && r.result.assists === 0) mastered.add(r.mode);
  }
  const reactions = runs.map((r) => r.result.reactionMedianMs).filter((v): v is number => v !== null);
  return {
    runs: runs.length,
    totalMinutes: Math.round(runs.reduce((s, r) => s + r.result.durationMs, 0) / 6000) / 10,
    bestAccuracy: runs.reduce((m, r) => Math.max(m, r.result.accuracy), 0),
    bestReactionMs: reactions.length ? Math.min(...reactions) : null,
    totalReads: runs.reduce((s, r) => s + r.result.reads, 0),
    chosenModes,
    predictionPrecision: predAttempts ? predCorrect / predAttempts : null,
    accuracySeries: runs.map((r) => r.result.accuracy),
    reactionSeries: reactions,
    masteredModes: [...mastered],
  };
}

/**
 * Detects repeated error patterns from the last run — the facts an AI mentor
 * may comment on. Computed locally and deterministically.
 */
export interface ErrorPattern {
  kind: 'typeWeakness' | 'impulsive' | 'latePredictor' | 'memoryGap';
  detail: string;
  count: number;
}

export function detectErrorPatterns(result: MissionResult): ErrorPattern[] {
  const out: ErrorPattern[] = [];
  for (const [type, t] of Object.entries(result.byType)) {
    const miss = t.n - t.ok;
    if (t.n >= 3 && miss >= 2 && miss / t.n >= 0.4) out.push({ kind: 'typeWeakness', detail: type, count: miss });
  }
  if (result.impulsive >= 3) out.push({ kind: 'impulsive', detail: 'early-wrong-commit', count: result.impulsive });
  const loopAttacks = result.byStage.pattern.n + result.byStage.ascension.n;
  if (loopAttacks >= 8 && result.predictions.attempts === 0) {
    out.push({ kind: 'latePredictor', detail: 'no-predictions', count: loopAttacks });
  }
  const missedTaps = result.ascension.taps - result.ascension.correct;
  if (missedTaps >= 2) out.push({ kind: 'memoryGap', detail: 'weak-points', count: missedTaps });
  return out;
}
