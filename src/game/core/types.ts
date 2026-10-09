/**
 * Core game vocabulary. Everything in `game/core` is pure TypeScript with no
 * Phaser / DOM dependency so it can be unit-tested, simulated, and later reused
 * inside a native shell without rewriting game rules.
 */

/** Attack families of the first antagonist. Each has a unique visual + audio telegraph. */
export type AttackType = 'slashL' | 'slashR' | 'crush' | 'pierce';

/** Player responses. Swipe left/right = dash, tap/hold = shield. */
export type Action = 'dodgeL' | 'dodgeR' | 'block';

export type StageId = 'awakening' | 'contact' | 'pattern' | 'ascension' | 'evolution';

export type ModeId = 'spark' | 'flow' | 'calm';

/**
 * How a single attack was resolved.
 * - read: the player committed the correct response *before* the telegraph (prediction).
 * - react: correct response during the telegraph.
 * - recovered: wrong prediction, but corrected in time after the stagger.
 * - wrong: first reaction during the telegraph was the wrong action.
 * - miss: no response at all.
 * - misread: wrong prediction and no successful correction.
 */
export type Outcome = 'read' | 'react' | 'recovered' | 'wrong' | 'miss' | 'misread';

export const SUCCESS_OUTCOMES: ReadonlySet<Outcome> = new Set(['read', 'react', 'recovered']);

export function isSuccess(outcome: Outcome): boolean {
  return SUCCESS_OUTCOMES.has(outcome);
}

export interface AttackRecord {
  /** Sequential index across the whole mission. */
  i: number;
  stage: StageId;
  type: AttackType;
  telegraphMs: number;
  /** Prediction committed during the gap, if any. */
  predicted: Action | null;
  predictedCorrect: boolean | null;
  /** First reaction during the telegraph, if any. */
  response: Action | null;
  /** ms from telegraph start to the correct reaction (only for react / recovered). */
  reactionMs: number | null;
  outcome: Outcome;
  hinted: boolean;
  /** Mission clock (ms) when the attack resolved. */
  t: number;
}

export interface AscensionTap {
  /** Node the player tapped (null = tapped empty space / timed out). */
  node: number | null;
  expected: number;
  correct: boolean;
  /** ms from the start of the recall window. */
  ms: number;
}

export interface AscensionRecord {
  index: number;
  trigger: 'read' | 'react' | 'assist';
  sequence: number[];
  taps: AscensionTap[];
}

export interface TutorialRecord {
  expect: Action;
  /** ms from prompt to correct input, or null if it auto-completed. */
  ms: number | null;
  wrongInputs: number;
}
