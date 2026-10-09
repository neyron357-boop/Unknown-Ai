import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { createGeminiModel } from './ai/gemini';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const port = Number(process.env.PORT ?? 8787);
const apiKey = process.env.GEMINI_API_KEY?.trim();
const modelName = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
const rateLimitPerMin = Number(process.env.AI_RATE_LIMIT_PER_MIN ?? 12);

const model = apiKey ? createGeminiModel(apiKey, modelName) : null;

const app = createApp({
  model,
  rateLimitPerMin,
  staticDir: path.join(root, 'dist'),
  trustProxy: process.env.TRUST_PROXY === '1',
});

app.listen(port, () => {
  console.log(`UNKNOWN server on http://localhost:${port}`);
  console.log(model ? `AI: Gemini live (${modelName})` : 'AI: demo mode — set GEMINI_API_KEY in .env to enable Gemini');
});
