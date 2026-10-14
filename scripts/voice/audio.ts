/**
 * ffmpeg helpers for the voice bank: silence detection / batch splitting,
 * trimming, loudness normalisation and MP3 (or AAC) encoding.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { wavDurationMs } from '../../server/ai/geminiAudio';

export const FFMPEG = process.env.FFMPEG ?? '/usr/bin/ffmpeg';

export function ffmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.split('\n').slice(-6).join(' | ')}`));
    });
  });
}

let encoderCache: { codec: 'mp3' | 'aac'; ext: 'mp3' | 'm4a' } | null = null;
/** libmp3lame when this ffmpeg has it, else AAC in .m4a. */
export async function pickEncoder(): Promise<{ codec: 'mp3' | 'aac'; ext: 'mp3' | 'm4a' }> {
  if (encoderCache) return encoderCache;
  const { stdout } = await ffmpeg(['-encoders']);
  encoderCache = /\blibmp3lame\b/.test(stdout) ? { codec: 'mp3', ext: 'mp3' } : { codec: 'aac', ext: 'm4a' };
  return encoderCache;
}

export interface Silence {
  start: number;
  end: number;
}

/** Runs silencedetect and returns silence intervals (seconds) plus the file duration. */
export async function detectSilences(file: string, noiseDb: number, minDur: number): Promise<{ silences: Silence[]; duration: number }> {
  const { stderr } = await ffmpeg(['-i', file, '-af', `silencedetect=n=${noiseDb}dB:d=${minDur}`, '-f', 'null', '-']);
  const silences: Silence[] = [];
  let open: number | null = null;
  for (const line of stderr.split('\n')) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    if (s) open = Math.max(0, parseFloat(s[1]));
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (e && open !== null) {
      silences.push({ start: open, end: parseFloat(e[1]) });
      open = null;
    }
  }
  const duration = wavDurationMs(new Uint8Array(await readFile(file))) / 1000;
  if (open !== null) silences.push({ start: open, end: duration });
  return { silences, duration };
}

export interface Segment {
  start: number;
  end: number;
}

export interface SplitResult {
  segments: Segment[] | null;
  /** Interior gaps found (seconds), longest first — for logs. */
  gaps: number[];
  method: string;
}

/**
 * Splits a batch recording of `n` lines on silence: gaps ≥ `minGap` must give exactly n
 * segments whose lengths loosely follow the text lengths. (When this fails the generator
 * falls back to ASR-aligned chunking, see `chunkOnSilence`.)
 */
export async function splitOnSilence(file: string, texts: string[], opts: { minGap?: number; noiseDb?: number } = {}): Promise<SplitResult> {
  const n = texts.length;
  const noiseDb = opts.noiseDb ?? -45;
  const minGap = opts.minGap ?? 1.0;
  const { silences, duration } = await detectSilences(file, noiseDb, 0.18);
  const eps = 0.02;
  const interior = silences.filter((s) => s.start > eps && s.end < duration - eps);
  const gaps = interior.map((s) => s.end - s.start).sort((a, b) => b - a);
  if (n === 1) return { segments: [{ start: 0, end: duration }], gaps, method: 'single' };

  const strict = interior.filter((s) => s.end - s.start >= minGap);
  if (strict.length !== n - 1) return { segments: null, gaps, method: `failed(${strict.length} gaps≥${minGap}s for ${n} lines)` };
  const segs: Segment[] = [];
  let cursor = 0;
  for (const c of strict) {
    segs.push({ start: cursor, end: c.start + 0.04 });
    cursor = Math.max(c.start + 0.04, c.end - 0.04);
  }
  segs.push({ start: cursor, end: duration });
  // Each segment's share of the speech time should loosely follow its share of the text.
  const weights = texts.map((t) => Math.max(4, t.replace(/[^\p{L}]/gu, '').length));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const lSum = segs.reduce((a, s) => a + s.end - s.start, 0);
  const ok = segs.every((s, i) => {
    const expect = (weights[i] / wSum) * lSum;
    const got = s.end - s.start;
    return got > 0.12 && got / expect < 3.2 && expect / got < 3.2;
  });
  return ok ? { segments: segs, gaps, method: `strict(gap≥${minGap}s)` } : { segments: null, gaps, method: 'failed(implausible lengths)' };
}

/**
 * Cuts a recording at every pause ≥ `minGap` (speech chunks, typically one phrase each).
 * Used for ASR alignment: chunks are transcribed and grouped back into lines.
 */
