/**
 * Vocabulary of the v3 battle: the player is the sword — every input is a slash in one of
 * four directions, aimed at the threat. Everything lives on a musical beat grid.
 */

export type ModeId = 'spark' | 'flow' | 'calm';

/** A slash (swipe) direction. Enemies on the left are cut with a swipe to the left, etc. */
export type Dir = 'left' | 'right' | 'up' | 'down';
export const DIRS: readonly Dir[] = ['left', 'right', 'up', 'down'];
export const OPPOSITE: Record<Dir, Dir> = { left: 'right', right: 'left', up: 'down', down: 'up' };

export type Side = 'left' | 'right';

export type EnemyKind =
  /** One cut. */
  | 'grunt'
  /** Armored: two cuts on consecutive beats. */
  | 'brute'
  /** Blinks to the other side after the first cut. */
  | 'dodger'
  /** Fakes an attack (white eyes) — don't cut; the real attack follows a beat later (red eyes). */
  | 'feinter'
  /** Jumps from above — cut up. */
  | 'leaper'
  /** Comes from below — cut down. */
  | 'crawler'
  /** Shoots from the background — deflect the bullet toward the shooter. */
  | 'gunner'
  /** Mini-boss with a chainsaw. */
  | 'butcher';

export const ENEMY_KINDS: readonly EnemyKind[] = ['grunt', 'brute', 'dodger', 'feinter', 'leaper', 'crawler', 'gunner', 'butcher'];

export type BossMove = 'high' | 'low' | 'thrust' | 'feint';
export type CameoId = 'cleaner' | 'fox' | 'ronin' | 'butcher';
export type ActId = 'roof' | 'fall' | 'train' | 'temple';

/** Music sections the director asks the audio engine for (bar-aligned). */
export type SectionId =
  | 'menu'
  | 'intro'
  | 'roof'
  | 'roofBuild'
  | 'roofDrop'
  | 'fall'
  | 'train'
  | 'trainDrop'
  | 'cameo'
  | 'bossIntro'
  | 'boss'
  | 'bossRage'
  | 'execution'
  | 'finale'
  | 'outro';

export type SegmentId = 'intro' | 'roofA' | 'roofB' | 'roofDrop' | 'fall' | 'trainA' | 'trainDrop' | 'cameo' | 'bossIntro' | 'duel' | 'rage' | 'exec' | 'finale';

export type Judgement =
  | 'perfect'
  | 'good'
  /** Too late / never answered — the threat lands. */
  | 'miss'
  /** Slashed at a feint. */
  | 'fooled'
  /** Correctly ignored a feint. */
  | 'ignored';

/** Visual hint for how a kill should look (the scene may vary it). */
export type KillStyle = 'bisect' | 'decap' | 'cleave' | 'impale' | 'burst' | 'shot' | 'shove';

/** Cosmetic surprises (the director schedules them on bar lines; `mirror` also flips left/right input). */
export type AnomalyKind =
  | 'lightning'
  | 'mirror'
  | 'invert'
  | 'moonEye'
  | 'bloodRain'
  | 'glitch'
  | 'whisper'
  | 'hudCut'
  | 'fakeCrash'
  | 'timeStop'
  | 'panels'
  | 'blackout';

export type HintKind = EnemyKind | 'beat' | 'duel' | 'exec';

export interface NoteInfo {
  id: number;
  /** Enemy id, or -1 for the boss / execution. */
  enemy: number;
  /** Impact time (director ms). */
  at: number;
  dir: Dir;
  /** Must NOT be answered. */
  feint: boolean;
  kind: EnemyKind | 'boss' | 'exec';
  /** Last note of its enemy (answering it kills). */
  final: boolean;
  step: number;
  /** Resolved by a cameo, not by the player. */
  assist: CameoId | null;
  /** Boss move behind this note. */
  move?: BossMove;
}

export interface EnemySpawn {
  id: number;
  kind: EnemyKind;
  side: Side;
  /** When it appears (director ms); it reaches striking range exactly at notes[0].at. */
  spawnAt: number;
  notes: NoteInfo[];
  /** Small integer for visual variety (outfit/weapon). */
  variant: number;
  assist: CameoId | null;
  act: ActId;
}

export interface Meters {
  hp: number;
  score: number;
  combo: number;
  mult: number;
  /** 0..1, full → Bloodlust. */
  rage: number;
  bloodlust: boolean;
  /** Boss posture 0..1 while the duel is on, else null. */
  posture: number | null;
  /** Boss health 0..1 for the HUD bar (cosmetic), else null. */
  bossHp: number | null;
  kills: number;
}

export const MAX_HP = 100;
