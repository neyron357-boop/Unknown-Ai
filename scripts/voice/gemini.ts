/**
 * Quota-frugal Gemini caller for the offline voice-bank generator.
 *
 * - Every successful response is cached on disk (`.cache/voice/…`), keyed by a sha256 of
 *   (model, request) — a re-run never pays twice. TTS lookups check every model in the
 *   fallback list, so a clip made yesterday by another model is still reused.
 * - 429 handling: per-day limit → the model is parked until the next Pacific midnight
 *   (persisted in `.cache/voice/quota.json`) and the next model is tried; per-minute limit →
 *   wait the advised delay (capped at 65 s) and retry. Learned RPM limits pace later calls.
 * - The API key is only ever placed in the `x-goog-api-key` header and scrubbed from any
 *   message that could reach the console.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateUrl, msUntilQuotaReset, parseGeminiError, quotaDay, type GeminiErrorInfo } from '../../server/ai/geminiAudio';

export class QuotaExhaustedError extends Error {
  constructor(readonly models: string[]) {
    super(`all models exhausted for today: ${models.join(', ')}`);
    this.name = 'QuotaExhaustedError';
  }
}

export class CallError extends Error {
  constructor(
    message: string,
    readonly info?: GeminiErrorInfo,
    /** True when the model refused the content (finishReason SAFETY / prompt blocked): retrying the same prompt is pointless. */
    readonly blocked = false,
  ) {
    super(message);
    this.name = 'CallError';
  }
}

interface ModelQuota {
  /** Epoch ms until which the per-day quota is used up (from the API's retry delay, else next PT midnight). */
  exhaustedUntil?: number;
  exhaustedDay?: string;
  rpmLimit?: number;
  rpdLimit?: number;
  requests?: Record<string, number>;
  events?: string[];
}

export interface QuotaEvent {
  at: string;
  model: string;
  scope: string;
  limit?: number;
  retryMs?: number | null;
  action: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Request counters are kept per UTC day: the API's advised delays show daily quotas resetting at 00:00 UTC. */
const utcDay = () => new Date().toISOString().slice(0, 10);

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface CallOptions<T> {
  /** Models in preference order. */
  models: string[];
  /** Builds the request body for a model (usually model-independent). */
  body: unknown;
  /** Stable identity of the request for the cache (model is added automatically). */
  cacheId: unknown;
  timeoutMs: number;
  /** Validates/extracts the payload; throw to reject a 200 response (it is retried, not cached). */
  accept: (json: unknown) => T;
  /** What gets stored on disk for a hit (defaults to the raw JSON). */
  label: string;
}

export class GeminiCaller {
  private quota: Record<string, ModelQuota> = {};
  private readonly quotaFile: string;
  private readonly recent = new Map<string, number[]>();
  private readonly unavailable = new Set<string>();
  readonly events: QuotaEvent[] = [];
  requestsMade = 0;
  cacheHits = 0;

  constructor(
    private readonly apiKey: string,
    private readonly cacheDir: string,
    private readonly log: (s: string) => void,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.quotaFile = path.join(cacheDir, 'quota.json');
  }

  async init(): Promise<void> {
    await mkdir(path.join(this.cacheDir, 'resp'), { recursive: true });
    if (existsSync(this.quotaFile)) {
      try {
        this.quota = JSON.parse(await readFile(this.quotaFile, 'utf8')) as Record<string, ModelQuota>;
      } catch {
        this.quota = {};
      }
    }
    for (const [m, q] of Object.entries(this.quota)) {
      if (this.isExhausted(m)) this.log(`[quota] ${m}: daily limit reached — skipped until ${new Date(q.exhaustedUntil!).toISOString()}`);
    }
  }

  private isExhausted(model: string): boolean {
    const q = this.quota[model];
    return !!q?.exhaustedUntil && q.exhaustedUntil > Date.now();
  }

  private scrub(s: string): string {
    return this.apiKey ? s.split(this.apiKey).join('***') : s;
  }

  private async saveQuota(): Promise<void> {
    const tmp = `${this.quotaFile}.tmp`;
    await writeFile(tmp, JSON.stringify(this.quota, null, 2));
    await rename(tmp, this.quotaFile);
  }

  private q(model: string): ModelQuota {
    return (this.quota[model] ??= {});
  }

