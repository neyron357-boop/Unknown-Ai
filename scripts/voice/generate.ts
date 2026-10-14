/**
 * Voice-bank generator: Gemini TTS → ffmpeg (trim, −16 LUFS, MP3 56 kbps / 24 kHz) → public/voice/.
 *
 *   npx tsx scripts/voice/generate.ts [--only id1,id2] [--force] [--variants]
 *        [--retake] [--batch N] [--no-qa] [--qa-only] [--max-requests N] [--dry-run] [--debug]
 *
 *   --only        comma list of line ids (variants as `g_charge1@Algieba`)
 *   --force       re-process lines that already exist (re-uses cached API audio — free)
 *   --retake      ask the API for a fresh take of the selected lines (costs requests)
 *   --variants    also make alt-voice variants for grunt.charge / grunt.death (SPEAKERS.grunt.alt)
 *   --batch N     max lines per TTS request (same speaker); 1 disables batching (default 6)
 *   --no-qa       skip transcription QA;  --qa-only: only run QA on existing files
 *   --max-requests N   stop after N TTS API requests (cache hits are free)
 *
 * Flow per batch: one TTS request → split on long silences → transcribe the clips (QA) →
 * if the split is wrong, cut at every pause, transcribe the chunks and align them to the
 * expected lines (ASR alignment, text quota only) → only lines that still fail get their own
 * TTS request. Every API response is cached under .cache/voice/ (see gemini.ts).
 * The key is read from .env (GEMINI_API_KEY) and never printed. See docs/voice.md.
 */
import { parse as parseEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES, SPEAKERS, type Speaker, type VoiceCue, type VoiceLine } from '../../src/voice/lines';
import { extractInlineAudio, toWav, ttsBatchPrompt, ttsBody, ttsPrompt, wavDurationMs } from '../../server/ai/geminiAudio';
import { chunkOnSilence, extractWav, ffmpeg, pickEncoder, processClip, splitOnSilence, type Segment } from './audio';
import { CallError, GeminiCaller, QuotaExhaustedError, sha256 } from './gemini';
import { QA_PASS, QA_REJECT, similarity, transcribe, type QaResult } from './qa';

// ------------------------------------------------------------------ config
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'public', 'voice');
const CACHE_DIR = path.join(ROOT, '.cache', 'voice');
const WORK_DIR = path.join(CACHE_DIR, 'work');
const REJECT_DIR = path.join(CACHE_DIR, 'rejected');
const STATE_FILE = path.join(CACHE_DIR, 'state.json');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');

const fileEnv: Record<string, string> = existsSync(path.join(ROOT, '.env')) ? parseEnv(readFileSync(path.join(ROOT, '.env'))) : {};
const env = (k: string): string | undefined => process.env[k]?.trim() || fileEnv[k]?.trim() || undefined;
const list = (v: string | undefined) =>
  v
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const TTS_MODELS = list(env('GEMINI_TTS_MODELS')) ?? [
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
];
const QA_MODELS = list(env('GEMINI_QA_MODELS')) ?? ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];

const VARIANT_CUES: VoiceCue[] = ['grunt.charge', 'grunt.death'];
const ECHO_HINTS: VoiceCue[] = ['echo.swipe', 'echo.beat', 'echo.brute', 'echo.dodger', 'echo.feint', 'echo.leaper', 'echo.crawler', 'echo.gunner', 'echo.duel', 'echo.exec'];
const CAMEOS: Speaker[] = ['cleaner', 'butcher', 'ronin', 'fox'];

