import { audio3 } from './v3/Engine';
import { VoiceManager, type VoiceSubtitle } from '@/voice/VoiceManager';

/**
 * The app's one sound system: the procedural music/SFX engine and the character voices routed
 * through its voice bus (so the voice volume setting, ducking and the master limiter apply).
 */
export { audio3 };

const subtitleListeners = new Set<(s: VoiceSubtitle) => void>();

export const voice = new VoiceManager({
  getContext: () => audio3.ctx as AudioContext | null,
  output: () => audio3.voiceInput,
  onSubtitle: (s) => subtitleListeners.forEach((l) => l(s)),
  duck: (amount, ms) => audio3.duck(amount, ms),
});

/** Subscribe to the subtitle of every line that starts playing. */
export function onSubtitle(listener: (s: VoiceSubtitle) => void): () => void {
  subtitleListeners.add(listener);
  return () => subtitleListeners.delete(listener);
}

/** Call from a user gesture: creates/resumes the AudioContext (iOS) and starts loading the voice bank. */
export function unlockAudio(): void {
  audio3.unlock();
  void voice.load();
}

// dev/e2e hook: the smoke test checks the context is created only by the first gesture
if (import.meta.env.DEV) Object.assign(window, { __UNKNOWN_AUDIO__: audio3 });
