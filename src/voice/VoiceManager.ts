/**
 * VoiceManager — plays the pre-generated voice bank (`public/voice/`, see scripts/voice) and
 * server-generated dynamic lines through cheap per-speaker FX (native Web Audio nodes only).
 *
 *   source(playbackRate) → [highpass] → [lowshelf] → [peaking] → [highshelf] → [parallel saturation]
 *     → envelope ─┬→ [StereoPanner] → voice bus ─→ limiter → volume → output
 *                 └→ reverb send → shared Convolver (hall | room, procedural IR, one per context) ↗
 *
 * Priorities: narrator / VERDICT / cameos 3, ECHO 2, grunts 1, chants 0.
 *  - Lines of priority ≥ 2 never overlap: a new one waits ≤ 1.2 s for the current one, else it is
 *    dropped — unless `interrupt` (the old one fades out in 80 ms).
 *  - Grunts may overlap each other (max 2) and are dropped while a priority-3 line plays.
 *  - Priority ≥ 2 lines duck the music (`duck(0.55, durMs)`) and raise subtitles.
 *
 * Robustness: missing manifest/files → silent no-op; works on iPhone Safari (callback-style
 * decodeAudioData fallback), in the single-file build (files resolved relative to the page) and
 * offline (Cache Storage copy, versioned by the manifest's `generatedAt`).
 */
import { LINE_BY_ID, type Speaker, type VoiceCue } from './lines';

export interface VoiceSubtitle {
  ru: string;
  en: string;
  speaker: Speaker;
  durMs: number;
  /** Manifest id (`v_miss2`, `g_charge1@Algieba`) or `dyn:<n>` for dynamic lines. */
  id: string;
}

export interface VoiceManagerOptions {
  getContext: () => AudioContext | null;
  /** Where the voice bus connects (e.g. the engine's master/limiter input). Defaults to ctx.destination. */
  output?: () => AudioNode | null;
  /** Folder with manifest.json and the clips. Default `${import.meta.env.BASE_URL}voice/`. */
  baseUrl?: string;
  onSubtitle?: (s: VoiceSubtitle) => void;
  /**
   * Called when a priority ≥ 2 line starts: dip the music by `amount` (0 = none, 1 = silence,
   * i.e. music gain × (1 − amount)) for `ms`, then release.
   */
  duck?: (amount: number, ms: number) => void;
  /** Download (not decode) every clip in the background after the priority set. Default true. */
  prefetchAll?: boolean;
  /** Cache Storage prefix for offline play; null disables. Default 'unknown-voice'. */
  cacheName?: string | null;
}

export type VoicePriority = 0 | 1 | 2 | 3;

export interface PlayOptions {
  priority?: VoicePriority;
  delayMs?: number;
  /** Fade out (80 ms) whatever priority ≥ 2 line is playing or queued and start now. */
  interrupt?: boolean;
}

export interface PlayHandle {
  id: string;
  /** Duration as heard (after the speaker's playback-rate change). */
  durMs: number;
}

export interface FxProfile {
  /** Playback rate (pitch + tempo); a [min, max] range is randomised per play. */
  rate: number | [number, number];
  gainDb?: number;
  highpass?: number;
  lowshelf?: { freq: number; gain: number };
  peaking?: { freq: number; q: number; gain: number };
  highshelf?: { freq: number; gain: number };
  /** 0..1 — parallel tanh saturation. */
  saturation?: number;
  reverb?: { send: number; space: 'hall' | 'room' };
  pan?: { mode: 'alternate' | 'random'; amount: number };
}