/** Generation order when quota is tight. */
const PRIORITY: { name: string; test: (l: VoiceLine) => boolean }[] = [
  { name: 'narrator', test: (l) => l.speaker === 'narrator' },
  { name: 'verdict', test: (l) => l.speaker === 'verdict' },
  { name: 'echo hints', test: (l) => ECHO_HINTS.includes(l.cue) },
  { name: 'echo barks', test: (l) => l.speaker === 'echo' && !l.cue.startsWith('echo.result') },
  { name: 'cameos', test: (l) => CAMEOS.includes(l.speaker) },
  { name: 'grunts', test: (l) => l.speaker === 'grunt' },
  { name: 'chants', test: (l) => l.speaker === 'chant' },
  { name: 'echo results', test: (l) => l.cue.startsWith('echo.result') },
];

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
};
const ONLY = list(opt('only'));
const FORCE = flag('force');
const RETAKE = flag('retake');
const VARIANTS = flag('variants');
const BATCH = Math.max(1, Number(opt('batch') ?? 6));
const NO_QA = flag('no-qa');
const QA_ONLY = flag('qa-only');
const DRY = flag('dry-run');
const DEBUG = flag('debug');
const MAX_REQ = opt('max-requests') ? Number(opt('max-requests')) : Infinity;

const log = (s: string) => console.log(s);
const dbg = (s: string) => DEBUG && console.log(`  · ${s}`);

// ------------------------------------------------------------------ model of the bank
interface Job {
  id: string;
  line: VoiceLine;
  voice: string;
  group: number;
}

const styleOf = (j: Job) => SPEAKERS[j.line.speaker].style;

function allJobs(): Job[] {
  const jobs: Job[] = [];
  const groupOf = (l: VoiceLine) => {
    const g = PRIORITY.findIndex((p) => p.test(l));
    return g < 0 ? PRIORITY.length : g;
  };
  for (const l of LINES) jobs.push({ id: l.id, line: l, voice: SPEAKERS[l.speaker].voice, group: groupOf(l) });
  // Variants go last ("only if quota allows").
  for (const v of SPEAKERS.grunt.alt ?? []) {
    for (const l of LINES) {
      if (l.speaker === 'grunt' && VARIANT_CUES.includes(l.cue)) jobs.push({ id: `${l.id}@${v}`, line: l, voice: v, group: PRIORITY.length + 1 });
    }
  }
  return jobs;
}
const ALL = allJobs();
const jobById = new Map(ALL.map((j) => [j.id, j]));

/** Manifest key order: bank order, each line followed by its variants. */
function manifestOrder(): string[] {
  const ids: string[] = [];
  for (const l of LINES) {
    ids.push(l.id);
    if (l.speaker === 'grunt' && VARIANT_CUES.includes(l.cue)) for (const v of SPEAKERS.grunt.alt ?? []) ids.push(`${l.id}@${v}`);
  }
  return ids;
}

