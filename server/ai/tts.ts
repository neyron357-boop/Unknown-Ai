/**
 * Server-side Gemini TTS (REST, no SDK) with model fallback.
 *
 * - 429 per-day quota → that model is parked until the next Pacific midnight and the next
 *   model is tried; 429 per-minute → parked for the advised delay (≤ 65 s), next model tried.
 * - 404 / 5xx → next model. Upstream bodies are never echoed (they may contain request details).
 * - When every model is parked, throws TtsQuotaError with the soonest retry time.
 * The API key only ever travels in the `x-goog-api-key` header.
 */
import { GeminiError } from './gemini';
import { extractInlineAudio, generateUrl, msUntilQuotaReset, parseGeminiError, toWav, ttsBody } from './geminiAudio';

export const DEFAULT_TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];

export interface TtsModel {
  readonly models: readonly string[];
  /** Returns a WAV file (24 kHz mono 16-bit PCM for current Gemini TTS models). */
  synth(input: { voice: string; prompt: string; signal?: AbortSignal }): Promise<Buffer>;
}

export class TtsQuotaError extends Error {
  constructor(readonly retryAfterSec: number) {
    super('TTS quota exhausted');
    this.name = 'TtsQuotaError';
  }
}

export function createTtsModel(apiKey: string, models: string[], fetchImpl: typeof fetch = fetch, now: () => number = Date.now): TtsModel {
  if (!models.length) throw new Error('createTtsModel: no models');
  const parkedUntil = new Map<string, number>();

  return {
    models,
    async synth({ voice, prompt, signal }) {
      let soonest = Infinity;
      let lastError: Error | null = null;
      for (const model of models) {
        const until = parkedUntil.get(model) ?? 0;
        if (until > now()) {
          soonest = Math.min(soonest, until);
          continue;
        }
        signal?.throwIfAborted();
        let res: Response;
        try {
          res = await fetchImpl(generateUrl(model), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(ttsBody(voice, prompt)),
            signal,
          });
        } catch (err) {
          if (signal?.aborted) throw err;
          lastError = new GeminiError(`TTS network error (${model})`);
          continue;
        }
        if (res.ok) {
          const json = (await res.json().catch(() => null)) as unknown;
          const audio = extractInlineAudio(json);
          const wav = audio ? toWav(audio.data, audio.mimeType) : null;
          if (wav && wav.length > 2000) return Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength);
          lastError = new GeminiError(`TTS returned no usable audio (${model})`);
          continue;
        }
        const info = parseGeminiError(res.status, await res.text().catch(() => ''));
        if (res.status === 429) {
          // A daily quota's advised delay points at the real reset; without one assume PT midnight.
          const wait =
            info.quota === 'day'
              ? info.retryAfterMs && info.retryAfterMs > 60_000
                ? info.retryAfterMs
                : msUntilQuotaReset(new Date(now()))
              : Math.min(65_000, Math.max(1000, info.retryAfterMs ?? 30_000));
          parkedUntil.set(model, now() + wait);
          soonest = Math.min(soonest, now() + wait);
          continue;
        }
        if (res.status === 404 || res.status >= 500) {
          if (res.status === 404) parkedUntil.set(model, now() + 3_600_000);
          lastError = new GeminiError(`Gemini TTS HTTP ${res.status}`, res.status);
          continue;
        }
        throw new GeminiError(`Gemini TTS HTTP ${res.status}`, res.status);
      }
      // Some model is only parked by quota: tell the client when to come back.
      if (soonest !== Infinity) throw new TtsQuotaError(Math.max(1, Math.ceil((soonest - now()) / 1000)));
      throw lastError ?? new GeminiError('No TTS model available');
    },
  };
}
