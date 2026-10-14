/**
 * Personalised pre-fight lines ("episode"): shared between the server (/api/ai/episode)
 * and the client (src/voice/dynamic.ts). The client sends only numbers and enum values.
 */
export type EnemyKind = 'grunt' | 'brute' | 'dodger' | 'feinter' | 'leaper' | 'crawler' | 'gunner';
export type TimingBias = 'early' | 'late' | 'centered';
export type Grade = 'S' | 'A' | 'B' | 'C';

export interface EpisodeProfile {
  lang: 'ru' | 'en';
  mode: 'spark' | 'flow' | 'calm';
  /** Finished runs so far (deaths included). */
  runs: number;
  lastGrade: Grade | null;
  /** Enemy type that hurt the player most. */
  weakestEnemy: EnemyKind | null;
  /** Where the player's cuts land relative to the beat. */
  timingBias: TimingBias | null;
  fooledByFeints: number;
  /** Execution (finisher line) accuracy, 0..1. */
  execAccuracy: number | null;
  bestCombo: number;
}

export interface EpisodeLines {
  /** Episode title, ≤ 40 chars. */
  title: string;
  /** VERDICT's entrance line, ≤ 140 chars (voiceable via /api/ai/voice). */
  bossIntro: string;
  /** Exactly 3 mid-fight taunts, each ≤ 70 chars. */
  bossTaunts: string[];
  /** Whisper aimed at the player behind the screen, ≤ 140 chars. */
  bossWhisper: string;
  /** ECHO's cold hint before the fight, ≤ 140 chars. */
  echoIntro: string;
}

export type EpisodeSource = 'gemini' | 'demo' | 'fallback';

export interface EpisodeResponse extends EpisodeLines {
  source: EpisodeSource;
  /**
   * Present when the lines come from the static voice bank (demo / fallback):
   * play them with VoiceManager.playLine(id) instead of fetching dynamic audio.
   */
  bankIds?: { bossIntro: string; bossTaunts: string[]; bossWhisper: string; echoIntro: string };
}

export const EPISODE_LIMITS = { title: 40, line: 140, taunt: 70, voiceText: 140 } as const;