/** Same priority group + speaker + voice; plain-style lines first; balanced chunks of ≤ size. */
function makeBatches(jobs: Job[], size: number): Job[][] {
  const groups = new Map<string, Job[]>();
  for (const j of [...jobs].sort((a, b) => a.group - b.group)) {
    const k = `${j.group}|${j.line.speaker}|${j.voice}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(j);
  }
  const out: Job[][] = [];
  for (const g of groups.values()) {
    const list = [...g.filter((j) => !j.line.style), ...g.filter((j) => j.line.style)];
    const chunks = Math.ceil(list.length / size);
    const per = Math.ceil(list.length / chunks);
    for (let i = 0; i < list.length; i += per) out.push(list.slice(i, i + per));
  }
  return out.sort((a, b) => a[0].group - b[0].group);
}

// ------------------------------------------------------------------ state
interface QaRecord {
  sha: string;
  transcript: string;
  voice: string;
  sim: number;
  model: string;
}
interface LineState {
  take: number;
  model?: string;
  source?: string;
  sha?: string;
  durMs?: number;
  method?: string;
  qa?: QaRecord;
  regens?: number;
  status?: 'ok' | 'qa-warn' | 'rejected' | 'failed';
  error?: string;
}
interface State {
  lines: Record<string, LineState>;
  batchStats: { tried: number; strict: number; asr: number; partial: number; perLine: number };
}
interface ManifestEntry {
  file: string;
  durMs: number;
  speaker: Speaker;
  cue: VoiceCue;
}
interface Manifest {
  version: 1;
  generatedAt: string;
  lines: Record<string, ManifestEntry>;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await rename(tmp, file);
}

const state: State = await readJson<State>(STATE_FILE, { lines: {}, batchStats: { tried: 0, strict: 0, asr: 0, partial: 0, perLine: 0 } });
if (!state.batchStats || !('asr' in state.batchStats)) state.batchStats = { tried: 0, strict: 0, asr: 0, partial: 0, perLine: 0 };
const ls = (id: string): LineState => (state.lines[id] ??= { take: 1 });
const saveState = () => writeJson(STATE_FILE, state);

let ext = 'mp3';
let mime = 'audio/mpeg';
const outFile = (id: string) => path.join(OUT_DIR, `${id}.${ext}`);
const good = (id: string) => existsSync(outFile(id)) && (state.lines[id]?.status === 'ok' || state.lines[id]?.status === 'qa-warn');

async function fileSha(file: string): Promise<string> {
  return sha256(await readFile(file));
}

async function decodedDurationMs(file: string): Promise<number> {
  const tmp = path.join(WORK_DIR, `dur-${process.pid}.wav`);
  await ffmpeg(['-y', '-i', file, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', tmp]);
  const ms = wavDurationMs(new Uint8Array(await readFile(tmp)));
  await rm(tmp, { force: true });
  return ms;
}

async function writeManifest(): Promise<Manifest> {
  const prev = await readJson<Manifest | null>(MANIFEST, null);
  const lines: Record<string, ManifestEntry> = {};
  for (const id of manifestOrder()) {
    if (!good(id)) continue;
    const s = state.lines[id];
    const job = jobById.get(id)!;
    if (!s.durMs) s.durMs = await decodedDurationMs(outFile(id));
    lines[id] = { file: path.basename(outFile(id)), durMs: s.durMs, speaker: job.line.speaker, cue: job.line.cue };
  }
  const changed = !prev || JSON.stringify(prev.lines) !== JSON.stringify(lines);
  const manifest: Manifest = { version: 1, generatedAt: changed ? new Date().toISOString() : prev!.generatedAt, lines };
  if (changed) await writeJson(MANIFEST, manifest);
  return manifest;
}

// ------------------------------------------------------------------ API
const apiKey = env('GEMINI_API_KEY');
const caller = new GeminiCaller(apiKey ?? '', CACHE_DIR, log);
let ttsRequests = 0;

class BudgetError extends Error {}

function cacheIdFor(voice: string, prompt: string, take: number): unknown {
  return take > 1 ? { voice, prompt, take } : { voice, prompt };
}

async function synth(voice: string, prompt: string, take: number, label: string): Promise<{ wav: string; model: string; cached: boolean }> {
  const cacheId = cacheIdFor(voice, prompt, take);
  if (ttsRequests >= MAX_REQ || !apiKey) {
    // Over budget / no key: cached audio is still free.
    let hit = false;
    for (const m of TTS_MODELS) if (await caller.readCache(m, cacheId)) hit = true;
    if (!hit) throw new BudgetError(apiKey ? 'request budget exhausted' : 'no GEMINI_API_KEY and no cached audio');
  }
  const before = caller.requestsMade;
  const { value, model, cached } = await caller
    .call({
      models: TTS_MODELS,
      body: ttsBody(voice, prompt),
      cacheId,
      timeoutMs: 150_000,
      label,
      accept: (json) => {
        const a = extractInlineAudio(json);
        if (!a || a.data.length < 2000) throw new Error('no audio in response');
        return a;
      },
    })
    .finally(() => {
      ttsRequests += caller.requestsMade - before;
    });
  const name = sha256(JSON.stringify(cacheId)).slice(0, 16);
  const wavFile = path.join(WORK_DIR, `${name}.wav`);
  const wav = toWav(value.data, value.mimeType);
  if (wav) await writeFile(wavFile, wav);
  else {
    const raw = path.join(WORK_DIR, `${name}.raw`);
    await writeFile(raw, value.data);
    await ffmpeg(['-y', '-i', raw, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', wavFile]);
    await rm(raw, { force: true });
  }
  return { wav: wavFile, model, cached };
}

async function finishClip(job: Job, wav: string, seg: Segment | null, meta: { model: string; source: string; take: number }, dest = outFile(job.id)): Promise<void> {
  const tmp = path.join(WORK_DIR, `${job.id}.proc.wav`);
  const { durMs, method } = await processClip(wav, seg, tmp, dest);
  await rm(tmp, { force: true });
  if (dest === outFile(job.id)) {
    const s = ls(job.id);
    Object.assign(s, { take: meta.take, model: meta.model, source: meta.source, durMs, method, sha: await fileSha(dest), status: 'ok', error: undefined });
    if (s.qa && s.qa.sha !== s.sha) s.qa = undefined;
  }
  dbg(`${job.id}: ${durMs} ms, ${method}`);
}

/** Transcribes the current files of `ids` and stores the QA records. Returns false if QA is unavailable. */
async function qaFiles(ids: string[]): Promise<boolean> {
  if (NO_QA || !ids.length) return true;
  const res = await transcribe(
    caller,
    QA_MODELS,
    ids.map((id) => ({ id, file: outFile(id), mimeType: mime })),
    log,
  );
  for (const [id, r] of res) storeQa(id, r.transcript, r.voice, r.model);
  return res.size === ids.length;
}

function storeQa(id: string, transcript: string, voice: string, model: string): void {
  const s = ls(id);
  s.qa = { sha: s.sha ?? '', transcript, voice, sim: similarity(jobById.get(id)!.line.ru, transcript), model };
}

const passes = (id: string) => {
  const s = state.lines[id];
  const job = jobById.get(id)!;
  return !!s?.qa && (job.line.noSubtitle ? true : s.qa.sim >= QA_PASS);
};

/**
 * Groups transcribed chunks into the expected lines (each line = a contiguous run of ≥ 1 chunks)
 * maximising total similarity. Chunks may be skipped (small penalty) so that improvised or
 * repeated material between the real takes doesn't pollute a line.
 */
function alignChunks(transcripts: string[], expected: string[]): { groups: [number, number][]; sims: number[] } | null {
  const K = transcripts.length;
  const N = expected.length;
  if (K < N) return null;
  const SKIP = 0.03;
  type From = { k: number; j: number; line: boolean } | null;
  const best = Array.from({ length: K + 1 }, () => new Array<number>(N + 1).fill(-Infinity));
  const from: From[][] = Array.from({ length: K + 1 }, () => new Array<From>(N + 1).fill(null));
  best[0][0] = 0;
  for (let i = 0; i <= K; i++) {
    for (let j = 0; j <= N; j++) {
      const cur = best[i][j];
      if (cur === -Infinity) continue;
      if (i < K) {
        const v = cur - (transcripts[i].trim() ? SKIP : 0);
        if (v > best[i + 1][j]) {
          best[i + 1][j] = v;
          from[i + 1][j] = { k: i, j, line: false };
        }
      }
      if (j < N) {
        for (let e = i + 1; e <= K; e++) {
          const v = cur + similarity(expected[j], transcripts.slice(i, e).join(' '));
          if (v > best[e][j + 1]) {
            best[e][j + 1] = v;
            from[e][j + 1] = { k: i, j, line: true };
          }
        }
      }
    }
  }
  if (best[K][N] === -Infinity) return null;
  const groups: [number, number][] = [];
  let i = K;
  let j = N;
  while (i > 0 || j > 0) {
    const f = from[i][j];
    if (!f) return null;
    if (f.line) groups.unshift([f.k, i - 1]);
    i = f.k;
    j = f.j;
  }
  if (groups.length !== N) return null;
  return { groups, sims: groups.map(([a, b], n) => similarity(expected[n], transcripts.slice(a, b + 1).join(' '))) };
}

/** Cut at every pause, transcribe the chunks (one text request) and align them to the lines. */
async function asrSplit(wav: string, batch: Job[]): Promise<{ segments: Segment[]; transcripts: string[]; voices: string[]; sims: number[]; model: string } | null> {
  const chunks = await chunkOnSilence(wav);
  if (chunks.length < batch.length) return null;
  const tag = path.basename(wav, '.wav');
  const clips = [];
  for (const [i, c] of chunks.entries()) {
    const f = path.join(WORK_DIR, `${tag}.chunk${i}.wav`);
    await extractWav(wav, c, f);
    clips.push({ id: String(i), file: f, mimeType: 'audio/wav' });
  }
  const res: Map<string, QaResult> = await transcribe(caller, QA_MODELS, clips, log, 40);
  for (const c of clips) await rm(c.file, { force: true });
  if (res.size !== chunks.length) return null;
  const texts = chunks.map((_, i) => res.get(String(i))!.transcript);
  dbg(`asr chunks: ${texts.map((t, i) => `[${chunks[i].start.toFixed(1)}] ${t}`).join(' | ')}`);
  const al = alignChunks(
    texts,
    batch.map((j) => j.line.ru),
  );
  if (!al) return null;
  const model = res.get('0')!.model;
  return {
    segments: al.groups.map(([a, b]) => ({ start: chunks[a].start, end: chunks[b].end })),
    transcripts: al.groups.map(([a, b]) => texts.slice(a, b + 1).join(' ').trim()),
    voices: al.groups.map(([a, b]) => {
      // Description of the longest chunk of the line.
      let best = a;
      for (let k = a; k <= b; k++) if (chunks[k].end - chunks[k].start > chunks[best].end - chunks[best].start) best = k;
      return res.get(String(best))!.voice;
    }),
    sims: al.sims,
    model,
  };
}

async function generateSingle(job: Job, take: number): Promise<void> {
  const prompt = ttsPrompt(styleOf(job), job.line.ru, job.line.style);
  const r = await synth(job.voice, prompt, take, job.id);
  await finishClip(job, r.wav, null, { model: r.model, source: 'single', take });
  log(`  ✓ ${job.id} (single, ${r.model}${r.cached ? ', cache' : ''})`);
}

async function runOne(job: Job, take = 1): Promise<void> {
  try {
    await generateSingle(job, take);
  } catch (err) {
    if (err instanceof QuotaExhaustedError || err instanceof BudgetError) throw err;
    const s = ls(job.id);
    s.status = 'failed';
    s.error = (err as Error).message;
    await rm(outFile(job.id), { force: true });
    log(`  ✗ ${job.id}: ${(err as Error).message}`);
  }
}

async function generateBatch(batch: Job[]): Promise<void> {
  const texts = batch.map((j) => j.line.ru);
  const prompt = ttsBatchPrompt(styleOf(batch[0]), texts, batch.map((j) => j.line.style));
  const r = await synth(batch[0].voice, prompt, 1, `batch ${batch.map((j) => j.id).join(',')}`);
  const meta = { model: r.model, take: 1 };
  state.batchStats.tried++;
  const ok = new Set<string>();

  // 1) split on long silences, verify by transcription.
  const split = await splitOnSilence(r.wav, texts);
  dbg(`split: ${split.method}; gaps=${split.gaps.map((g) => g.toFixed(2)).join(' ')}`);
  let unverified = false;
  if (split.segments) {
    for (const [i, j] of batch.entries()) await finishClip(j, r.wav, split.segments[i], { ...meta, source: 'batch:strict' });
    const checked = await qaFiles(batch.map((j) => j.id));
    if (!checked) unverified = true;
    for (const j of batch) if (passes(j.id) || (!checked && !state.lines[j.id]?.qa)) ok.add(j.id);
    if (ok.size === batch.length) {
      state.batchStats.strict++;
      log(`  ✓ ${batch.map((j) => j.id).join(', ')} (1 request, ${r.model}${r.cached ? ', cache' : ''}, silence split${unverified ? ', QA unavailable' : ', QA ok'})`);
      return;
    }
    dbg(`strict split QA failed for: ${batch.filter((j) => !ok.has(j.id)).map((j) => j.id).join(', ')}`);
    ok.clear();
  }

  // 2) ASR alignment of pause-delimited chunks (costs one text request, no TTS).
  const asr = NO_QA ? null : await asrSplit(r.wav, batch);
  if (asr) {
    for (const [i, j] of batch.entries()) {
      // Screams / laughs / chants: any short vocalisation in its aligned slot will do.
      const heard = asr.transcripts[i].trim();
      const exemptOk = !!j.line.noSubtitle && heard.length > 0 && heard.split(/\s+/).length <= 4;
      if (asr.sims[i] >= QA_PASS || exemptOk) {
        await finishClip(j, r.wav, asr.segments[i], { ...meta, source: 'batch:asr' });
        storeQa(j.id, asr.transcripts[i], asr.voices[i], asr.model);
        ok.add(j.id);
      }
    }
    dbg(`asr alignment sims: ${asr.sims.map((s, i) => `${batch[i].id}=${s.toFixed(2)}`).join(' ')}`);
  }
  if (ok.size === batch.length) {
    state.batchStats.asr++;
    log(`  ✓ ${batch.map((j) => j.id).join(', ')} (1 request, ${r.model}${r.cached ? ', cache' : ''}, ASR-aligned)`);
    return;
  }
  // 3) whatever is still missing: one request per line.
  const rest = batch.filter((j) => !ok.has(j.id));
  if (ok.size) state.batchStats.partial++;
  else state.batchStats.perLine++;
  log(`  ~ batch kept ${ok.size}/${batch.length}; one request per line for: ${rest.map((j) => j.id).join(', ')}`);
  for (const j of rest) {
    ls(j.id).status = 'failed';
    await rm(outFile(j.id), { force: true });
  }
  for (const j of rest) await runOne(j, 1);
}

/** A refused batch (SAFETY) is retried as two halves — isolating the offending line costs fewer requests than going line by line. */
async function generateBatchSafe(batch: Job[]): Promise<void> {
  try {
    if (batch.length === 1) await runOne(batch[0], 1);
    else await generateBatch(batch);
  } catch (err) {
    if (err instanceof QuotaExhaustedError || err instanceof BudgetError) throw err;
    if (err instanceof CallError && err.blocked && batch.length > 2) {
      const mid = Math.ceil(batch.length / 2);
      log(`  ✗ ${(err as Error).message} → retrying as two smaller batches`);
      await generateBatchSafe(batch.slice(0, mid));
      await generateBatchSafe(batch.slice(mid));
      return;
    }
    log(`  ✗ batch failed (${(err as Error).message}) → one request per line`);
    for (const j of batch) await runOne(j, 1);
  }
}

// ------------------------------------------------------------------ QA (final pass)
interface QaOutcome {
  id: string;
  expected: string;
  heard: string;
  sim: number;
  exempt: boolean;
  voice: string;
}

async function finalQa(candidates: string[], allowRegen: boolean): Promise<QaOutcome[]> {
  const need: string[] = [];
  for (const id of candidates) {
    if (!good(id)) continue;
    const s = ls(id);
    s.sha = await fileSha(outFile(id));
    if (!s.qa || s.qa.sha !== s.sha) need.push(id);
  }
  if (need.length) {
    log(`\nQA: transcribing ${need.length} clip(s)…`);
    await qaFiles(need);
    await saveState();
  }

  if (allowRegen) {
    const bad = candidates.filter((id) => good(id) && state.lines[id]?.qa && !passes(id) && (state.lines[id].regens ?? 0) < 1);
    if (bad.length) log(`\nQA: ${bad.length} mismatch(es) → one fresh take each: ${bad.join(', ')}`);
    for (const id of bad) {
      const job = jobById.get(id)!;
      const s = ls(id);
      s.regens = (s.regens ?? 0) + 1;
      const take = s.source === 'single' ? (s.take ?? 1) + 1 : 1;
      try {
        const r = await synth(job.voice, ttsPrompt(styleOf(job), job.line.ru, job.line.style), take, `${id} retake`);
        const dest = path.join(WORK_DIR, `${id}.retake.${ext}`);
        await finishClip(job, r.wav, null, { model: r.model, source: 'single', take }, dest);
        const rr = await transcribe(caller, QA_MODELS, [{ id, file: dest, mimeType: mime }], log);
        const q = rr.get(id);
        const sim = q ? similarity(job.line.ru, q.transcript) : -1;
        if (q && sim > (s.qa?.sim ?? 0)) {
          await rename(dest, outFile(id));
          s.sha = await fileSha(outFile(id));
          s.durMs = await decodedDurationMs(outFile(id));
          Object.assign(s, { take, model: r.model, source: 'single', qa: { sha: s.sha, transcript: q.transcript, voice: q.voice, sim, model: q.model } });
          log(`  ✓ ${id}: retake reads better (${sim.toFixed(2)})`);
        } else {
          log(`  · ${id}: retake not better (${sim.toFixed(2)} vs ${(s.qa?.sim ?? 0).toFixed(2)}), keeping the original`);
          await rm(dest, { force: true });
        }
      } catch (err) {
        log(`  ✗ retake ${id}: ${(err as Error).message}`);
        if (err instanceof QuotaExhaustedError || err instanceof BudgetError) break;
      }
      await saveState();
    }
  }

  const outcomes: QaOutcome[] = [];
  for (const id of candidates) {
    const s = state.lines[id];
    if (!s?.qa || !good(id)) continue;
    const job = jobById.get(id)!;
    const exempt = !!job.line.noSubtitle;
    if (!exempt && s.qa.sim < QA_REJECT) {
      s.status = 'rejected';
      await mkdir(REJECT_DIR, { recursive: true });
      await rename(outFile(id), path.join(REJECT_DIR, path.basename(outFile(id))));
    } else s.status = !exempt && s.qa.sim < QA_PASS ? 'qa-warn' : 'ok';
    outcomes.push({ id, expected: job.line.ru, heard: s.qa.transcript, sim: s.qa.sim, exempt, voice: s.qa.voice });
  }
  await saveState();
  return outcomes;
}

// ------------------------------------------------------------------ main
async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(WORK_DIR, { recursive: true });
  const enc = await pickEncoder();
  ext = enc.ext;
  mime = enc.ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
  await caller.init();

  if (ONLY) {
    const unknown = ONLY.filter((id) => !jobById.has(id));
    if (unknown.length) log(`unknown ids ignored: ${unknown.join(', ')}`);
  }
  const jobs = ALL.filter((j) => (ONLY ? ONLY.includes(j.id) : j.group <= PRIORITY.length || VARIANTS));

  // Reconcile files on disk with the state (a crash between encode and manifest must not lose work).
  for (const j of ALL) {
    const s = state.lines[j.id];
    if (existsSync(outFile(j.id)) && !s?.status) Object.assign(ls(j.id), { status: 'ok', sha: await fileSha(outFile(j.id)) });
    if (s?.status === 'ok' && !existsSync(outFile(j.id))) s.status = undefined;
  }

  const todo = QA_ONLY ? [] : jobs.filter((j) => FORCE || RETAKE || !good(j.id));
  const batches = makeBatches(todo, RETAKE ? 1 : BATCH);
  log(`voice bank: ${LINES.length} lines (+${ALL.length - LINES.length} possible variants); to generate: ${todo.length} in ${batches.length} request(s)`);
  log(`TTS models: ${caller.available(TTS_MODELS).join(' → ') || '(none left today)'}; QA: ${QA_MODELS.join(' → ')}; output .${ext}`);
  if (DRY) {
    for (const b of batches) log(`  [${PRIORITY[b[0].group]?.name ?? 'variants'}] ${b[0].voice}: ${b.map((j) => j.id + (j.line.style ? '*' : '')).join(', ')}`);
    return;
  }

  let stopped: string | null = null;
  const generated: string[] = [];
  for (const b of batches) {
    if (stopped) break;
    // --force / --retake: keep the current clips until their replacement is ready.
    const backups = new Map<string, { file: string; state: LineState }>();
    for (const j of b) {
      if (!existsSync(outFile(j.id))) continue;
      const file = path.join(WORK_DIR, `${j.id}.bak.${ext}`);
      await copyFile(outFile(j.id), file);
      backups.set(j.id, { file, state: JSON.parse(JSON.stringify(state.lines[j.id] ?? { take: 1 })) as LineState });
    }
    log(`\n[${PRIORITY[b[0].group]?.name ?? 'variants'}] ${b[0].line.speaker}/${b[0].voice}: ${b.map((j) => j.id).join(', ')}`);
    try {
      if (b.length === 1) await runOne(b[0], RETAKE ? (state.lines[b[0].id]?.take ?? 1) + 1 : 1);
      else await generateBatchSafe(b);
    } catch (err) {
      if (err instanceof QuotaExhaustedError) stopped = 'TTS quota exhausted on every model for today';
      else if (err instanceof BudgetError) stopped = err.message;
      else throw err;
    }
    for (const j of b) {
      const bak = backups.get(j.id);
      if (bak && !good(j.id)) {
        await rename(bak.file, outFile(j.id));
        state.lines[j.id] = bak.state;
        log(`  ↺ ${j.id}: kept the previous clip`);
      } else if (bak) await rm(bak.file, { force: true });
      if (good(j.id) && !bak) generated.push(j.id);
      else if (good(j.id) && state.lines[j.id].sha !== bak?.state.sha) generated.push(j.id);
    }
    await saveState();
    await writeManifest();
  }
  if (stopped) log(`\n■ stopped: ${stopped}`);

  let outcomes: QaOutcome[] = [];
  if (!NO_QA && apiKey) {
    const scope = (ONLY ? jobs : ALL).map((j) => j.id).filter(good);
    outcomes = await finalQa(scope, !QA_ONLY && !stopped);
  }
  const manifest = await writeManifest();
  await saveState();
  await report(manifest, outcomes, generated, stopped);
}

async function report(manifest: Manifest, outcomes: QaOutcome[], generated: string[], stopped: string | null): Promise<void> {
  const bySpeaker = new Map<string, { have: number; total: number; missing: string[] }>();
  for (const l of LINES) {
    const e = bySpeaker.get(l.speaker) ?? { have: 0, total: 0, missing: [] };
    e.total++;
    if (manifest.lines[l.id]) e.have++;
    else e.missing.push(l.id);
    bySpeaker.set(l.speaker, e);
  }
  const variants = Object.keys(manifest.lines).filter((id) => id.includes('@'));
  log('\n================ voice bank');
  for (const [sp, e] of bySpeaker) log(`${sp.padEnd(9)} ${e.have}/${e.total}${e.missing.length ? `  missing: ${e.missing.join(', ')}` : ''}`);
  log(`variants  ${variants.length}/${ALL.length - LINES.length}`);
  log(`generated this run: ${generated.length}; TTS requests this run: ${ttsRequests}; all API requests: ${caller.requestsMade}; cache hits: ${caller.cacheHits}`);
  log(`batches (all runs): ${JSON.stringify(state.batchStats)}`);
  const failed = Object.entries(state.lines).filter(([, s]) => s.status === 'failed' || s.status === 'rejected');
  if (failed.length) log(`failed/rejected: ${failed.map(([id, s]) => `${id} (${s.status}: ${s.error ?? `qa ${s.qa?.sim.toFixed(2)}`})`).join('; ')}`);
  log(`quota (requests per UTC day): ${JSON.stringify(caller.usage())}`);
  if (outcomes.length) {
    const bad = outcomes.filter((o) => !o.exempt && o.sim < QA_PASS);
    log(`\nQA: ${outcomes.length} checked, ${bad.length} mismatch(es)`);
    for (const o of bad) log(`  ✗ ${o.id} (${o.sim.toFixed(2)}): expected «${o.expected}» heard «${o.heard}»`);
    if (DEBUG) for (const o of outcomes.filter((x) => x.exempt)) log(`  · ${o.id} (exempt): heard «${o.heard}»`);
    log('\nvoices:');
    for (const o of outcomes) {
      const sp = jobById.get(o.id)!.line.speaker;
      if (sp === 'verdict' || sp === 'narrator' || DEBUG) log(`  ${o.id.padEnd(12)} ${o.voice}`);
    }
  }
  await writeJson(path.join(CACHE_DIR, 'last-run.json'), {
    at: new Date().toISOString(),
    stopped,
    generated,
    ttsRequests,
    quota: caller.usage(),
    quotaEvents: caller.events,
    qa: outcomes,
  });
  for (const f of await readdir(WORK_DIR)) if (/\.(raw|tmp)$|\.chunk\d+\.wav$/.test(f)) await rm(path.join(WORK_DIR, f), { force: true });
}

main().catch((err) => {
  if (err instanceof CallError) console.error(`fatal: ${err.message}`);
  else console.error(err);
  process.exitCode = 1;
});
