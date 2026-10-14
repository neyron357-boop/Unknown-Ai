#!/usr/bin/env node
// Asks Gemini (audio understanding) to critique rendered clips. Quota-frugal:
// responses are cached on disk by (prompt + audio bytes); every real request is
// logged to .cache/audio/gemini/requests.log so the total stays visible.
// The API key is read from .env and never printed or written anywhere.
//
//   node scripts/audio/critique.mjs --tag drift1 --prompt-file prompt.txt .cache/audio/drift.mp3 [more.mp3]
//   options: --prompt "<text>"  --model gemini-3.5-flash  --force (ignore cache)
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(REPO, '.cache/audio/gemini');
mkdirSync(DIR, { recursive: true });

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUE_OPTS = ['--prompt', '--prompt-file', '--model', '--tag'];
const files = args.filter((a, i) => !a.startsWith('--') && !VALUE_OPTS.includes(args[i - 1]));
const prompt = opt('--prompt') ?? (opt('--prompt-file') ? readFileSync(opt('--prompt-file'), 'utf8') : null);
if (!prompt || !files.length) {
  console.error('usage: critique.mjs --prompt-file p.txt [--tag name] file.mp3 [...]');
  process.exit(1);
}
const MODELS = opt('--model') ? [opt('--model')] : ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];

function apiKey() {
  const env = readFileSync(join(REPO, '.env'), 'utf8');
  const m = env.match(/^GEMINI_API_KEY=(.*)$/m);
  const key = m?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  if (!key) throw new Error('GEMINI_API_KEY missing in .env');
  return key;
}

const audio = files.map((f) => readFileSync(f));
const hash = createHash('sha256').update(MODELS[0]).update(prompt);
for (const a of audio) hash.update(a);
const key = hash.digest('hex').slice(0, 24);
const cacheFile = join(DIR, `${key}.json`);
const tag = opt('--tag');

if (existsSync(cacheFile) && !args.includes('--force')) {
  const c = JSON.parse(readFileSync(cacheFile, 'utf8'));
  console.log(`[cached ${c.model}]\n${c.text}`);
  if (tag) writeFileSync(join(DIR, `${tag}.txt`), c.text);
  process.exit(0);
}

const parts = [];
for (const a of audio) parts.push({ inlineData: { mimeType: 'audio/mpeg', data: a.toString('base64') } });
parts.push({ text: prompt });
const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.4 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(model) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey() },
    body,
  });
  appendFileSync(join(DIR, 'requests.log'), `${new Date().toISOString()} ${model} ${res.status} ${tag ?? key}\n`);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

for (const model of MODELS) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { status, json } = await call(model);
    if (status === 200) {
      const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('\n').trim();
      writeFileSync(cacheFile, JSON.stringify({ model, prompt, files, text, at: new Date().toISOString() }, null, 1));
      if (tag) writeFileSync(join(DIR, `${tag}.txt`), text);
      console.log(`[${model}]\n${text}`);
      process.exit(0);
    }
    const msg = json.error?.message ?? JSON.stringify(json).slice(0, 400);
    console.error(`[${model}] HTTP ${status}: ${msg}`);
    if (status === 503 && attempt === 0) {
      console.error('model overloaded — retrying once in 25s…');
      await sleep(25000);
      continue;
    }
    if (status === 429) {
      const retry = JSON.stringify(json).match(/"retryDelay":\s*"(\d+)s"/);
      const wait = retry ? Number(retry[1]) : 30;
      if (attempt === 0 && wait <= 90) {
        console.error(`waiting ${wait}s then retrying once…`);
        await sleep((wait + 2) * 1000);
        continue;
      }
    }
    break; // next model
  }
}
process.exit(2);
