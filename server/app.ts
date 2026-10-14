import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DEBRIEF_MAX_CHARS } from '../shared/debrief';
import type { EpisodeSource } from '../shared/episode';
import { demoEpisode, episodeProfileSchema, type EpisodeModel } from './ai/episode';
import type { TextModel } from './ai/gemini';
import { msUntilQuotaReset, quotaDay } from './ai/geminiAudio';
import { buildDebriefPrompt, demoDebrief, isSafeDebrief, sanitizeLine } from './ai/mentor';
import { mentorRequestSchema } from './ai/schemas';
import { TtsQuotaError, type TtsModel } from './ai/tts';
import { createVoiceService, voiceRequestSchema } from './ai/voice';
import { createRateLimiter } from './rateLimit';

export interface AppOptions {
  /** Null → demo mode (pre-written lines). */
  model: TextModel | null;
  rateLimitPerMin?: number;
  /** Directory with the built client (served in production). */
  staticDir?: string;
  aiTimeoutMs?: number;
  trustProxy?: boolean;
  log?: (msg: string) => void;
  /** Gemini TTS for /api/ai/voice. Null/undefined → 503 {error:'demo'}. */
  tts?: TtsModel | null;
  /** Personalised pre-fight lines for /api/ai/episode. Null/undefined → demo lines from the static bank. */
  episodeModel?: EpisodeModel | null;
  /** Per-IP limit for /api/ai/voice (default 6/min). Cache hits are not counted. */
  voiceRateLimitPerMin?: number;
  /** Upstream TTS calls per server per day (protects the key; default 300). */
  voiceDailyLimit?: number;
  /** Disk cache for dynamic voice lines (default `.cache/voice-dyn` in the working directory). */
  voiceCacheDir?: string;
  /** HTTP response timeout for /api/ai/voice (default 11 s; the upstream call may finish later and is cached). */
  voiceTimeoutMs?: number;
  /** Hard cap for one upstream TTS call (default 45 s). */
  voiceUpstreamTimeoutMs?: number;
  /** Timeout for /api/ai/episode (default 7 s, below the client's 8 s). */
  episodeTimeoutMs?: number;
}

export type MentorSource = 'gemini' | 'demo' | 'fallback';

