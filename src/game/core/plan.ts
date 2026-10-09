import { createRng, pickDistinct } from './random';
import type { AttackKind, ModeId, OrbOp, Reveal, RoundKind, UpgradeId } from './types';

/**
 * Deterministic content generation: tuning per mode, attack patterns,
 * phantom layouts, energy orbs, rune sequences and upgrade offers.
 * Everything derives from (seed, round index) so a run is reproducible
 * and a resumed run matches an uninterrupted one.
 */

export interface Tuning {
  bpm: Record<RoundKind, number>;
  taktLoops: number;
  patternLen: number;
  phantomLoops: number;
  phantomLoopLen: number;
  orbPairs: number;
  runes: number;
  defenseLen: number;
  /** ±ms around the impact that count as PERFECT. */
  perfectMs: number;
  /** How early / late a correct input still counts (GOOD). */
  earlyMs: number;
  lateMs: number;
  /** Reveal for the final defense loop. */
  defenseReveal: Reveal;
}

const BASE: Record<ModeId, Tuning> = {
  spark: {
    bpm: { takt: 118, phantoms: 126, overcharge: 132, ascension: 140 },
    taktLoops: 4,
    patternLen: 4,
    phantomLoops: 3,
    phantomLoopLen: 6,
    orbPairs: 6,
    runes: 3,
    defenseLen: 6,
    perfectMs: 60,
    earlyMs: 150,
    lateMs: 120,
    defenseReveal: 'late',
  },
  flow: {
    bpm: { takt: 114, phantoms: 122, overcharge: 128, ascension: 136 },
    taktLoops: 5,
    patternLen: 5,
    phantomLoops: 4,
    phantomLoopLen: 6,
    orbPairs: 8,
    runes: 4,
    defenseLen: 8,
    perfectMs: 60,
    earlyMs: 150,
    lateMs: 120,
    defenseReveal: 'late',
  },
  calm: {
    bpm: { takt: 96, phantoms: 102, overcharge: 108, ascension: 114 },
    taktLoops: 4,
    patternLen: 4,
    phantomLoops: 3,
    phantomLoopLen: 5,
    orbPairs: 5,
    runes: 3,
    defenseLen: 6,
    perfectMs: 80,
    earlyMs: 190,
    lateMs: 150,
    defenseReveal: 'early',
  },
};

/** `ease` > 1 slows the tempo and widens timing windows; < 1 tightens them. Range 0.85–1.25. */
export function buildTuning(mode: ModeId, ease = 1): Tuning {
  const e = Math.max(0.85, Math.min(1.25, ease));
  const b = BASE[mode];
  const bpm = Object.fromEntries(Object.entries(b.bpm).map(([k, v]) => [k, Math.round(v / Math.sqrt(e))])) as Tuning['bpm'];
  return {
    ...b,
    bpm,
    perfectMs: Math.round(b.perfectMs * e),
    earlyMs: Math.round(b.earlyMs * e),
    lateMs: Math.round(b.lateMs * e),
  };
}

export const ROUND_ORDER: readonly RoundKind[] = ['takt', 'phantoms', 'overcharge', 'ascension'];

export function roundRng(seed: number, round: number, salt = 0): () => number {
  return createRng((seed ^ Math.imul(round + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b)) >>> 0);
}

export interface PlannedAttack {
  kind: AttackKind;
  phantom: boolean;
  /** Figure that attacks (phantoms round: 0..2, otherwise 0). */
  source: number;
  reveal: Reveal;
  hint: boolean;
}

export interface PlannedLoop {
  attacks: PlannedAttack[];
  /** Phantoms round: index of the real VERDICT this loop, and how obvious the tell is. */
  real?: number;
  tell?: 'strong' | 'subtle';
}

/** TAKT: one fixed pattern for the whole round; the reveal shrinks every loop until it is played blind. */
export function planTakt(seed: number, t: Tuning): PlannedLoop[] {
  const rng = roundRng(seed, 0);
  let pattern: AttackKind[] = [];
  for (let tries = 0; tries < 50; tries++) {
    pattern = Array.from({ length: t.patternLen }, () => (rng() < 0.55 ? 'mid' : 'high'));
    const hasBoth = pattern.includes('mid') && pattern.includes('high');
    const noTriple = !pattern.some((k, i) => i >= 2 && k === pattern[i - 1] && k === pattern[i - 2]);
    // The loop must not be trivially periodic (e.g. mid-high-mid-high), otherwise there is nothing to learn.
    const half = t.patternLen % 2 === 0 && pattern.slice(0, t.patternLen / 2).join() === pattern.slice(t.patternLen / 2).join();
    if (hasBoth && noTriple && !half) break;
  }
  const reveals: Reveal[] = ['early', 'early', 'late', 'blind', 'blind', 'blind'];
  return Array.from({ length: t.taktLoops }, (_, loop) => ({
    attacks: pattern.map((kind) => ({ kind, phantom: false, source: 0, reveal: reveals[Math.min(loop, reveals.length - 1)], hint: loop === 0 })),
  }));
}