/** Starting profiles; tweak freely (they are read on every play). */
export const VOICE_FX: Record<Speaker, FxProfile> = {
  verdict: {
    rate: 0.86,
    gainDb: -3,
    highpass: 38,
    lowshelf: { freq: 140, gain: 9 },
    peaking: { freq: 2600, q: 0.9, gain: 2 },
    saturation: 0.35,
    reverb: { send: 0.35, space: 'hall' },
  },
  // Tuned by ear-proxy (audio model): 0.94 / +6 dB read as merely "low"; 0.9 / +7 dB reads "very low, menacing", still intelligible.
  narrator: { rate: 0.9, highpass: 38, lowshelf: { freq: 140, gain: 7 }, peaking: { freq: 3000, q: 0.9, gain: 1.5 }, reverb: { send: 0.25, space: 'hall' } },
  echo: { rate: 1, highpass: 180, highshelf: { freq: 5000, gain: 3 }, reverb: { send: 0.15, space: 'room' }, pan: { mode: 'alternate', amount: 0.2 } },
  cleaner: { rate: 0.92, gainDb: -2, lowshelf: { freq: 150, gain: 6 }, reverb: { send: 0.06, space: 'room' } },
  butcher: { rate: 0.97, saturation: 0.5, reverb: { send: 0.1, space: 'room' } },
  ronin: { rate: 0.9, gainDb: -2, lowshelf: { freq: 140, gain: 7 }, reverb: { send: 0.2, space: 'hall' } },
  fox: { rate: 0.97, reverb: { send: 0.05, space: 'room' } },
  grunt: { rate: [0.85, 1.05], saturation: 0.25, reverb: { send: 0.08, space: 'room' }, pan: { mode: 'random', amount: 0.5 } },
  chant: { rate: 1 },
};

export const DEFAULT_PRIORITY: Record<Speaker, VoicePriority> = {
  narrator: 3,
  verdict: 3,
  cleaner: 3,
  butcher: 3,
  ronin: 3,
  fox: 3,
  echo: 2,
  grunt: 1,
  chant: 0,
};

/** Decoded in the background right after load(). */
const PRIORITY_CUES = new Set<string>(['boss.intro', 'echo.swipe', 'echo.beat', 'echo.brute', 'echo.dodger', 'echo.feint', 'echo.leaper', 'echo.crawler', 'echo.gunner', 'echo.duel', 'echo.exec']);

const MAX_WAIT_S = 1.2;
const QUEUE_GAP_S = 0.08;
const LAZY_WINDOW_S = 0.3;
const FADE_S = 0.08;
const DUCK_AMOUNT = 0.55;
const MAX_GRUNTS = 2;
const MAX_CHANTS = 4;
/** RMS (dBFS, gated) the static bank sits at after −16 LUFS normalisation; dynamic lines are matched to it. */
const BANK_RMS_DB = -19;

interface ManifestEntry {
  file: string;
  durMs: number;
  speaker: Speaker;
  cue: VoiceCue;
}
interface Manifest {
  version: number;
  generatedAt: string;
  lines: Record<string, ManifestEntry>;
}

interface Entry {
  id: string;
  base: string;
  speaker: Speaker;
  cue: VoiceCue;
  url: string;
  durMs: number;
  bytes?: Promise<ArrayBuffer | null>;
  buffer?: AudioBuffer;
  decoding?: Promise<AudioBuffer | null>;
  broken?: boolean;
}

interface Voice {
  id: string;
  speaker: Speaker;
  priority: VoicePriority;
  ctx: AudioContext;
  start: number;
  end: number;
  rate: number;
  pan: number;
  gain: number;
  text: { ru: string; en: string } | null;
  src?: AudioBufferSourceNode;
  env?: GainNode;
  nodes: AudioNode[];
  timers: ReturnType<typeof setTimeout>[];
  cancelled: boolean;
}

interface Bus {
  input: GainNode;
  limiter: DynamicsCompressorNode;
  volume: GainNode;
  out: AudioNode | null;
  hall?: ConvolverNode;
  room?: ConvolverNode;
}

const dbToGain = (db: number) => Math.pow(10, db / 20);