export async function chunkOnSilence(file: string, minGap = 0.28, noiseDb = -45, maxChunks = 40): Promise<Segment[]> {
  const { silences, duration } = await detectSilences(file, noiseDb, minGap);
  const eps = 0.02;
  let interior = silences.filter((s) => s.start > eps && s.end < duration - eps);
  if (interior.length > maxChunks - 1) {
    interior = [...interior]
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .slice(0, maxChunks - 1)
      .sort((a, b) => a.start - b.start);
  }
  const lead = silences.find((s) => s.start <= eps);
  const tail = silences.find((s) => s.end >= duration - eps && s.start > eps);
  const segs: Segment[] = [];
  let cursor = lead ? lead.end : 0;
  for (const g of interior) {
    segs.push({ start: Math.max(0, cursor - 0.03), end: g.start + 0.03 });
    cursor = g.end;
  }
  segs.push({ start: Math.max(0, cursor - 0.03), end: tail ? Math.min(duration, tail.start + 0.03) : duration });
  return segs.filter((s) => s.end - s.start > 0.08);
}

export async function extractWav(src: string, seg: Segment, out: string): Promise<void> {
  await ffmpeg(['-y', '-i', src, '-af', `atrim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)}`, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', '-map_metadata', '-1', '-fflags', '+bitexact', out]);
}

interface Loudness {
  i: number;
  tp: number;
  lra: number;
  thresh: number;
  offset: number;
}

async function measureLoudnorm(file: string): Promise<Loudness | null> {
  const { stderr } = await ffmpeg(['-i', file, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']);
  const m = /\{[\s\S]*"input_i"[\s\S]*?\}/.exec(stderr);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, string>;
    const v = { i: +j.input_i, tp: +j.input_tp, lra: +j.input_lra, thresh: +j.input_thresh, offset: +j.target_offset };
    return Object.values(v).every(Number.isFinite) && v.i > -60 ? v : null;
  } catch {
    return null;
  }
}

async function measureRms(file: string): Promise<{ rmsDb: number; peakDb: number } | null> {
  const { stderr } = await ffmpeg(['-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const mean = /mean_volume: (-?[\d.]+) dB/.exec(stderr);
  const max = /max_volume: (-?[\d.]+) dB/.exec(stderr);
  if (!mean || !max) return null;
  return { rmsDb: parseFloat(mean[1]), peakDb: parseFloat(max[1]) };
}

export interface ProcessResult {
  durMs: number;
  method: string;
}

/**
 * segment of `src` → trimmed (≈30 ms of silence kept at both ends) → loudness-normalised
 * (−16 LUFS, true peak −1.5 dB; RMS-based gain + limiter for clips too short for EBU R128)
 * → mono 24 kHz MP3 ~56 kbps (or AAC).
 */
export async function processClip(src: string, seg: Segment | null, tmpWav: string, outFile: string): Promise<ProcessResult> {
  const trim = 'silenceremove=start_periods=1:start_duration=0:start_threshold=-48dB:start_silence=0.03:detection=peak';
  const pre = [seg ? `atrim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},asetpts=PTS-STARTPTS` : null, trim, 'areverse', trim, 'areverse']
    .filter(Boolean)
    .join(',');
  await ffmpeg(['-y', '-i', src, '-af', pre, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', tmpWav]);
  const durMs = wavDurationMs(new Uint8Array(await readFile(tmpWav)));
  if (durMs < 60) throw new Error(`clip is empty after trimming (${durMs} ms)`);

  let af: string;
  let method: string;
  const ln = durMs >= 900 ? await measureLoudnorm(tmpWav) : null;
  if (ln) {
    af =
      `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${ln.i}:measured_TP=${ln.tp}:measured_LRA=${ln.lra}` +
      `:measured_thresh=${ln.thresh}:offset=${ln.offset}:linear=true,aresample=24000`;
    method = `loudnorm(in ${ln.i.toFixed(1)} LUFS)`;
  } else {
    const rms = await measureRms(tmpWav);
    if (!rms) throw new Error('volumedetect failed');
    // Short shouts: aim the RMS at the target, never push the peak above −1.5 dBFS by more than the limiter can absorb.
    const gain = Math.max(-20, Math.min(24, -16 - rms.rmsDb));
    af = `volume=${gain.toFixed(2)}dB,alimiter=limit=0.84:attack=2:release=40:level=false,aresample=24000`;
    method = `rms(${rms.rmsDb.toFixed(1)} dBFS, +${gain.toFixed(1)} dB)`;
  }
  const enc = await pickEncoder();
  const codecArgs =
    enc.codec === 'mp3'
      ? ['-c:a', 'libmp3lame', '-b:a', '56k', '-id3v2_version', '0', '-write_xing', '1']
      : ['-c:a', 'aac', '-b:a', '56k', '-movflags', '+faststart'];
  await ffmpeg(['-y', '-i', tmpWav, '-af', af, '-ac', '1', '-ar', '24000', '-map_metadata', '-1', ...codecArgs, outFile]);
  return { durMs, method };
}
