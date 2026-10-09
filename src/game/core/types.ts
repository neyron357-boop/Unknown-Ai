/**
 * Core vocabulary of the rhythm duel. Everything in `game/core` is pure
 * TypeScript (no Phaser, no DOM): rules can be simulated and unit-tested,
 * and reused in a native shell later.
 */

/** Player inputs. Tap = parry / strike, swipes = duck, jump, pick a side. */
export type Action = 'tap' | 'up' | 'down' | 'left' | 'right';

/**
 * Attack families.
 *  mid  — straight thrust at the chest → parry with a TAP on the beat
 *  high — horizontal swing at head height → DUCK (swipe down)
 *  low  — sweep at the legs → JUMP (swipe up)
 */
export type AttackKind = 'mid' | 'high' | 'low';

export type RoundKind = 'takt' | 'phantoms' | 'overcharge' | 'ascension';

export type ModeId = 'spark' | 'flow' | 'calm';

/** When the attack kind becomes visible: 2 beats before impact, 1 beat before, or never. */
export type Reveal = 'early' | 'late' | 'blind';

/**
 * perfect / good — correct action inside the window
 * miss   — no reaction to a real attack (hit taken)
 * wrong  — wrong action (hit taken)
 * fooled — reacted to a phantom (combo broken)
 * ignored — correctly let a phantom pass
 */
export type Judgement = 'perfect' | 'good' | 'miss' | 'wrong' | 'fooled' | 'ignored';

export const SUCCESS: ReadonlySet<Judgement> = new Set(['perfect', 'good', 'ignored']);

export function isSuccess(j: Judgement): boolean {
  return SUCCESS.has(j);
}

export const RESPONSE: Record<AttackKind, Action> = { mid: 'tap', high: 'down', low: 'up' };

export type UpgradeId =
  | 'resonance'
  | 'foresight'
  | 'secondWind'
  | 'coldMind'
  | 'bloodRhythm'
  | 'phantomSight'
  | 'overclock'
  | 'echoMemory'
  | 'thirst';

export interface AttackRecord {
  i: number;
  round: RoundKind;
  loop: number;
  kind: AttackKind;
  phantom: boolean;
  reveal: Reveal;
  impactMs: number;
  action: Action | null;
  /** input time − impact time (ms); negative = early. */
  offsetMs: number | null;
  /** input time − reveal time (ms) for revealed attacks. */
  reactionMs: number | null;
  judgement: Judgement;
}

export interface StrikeRecord {
  round: RoundKind;
  onBeat: boolean;
  offsetMs: number;
  damage: number;
}

export type OrbOp = { op: '+' | '×' | '−'; n: number };

export interface OrbRecord {
  i: number;
  energyBefore: number;
  left: OrbOp;
  right: OrbOp;
  chosen: 'left' | 'right' | null;
  correct: boolean;
  decisionMs: number | null;
}

export interface RecallRecord {
  sequence: number[];
  taps: { node: number | null; expected: number; correct: boolean; ms: number }[];
}

export function applyOp(energy: number, o: OrbOp): number {
  const v = o.op === '+' ? energy + o.n : o.op === '×' ? energy * o.n : energy - o.n;
  return Math.max(0, Math.min(99, v));
}

export function opLabel(o: OrbOp): string {
  return `${o.op}${o.n}`;
}
