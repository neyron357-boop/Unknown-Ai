import { voice } from '@/audio/bus';
import { fetchVoice, playEpisodeLine, type EpisodeResponse } from '@/voice/dynamic';
import type { VoicePriority } from '@/voice/VoiceManager';
import type { BattleDirector, BattleEvent } from '../core/battle';

export interface VoiceBindOptions {
  /** Personalised lines for this fight (null → the static bank only). */
  episode: EpisodeResponse | null;
  /** Fetch live TTS for the episode's key lines (Gemini via the server). */
  live: boolean;
  /** Text-only line on screen (a taunt that has no recording). */
  say: (text: { ru: string; en: string }, durMs: number) => void;
}

/**
 * Director voice cues → the voice bank, with VERDICT's personalised episode lines spliced in:
 * his entrance and the whisper are spoken live (Gemini TTS, fetched at the start of the run),
 * the taunts appear as his lines over a laugh.
 */
export function bindVoice(director: BattleDirector, opts: VoiceBindOptions): () => void {
  const ep = opts.episode;
  const fromGemini = !!ep && ep.source === 'gemini' && !ep.bankIds;
  // Two TTS calls per run at most, started now: the boss appears ~1.5 min in.
  const dyn: { bossIntro: ArrayBuffer | null; bossWhisper: ArrayBuffer | null } = { bossIntro: null, bossWhisper: null };
  if (ep && fromGemini && opts.live) {
    void fetchVoice('verdict', ep.bossIntro).then((a) => (dyn.bossIntro = a));
    void fetchVoice('verdict', ep.bossWhisper).then((a) => (dyn.bossWhisper = a));
  }
  let taunt = 0;

  const off = director.on((e: BattleEvent) => {
    if (e.type === 'voice') {
      const priority = Math.max(0, Math.min(3, e.priority)) as VoicePriority;
      if (e.cue === 'boss.intro' && ep) {
        void playEpisodeLine(voice, ep, 'bossIntro', { audio: dyn.bossIntro, priority: 3, interrupt: true });
        return;
      }
      if (e.cue === 'boss.miss' && ep && fromGemini && ep.bossTaunts.length) {
        const text = ep.bossTaunts[taunt++ % ep.bossTaunts.length];
        const h = voice.play('boss.laugh', { priority: 3 });
        opts.say({ ru: text, en: text }, Math.max(1800, h?.durMs ?? 0));
        return;
      }
      voice.play(e.cue, { priority });
      return;
    }
    if (e.type === 'anomaly' && e.kind === 'whisper') {
      if (ep) void playEpisodeLine(voice, ep, 'bossWhisper', { audio: dyn.bossWhisper, priority: 3 });
      else voice.play('boss.whisper', { priority: 3 });
    }
  });
  return () => {
    off();
    voice.stopAll();
  };
}
