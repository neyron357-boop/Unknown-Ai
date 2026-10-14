/**
 * QA for the voice bank: blind transcription of generated clips with a Gemini text model
 * (several clips per request, JSON array out), plus a short description of each voice.
 */
import { readFile } from 'node:fs/promises';
import type { GeminiCaller } from './gemini';
import { sha256 } from './gemini';

export interface QaClip {
  id: string;
  file: string;
  mimeType: string;
}

export interface QaResult {
  transcript: string;
  voice: string;
  model: string;
}

const INSTRUCTIONS = (n: number) => `You are a meticulous audio transcriber and voice director.
You will receive ${n} short audio clips from a video game voice bank, each preceded by its label "Clip k".
For EACH clip:
1. "transcript": write exactly the words that are spoken, in the language spoken (Russian in Cyrillic, Portuguese in Latin script). Write numbers as words. Keep stutters and elongations with hyphens (e.g. "Р-р-раздавлю", "А-а-а"). For non-verbal sounds (screams, laughter, groans, roars) write them phonetically, e.g. "А-а-а!", "Ха-ха-ха". Do not guess what was meant: if extra words are spoken (for example instructions or numbers), include them. Empty string if the clip is silent.
2. "voice": at most 14 English words describing the voice: pitch (very low / low / medium / high), timbre and delivery.
Return a JSON array with exactly ${n} objects, in clip order: {"clip": k, "transcript": "...", "voice": "..."}.`;

const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { clip: { type: 'INTEGER' }, transcript: { type: 'STRING' }, voice: { type: 'STRING' } },
    required: ['clip', 'transcript', 'voice'],
  },
};

function responseText(json: unknown): string {
  const parts = (json as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
}

export async function transcribe(
  caller: GeminiCaller,
  models: string[],
  clips: QaClip[],
  log: (s: string) => void,
  perRequest = 8,
): Promise<Map<string, QaResult>> {
  const out = new Map<string, QaResult>();
  for (let i = 0; i < clips.length; i += perRequest) {
    const chunk = clips.slice(i, i + perRequest);
    const parts: unknown[] = [{ text: INSTRUCTIONS(chunk.length) }];
    const hashes: string[] = [];
    for (const [k, c] of chunk.entries()) {
      const bytes = await readFile(c.file);
      hashes.push(sha256(bytes));
      parts.push({ text: `Clip ${k + 1}:` }, { inlineData: { mimeType: c.mimeType, data: bytes.toString('base64') } });
    }
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
    };
    try {
      const { value, model, cached } = await caller.call({
        models,
        body,
        cacheId: { kind: 'qa', v: 1, prompt: sha256(INSTRUCTIONS(chunk.length)), audio: hashes },
        timeoutMs: 90_000,
        label: `qa ${chunk.map((c) => c.id).join(',')}`,
        accept: (json) => {
          const arr = JSON.parse(responseText(json)) as { clip?: number; transcript?: string; voice?: string }[];
          if (!Array.isArray(arr) || arr.length !== chunk.length) throw new Error(`expected ${chunk.length} transcripts, got ${Array.isArray(arr) ? arr.length : typeof arr}`);
          return arr;
        },
      });
      log(`[qa] ${chunk.length} clips via ${model}${cached ? ' (cache)' : ''}`);
      value.forEach((r, k) => {
        const idx = typeof r.clip === 'number' && r.clip >= 1 && r.clip <= chunk.length ? r.clip - 1 : k;
        out.set(chunk[idx].id, { transcript: String(r.transcript ?? ''), voice: String(r.voice ?? ''), model });
      });
    } catch (err) {
      log(`[qa] transcription failed for ${chunk.map((c) => c.id).join(',')}: ${(err as Error).message}`);
      if ((err as Error).name === 'QuotaExhaustedError') break;
    }
  }
  return out;
}

/** Lowercase, ё→е, no punctuation/spaces, hyphenated stutters joined and letter runs collapsed. */
export function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(\p{L})[-‐–—](?=\p{L})/gu, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .replace(/(\p{L})\1+/gu, '$1');
}

export function levenshtein(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[B.length];
}

export function similarity(expected: string, heard: string): number {
  const a = normalizeForCompare(expected);
  const b = normalizeForCompare(heard);
  if (!a && !b) return 1;
  const len = Math.max([...a].length, [...b].length);
  return len === 0 ? 1 : 1 - levenshtein(a, b) / len;
}

export const QA_PASS = 0.8;
/** Below this the clip is almost certainly wrong (other words, instructions read aloud…). */
export const QA_REJECT = 0.5;
