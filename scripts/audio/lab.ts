/**
 * Audio lab for the v3 engine: live section preview with a fake director,
 * SFX buttons, and `window.lab` hooks used by scripts/audio/render.mjs to
 * render WAVs offline (OfflineAudioContext) in headless Chromium.
 */
import { AudioEngineV3, audio3, type Stem } from '@/audio/v3/Engine';
import { SECTION_IDS, SFX_NAMES, type RenderPlanItem, type SectionId, type Sfx, type SfxOptions } from '@/audio/v3/types';
import { renderKit, type KitId } from '@/audio/v3/kit';
import { renderSfx } from '@/audio/v3/sfxlib';
import { generateBar } from '@/audio/v3/patterns';

// ---------------------------------------------------------------- WAV encoding

function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const ch = buffer.numberOfChannels;
  const n = buffer.length;
  const sr = buffer.sampleRate;
  const out = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(out);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return out;
}

function toB64(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

function measure(buffer: AudioBuffer) {
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      sum += d[i] * d[i];
    }
  }
  const rms = Math.sqrt(sum / (buffer.length * buffer.numberOfChannels));
  return { peak, rmsDb: 20 * Math.log10(rms + 1e-12), clipped };
}

// ---------------------------------------------------------------- render hooks

interface RenderResult {
  wav: string;
  seconds: number;
  renderMs: number;
  peak: number;
  rmsDb: number;
  clipped: number;
  stats: unknown;
}

async function renderPlan(plan: RenderPlanItem[], bpm: number, seed?: number, noChops = false, solo?: Stem[], dry = false): Promise<RenderResult> {
  const eng = new AudioEngineV3({ seed });
  eng.useFallbackChops = !noChops;
  if (labChants) eng.setChants(labChants);
  const t0 = performance.now();
  const buffer = await eng.render(plan, bpm, { solo, dry });
  const renderMs = performance.now() - t0;
  return { wav: toB64(encodeWav(buffer)), seconds: buffer.duration, renderMs, ...measure(buffer), stats: eng.lastRenderStats };
}

interface SfxCue {
  name: Sfx;
  /** ms */
  at: number;
  opts?: SfxOptions;
}

async function renderSfxSeq(cues: SfxCue[], seconds: number, seed?: number): Promise<RenderResult> {
  const sr = 48000;
  const off = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const eng = new AudioEngineV3({ context: off, seed });
  eng.setPrefs({ musicOn: true, sfxOn: true, voiceOn: true, musicVolume: 1, sfxVolume: 1, voiceVolume: 1, volumeLimit: 1 });
  eng.unlock();
  const t0 = performance.now();
  for (const c of cues) eng.sfx(c.name, { ...c.opts, at: c.at });
  const buffer = await off.startRendering();
  return { wav: toB64(encodeWav(buffer)), seconds, renderMs: performance.now() - t0, ...measure(buffer), stats: eng.stats() };
}

/** Renders SFX one after another with `gapSec` of silence between them; returns the cue times. */
async function renderSfxList(names: Sfx[], gapSec = 0.6, seed?: number): Promise<RenderResult & { cues: { name: Sfx; at: number }[] }> {
  const cues: { name: Sfx; at: number }[] = [];
  let t = 0.3;
  for (const name of names) {
    cues.push({ name, at: +t.toFixed(2) });
    const len = renderSfx(name, 48000, seed ?? 0x5eed1e5, 0)[0].length / 48000;
    t += len + gapSec;
  }
  const res = await renderSfxSeq(
    cues.map((c) => ({ name: c.name, at: c.at * 1000 })),
    t + 0.2,
    seed,
  );
  return { ...res, cues };
}