export class VoiceManager {
  private readonly base: string;
  private readonly entries = new Map<string, Entry>();
  private readonly byCue = new Map<string, string[]>();
  private readonly bags = new Map<string, string[]>();
  private readonly lastPick = new Map<string, string>();
  private readonly buses = new Map<AudioContext, Bus>();
  private readonly curves = new Map<number, Float32Array<ArrayBuffer>>();
  private active: Voice[] = [];
  private loading: Promise<void> | null = null;
  private version = '';
  private enabled = true;
  private volume = 1;
  private echoSide = 1;
  private dynCount = 0;
  private offline: OfflineAudioContext | null = null;
  private cacheStore: Promise<Cache | null> | null = null;

  constructor(private readonly opts: VoiceManagerOptions) {
    const b = opts.baseUrl ?? `${import.meta.env.BASE_URL ?? '/'}voice/`;
    this.base = b.endsWith('/') ? b : `${b}/`;
  }

  // ------------------------------------------------------------------ loading

  /** Fetches the manifest, then decodes the priority set in the background. Never rejects. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const manifest = await this.fetchManifest();
        if (!manifest) return;
        this.index(manifest);
        void this.background();
      } catch {
        /* no voice bank: every call becomes a no-op */
      }
    })();
    return this.loading;
  }

  private index(m: Manifest): void {
    this.version = String(m.generatedAt ?? '').replace(/[^0-9A-Za-z]/g, '');
    for (const [id, e] of Object.entries(m.lines ?? {})) {
      if (!e || typeof e.file !== 'string' || !e.cue || !(e.speaker in DEFAULT_PRIORITY)) continue;
      const base = id.split('@')[0];
      this.entries.set(id, { id, base, speaker: e.speaker, cue: e.cue, url: this.base + e.file, durMs: Number(e.durMs) || 0 });
      const list = this.byCue.get(e.cue) ?? [];
      list.push(id);
      this.byCue.set(e.cue, list);
    }
  }

  private async background(): Promise<void> {
    const all = [...this.entries.values()];
    const first = all.filter((e) => e.speaker === 'narrator' || PRIORITY_CUES.has(e.cue));
    for (const e of first) {
      await this.ensureDecoded(e);
      await new Promise((r) => setTimeout(r, 0));
    }
    if (this.opts.prefetchAll === false) return;
    for (const e of all) if (!first.includes(e)) await this.fetchBytes(e);
  }

  private async fetchManifest(): Promise<Manifest | null> {
    const url = this.base + 'manifest.json';
    let text: string | null = null;
    try {
      const res = await fetchWithTimeout(url, 6000, { cache: 'no-cache' });
      if (res.ok) text = await res.text();
    } catch {
      /* offline */
    }
    const store = await this.cache('manifest');
    if (text && store) store.put(url, new Response(text, { headers: { 'Content-Type': 'application/json' } })).catch(() => undefined);
    if (!text && store) {
      const hit = await store.match(url).catch(() => undefined);
      if (hit) text = await hit.text();
    }
    if (!text) return null;
    try {
      const m = JSON.parse(text) as Manifest;
      if (!m || typeof m.lines !== 'object') return null;
      if (store) void this.pruneCaches(String(m.generatedAt ?? '').replace(/[^0-9A-Za-z]/g, ''));
      return m;
    } catch {
      return null;
    }
  }

  /** Cache Storage (offline PWA). Null when unavailable (http, sandboxed iframe, private mode…). */
  private cache(kind: 'manifest' | 'audio'): Promise<Cache | null> {
    const prefix = this.opts.cacheName === undefined ? 'unknown-voice' : this.opts.cacheName;
    if (!prefix || typeof caches === 'undefined') return Promise.resolve(null);
    if (kind === 'manifest') return caches.open(`${prefix}-manifest`).catch(() => null);
    this.cacheStore ??= caches.open(`${prefix}-${this.version || 'v0'}`).catch(() => null);
    return this.cacheStore;
  }

  private async pruneCaches(current: string): Promise<void> {
    const prefix = this.opts.cacheName === undefined ? 'unknown-voice' : this.opts.cacheName;
    if (!prefix || typeof caches === 'undefined') return;
    try {
      for (const name of await caches.keys()) {
        if (name.startsWith(`${prefix}-`) && name !== `${prefix}-manifest` && name !== `${prefix}-${current}`) await caches.delete(name);
      }
    } catch {
      /* ignore */
    }
  }

  private fetchBytes(e: Entry): Promise<ArrayBuffer | null> {
    e.bytes ??= (async () => {
      const store = await this.cache('audio');
      try {
        const hit = store ? await store.match(e.url) : undefined;
        if (hit) return await hit.arrayBuffer();
      } catch {
        /* fall through to the network */
      }
      try {
        const res = await fetchWithTimeout(e.url, 15000, { cache: 'no-cache' });
        if (!res.ok) return null;
        if (store) store.put(e.url, res.clone()).catch(() => undefined);
        return await res.arrayBuffer();
      } catch {
        return null;
      }
    })().then((b) => {
      if (!b) e.bytes = undefined; // allow a later retry (e.g. back online)
      return b;
    });
    return e.bytes;
  }

  private decodeContext(): BaseAudioContext | null {
    const ctx = this.opts.getContext();
    if (ctx && ctx.state !== 'closed') return ctx;
    if (!this.offline) {
      const OAC =
        globalThis.OfflineAudioContext ?? (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
      try {
        if (OAC) this.offline = new OAC(1, 1, 48000);
      } catch {
        this.offline = null;
      }
    }
    return this.offline;
  }

  private decode(bytes: ArrayBuffer): Promise<{ buffer: AudioBuffer; ctx: BaseAudioContext }> {
    const ctx = this.decodeContext();
    if (!ctx) return Promise.reject(new Error('no audio context'));
    const copy = bytes.slice(0); // decodeAudioData detaches its input
    return new Promise((resolve, reject) => {
      let done = false;
      const ok = (buffer: AudioBuffer) => {
        if (!done) {
          done = true;
          resolve({ buffer, ctx });
        }
      };
      const fail = (err: unknown) => {
        if (!done) {
          done = true;
          reject(err instanceof Error ? err : new Error('decode failed'));
        }
      };
      try {
        // Old Safari only supports the callback form and returns undefined.
        const p = ctx.decodeAudioData(copy, ok, fail) as Promise<AudioBuffer> | undefined;
        if (p && typeof p.then === 'function') p.then(ok, fail);
      } catch (err) {
        fail(err);
      }
    });
  }

  private ensureDecoded(e: Entry): Promise<AudioBuffer | null> {
    if (e.buffer) return Promise.resolve(e.buffer);
    if (e.broken) return Promise.resolve(null);
    e.decoding ??= (async () => {
      const bytes = await this.fetchBytes(e);
      if (!bytes) return null;
      if (!this.decodeContext()) return null;
      try {
        const { buffer, ctx } = await this.decode(bytes);
        e.buffer = trimSilence(ctx, buffer, e.cue === 'chant' ? 0.002 : 0.012, false).buffer;
        e.bytes = undefined; // decoded: drop the compressed copy
        return e.buffer;
      } catch {
        e.broken = true;
        return null;
      }
    })().finally(() => {
      e.decoding = undefined;
    });
    return e.decoding;
  }

  // ------------------------------------------------------------------ public API

  has(cue: VoiceCue): boolean {
    return !!this.byCue.get(cue)?.some((id) => !this.entries.get(id)!.broken);
  }

  /** Random line of `cue`, cycling through all of them before any repeats. */
  play(cue: VoiceCue, opts: PlayOptions = {}): PlayHandle | null {
    if (!this.enabled) return null;
    const ids = this.byCue.get(cue)?.filter((id) => !this.entries.get(id)!.broken);
    if (!ids?.length) return null;
    const id = this.peek(cue, ids);
    const handle = this.playEntry(this.entries.get(id)!, opts);
    if (handle) this.commit(cue, id);
    return handle;
  }

  playLine(id: string, opts: PlayOptions = {}): PlayHandle | null {
    if (!this.enabled) return null;
    const e = this.entries.get(id);
    if (!e || e.broken) return null;
    return this.playEntry(e, opts);
  }

  /**
   * Plays a server-generated line (WAV/MP3 bytes from /api/ai/voice) with the speaker's FX.
   * The clip is trimmed and its level matched to the static bank.
   */
  async playDynamic(speaker: Speaker, audio: ArrayBuffer, text: { ru: string; en: string }, opts: PlayOptions = {}): Promise<PlayHandle | null> {
    if (!this.enabled) return null;
    let decoded: { buffer: AudioBuffer; ctx: BaseAudioContext };
    try {
      decoded = await this.decode(audio);
    } catch {
      return null;
    }
    const { buffer, rmsDb } = trimSilence(decoded.ctx, decoded.buffer, 0.012, true);
    const gain = rmsDb === null ? 1 : Math.min(4, Math.max(0.25, dbToGain(BANK_RMS_DB - rmsDb)));
    return this.playBuffer(`dyn:${++this.dynCount}`, speaker, buffer, opts, { text, gain });
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 1));
    for (const [ctx, bus] of this.buses) {
      if (ctx.state === 'closed') continue;
      bus.volume.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.03);
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stopAll();
  }

  stopAll(): void {
    for (const v of [...this.active]) this.fadeOut(v);
  }

  /** Milliseconds until no priority ≥ 2 line is playing or queued. */
  busyMs(): number {
    const ctx = this.opts.getContext();
    if (!ctx) return 0;
    const end = Math.max(0, ...this.live(ctx).filter((v) => v.priority >= 2).map((v) => v.end));
    return Math.max(0, Math.round((end - ctx.currentTime) * 1000));
  }

  /** Decoded chant clips keyed by id (vocal chops for the music engine; leading silence trimmed to 2 ms). */
  async getChantBuffers(): Promise<Record<string, AudioBuffer>> {
    await this.load();
    const out: Record<string, AudioBuffer> = {};
    for (const id of this.byCue.get('chant') ?? []) {
      const buf = await this.ensureDecoded(this.entries.get(id)!);
      if (buf) out[id] = buf;
    }
    return out;
  }

  // ------------------------------------------------------------------ scheduling

  private peek(cue: string, ids: string[]): string {
    let bag = (this.bags.get(cue) ?? []).filter((id) => ids.includes(id));
    if (!bag.length) {
      bag = shuffle([...ids]);
      const last = this.lastPick.get(cue);
      if (bag.length > 1 && bag[0] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    this.bags.set(cue, bag);
    return bag[0];
  }

  private commit(cue: string, id: string): void {
    const bag = this.bags.get(cue) ?? [];
    const i = bag.indexOf(id);
    if (i >= 0) bag.splice(i, 1);
    this.lastPick.set(cue, id);
  }

  private live(ctx: AudioContext): Voice[] {
    const now = ctx.currentTime;
    this.active = this.active.filter((v) => !v.cancelled && v.ctx === ctx && v.end > now - 0.02);
    return this.active;
  }

  /** Decides when a new voice may start; null = drop it. */
  private slot(ctx: AudioContext, priority: VoicePriority, want: number, dur: number, interrupt: boolean): number | null {
    const live = this.live(ctx);
    if (priority >= 2) {
      const blocking = live.filter((v) => v.priority >= 2);
      if (interrupt) {
        blocking.forEach((v) => this.fadeOut(v));
        return want;
      }
      const busyUntil = Math.max(0, ...blocking.map((v) => v.end));
      if (busyUntil <= want) return want;
      if (busyUntil - want <= MAX_WAIT_S) return busyUntil + QUEUE_GAP_S;
      return null;
    }
    if (priority === 1) {
      if (live.some((v) => v.priority === 3 && v.start < want + dur && v.end > want)) return null;
      if (live.filter((v) => v.priority === 1 && v.end > want).length >= MAX_GRUNTS) return null;
      return want;
    }
    return live.filter((v) => v.priority === 0 && v.end > want).length >= MAX_CHANTS ? null : want;
  }

  private rateFor(speaker: Speaker): number {
    const r = VOICE_FX[speaker].rate;
    return Array.isArray(r) ? r[0] + Math.random() * (r[1] - r[0]) : r;
  }

  private panFor(speaker: Speaker): number {
    const p = VOICE_FX[speaker].pan;
    if (!p) return 0;
    if (p.mode === 'alternate') {
      this.echoSide = -this.echoSide;
      return this.echoSide * p.amount;
    }
    return (Math.random() * 2 - 1) * p.amount;
  }

  private runningContext(): AudioContext | null {
    const ctx = this.opts.getContext();
    return ctx && ctx.state === 'running' ? ctx : null;
  }

  private playEntry(e: Entry, opts: PlayOptions): PlayHandle | null {
    if (e.buffer) return this.playBuffer(e.id, e.speaker, e.buffer, opts, { base: e.base, cue: e.cue });
    // Not decoded yet: reserve the slot, decode, and play only if still within ~300 ms of the plan.
    const ctx = this.runningContext();
    if (!ctx) return null;
    const priority = opts.priority ?? DEFAULT_PRIORITY[e.speaker];
    const rate = this.rateFor(e.speaker);
    const dur = e.durMs / 1000 / rate;
    const want = ctx.currentTime + Math.max(0, opts.delayMs ?? 0) / 1000;
    const at = this.slot(ctx, priority, want, dur, !!opts.interrupt);
    if (at === null) return null;
    const v = this.makeVoice(e.id, e.speaker, priority, ctx, at, dur, rate, null, 1);
    void this.ensureDecoded(e).then((buf) => {
      if (v.cancelled) return;
      const now = ctx.currentTime;
      if (!buf || ctx.state !== 'running' || now - v.start > LAZY_WINDOW_S) {
        v.cancelled = true;
        return;
      }
      v.start = Math.max(v.start, now + 0.005);
      v.end = v.start + buf.duration / v.rate;
      this.launch(v, buf, e.base, e.cue);
    });
    return { id: e.id, durMs: Math.round(dur * 1000) };
  }

  private playBuffer(
    id: string,
    speaker: Speaker,
    buffer: AudioBuffer,
    opts: PlayOptions,
    extra: { base?: string; cue?: VoiceCue; text?: { ru: string; en: string }; gain?: number },
  ): PlayHandle | null {
    const ctx = this.runningContext();
    if (!ctx || !this.enabled) return null;
    const priority = opts.priority ?? DEFAULT_PRIORITY[speaker];
    const rate = this.rateFor(speaker);
    const dur = buffer.duration / rate;
    const want = ctx.currentTime + 0.01 + Math.max(0, opts.delayMs ?? 0) / 1000;
    const at = this.slot(ctx, priority, want, dur, !!opts.interrupt);
    if (at === null) return null;
    const v = this.makeVoice(id, speaker, priority, ctx, at, dur, rate, extra.text ?? null, extra.gain ?? 1);
    this.launch(v, buffer, extra.base ?? null, extra.cue ?? null);
    return { id, durMs: Math.round(dur * 1000) };
  }

  private makeVoice(id: string, speaker: Speaker, priority: VoicePriority, ctx: AudioContext, start: number, dur: number, rate: number, text: Voice['text'], gain: number): Voice {
    const v: Voice = { id, speaker, priority, ctx, start, end: start + dur, rate, pan: this.panFor(speaker), gain, text, nodes: [], timers: [], cancelled: false };
    this.active.push(v);
    return v;
  }

  // ------------------------------------------------------------------ audio graph

  private bus(ctx: AudioContext): Bus {
    let b = this.buses.get(ctx);
    if (!b) {
      for (const c of [...this.buses.keys()]) if (c.state === 'closed') this.buses.delete(c);
      const input = ctx.createGain();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 4;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      const volume = ctx.createGain();
      volume.gain.value = this.volume;
      input.connect(limiter);
      limiter.connect(volume);
      b = { input, limiter, volume, out: null };
      this.buses.set(ctx, b);
    }
    let target: AudioNode | null = null;
    try {
      target = this.opts.output?.() ?? null;
    } catch {
      target = null;
    }
    if (!target || target.context !== ctx) target = ctx.destination;
    if (b.out !== target) {
      try {
        b.volume.disconnect();
      } catch {
        /* not connected yet */
      }
      b.volume.connect(target);
      b.out = target;
    }
    return b;
  }

  private reverb(ctx: AudioContext, space: 'hall' | 'room'): ConvolverNode {
    const b = this.bus(ctx);
    let c = b[space];
    if (!c) {
      c = ctx.createConvolver();
      c.buffer = makeImpulse(ctx, space);
      c.connect(b.input);
      b[space] = c;
    }
    return c;
  }

  private curve(amount: number): Float32Array<ArrayBuffer> {
    const key = Math.round(amount * 100);
    let c = this.curves.get(key);
    if (!c) {
      const k = 1 + amount * 4;
      const n = 1024;
      const norm = Math.tanh(k);
      c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = Math.tanh(k * ((i / (n - 1)) * 2 - 1)) / norm;
      this.curves.set(key, c);
    }
    return c;
  }

  private launch(v: Voice, buffer: AudioBuffer, base: string | null, cue: VoiceCue | null): void {
    const ctx = v.ctx;
    const fx = VOICE_FX[v.speaker];
    const bus = this.bus(ctx);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = v.rate;
    const nodes: AudioNode[] = [src];
    let node: AudioNode = src;
    const chain = (n: AudioNode) => {
      node.connect(n);
      nodes.push(n);
      node = n;
    };
    const biquad = (type: BiquadFilterType, freq: number, gain = 0, q = 0.707) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.gain.value = gain;
      f.Q.value = q;
      chain(f);
    };
    if (fx.highpass) biquad('highpass', fx.highpass);
    if (fx.lowshelf) biquad('lowshelf', fx.lowshelf.freq, fx.lowshelf.gain);
    if (fx.peaking) biquad('peaking', fx.peaking.freq, fx.peaking.gain, fx.peaking.q);
    if (fx.highshelf) biquad('highshelf', fx.highshelf.freq, fx.highshelf.gain);
    if (fx.saturation) {
      // Parallel saturation: grit without smearing the consonants.
      const dry = ctx.createGain();
      dry.gain.value = 1 - fx.saturation * 0.6;
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.curve(fx.saturation);
      shaper.oversample = '2x';
      const wet = ctx.createGain();
      wet.gain.value = fx.saturation * 0.5;
      const sum = ctx.createGain();
      node.connect(dry);
      node.connect(shaper);
      shaper.connect(wet);
      dry.connect(sum);
      wet.connect(sum);
      nodes.push(dry, shaper, wet, sum);
      node = sum;
    }
    const env = ctx.createGain();
    env.gain.value = v.gain * dbToGain(fx.gainDb ?? 0);
    chain(env);
    if (v.pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = v.pan;
      env.connect(p);
      p.connect(bus.input);
      nodes.push(p);
    } else env.connect(bus.input);
    if (fx.reverb && fx.reverb.send > 0) {
      const send = ctx.createGain();
      send.gain.value = fx.reverb.send;
      env.connect(send);
      send.connect(this.reverb(ctx, fx.reverb.space));
      nodes.push(send);
    }
    v.src = src;
    v.env = env;
    v.nodes = nodes;
    src.onended = () => this.cleanup(v);
    src.start(v.start);

    const durMs = Math.round((v.end - v.start) * 1000);
    const fire = () => {
      if (v.cancelled) return;
      if (v.priority >= 2) this.opts.duck?.(DUCK_AMOUNT, durMs);
      const line = base ? LINE_BY_ID[base] : null;
      const text = v.text ?? (line && !line.noSubtitle ? { ru: line.ru, en: line.en } : null);
      if (text && cue !== 'chant') this.opts.onSubtitle?.({ ru: text.ru, en: text.en, speaker: v.speaker, durMs, id: v.id });
    };
    const ms = (v.start - ctx.currentTime) * 1000;
    if (ms <= 15) fire();
    else v.timers.push(setTimeout(fire, ms));
  }

  private fadeOut(v: Voice): void {
    if (v.cancelled) return;
    v.cancelled = true;
    v.timers.forEach(clearTimeout);
    v.timers = [];
    const { src, env, ctx } = v;
    if (!src || !env || ctx.state === 'closed') return;
    const t = ctx.currentTime;
    try {
      if (v.start > t + 0.005) {
        src.stop();
        return;
      }
      env.gain.cancelScheduledValues(t);
      env.gain.setValueAtTime(env.gain.value, t);
      env.gain.linearRampToValueAtTime(0, t + FADE_S);
      src.stop(t + FADE_S + 0.02);
    } catch {
      /* already stopped */
    }
  }

  private cleanup(v: Voice): void {
    v.cancelled = true;
    v.timers.forEach(clearTimeout);
    for (const n of v.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    v.nodes = [];
    this.active = this.active.filter((x) => x !== v);
  }
}

// ------------------------------------------------------------------ helpers

function fetchWithTimeout(url: string, ms: number, init: RequestInit = {}): Promise<Response> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ms) : null;
  return fetch(url, { ...init, signal: controller?.signal }).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Trims leading (and optionally trailing) near-silence (< −50 dBFS), keeping `keepS`.
 * Also normalises encoder delay differences between browsers. Returns the gated RMS (dBFS).
 */
