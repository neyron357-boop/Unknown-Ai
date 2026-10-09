import {
  isSuccess,
  type AttackKind,
  type AttackRecord,
  type ModeId,
  type OrbRecord,
  type RecallRecord,
  type RoundKind,
  type StrikeRecord,
  type UpgradeId,
} from './types';

export type Grade = 'S' | 'A' | 'B' | 'C';

export type BestDecisionKind =
  | 'perfectAscension'
  | 'blindRead'
  | 'ironWill'
  | 'mathMind'
  | 'perfectStreak'
  | 'comboKing'
  | 'fastReaction'
  | 'persistence';

export interface Tally {
  n: number;
  ok: number;
}

export interface MissionResult {
  version: 2;
  mode: ModeId;
  seed: number;
  durationMs: number;
  score: number;
  grade: Grade;
  /** 0..1 — the transparent rating behind the grade. */
  rating: number;
  /** Correct outcomes / all attacks (phantoms included). */
  accuracy: number;
  attacks: number;
  successes: number;
  perfects: number;
  maxCombo: number;
  /** Mean |input − beat| for correct responses, ms. */
  timingMs: number | null;
  /** Median time from the attack becoming visible to the correct response, ms. */
  reactionMedianMs: number | null;
  reactionBestMs: number | null;
  /** Attacks played blind (from memory of the pattern). */
  predictions: { attempts: number; correct: number };
  inhibition: { phantoms: number; ignored: number; fooled: number };
  calc: { choices: number; correct: number; decisionMedianMs: number | null };
  recall: { taps: number; correct: number };
  strikes: { total: number; onBeat: number };
  /** Inputs made out of impatience: during a windup or at a phantom. */
  impulsive: number;
  hitsTaken: number;
  reboots: number;
  byRound: Record<RoundKind, Tally>;
  byKind: Record<AttackKind, Tally>;
  upgrades: UpgradeId[];
  bestDecision: { kind: BestDecisionKind; value: number };
  records: { attacks: AttackRecord[]; strikes: StrikeRecord[]; orbs: OrbRecord[]; recall: RecallRecord | null };
}

export interface SummarizeInput {
  mode: ModeId;
  seed: number;
  durationMs: number;
  score: number;
  maxCombo: number;
  attacks: AttackRecord[];
  strikes: StrikeRecord[];
  orbs: OrbRecord[];
  recall: RecallRecord | null;
  reboots: number;
  hitsTaken: number;
  stray: number;
  upgrades: UpgradeId[];
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

const tally = (): Tally => ({ n: 0, ok: 0 });

export function gradeFor(rating: number): Grade {
  return rating >= 0.88 ? 'S' : rating >= 0.72 ? 'A' : rating >= 0.52 ? 'B' : 'C';
}

export function summarizeRun(input: SummarizeInput): MissionResult {
  const { attacks, strikes, orbs, recall } = input;
  const successes = attacks.filter((a) => isSuccess(a.judgement));
  const perfects = attacks.filter((a) => a.judgement === 'perfect').length;
  const responded = attacks.filter((a) => (a.judgement === 'perfect' || a.judgement === 'good') && a.offsetMs !== null);
  const reactions = attacks.filter((a) => a.reactionMs !== null && a.reactionMs > 0).map((a) => a.reactionMs as number);
  const blind = attacks.filter((a) => a.reveal === 'blind' && !a.phantom);
  const phantoms = attacks.filter((a) => a.phantom);
  const fooled = phantoms.filter((a) => a.judgement === 'fooled').length;

  const byRound: Record<RoundKind, Tally> = { takt: tally(), phantoms: tally(), overcharge: tally(), ascension: tally() };
  const byKind: Record<AttackKind, Tally> = { mid: tally(), high: tally(), low: tally() };
  for (const a of attacks) {
    const ok = isSuccess(a.judgement) ? 1 : 0;
    byRound[a.round].n++;
    byRound[a.round].ok += ok;
    if (!a.phantom) {
      byKind[a.kind].n++;
      byKind[a.kind].ok += ok;
    }
  }
  const orbCorrect = orbs.filter((o) => o.correct).length;
  const taps = recall?.taps ?? [];
  const tapsCorrect = taps.filter((t) => t.correct).length;
  const onBeat = strikes.filter((s) => s.onBeat).length;

  // Transparent rating: weighted share of everything the run asked for.
  const attackScore = attacks.length
    ? attacks.reduce((s, a) => s + (a.judgement === 'perfect' || a.judgement === 'ignored' ? 1 : a.judgement === 'good' ? 0.75 : 0), 0) / attacks.length
    : 0;
  const parts: [number, number][] = [
    [attackScore, 0.55],
    [strikes.length ? onBeat / Math.max(strikes.length, 1) : 0, 0.1],
    [orbs.length ? orbCorrect / orbs.length : 0, 0.15],
    [taps.length ? tapsCorrect / taps.length : 0, 0.2],
  ];
  const rating = parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0);

