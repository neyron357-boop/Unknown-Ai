/**
 * Small, dependency-free helpers for Gemini audio responses and quota errors.
 * Shared by the server TTS model (`tts.ts`) and the offline voice-bank generator
 * (`scripts/voice/generate.ts`). Nothing here ever sees or logs the API key.
 */

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export function generateUrl(model: string): string {
  return `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`;
}

/** Request body for a single-speaker TTS call. */
export function ttsBody(voice: string, prompt: string): unknown {
  return {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  };
}

const clean = (s: string) => s.trim().replace(/[.:\s]+$/, '');

/**
 * Structured single-line TTS prompt (Gemini's "audio profile / director's notes / transcript"
 * layout). Only the transcript is spoken. A bare "<long English direction>: <line>" prompt
 * is NOT safe: with descriptive (non-imperative) styles the model reads the direction aloud.
 */
export function ttsPrompt(style: string, text: string, note?: string): string {
  return [
    '# AUDIO PROFILE',
    `${clean(style)}.`,
    '',
    "### DIRECTOR'S NOTES",
    ...(note ? [`${clean(note)}.`] : []),
    'Perform the transcript line once, fully in character.',
    'Only speak the transcript line: never read headings or notes aloud.',
    '',
    '#### TRANSCRIPT',
    text.trim(),
  ].join('\n');
}

/**
 * Several lines of one speaker in one request, separated by long silences (split later on
 * silence). Optional per-line delivery notes let lines with different styles share a request.
 */
export function ttsBatchPrompt(style: string, texts: string[], notes?: (string | undefined)[]): string {
  const out = [
    '# AUDIO PROFILE',
    `${clean(style)}.`,
    '',
    "### DIRECTOR'S NOTES",
    `The transcript holds ${texts.length} separate lines. Perform each one as its own take, in order, fully in character.`,
    'After every line leave two full seconds of complete silence before the next one.',
    'Only speak the transcript lines: never read headings, notes or numbers aloud.',
  ];
  if (notes?.some(Boolean)) {
    out.push('Delivery per line:');
    texts.forEach((t, i) => out.push(`- Line ${i + 1} («${t.trim()}»): ${notes[i] ? clean(notes[i]!) : 'as described above'}.`));
  }
  out.push('', '#### TRANSCRIPT', texts.map((t) => t.trim()).join('\n\n'));
  return out.join('\n');
}

export type QuotaScope = 'day' | 'minute' | 'other';

export interface GeminiErrorInfo {
  status: number;
  /** Set for 429 / RESOURCE_EXHAUSTED. */
  quota: QuotaScope | null;
  /** Advised retry delay, if the API gave one. */
  retryAfterMs: number | null;
  quotaId?: string;
  metric?: string;
  limit?: number;
  /** Short, key-free summary suitable for logs (never sent to clients). */
  summary: string;
}

interface RawViolation {
  quotaMetric?: string;
  quotaId?: string;
  quotaValue?: string | number;
}
interface RawDetail {
  '@type'?: string;
  violations?: RawViolation[];
  retryDelay?: string;
}

function parseDelay(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^([\d.]+)s$/.exec(s.trim());
  return m ? Math.round(parseFloat(m[1]) * 1000) : null;
}

/**
 * Classifies a Gemini error response. For 429s the body names the exhausted metric
 * (`...PerDay...` / `...PerMinute...`), its limit and an advised retry delay.
 */