/** PHANTOMS: the real VERDICT teleports between three figures; only its attacks are real. */
export function planPhantoms(seed: number, t: Tuning, strongTell = false): PlannedLoop[] {
  const rng = roundRng(seed, 1);
  const loops: PlannedLoop[] = [];
  let firstLow = true;
  let lastReal = -1;
  for (let loop = 0; loop < t.phantomLoops; loop++) {
    let real = Math.floor(rng() * 3);
    if (real === lastReal) real = (real + 1 + Math.floor(rng() * 2)) % 3;
    lastReal = real;
    let flags: boolean[] = [];
    for (let tries = 0; tries < 50; tries++) {
      flags = Array.from({ length: t.phantomLoopLen }, () => rng() < 0.42);
      const phantoms = flags.filter(Boolean).length;
      if (phantoms >= 2 && t.phantomLoopLen - phantoms >= 2 && !flags[0]) break;
    }
    const attacks = flags.map((phantom): PlannedAttack => {
      const kind: AttackKind = rng() < 0.5 ? 'mid' : 'low';
      const others = [0, 1, 2].filter((i) => i !== real);
      const hint = !phantom && kind === 'low' && firstLow;
      if (hint) firstLow = false;
      // the first low strike is taught: its kind shows early, with the gesture hint
      return { kind, phantom, source: phantom ? others[Math.floor(rng() * 2)] : real, reveal: hint ? 'early' : 'late', hint };
    });
    loops.push({ attacks, real, tell: strongTell || loop < t.phantomLoops - 1 ? 'strong' : 'subtle' });
  }
  return loops;
}

/** Final defense before the Ascension: every kind, mixed, fast. */
export function planDefense(seed: number, t: Tuning): PlannedLoop {
  const rng = roundRng(seed, 3);
  const kinds: AttackKind[] = ['mid', 'high', 'low'];
  const attacks: PlannedAttack[] = [];
  for (let i = 0; i < t.defenseLen; i++) {
    let k = kinds[Math.floor(rng() * 3)];
    if (i >= 2 && k === attacks[i - 1].kind && k === attacks[i - 2].kind) k = kinds[(kinds.indexOf(k) + 1) % 3];
    attacks.push({ kind: k, phantom: false, source: 0, reveal: t.defenseReveal, hint: false });
  }
  return { attacks };
}

export function planRunes(seed: number, t: Tuning): number[] {
  return pickDistinct(roundRng(seed, 3, 1), 6, t.runes);
}

/**
 * Two energy options for the current energy. Exactly one is clearly better (≥ 2 apart),
 * numbers grow a little with each pair. Uses the round rng so a run stays reproducible.
 */
export function makeOrbPair(rng: () => number, energy: number, index: number): { left: OrbOp; right: OrbOp } {
  const value = (o: OrbOp) => (o.op === '+' ? energy + o.n : o.op === '×' ? energy * o.n : energy - o.n);
  const randomOp = (): OrbOp => {
    const r = rng();
    if (r < 0.15 && energy > 4) return { op: '−', n: 1 + Math.floor(rng() * 4) };
    if (r < 0.5 && energy <= 14) return { op: '×', n: energy <= 6 && rng() < 0.4 ? 3 : 2 };
    return { op: '+', n: 2 + Math.floor(rng() * (5 + Math.min(index, 4))) };
  };
  for (let tries = 0; tries < 40; tries++) {
    const a = randomOp();
    const b = randomOp();
    if (a.op === b.op && a.n === b.n) continue;
    if (Math.abs(value(a) - value(b)) < 2) continue;
    return rng() < 0.5 ? { left: a, right: b } : { left: b, right: a };
  }
  return { left: { op: '+', n: 2 }, right: { op: '+', n: 7 } };
}

export const ROUND_UPGRADE: Partial<Record<RoundKind, UpgradeId>> = {
  phantoms: 'phantomSight',
  overcharge: 'overclock',
  ascension: 'echoMemory',
};

const GENERAL: UpgradeId[] = ['resonance', 'foresight', 'secondWind', 'coldMind', 'bloodRhythm', 'thirst'];

/** Three cards: one tailored to the next round, two general ones not already taken. */
export function offerUpgrades(seed: number, offerIndex: number, nextRound: RoundKind, taken: readonly UpgradeId[]): UpgradeId[] {
  const rng = roundRng(seed, 10 + offerIndex);
  const pool = GENERAL.filter((u) => !taken.includes(u));
  const picks: UpgradeId[] = [];
  const special = ROUND_UPGRADE[nextRound];
  if (special && !taken.includes(special)) picks.push(special);
  while (picks.length < 3 && pool.length) picks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return picks;
}
