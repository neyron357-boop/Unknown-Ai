/**
 * Client side of the dynamic voice features (server: POST /api/ai/episode, POST /api/ai/voice).
 * Both helpers resolve to null — quickly — in the single-file build (no server), when the
 * server is unreachable or in demo mode, and after a failure they back off for a while
 * instead of making the game wait on timeouts again.
 */
import type { EpisodeProfile, EpisodeResponse } from '../../shared/episode';
import type { Speaker } from './lines';
import type { PlayHandle, PlayOptions, VoiceManager } from './VoiceManager';

export type { EpisodeProfile, EpisodeResponse } from '../../shared/episode';

/** Single-file build hosted without the API server. */
const STATIC_BUILD = import.meta.env.VITE_TARGET === 'artifact';

const backoff = { episode: 0, voice: 0 };
const now = () => Date.now();

async function post(path: string, body: unknown, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function retryAfterMs(res: Response, fallbackSec: number): number {
  const h = Number(res.headers.get('Retry-After'));
  return (Number.isFinite(h) && h > 0 ? h : fallbackSec) * 1000;
}

function isEpisode(x: unknown): x is EpisodeResponse {
  const e = x as EpisodeResponse;
  return (
    !!e &&
    typeof e.title === 'string' &&
    typeof e.bossIntro === 'string' &&
    Array.isArray(e.bossTaunts) &&
    e.bossTaunts.every((t) => typeof t === 'string') &&
    typeof e.bossWhisper === 'string' &&
    typeof e.echoIntro === 'string'
  );
}

/**
 * Personalised pre-fight lines (VERDICT mocks the player's actual weaknesses). Only numbers and
 * enum values leave the device. Resolves to null when there is no server (use the static bank).
 * A rate-limited answer still carries usable demo lines (`source: 'fallback'`, with `bankIds`).
 */
export async function fetchEpisode(profile: EpisodeProfile, timeoutMs = 8000): Promise<EpisodeResponse | null> {
  if (STATIC_BUILD || now() < backoff.episode) return null;
  const res = await post('/api/ai/episode', profile, Math.min(timeoutMs, 8000));
  if (!res) {
    backoff.episode = now() + 60_000;
    return null;
  }
  if (res.status === 429) backoff.episode = now() + retryAfterMs(res, 30);
  if (!res.ok && res.status !== 429) {
    backoff.episode = now() + 30_000;
    return null;
  }
  const data = (await res.json().catch(() => null)) as unknown;
  return isEpisode(data) ? data : null;
}

/**
 * Speaks `text` (≤ 140 chars) in a character's voice via the server (Gemini TTS, cached there).
 * Returns WAV bytes for VoiceManager.playDynamic(), or null (no server / demo / quota / timeout).
 * Latency is several seconds: fetch ahead of time (e.g. during the pre-fight intro).
 */
export async function fetchVoice(speaker: Speaker, text: string, timeoutMs = 12000): Promise<ArrayBuffer | null> {
  if (STATIC_BUILD || now() < backoff.voice || !text.trim()) return null;
  const res = await post('/api/ai/voice', { speaker, text: text.slice(0, 140) }, Math.min(timeoutMs, 12000));
  if (!res) {
    backoff.voice = now() + 60_000;
    return null;
  }
  if (res.status === 503) {
    backoff.voice = now() + 10 * 60_000; // demo server (no key)
    return null;
  }
  if (res.status === 429 || res.status === 504) {
    backoff.voice = now() + Math.min(retryAfterMs(res, 20), 10 * 60_000);
    return null;
  }
  if (!res.ok || !/^audio\//.test(res.headers.get('Content-Type') ?? '')) return null;
  try {
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export type EpisodeField = 'bossIntro' | 'bossTaunts' | 'bossWhisper' | 'echoIntro';

/**
 * Plays one line of an episode: the pre-voiced bank clip when the line came from the bank
 * (`bankIds`), otherwise `audio` previously fetched with fetchVoice(). Falls back to a generic
 * bank cue so the moment is never silent.
 */
export async function playEpisodeLine(
  voice: VoiceManager,
  episode: EpisodeResponse,
  field: EpisodeField,
  opts: PlayOptions & { index?: number; audio?: ArrayBuffer | null } = {},
): Promise<PlayHandle | null> {
  const i = opts.index ?? 0;
  const bankId = field === 'bossTaunts' ? episode.bankIds?.bossTaunts[i] : episode.bankIds?.[field];
  if (bankId) return voice.playLine(bankId, opts);
  const text = field === 'bossTaunts' ? episode.bossTaunts[i] : episode[field];
  const speaker: Speaker = field === 'echoIntro' ? 'echo' : 'verdict';
  if (opts.audio && text) {
    const handle = await voice.playDynamic(speaker, opts.audio, { ru: text, en: text }, opts);
    if (handle) return handle;
  }
  const cue = field === 'bossIntro' ? 'boss.intro' : field === 'bossWhisper' ? 'boss.whisper' : field === 'bossTaunts' ? 'boss.miss' : null;
  return cue ? voice.play(cue, opts) : null;
}
