import { isSuccess, type AscensionRecord, type AttackRecord, type AttackType, type ModeId, type TutorialRecord } from './types';

export type BestDecisionKind =
  | 'perfectAscension'
  | 'readStreak'
  | 'fastReaction'
  | 'recovered'
  | 'firstRead'
  | 'persistence';

export interface Tally {
  n: number;
  ok: number;
}

export interface MissionResult {
  mode: ModeId;
  seed: number;
  durationMs: number;
  attacks: number;
  successes: number;
  /** 0..1 */
  accuracy: number;
  reactionMedianMs: number | null;
  reactionBestMs: number | null;
  predictions: { attempts: number; correct: number };
  reads: number;
  longestReadStreak: number;
  ascension: { taps: number; correct: number };
  /** Wrong first commitments: wrong predictions + wrong reactions. */
  impulsive: number;
  reboots: number;
  assists: number;
  byType: Record<AttackType, Tally>;
  byStage: { contact: Tally; pattern: Tally; ascension: Tally };
  bestDecision: { kind: BestDecisionKind; value: number };
  tutorialMedianMs: number | null;
  records: { attacks: AttackRecord[]; ascensions: AscensionRecord[]; tutorial: TutorialRecord[] };
}

export interface SummarizeInput {
  mode: ModeId;
  seed: number;
  durationMs: number;
  attacks: AttackRecord[];
  ascensions: AscensionRecord[];
  tutorial: TutorialRecord[];
  reboots: number;
  assists: number;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function longestStreak<T>(items: T[], pred: (t: T) => boolean): number {
  let best = 0;
  let cur = 0;
  for (const it of items) {
    cur = pred(it) ? cur + 1 : 0;
    if (cur > best) best = cur;
  }
  return best;
}

const emptyTally = (): Tally => ({ n: 0, ok: 0 });

export function summarizeMission(input: SummarizeInput): MissionResult {
  const { attacks, ascensions, tutorial } = input;
  const successes = attacks.filter((a) => isSuccess(a.outcome)).length;
  const reactions = attacks
    .filter((a) => (a.outcome === 'react' || a.outcome === 'recovered') && a.reactionMs !== null)
    .map((a) => a.reactionMs as number);
  const predicted = attacks.filter((a) => a.predicted !== null);
  const predictionsCorrect = predicted.filter((a) => a.predictedCorrect).length;
  const reads = attacks.filter((a) => a.outcome === 'read').length;
  const recovered = attacks.filter((a) => a.outcome === 'recovered').length;
  const impulsive = attacks.filter((a) => a.predictedCorrect === false || a.outcome === 'wrong').length;
  const longestReadStreak = longestStreak(attacks, (a) => a.outcome === 'read');

  const byType: Record<AttackType, Tally> = {
    slashL: emptyTally(),
    slashR: emptyTally(),
    crush: emptyTally(),
    pierce: emptyTally(),
  };
  const byStage = { contact: emptyTally(), pattern: emptyTally(), ascension: emptyTally() };
  for (const a of attacks) {
    const ok = isSuccess(a.outcome) ? 1 : 0;
    byType[a.type].n++;
    byType[a.type].ok += ok;
    const key = a.stage === 'contact' ? 'contact' : a.stage === 'pattern' ? 'pattern' : 'ascension';
    byStage[key].n++;
    byStage[key].ok += ok;
  }

  const taps = ascensions.flatMap((a) => a.taps);
  const tapsCorrect = taps.filter((t) => t.correct).length;
  const reactionBestMs = reactions.length ? Math.min(...reactions) : null;

  return {
    mode: input.mode,
    seed: input.seed,
    durationMs: input.durationMs,
    attacks: attacks.length,
    successes,
    accuracy: attacks.length ? successes / attacks.length : 0,
    reactionMedianMs: median(reactions),
    reactionBestMs,
    predictions: { attempts: predicted.length, correct: predictionsCorrect },
    reads,
    longestReadStreak,
    ascension: { taps: taps.length, correct: tapsCorrect },
    impulsive,
    reboots: input.reboots,
    assists: input.assists,
    byType,
    byStage,
    bestDecision: pickBestDecision({ ascensions, longestReadStreak, reactionBestMs, recovered, reads, attacks: attacks.length }),
    tutorialMedianMs: median(tutorial.filter((t) => t.ms !== null).map((t) => t.ms as number)),
    records: { attacks, ascensions, tutorial },
  };
}

/** Deterministic, explainable "best decision" highlight. */
export function pickBestDecision(p: {
  ascensions: AscensionRecord[];
  longestReadStreak: number;
  reactionBestMs: number | null;
  recovered: number;
  reads: number;
  attacks: number;
}): MissionResult['bestDecision'] {
  const perfect = p.ascensions.filter((a) => a.taps.length > 0 && a.taps.every((t) => t.correct));
  if (perfect.length) return { kind: 'perfectAscension', value: Math.max(...perfect.map((a) => a.taps.length)) };
  if (p.longestReadStreak >= 3) return { kind: 'readStreak', value: p.longestReadStreak };
  if (p.reactionBestMs !== null && p.reactionBestMs <= 450) return { kind: 'fastReaction', value: p.reactionBestMs };
  if (p.recovered > 0) return { kind: 'recovered', value: p.recovered };
  if (p.reads > 0) return { kind: 'firstRead', value: p.reads };
  return { kind: 'persistence', value: p.attacks };
}
