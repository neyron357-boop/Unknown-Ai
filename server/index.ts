import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { createEpisodeModel, DEFAULT_EPISODE_MODELS } from './ai/episode';
import { createGeminiModel } from './ai/gemini';
import { createTtsModel, DEFAULT_TTS_MODELS } from './ai/tts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const list = (v: string | undefined, fallback: string[]) => {
  const items = (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
};

const port = Number(process.env.PORT ?? 8787);
const apiKey = process.env.GEMINI_API_KEY?.trim();
const modelName = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
const rateLimitPerMin = Number(process.env.AI_RATE_LIMIT_PER_MIN ?? 12);
const ttsModels = list(process.env.GEMINI_TTS_MODELS, DEFAULT_TTS_MODELS);
const episodeModels = list(process.env.GEMINI_EPISODE_MODELS, DEFAULT_EPISODE_MODELS);

const model = apiKey ? createGeminiModel(apiKey, modelName) : null;
const tts = apiKey ? createTtsModel(apiKey, ttsModels) : null;
const episodeModel = apiKey ? createEpisodeModel(apiKey, episodeModels) : null;

const app = createApp({
  model,
  tts,
  episodeModel,
  rateLimitPerMin,
  voiceRateLimitPerMin: Number(process.env.VOICE_RATE_LIMIT_PER_MIN ?? 6),
  voiceDailyLimit: Number(process.env.VOICE_DAILY_LIMIT ?? 300),
  voiceCacheDir: process.env.VOICE_CACHE_DIR?.trim() || path.join(root, '.cache', 'voice-dyn'),
  staticDir: path.join(root, 'dist'),
  trustProxy: process.env.TRUST_PROXY === '1',
});

app.listen(port, () => {
  console.log(`UNKNOWN server on http://localhost:${port}`);
  if (model) {
    console.log(`AI: Gemini live (${modelName}); episode: ${episodeModels.join(' → ')}; TTS: ${ttsModels.join(' → ')}`);
  } else {
    console.log('AI: demo mode — set GEMINI_API_KEY in .env to enable Gemini');
  }
});