  /** Models still usable today, in preference order. */
  available(models: string[]): string[] {
    return models.filter((m) => !this.unavailable.has(m) && !this.isExhausted(m));
  }

  usage(): Record<string, { today: number; rpmLimit?: number; rpdLimit?: number; exhausted: boolean }> {
    const today = utcDay();
    const out: Record<string, { today: number; rpmLimit?: number; rpdLimit?: number; exhausted: boolean }> = {};
    for (const [m, q] of Object.entries(this.quota)) {
      out[m] = { today: q.requests?.[today] ?? 0, rpmLimit: q.rpmLimit, rpdLimit: q.rpdLimit, exhausted: this.isExhausted(m) };
    }
    return out;
  }

  private event(model: string, info: GeminiErrorInfo, action: string): void {
    const e: QuotaEvent = { at: new Date().toISOString(), model, scope: info.quota ?? 'other', limit: info.limit, retryMs: info.retryAfterMs, action };
    this.events.push(e);
    const q = this.q(model);
    (q.events ??= []).push(`${e.at} ${info.summary} → ${action}`);
    if (q.events.length > 30) q.events.splice(0, q.events.length - 30);
    this.log(`[quota] ${model}: ${info.summary} → ${action}`);
  }

  private cachePath(hash: string, ext: string): string {
    return path.join(this.cacheDir, 'resp', hash.slice(0, 2), `${hash}.${ext}`);
  }

  keyFor(model: string, cacheId: unknown): string {
    return sha256(JSON.stringify({ model, id: cacheId }));
  }

  async readCache(model: string, cacheId: unknown): Promise<unknown | null> {
    const file = this.cachePath(this.keyFor(model, cacheId), 'json');
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return null;
    }
  }

