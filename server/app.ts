import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { TextModel } from './ai/gemini';
import { buildDebriefPrompt, demoDebrief, sanitizeLine } from './ai/mentor';
import { mentorRequestSchema } from './ai/schemas';
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
}

export type MentorSource = 'gemini' | 'demo' | 'fallback';

export function createApp(opts: AppOptions) {
  const app = express();
  const log = opts.log ?? ((m: string) => console.log(m));
  const limiter = createRateLimiter(opts.rateLimitPerMin ?? 12);
  const timeoutMs = opts.aiTimeoutMs ?? 8000;

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
    res.json({ mode: opts.model ? 'live' : 'demo', model: opts.model?.model ?? null });
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
      const text = sanitizeLine(raw);
      res.json({ text: text || demo, source: (text ? 'gemini' : 'fallback') satisfies MentorSource });
    } catch (err) {
      log(`[ai] mentor failed: ${(err as Error).name}: ${(err as Error).message}`);
      res.json({ text: demo, source: 'fallback' satisfies MentorSource });
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
