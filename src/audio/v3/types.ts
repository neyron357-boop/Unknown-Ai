/**
 * Public types of the v3 audio engine (procedural phonk + gore SFX).
 * Pure module — safe to import in Node (tests) and in the browser.
 */

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

export const SECTION_IDS: readonly SectionId[] = [
  'menu',
  'intro',
  'roof',
  'roofBuild',
  'roofDrop',
  'fall',
  'train',
  'trainDrop',
  'cameo',
  'bossIntro',
  'boss',
  'bossRage',
  'execution',
  'finale',
  'outro',
];

export type Sfx =
  | 'swing'
  | 'swingHeavy'
  | 'slashFlesh'
  | 'slashCrit'
  | 'bloodSplash'
  | 'bloodGush'
  | 'boneCrack'
  | 'decap'
  | 'bodyFall'
  | 'parry'
  | 'parryPerfect'
  | 'armorBreak'
  | 'whiff'
  | 'heroHit'
  | 'heroHitHeavy'
  | 'gunshot'
  | 'bulletDeflect'
  | 'chainsaw'
  | 'dash'
  | 'blink'
  | 'land'
  | 'glassCrack'
  | 'glitch'
  | 'thunder'
  | 'impact'
  | 'slowmoIn'
  | 'slowmoOut'
  | 'riser'
  | 'subDrop'
  | 'ui'
  | 'uiConfirm'
  | 'combo'
  | 'bloodlust'
  | 'execCut'
  | 'execFail'
  | 'heartbeat'
  | 'collapse'
  | 'trainHorn'
  | 'tapeStop';

export const SFX_NAMES: readonly Sfx[] = [
  'swing',
  'swingHeavy',
  'slashFlesh',
  'slashCrit',
  'bloodSplash',
  'bloodGush',
  'boneCrack',
  'decap',
  'bodyFall',
  'parry',
  'parryPerfect',
  'armorBreak',
  'whiff',
  'heroHit',
  'heroHitHeavy',
  'gunshot',
  'bulletDeflect',
  'chainsaw',
  'dash',
  'blink',
  'land',
  'glassCrack',
  'glitch',
  'thunder',
  'impact',
  'slowmoIn',
  'slowmoOut',
  'riser',
  'subDrop',
  'ui',
  'uiConfirm',
  'combo',
  'bloodlust',
  'execCut',
  'execFail',
  'heartbeat',
  'collapse',
  'trainHorn',
  'tapeStop',
];

export interface AudioPrefs {
  musicOn: boolean;
  sfxOn: boolean;
  voiceOn: boolean;
  /** 0..1 */
  musicVolume: number;
  sfxVolume: number;
  voiceVolume: number;
  /** Hard ceiling on the master output, 0..1. */
  volumeLimit: number;
}

export const DEFAULT_PREFS: AudioPrefs = {
  musicOn: true,
  sfxOn: true,
  voiceOn: true,
  musicVolume: 0.7,
  sfxVolume: 0.85,
  voiceVolume: 0.9,
  volumeLimit: 0.9,
};

export interface SfxOptions {
  /** -1 (left) .. 1 (right) */
  pan?: number;
  /** Linear gain multiplier (default 1). */
  gain?: number;
  /** Playback-rate multiplier (default 1; 1.12 ≈ +2 semitones). */
  pitch?: number;
  /** Director-clock ms when the sound should hit (default: now). */
  at?: number;
}

export type AmbienceId = 'rain' | 'wind' | 'train';

export type EngineState = 'none' | 'suspended' | 'running' | 'closed';

export interface RenderPlanItem {
  id: SectionId;
  bars: number;
  hype?: number;
}

/** Optional hints for `setSection` (non-breaking extension of the brief's API). */
export interface SectionOptions {
  /** Known length of the section in bars (sizes risers/builds; default per section). */
  bars?: number;
}

/** Ids of the optional TTS vocal chops. Any other string id is accepted too. */
export type ChantId = 'ch_hey' | 'ch_vai' | 'ch_toma' | 'ch_go' | 'ch_ha' | 'ch_rvi' | 'ch_kill' | 'ch_blood';

export const CHANT_IDS: readonly ChantId[] = ['ch_hey', 'ch_vai', 'ch_toma', 'ch_go', 'ch_ha', 'ch_rvi', 'ch_kill', 'ch_blood'];
