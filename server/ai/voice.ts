import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { SPEAKERS, type Speaker } from '../../src/voice/lines';
import { EPISODE_LIMITS } from '../../shared/episode';
import { ttsPrompt } from './geminiAudio';
import type { TtsModel } from './tts';

/**
 * Dynamic (personalised) voice lines: speaker + short text → WAV, through the same voice
 * and delivery direction as the static bank. Results are cached on disk by content hash,
 * identical concurrent requests share one upstream call, and a slow upstream call keeps
 * running after the HTTP response timed out so that the client's retry hits the cache.
 */

const SPEAKER_IDS = Object.keys(SPEAKERS) as [Speaker, ...Speaker[]];

/** Plain speakable text: letters, digits, spaces and common punctuation only. */
export function cleanVoiceText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s.,!?…:;—–\-'"«»()]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const voiceRequestSchema = z.object({
  speaker: z.enum(SPEAKER_IDS),
  text: z.string().max(600).transform(cleanVoiceText).pipe(z.string().min(1).max(EPISODE_LIMITS.voiceText)),
});
export type VoiceRequest = z.infer<typeof voiceRequestSchema>;

export interface VoiceService {
  /** Cached audio or null (never calls upstream). */
  cached(req: VoiceRequest): Promise<Buffer | null>;
  /** Synthesises (or joins an identical in-flight request) and stores the result. */
  synth(req: VoiceRequest): Promise<Buffer>;
}

export function voicePrompt(req: VoiceRequest): { voice: string; prompt: string; key: string } {
  const sv = SPEAKERS[req.speaker];
  const prompt = ttsPrompt(sv.style, req.text);
  const key = createHash('sha256').update(JSON.stringify({ v: 1, voice: sv.voice, prompt })).digest('hex');
  return { voice: sv.voice, prompt, key };
}

export function createVoiceService(opts: { tts: TtsModel; cacheDir: string; upstreamTimeoutMs?: number; log?: (m: string) => void }): VoiceService {
  const inflight = new Map<string, Promise<Buffer>>();
  const upstreamTimeoutMs = opts.upstreamTimeoutMs ?? 45_000;
  const file = (key: string) => path.join(opts.cacheDir, key.slice(0, 2), `${key}.wav`);

  const store = async (key: string, wav: Buffer) => {
    try {
      const f = file(key);
      await mkdir(path.dirname(f), { recursive: true });
      const tmp = `${f}.${process.pid}.tmp`;
      await writeFile(tmp, wav);
      await rename(tmp, f);
    } catch (err) {
      opts.log?.(`[voice] cache write failed: ${(err as Error).message}`);
    }
  };

  return {
    async cached(req) {
      const { key } = voicePrompt(req);
      try {
        return await readFile(file(key));
      } catch {
        return null;
      }
    },
    synth(req) {
      const { voice, prompt, key } = voicePrompt(req);
      const existing = inflight.get(key);
      if (existing) return existing;
      const p = (async () => {
        const signal = AbortSignal.timeout(upstreamTimeoutMs);
        const wav = await opts.tts.synth({ voice, prompt, signal });
        await store(key, wav);
        return wav;
      })();
      inflight.set(key, p);
      p.then(
        () => inflight.delete(key),
        () => inflight.delete(key),
      );
      return p;
    },
  };
}