  private async writeCache(model: string, cacheId: unknown, json: unknown, label: string): Promise<void> {
    const file = this.cachePath(this.keyFor(model, cacheId), 'json');
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify({ model, label, savedAt: new Date().toISOString(), response: json }));
    await rename(tmp, file);
  }

  /** Waits so that no more than the learned RPM limit is used within a rolling minute. */
  private async pace(model: string): Promise<void> {
    const rpm = this.quota[model]?.rpmLimit;
    const list = this.recent.get(model) ?? [];
    const now = Date.now();
    const recent = list.filter((t) => now - t < 60_000);
    this.recent.set(model, recent);
    if (rpm && recent.length >= rpm) {
      const wait = 60_000 - (now - recent[recent.length - rpm]) + 750;
      if (wait > 0) {
        this.log(`[pace] ${model}: ${recent.length}/${rpm} req in the last minute — waiting ${Math.ceil(wait / 1000)}s`);
        await sleep(wait);
      }
    }
  }

  private noteRequest(model: string): void {
    const list = this.recent.get(model) ?? [];
    list.push(Date.now());
    this.recent.set(model, list);
    const q = this.q(model);
    const today = utcDay();
    q.requests ??= {};
    q.requests[today] = (q.requests[today] ?? 0) + 1;
    // Keep only the last few days.
    const days = Object.keys(q.requests).sort();
    while (days.length > 7) delete q.requests[days.shift()!];
    this.requestsMade++;
  }

  /**
   * Calls generateContent with cache + model fallback. Returns the accepted payload,
   * the model that produced it and whether it came from the cache.
   */
  async call<T>(opts: CallOptions<T>): Promise<{ value: T; model: string; cached: boolean }> {
    for (const m of opts.models) {
      const hit = await this.readCache(m, opts.cacheId);
      if (hit) {
        try {
          const value = opts.accept((hit as { response: unknown }).response);
          this.cacheHits++;
          return { value, model: m, cached: true };
        } catch {
          /* corrupt cache entry: fall through and regenerate */
        }
      }
    }

    const minuteRetries = new Map<string, number>();
    const serverErrors = new Map<string, number>();
    const badPayloads = new Map<string, number>();
    const refusedBy = new Set<string>();
    let refusal: CallError | null = null;
    for (;;) {
      const model = this.available(opts.models).find((m) => !refusedBy.has(m));
      if (!model) {
        if (refusal) throw refusal;
        throw new QuotaExhaustedError(opts.models);
      }
      await this.pace(model);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
      let res: Response;
      try {
        this.noteRequest(model);
        res = await this.fetchImpl(generateUrl(model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify(opts.body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const n = (serverErrors.get(model) ?? 0) + 1;
        serverErrors.set(model, n);
        this.log(`[net] ${model}: ${this.scrub((err as Error).name)} ${this.scrub((err as Error).message)} (attempt ${n})`);
        if (n >= 3) {
          this.unavailable.add(model);
          this.log(`[net] ${model}: giving up on this model for this run`);
        } else await sleep(3000 * n);
        await this.saveQuota();
        continue;
      }
      let text: string;
      try {
        text = await res.text();
      } catch (err) {
        clearTimeout(timer);
        this.log(`[net] ${model}: body read failed: ${this.scrub((err as Error).message)}`);
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        try {
          const value = opts.accept(json);
          await this.writeCache(model, opts.cacheId, json, opts.label);
          await this.saveQuota();
          return { value, model, cached: false };
        } catch (err) {
          const n = (badPayloads.get(model) ?? 0) + 1;
          badPayloads.set(model, n);
          const j = json as { candidates?: { finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
          const finish = j?.candidates?.[0]?.finishReason ?? (j?.promptFeedback?.blockReason ? `blocked:${j.promptFeedback.blockReason}` : undefined);
          const blocked = !!finish && /SAFETY|BLOCK|PROHIBITED|RECITATION|blocked/i.test(finish);
          this.log(`[bad] ${model}: ${this.scrub((err as Error).message)} (finish=${finish ?? '?'}, attempt ${n})`);
          await this.saveQuota();
          if (blocked) {
            // Safety filters differ between models: give the next model one chance, then give up.
            refusal = new CallError(`${model} refused the content (${finish})`, undefined, true);
            refusedBy.add(model);
            if (refusedBy.size >= 2) throw refusal;
            continue;
          }
          if (n >= 2) throw new CallError(`unusable response from ${model}: ${(err as Error).message}`);
          await sleep(1500);
          continue;
        }
      }

      const info = parseGeminiError(res.status, this.scrub(text));
      if (res.status === 429) {
        if (info.quota === 'day') {
          const q = this.q(model);
          q.exhaustedDay = quotaDay();
          // The API's retry delay for a daily quota points at the actual reset; else assume PT midnight.
          q.exhaustedUntil = Date.now() + (info.retryAfterMs && info.retryAfterMs > 60_000 ? info.retryAfterMs + 30_000 : msUntilQuotaReset());
          if (info.limit !== undefined) q.rpdLimit = info.limit;
          const next = this.available(opts.models)[0];
          this.event(model, info, next ? `daily limit: switching to ${next}` : 'daily limit: no models left');
          await this.saveQuota();
          continue;
        }
        const q = this.q(model);
        if (info.quota === 'minute' && info.limit !== undefined && info.limit > 0) q.rpmLimit = info.limit;
        const n = (minuteRetries.get(model) ?? 0) + 1;
        minuteRetries.set(model, n);
        if (n > 4) {
          this.unavailable.add(model);
          this.event(model, info, 'still limited after 4 waits: skipping model for this run');
          await this.saveQuota();
          continue;
        }
        const wait = Math.min(65_000, Math.max(5_000, info.retryAfterMs ?? 20_000)) + 1000;
        this.event(model, info, `waiting ${Math.round(wait / 1000)}s (try ${n})`);
        await this.saveQuota();
        await sleep(wait);
        continue;
      }
      if (res.status === 404 || (res.status === 400 && /not (found|supported)|does not support|unsupported/i.test(text))) {
        this.unavailable.add(model);
        this.log(`[model] ${model}: ${info.summary} — unavailable, trying the next one`);
        await this.saveQuota();
        continue;
      }
      if (res.status >= 500) {
        const n = (serverErrors.get(model) ?? 0) + 1;
        serverErrors.set(model, n);
        this.log(`[server] ${model}: ${info.summary} (attempt ${n})`);
        if (n >= 3) this.unavailable.add(model);
        else await sleep(4000 * n);
        await this.saveQuota();
        continue;
      }
      await this.saveQuota();
      throw new CallError(`${model}: ${info.summary}`, info);
    }
  }
}