export function parseGeminiError(status: number, bodyText: string): GeminiErrorInfo {
  let message = '';
  let details: RawDetail[] = [];
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string; details?: RawDetail[] } };
    message = j.error?.message ?? '';
    details = Array.isArray(j.error?.details) ? j.error!.details! : [];
  } catch {
    message = bodyText.slice(0, 300);
  }
  const violations = details.flatMap((d) => (Array.isArray(d.violations) ? d.violations : []));
  let retryAfterMs = details.map((d) => parseDelay(d.retryDelay)).find((v) => v !== null) ?? null;
  if (retryAfterMs === null) {
    const m = /retry in ([\d.]+)\s*s/i.exec(message);
    if (m) retryAfterMs = Math.round(parseFloat(m[1]) * 1000);
  }

  let quota: QuotaScope | null = null;
  let picked: RawViolation | undefined;
  if (status === 429 || /RESOURCE_EXHAUSTED/.test(bodyText)) {
    const ids = violations.map((v) => `${v.quotaId ?? ''} ${v.quotaMetric ?? ''}`);
    const dayIdx = ids.findIndex((s) => /per ?day|daily/i.test(s));
    const minIdx = ids.findIndex((s) => /per ?minute/i.test(s));
    const zero = violations.findIndex((v) => Number(v.quotaValue) === 0);
    if (zero >= 0) {
      // A limit of 0 means "not available on this tier": as good as exhausted for the day.
      quota = 'day';
      picked = violations[zero];
    } else if (dayIdx >= 0) {
      quota = 'day';
      picked = violations[dayIdx];
    } else if (minIdx >= 0) {
      quota = 'minute';
      picked = violations[minIdx];
    } else if (/per day|daily/i.test(message)) {
      quota = 'day';
    } else {
      quota = /per minute/i.test(message) ? 'minute' : 'other';
    }
  }
  const limit = picked?.quotaValue !== undefined ? Number(picked.quotaValue) : undefined;
  const parts = [`HTTP ${status}`];
  if (quota) parts.push(`quota=${quota}`);
  if (picked?.quotaId) parts.push(`id=${picked.quotaId}`);
  if (limit !== undefined && Number.isFinite(limit)) parts.push(`limit=${limit}`);
  if (retryAfterMs !== null) parts.push(`retry=${Math.round(retryAfterMs / 1000)}s`);
  if (!quota && message) parts.push(message.replace(/\s+/g, ' ').slice(0, 160));
  return {
    status,
    quota,
    retryAfterMs,
    quotaId: picked?.quotaId,
    metric: picked?.quotaMetric,
    limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
    summary: parts.join(' '),
  };
}

/** Pulls the first inline audio part out of a generateContent response. */
export function extractInlineAudio(json: unknown): { mimeType: string; data: Uint8Array } | null {
  const parts =
    (json as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] })
      ?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const d = p.inlineData;
    if (d?.data && typeof d.data === 'string') {
      return { mimeType: d.mimeType ?? 'application/octet-stream', data: Uint8Array.from(Buffer.from(d.data, 'base64')) };
    }
  }
  return null;
}

function isRiff(b: Uint8Array): boolean {
  return b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x41;
}

/** Builds a canonical 16-bit PCM WAV file around raw little-endian samples. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000, channels = 1): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/**
 * Normalises a TTS payload to a WAV file. Gemini answers either with a WAV
 * (`audio/wav`) or with raw PCM (`audio/L16;codec=pcm;rate=24000`).
 * Returns null for formats we don't know how to wrap (caller may still pass them to ffmpeg).
 */
export function toWav(data: Uint8Array, mimeType: string): Uint8Array | null {
  if (isRiff(data)) return data;
  const mt = mimeType.toLowerCase();
  if (mt.startsWith('audio/l16') || mt.startsWith('audio/pcm') || mt.includes('codec=pcm')) {
    const rate = Number(/rate=(\d+)/.exec(mt)?.[1] ?? 24000);
    const ch = Number(/channels=(\d+)/.exec(mt)?.[1] ?? 1);
    return pcmToWav(data, rate, ch);
  }
  return null;
}

/** Duration of a canonical PCM WAV in ms (walks the chunk list; 0 when unknown). */
export function wavDurationMs(wav: Uint8Array): number {
  if (!isRiff(wav)) return 0;
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= wav.length) {
    const id = String.fromCharCode(wav[off], wav[off + 1], wav[off + 2], wav[off + 3]);
    const size = v.getUint32(off + 4, true);
    if (id === 'fmt ') byteRate = v.getUint32(off + 16, true);
    if (id === 'data') {
      const len = Math.min(size, wav.length - off - 8);
      return byteRate ? Math.round((len / byteRate) * 1000) : 0;
    }
    off += 8 + size + (size & 1);
  }
  return 0;
}

/** Pacific-time calendar date: Gemini's per-day quotas reset at midnight PT. */
export function quotaDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Milliseconds until the next Pacific-time midnight (approximate, DST-safe enough for a cooldown). */
export function msUntilQuotaReset(now = new Date()): number {
  const day = quotaDay(now);
  for (let h = 1; h <= 26; h++) {
    const t = new Date(now.getTime() + h * 3_600_000);
    if (quotaDay(t) !== day) {
      // Narrow down to the minute.
      let lo = now.getTime() + (h - 1) * 3_600_000;
      let hi = t.getTime();
      while (hi - lo > 60_000) {
        const mid = (lo + hi) / 2;
        if (quotaDay(new Date(mid)) === day) lo = mid;
        else hi = mid;
      }
      return Math.max(60_000, hi - now.getTime());
    }
  }
  return 24 * 3_600_000;
}