export function createApp(opts: AppOptions) {
  const app = express();
  const log = opts.log ?? ((m: string) => console.log(m));
  const limiter = createRateLimiter(opts.rateLimitPerMin ?? 12);
  const episodeLimiter = createRateLimiter(opts.rateLimitPerMin ?? 12);
  const voiceLimiter = createRateLimiter(opts.voiceRateLimitPerMin ?? 6);
  const timeoutMs = opts.aiTimeoutMs ?? 8000;
  const voice = opts.tts
    ? createVoiceService({
        tts: opts.tts,
        cacheDir: opts.voiceCacheDir ?? path.resolve('.cache', 'voice-dyn'),
        upstreamTimeoutMs: opts.voiceUpstreamTimeoutMs,
        log,
      })
    : null;
  const voiceDaily = { day: '', used: 0, limit: opts.voiceDailyLimit ?? 300 };

  app.disable('x-powered-by');
  if (opts.trustProxy) app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '16kb' }));

  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  api.get('/ai/status', (_req, res) => {
    res.json({
      mode: opts.model ? 'live' : 'demo',
      model: opts.model?.model ?? null,
      voice: opts.tts ? 'live' : 'demo',
      episode: opts.episodeModel ? 'live' : 'demo',
    });
  });

  api.post('/ai/mentor', async (req: Request, res: Response) => {
    const parsed = mentorRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')) });
      return;
    }
    const body = parsed.data;
    const demo = demoDebrief(body);

    if (!opts.model) {
      res.json({ text: demo, source: 'demo' satisfies MentorSource });
      return;
    }

    const key = req.ip ?? 'unknown';
    const gate = limiter.take(key);
    if (!gate.ok) {
      res.setHeader('Retry-After', String(gate.retryAfterSec));
      res.status(429).json({ text: demo, source: 'fallback' satisfies MentorSource, error: 'rate_limited' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const { system, prompt } = buildDebriefPrompt(body);
      const raw = await opts.model.generate({ system, prompt, signal: controller.signal });
      const text = sanitizeLine(raw, DEBRIEF_MAX_CHARS);
      // Empty, medical or profane output never reaches the player: ECHO falls back to the local line.
      const ok = isSafeDebrief(text);
      res.json({ text: ok ? text : demo, source: (ok ? 'gemini' : 'fallback') satisfies MentorSource });
    } catch (err) {
      log(`[ai] mentor failed: ${(err as Error).name}: ${(err as Error).message}`);
      res.json({ text: demo, source: 'fallback' satisfies MentorSource });
    } finally {
      clearTimeout(timer);
    }
  });

  /** Personalised pre-fight lines: VERDICT mocks the player's actual weaknesses. */
  api.post('/ai/episode', async (req: Request, res: Response) => {
    const parsed = episodeProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')) });
      return;
    }
    const profile = parsed.data;
    const demo = demoEpisode(profile);
    if (!opts.episodeModel) {
      res.json({ ...demo, source: 'demo' satisfies EpisodeSource });
      return;
    }
    const gate = episodeLimiter.take(req.ip ?? 'unknown');
    if (!gate.ok) {
      res.setHeader('Retry-After', String(gate.retryAfterSec));
      res.status(429).json({ ...demo, source: 'fallback' satisfies EpisodeSource, error: 'rate_limited', retryAfter: gate.retryAfterSec });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.episodeTimeoutMs ?? 7000);
    try {
      const lines = await opts.episodeModel.generate(profile, controller.signal);
      res.json({ ...lines, source: 'gemini' satisfies EpisodeSource });
    } catch (err) {
      log(`[ai] episode failed: ${(err as Error).name}: ${(err as Error).message}`);
      res.json({ ...demo, source: 'fallback' satisfies EpisodeSource });
    } finally {
      clearTimeout(timer);
    }
  });

  /** Dynamic voice line: { speaker, text ≤ 140 } → audio/wav, same voice + direction as the static bank. */
  api.post('/ai/voice', async (req: Request, res: Response) => {
    const parsed = voiceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')) });
      return;
    }
    if (!voice) {
      res.status(503).json({ error: 'demo' });
      return;
    }
    const sendWav = (wav: Buffer, source: 'cache' | 'gemini') => {
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('X-Voice-Source', source);
      res.send(wav);
    };
    const hit = await voice.cached(parsed.data);
    if (hit) {
      sendWav(hit, 'cache');
      return;
    }
    const gate = voiceLimiter.take(req.ip ?? 'unknown');
    if (!gate.ok) {
      res.setHeader('Retry-After', String(gate.retryAfterSec));
      res.status(429).json({ error: 'rate_limited', retryAfter: gate.retryAfterSec });
      return;
    }
    const day = quotaDay();
    if (voiceDaily.day !== day) Object.assign(voiceDaily, { day, used: 0 });
    if (voiceDaily.used >= voiceDaily.limit) {
      const retryAfter = Math.ceil(msUntilQuotaReset() / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'daily_limit', retryAfter });
      return;
    }
    voiceDaily.used++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), opts.voiceTimeoutMs ?? 11_000);
    });
    const job = voice.synth(parsed.data);
    job.catch(() => undefined); // may settle after the response; errors are handled below or dropped
    try {
      const out = await Promise.race([job, timeout]);
      if (out === 'timeout') {
        res.setHeader('Retry-After', '10');
        res.status(504).json({ error: 'timeout', retryAfter: 10 });
        return;
      }
      sendWav(out, 'gemini');
    } catch (err) {
      if (err instanceof TtsQuotaError) {
        res.setHeader('Retry-After', String(err.retryAfterSec));
        res.status(429).json({ error: 'quota', retryAfter: err.retryAfterSec });
        return;
      }
      log(`[ai] voice failed: ${(err as Error).name}: ${(err as Error).message}`);
      res.status(502).json({ error: 'upstream' });
    } finally {
      clearTimeout(timer);
    }
  });

  api.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use('/api', api);

  // Production: serve the built PWA.
  if (opts.staticDir && existsSync(opts.staticDir)) {
    const dir = opts.staticDir;
    app.use(
      express.static(dir, {
        index: false,
        setHeaders(res, filePath) {
          const base = path.basename(filePath);
          if (base === 'sw.js' || base.startsWith('workbox-') || base === 'manifest.webmanifest') {
            res.setHeader('Cache-Control', 'no-cache');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  // Malformed JSON and other errors: never leak stack traces.
  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) log(`[server] ${err.message}`);
    res.status(status).json({ error: status === 500 ? 'server_error' : 'bad_request' });
  });

  return app;
}
