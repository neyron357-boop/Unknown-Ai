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
  /** Difficulty factor used for this run (>1 easier). */
  ease: number;
  result: MissionResult;
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
 *  - mean rating < 0.55 or ≥ 1 reboot per run → +0.05 (slower, wider windows)
 *  - mean rating ≥ 0.88 and no reboots → −0.05 (faster, tighter)
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
  bestGrade: MissionResult['grade'] | null;
  bestAccuracy: number;
  bestReactionMs: number | null;
  /** Correct share of blind (from-memory) attacks across runs. */
  blindPrecision: number | null;
  /** Share of phantoms correctly let through. */
  inhibition: number | null;
  calcAccuracy: number | null;
  recallAccuracy: number | null;
  chosenModes: Record<ModeId, number>;
  accuracySeries: number[];
  reactionSeries: number[];
  masteredModes: ModeId[];
}

const GRADE_ORDER = ['C', 'B', 'A', 'S'] as const;

export function computeProfileStats(history: RunSummary[]): ProfileStats {
  const runs = [...history].sort((a, b) => a.finishedAt - b.finishedAt);
  const chosenModes: Record<ModeId, number> = { spark: 0, flow: 0, calm: 0 };
  const sum = { blindN: 0, blindOk: 0, ph: 0, phOk: 0, calcN: 0, calcOk: 0, recN: 0, recOk: 0 };
  const mastered = new Set<ModeId>();
  let best: MissionResult['grade'] | null = null;
  for (const r of runs) {
    const x = r.result;
    if (r.modeChosen) chosenModes[r.mode]++;
    sum.blindN += x.predictions.attempts;
    sum.blindOk += x.predictions.correct;
    sum.ph += x.inhibition.phantoms;
    sum.phOk += x.inhibition.ignored;
    sum.calcN += x.calc.choices;
    sum.calcOk += x.calc.correct;
    sum.recN += x.recall.taps;
    sum.recOk += x.recall.correct;
    if (x.grade === 'S' || x.grade === 'A') mastered.add(r.mode);
    if (!best || GRADE_ORDER.indexOf(x.grade) > GRADE_ORDER.indexOf(best)) best = x.grade;
  }
  const ratio = (ok: number, n: number) => (n ? ok / n : null);
  const reactions = runs.map((r) => r.result.reactionMedianMs).filter((v): v is number => v !== null);
  return {
    runs: runs.length,
    totalMinutes: Math.round(runs.reduce((s, r) => s + r.result.durationMs, 0) / 6000) / 10,
    bestGrade: best,
    bestAccuracy: runs.reduce((m, r) => Math.max(m, r.result.accuracy), 0),
    bestReactionMs: reactions.length ? Math.min(...reactions) : null,
    blindPrecision: ratio(sum.blindOk, sum.blindN),
    inhibition: ratio(sum.phOk, sum.ph),
    calcAccuracy: ratio(sum.calcOk, sum.calcN),
    recallAccuracy: ratio(sum.recOk, sum.recN),
    chosenModes,
    accuracySeries: runs.map((r) => r.result.accuracy),
    reactionSeries: reactions,
    masteredModes: [...mastered],
  };
}

export type ErrorPatternKind = 'typeWeakness' | 'impulsive' | 'blindStruggle' | 'phantomBait' | 'mathSlip' | 'memoryGap';

export interface ErrorPattern {
  kind: ErrorPatternKind;
  detail: string;
  count: number;
}

/** Repeated error patterns of a run — the facts an AI mentor may comment on. */
export function detectErrorPatterns(r: MissionResult): ErrorPattern[] {
  const out: ErrorPattern[] = [];
  for (const [kind, t] of Object.entries(r.byKind)) {
    const miss = t.n - t.ok;
    if (t.n >= 3 && miss >= 2 && miss / t.n >= 0.35) out.push({ kind: 'typeWeakness', detail: kind, count: miss });
  }
  if (r.impulsive >= 3) out.push({ kind: 'impulsive', detail: 'early-input', count: r.impulsive });
  if (r.predictions.attempts >= 4 && r.predictions.correct / r.predictions.attempts < 0.6) out.push({ kind: 'blindStruggle', detail: 'blind-loop', count: r.predictions.attempts - r.predictions.correct });
  if (r.inhibition.fooled >= 2) out.push({ kind: 'phantomBait', detail: 'phantoms', count: r.inhibition.fooled });
  if (r.calc.choices - r.calc.correct >= 2) out.push({ kind: 'mathSlip', detail: 'orbs', count: r.calc.choices - r.calc.correct });
  if (r.recall.taps - r.recall.correct >= 1) out.push({ kind: 'memoryGap', detail: 'runes', count: r.recall.taps - r.recall.correct });
  return out;
}