  const timing = responded.map((a) => Math.abs(a.offsetMs as number));
  const perfectStreak = longestStreak(attacks, (a) => a.judgement === 'perfect');
  const result: MissionResult = {
    version: 2,
    mode: input.mode,
    seed: input.seed,
    durationMs: input.durationMs,
    score: input.score,
    grade: gradeFor(rating),
    rating: Math.round(rating * 1000) / 1000,
    accuracy: attacks.length ? successes.length / attacks.length : 0,
    attacks: attacks.length,
    successes: successes.length,
    perfects,
    maxCombo: input.maxCombo,
    timingMs: timing.length ? Math.round(timing.reduce((a, b) => a + b, 0) / timing.length) : null,
    reactionMedianMs: median(reactions),
    reactionBestMs: reactions.length ? Math.min(...reactions) : null,
    predictions: { attempts: blind.length, correct: blind.filter((a) => isSuccess(a.judgement)).length },
    inhibition: { phantoms: phantoms.length, ignored: phantoms.length - fooled, fooled },
    calc: { choices: orbs.length, correct: orbCorrect, decisionMedianMs: median(orbs.filter((o) => o.decisionMs !== null).map((o) => o.decisionMs as number)) },
    recall: { taps: taps.length, correct: tapsCorrect },
    strikes: { total: strikes.length, onBeat },
    impulsive: input.stray + fooled,
    hitsTaken: input.hitsTaken,
    reboots: input.reboots,
    byRound,
    byKind,
    upgrades: [...input.upgrades],
    bestDecision: { kind: 'persistence', value: attacks.length },
    records: { attacks, strikes, orbs, recall },
  };
  result.bestDecision = pickBestDecision(result, perfectStreak);
  return result;
}

/** Deterministic, explainable highlight of the run. */
export function pickBestDecision(r: MissionResult, perfectStreak: number): MissionResult['bestDecision'] {
  if (r.recall.taps > 0 && r.recall.correct === r.recall.taps) return { kind: 'perfectAscension', value: r.recall.taps };
  if (r.predictions.attempts >= 4 && r.predictions.correct === r.predictions.attempts) return { kind: 'blindRead', value: r.predictions.correct };
  if (r.inhibition.phantoms >= 4 && r.inhibition.fooled === 0) return { kind: 'ironWill', value: r.inhibition.phantoms };
  if (r.calc.choices >= 4 && r.calc.correct === r.calc.choices) return { kind: 'mathMind', value: r.calc.correct };
  if (perfectStreak >= 5) return { kind: 'perfectStreak', value: perfectStreak };
  if (r.maxCombo >= 15) return { kind: 'comboKing', value: r.maxCombo };
  if (r.reactionBestMs !== null && r.reactionBestMs <= 380) return { kind: 'fastReaction', value: r.reactionBestMs };
  return { kind: 'persistence', value: r.attacks };
}