function trimSilence(ctx: BaseAudioContext, buf: AudioBuffer, keepS: number, tail: boolean): { buffer: AudioBuffer; rmsDb: number | null } {
  const data = buf.getChannelData(0);
  const gate = 0.00316;
  let first = 0;
  while (first < data.length && Math.abs(data[first]) < gate) first++;
  if (first >= data.length) return { buffer: buf, rmsDb: null };
  let last = data.length - 1;
  if (tail) while (last > first && Math.abs(data[last]) < gate) last--;
  let sum = 0;
  let n = 0;
  for (let i = first; i <= last; i++) {
    const x = data[i];
    if (Math.abs(x) >= gate * 3) {
      sum += x * x;
      n++;
    }
  }
  const rmsDb = n ? 10 * Math.log10(sum / n) : null;
  const keep = Math.round(keepS * buf.sampleRate);
  const start = Math.max(0, first - keep);
  const end = tail ? Math.min(data.length, last + 1 + keep * 4) : data.length;
  if (start === 0 && end === data.length) return { buffer: buf, rmsDb };
  try {
    const out = ctx.createBuffer(buf.numberOfChannels, end - start, buf.sampleRate);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) out.getChannelData(ch).set(buf.getChannelData(ch).subarray(start, end));
    return { buffer: out, rmsDb };
  } catch {
    return { buffer: buf, rmsDb };
  }
}

/** Procedural stereo impulse response: dark long hall or short room (deterministic noise, darkening tail). */
function makeImpulse(ctx: BaseAudioContext, space: 'hall' | 'room'): AudioBuffer {
  const p = space === 'hall' ? { len: 3.2, decay: 2.8, pre: 0.025, a0: 0.5, a1: 0.05 } : { len: 0.9, decay: 3.2, pre: 0.006, a0: 0.85, a1: 0.3 };
  const sr = ctx.sampleRate;
  const n = Math.floor(p.len * sr);
  const pre = Math.floor(p.pre * sr);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let seed = ch ? 0x9e3779b9 : 0x85ebca6b;
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / (n - pre);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const white = seed / 2147483648 - 1;
      lp += (p.a0 + (p.a1 - p.a0) * t) * (white - lp); // one-pole low-pass that closes over time
      d[i] = lp * Math.pow(1 - t, p.decay);
    }
  }
  return buf;
}
