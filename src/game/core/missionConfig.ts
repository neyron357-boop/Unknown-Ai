import type { AttackType, ModeId } from './types';

export interface ScriptedAttack {
  type: AttackType;
  telegraphMs: number;
  /** Teaching attack: shows the gesture hint regardless of the hint setting. */
  demo?: boolean;
}

export interface LoopStageTuning {
  /** The repeating pattern. It is fixed for the whole stage (honest hidden rule). */
  loop: AttackType[];
  telegraphMs: number;
  /** Gap between attacks. During loop stages this is the prediction window. */
  gapMs: number;
  auraRead: number;
  auraReact: number;
  auraRecovered: number;
  /** After this many attacks without a full aura, ECHO assists so the mission stays completable. */
  assistAfter: number;
  /** How many recent attacks the HUD trace displays (scaffolding). */
  traceDepth: number;
}

export interface AscensionTuning {
  points: number;
  /** ms each weak point stays lit during the reveal. */
  showOnMs: number;
  showOffMs: number;
  recallMs: number;
}

export interface MissionConfig {
  mode: ModeId;
  seed: number;
  /** Multiplier on all telegraph durations; produced by the Cognitive Engine (transparent rule). */
  telegraphScale: number;
  awakening: { cineMs: number; stepTimeoutMs: number };
  contact: { introMs: number; gapMs: number; script: ScriptedAttack[] };
  pattern: LoopStageTuning & { introMs: number };
  overdrive: LoopStageTuning & { introMs: number; newTypeSlowdown: number };
  ascension: [AscensionTuning, AscensionTuning];
  recoverMs: number;
  staggerMs: number;
  minTelegraphMs: number;
  integrity: { max: number; hitDamage: number; rebootRestore: number; rebootMs: number };
  barrier: { readChip: number; ascensionBase: number; ascensionPerHit: number; floorAfterFirst: number };
  timing: { ascendTriggerMs: number; ascendStrikeMs: number; finisherMs: number; assistMs: number };
}

/** Teaching script shared by all modes; CALM stretches the timings. */
const CONTACT_SCRIPT: ScriptedAttack[] = [
  { type: 'slashL', telegraphMs: 1700, demo: true },
  { type: 'slashR', telegraphMs: 1700, demo: true },
  { type: 'crush', telegraphMs: 1700, demo: true },
  { type: 'slashR', telegraphMs: 1150 },
  { type: 'crush', telegraphMs: 1100 },
  { type: 'slashL', telegraphMs: 1050 },
  { type: 'slashL', telegraphMs: 1000 },
  { type: 'crush', telegraphMs: 950 },
  { type: 'slashR', telegraphMs: 900 },
  { type: 'slashL', telegraphMs: 900 },
];

interface ModePreset {
  pattern: Omit<LoopStageTuning, 'traceDepth'>;
  overdrive: Omit<LoopStageTuning, 'traceDepth'>;
  ascension: [AscensionTuning, AscensionTuning];
  contactStretch: number;
  gapStretch: number;
}

const PRESETS: Record<ModeId, ModePreset> = {
  // SPARK — short, punchy, fast feedback.
  spark: {
    pattern: { loop: ['slashL', 'slashL', 'crush', 'slashR'], telegraphMs: 640, gapMs: 1000, auraRead: 17, auraReact: 4, auraRecovered: 2, assistAfter: 30 },
    overdrive: { loop: ['pierce', 'slashR', 'slashR', 'crush'], telegraphMs: 540, gapMs: 950, auraRead: 21, auraReact: 5, auraRecovered: 3, assistAfter: 24 },
    ascension: [
      { points: 3, showOnMs: 560, showOffMs: 180, recallMs: 8000 },
      { points: 3, showOnMs: 500, showOffMs: 160, recallMs: 8000 },
    ],
    contactStretch: 1,
    gapStretch: 1,
  },
  // FLOW — longer patterns that demand sustained attention.
  flow: {
    pattern: { loop: ['slashR', 'crush', 'slashL', 'slashR', 'crush'], telegraphMs: 620, gapMs: 1050, auraRead: 15, auraReact: 3, auraRecovered: 2, assistAfter: 36 },
    overdrive: { loop: ['slashL', 'pierce', 'crush', 'slashR', 'pierce'], telegraphMs: 540, gapMs: 1000, auraRead: 18, auraReact: 4, auraRecovered: 2, assistAfter: 28 },
    ascension: [
      { points: 3, showOnMs: 560, showOffMs: 180, recallMs: 8000 },
      { points: 4, showOnMs: 520, showOffMs: 170, recallMs: 9000 },
    ],
    contactStretch: 1,
    gapStretch: 1,
  },
  // CALM — slower tempo, wider windows, room to think.
  calm: {
    pattern: { loop: ['slashL', 'crush', 'slashR', 'slashR'], telegraphMs: 880, gapMs: 1500, auraRead: 20, auraReact: 5, auraRecovered: 3, assistAfter: 24 },
    overdrive: { loop: ['crush', 'pierce', 'slashL', 'slashR'], telegraphMs: 760, gapMs: 1400, auraRead: 25, auraReact: 6, auraRecovered: 3, assistAfter: 20 },
    ascension: [
      { points: 3, showOnMs: 800, showOffMs: 240, recallMs: 11000 },
      { points: 3, showOnMs: 760, showOffMs: 220, recallMs: 11000 },
    ],
    contactStretch: 1.3,
    gapStretch: 1.25,
  },
};

export interface BuildConfigOptions {
  mode: ModeId;
  seed: number;
  telegraphScale?: number;
}

export function buildMissionConfig({ mode, seed, telegraphScale = 1 }: BuildConfigOptions): MissionConfig {
  const p = PRESETS[mode];
  const scale = clamp(telegraphScale, 0.8, 1.3);
  return {
    mode,
    seed,
    telegraphScale: scale,
    awakening: { cineMs: 2800, stepTimeoutMs: 7000 },
    contact: {
      introMs: 3200,
      gapMs: Math.round(850 * p.gapStretch),
      script: CONTACT_SCRIPT.map((a) => ({ ...a, telegraphMs: Math.round(a.telegraphMs * p.contactStretch) })),
    },
    pattern: { ...p.pattern, introMs: 3000, traceDepth: 4 },
    overdrive: { ...p.overdrive, introMs: 3400, traceDepth: 2, newTypeSlowdown: 2.4 },
    ascension: p.ascension,
    recoverMs: 620,
    staggerMs: 360,
    minTelegraphMs: 380,
    integrity: { max: 100, hitDamage: 20, rebootRestore: 60, rebootMs: 2000 },
    barrier: { readChip: 3, ascensionBase: 16, ascensionPerHit: 12, floorAfterFirst: 22 },
    timing: { ascendTriggerMs: 1300, ascendStrikeMs: 2600, finisherMs: 4200, assistMs: 1800 },
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Weak-point candidates on the enemy body, in enemy-local units (−1..1). Stable across runs. */
export const WEAK_POINT_NODES: ReadonlyArray<{ x: number; y: number }> = [
  { x: -0.46, y: -0.34 },
  { x: 0.46, y: -0.34 },
  { x: 0, y: -0.12 },
  { x: -0.34, y: 0.26 },
  { x: 0.34, y: 0.26 },
  { x: 0, y: 0.56 },
];