/** Raw DSP timing (no Web Audio): how long the one-shot renderers take. */
function timeRenderers(): Record<string, number> {
  const out: Record<string, number> = {};
  const kits: KitId[] = ['kick', 'snare', 'clap', 'hat0', 'crash', 'revCrash', 'impact', 'cowDirtyLo', 'cowDirtyHi', 'swell', 'vinyl', 'wind', 'rain', 'trainBed', 'vox_hey'];
  for (const k of kits) {
    const t = performance.now();
    renderKit(k, 48000, 1);
    out[`kit:${k}`] = +(performance.now() - t).toFixed(2);
  }
  let total = 0;
  for (const s of SFX_NAMES) {
    const t = performance.now();
    renderSfx(s, 48000, 1, 0);
    const dt = performance.now() - t;
    total += dt;
    out[`sfx:${s}`] = +dt.toFixed(2);
  }
  out['sfx:total'] = +total.toFixed(1);
  const t = performance.now();
  for (let i = 0; i < 200; i++) generateBar({ section: 'bossRage', bar: i, hype: 4, seed: 1 });
  out['patterns:200bars'] = +(performance.now() - t).toFixed(2);
  return out;
}

let labChants: Record<string, AudioBuffer> | null = null;

/** Loads chant WAVs (base64) as AudioBuffers for testing the TTS path. */
async function loadChants(map: Record<string, string>): Promise<string[]> {
  const ctx = new OfflineAudioContext(1, 1, 48000);
  const out: Record<string, AudioBuffer> = {};
  for (const [id, b64] of Object.entries(map)) {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    out[id] = await ctx.decodeAudioData(bin.buffer);
  }
  labChants = out;
  return Object.keys(out);
}

declare global {
  interface Window {
    lab: {
      renderPlan: typeof renderPlan;
      renderSfx: typeof renderSfxSeq;
      renderSfxList: typeof renderSfxList;
      timeRenderers: typeof timeRenderers;
      loadChants: typeof loadChants;
      ready: boolean;
    };
  }
}

window.lab = { renderPlan, renderSfx: renderSfxSeq, renderSfxList, timeRenderers, loadChants, ready: true };

// ---------------------------------------------------------------- live UI

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (s: string) => ($('log').textContent = s);
let raf = 0;
let t0 = 0;
let playing: SectionId | null = null;

function bpm(): number {
  return Number(($('bpm') as HTMLInputElement).value) || 130;
}

function play(id: SectionId): void {
  audio3.unlock();
  const now = () => performance.now() - t0;
  if (!playing) {
    t0 = performance.now();
    audio3.attachConductor();
    audio3.setSection(id, bpm(), 50);
    const loop = () => {
      audio3.pump(now());
      const s = audio3.stats();
      log(`state=${audio3.state} section=${playing} t=${(now() / 1000).toFixed(1)}s voices=${s.musicVoices} nodes≈${s.musicNodes} peak=${s.peakMusicNodes} sfx=${s.sfxActive}`);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  } else {
    const barMs = 240000 / bpm();
    const at = Math.ceil((now() + 150) / barMs) * barMs + 50;
    audio3.setSection(id, bpm(), at);
  }
  playing = id;
  document.querySelectorAll('#sections button').forEach((b) => b.classList.toggle('on', b.textContent === id));
}

for (const id of SECTION_IDS) {
  const b = document.createElement('button');
  b.textContent = id;
  b.onclick = () => play(id);
  $('sections').append(b);
}
for (const s of SFX_NAMES) {
  const b = document.createElement('button');
  b.textContent = s;
  b.onclick = () => {
    audio3.unlock();
    audio3.sfx(s, { pan: (Math.random() - 0.5) * 0.6 });
  };
  $('sfx').append(b);
}
for (const a of ['rain', 'wind', 'train', null] as const) {
  const b = document.createElement('button');
  b.textContent = a ?? 'none';
  b.onclick = () => {
    audio3.unlock();
    audio3.setAmbience(a);
  };
  $('amb').append(b);
}
$('unlock').onclick = () => audio3.unlock();
$('stop').onclick = () => {
  cancelAnimationFrame(raf);
  playing = null;
  audio3.detachConductor();
};
let slow = false;
$('slowmo').onclick = () => {
  slow = !slow;
  audio3.slowmo(slow, 400);
  $('slowmo').classList.toggle('on', slow);
};
$('duck').onclick = () => audio3.duck(0.6, 1500);
($('hype') as HTMLInputElement).oninput = (e) => audio3.setHype(Number((e.target as HTMLInputElement).value));
