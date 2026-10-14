/**
 * UNKNOWN: ASCENSION — audio engine v3.
 * Procedural phonk (mandelão / drift / hyperphonk / slowed+reverb) conducted
 * by the game's director clock, plus visceral procedural gore SFX.
 *
 * Conducting model (kept from v2): the director announces sections with
 * `setSection(id, bpm, at)` (director ms, bar-aligned) and calls
 * `pump(directorNow)` every frame. The engine maps director time to
 * AudioContext time with a smoothed offset (hard resync on > 80 ms drift) and
 * schedules every event ≤ 120 ms ahead — so enemy hits land on the kick.
 *
 * Everything is synthesized: one-shots are rendered once by small JS DSP
 * routines (deterministic, seeded) and played as buffers; the 808, pads,
 * screech lead and risers are tiny real-time voices. No AudioWorklet needed.
 */
import { ALL_KIT, CORE_KIT, fallbackChop, kitRate, renderKit, type KitId } from './kit';
import { sfxRate } from './sfxlib';
import { noise as noiseData } from './dsp';
import { IR_HALL, IR_PLATE, IR_ROOM, buildGraph, makeIR, toAudioBuffer, type Graph } from './fx';
import { Instruments, VoiceRegistry } from './instruments';
import { generateBar, type NoteEvent, type Inst } from './patterns';
import type { RenderJob, RenderReply } from './renderWorker';
import { mulberry32 } from './rng';
import { SfxPlayer } from './sfx';
import { SECTIONS, STYLES, sectionLength, type BedId, type SectionDef } from './styles';
import {
  DirectorClock,
  Timeline,
  barIndexAt,
  barMs,
  beatMs,
  clampBpm,
  nextBarAt,
  stepMs,
  swingOffsetSteps,
  type SectionEntry,
  type Slice,
} from './timing';
import {
  DEFAULT_PREFS,
  type AmbienceId,
  type AudioPrefs,
  type EngineState,
  type RenderPlanItem,
  type SectionId,
  type SectionOptions,
  type Sfx,
  type SfxOptions,
} from './types';

export type { AmbienceId, AudioPrefs, EngineState, RenderPlanItem, SectionId, SectionOptions, Sfx, SfxOptions } from './types';

/** How far ahead (director ms) notes are scheduled. */
export const LOOKAHEAD_MS = 120;
const GAPPED: ReadonlySet<Inst> = new Set<Inst>(['kick', 'snare', 'clap', 'hat', 'ohat', 'perc', 'bass', 'cowbell', 'heart', 'rim']);
const END_ALIGNED_KIT: Partial<Record<Inst, KitId>> = { revCrash: 'revCrash', swell: 'swell' };
const END_ALIGNED: ReadonlySet<Inst> = new Set<Inst>(['revCrash', 'swell', 'riser']);
/** SFX warm-up order: the hits the game triggers most come first. */
export const WARM_SFX: readonly Sfx[] = [
  'swing',
  'slashFlesh',
  'bloodSplash',
  'parry',
  'heroHit',
  'whiff',
  'swingHeavy',
  'slashCrit',
  'boneCrack',
  'bodyFall',
  'parryPerfect',
  'bloodGush',
  'decap',
  'impact',
  'dash',
  'land',
  'ui',
  'uiConfirm',
  'combo',
  'armorBreak',
  'heroHitHeavy',
  'gunshot',
  'bulletDeflect',
  'blink',
  'glassCrack',
  'glitch',
  'slowmoIn',
  'slowmoOut',
  'riser',
  'subDrop',
  'heartbeat',
  'execCut',
  'execFail',
  'bloodlust',
  'thunder',
  'collapse',
  'chainsaw',
  'trainHorn',
  'tapeStop',
];

export interface EngineOptions {
  /** Inject a context (OfflineAudioContext for rendering/QA). */
  context?: BaseAudioContext;
  /** Pattern/sound seed (same seed → same music). */
  seed?: number;
  /** Output-latency compensation in ms (music & `at`-scheduled SFX play this much earlier). */
  latencyMs?: number;
  /**
   * iOS: `navigator.audioSession.type` set on unlock. 'playback' keeps the music
   * audible with the ring/silent switch on (default), 'auto' leaves Safari's default.
   */
  audioSession?: 'playback' | 'ambient' | 'auto';
}

export type Stem = 'drums' | 'bass' | 'mel' | 'fx';

export interface RenderOptions {
  /** QA: render only these stems (drums / bass (808) / mel (cowbell, pad, lead, chants) / fx). */
  solo?: Stem[];
  /** QA: bypass glue/clip/limiter so stem levels are linear and comparable. */
  dry?: boolean;
}

export interface EngineStats {
  musicVoices: number;
  musicNodes: number;
  peakMusicVoices: number;
  peakMusicNodes: number;
  createdVoices: number;
  sfxActive: number;
  sfxPeak: number;
  sfxDropped: number;
  /** Rendered sound-bank entries (kit one-shots, SFX variants). */
  kitCached: number;
  sfxCached: number;
  hallReady: boolean;
}

function isRealtime(ctx: BaseAudioContext): ctx is AudioContext {
  return typeof (ctx as AudioContext).resume === 'function' && typeof (ctx as AudioContext).close === 'function';
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

export class AudioEngineV3 {
  private _ctx: BaseAudioContext | null = null;
  private readonly injected: BaseAudioContext | null;
  private readonly opts: EngineOptions;
  private seed: number;
  private latencySec: number;

  private g: Graph | null = null;
  private inst: Instruments | null = null;
  private player: SfxPlayer | null = null;
  private readonly music = new VoiceRegistry();
  private kitCache = new Map<KitId, AudioBuffer>();
  private noiseBuf: AudioBuffer | null = null;
  private prefs: AudioPrefs = { ...DEFAULT_PREFS };

  // conductor
  private readonly clock = new DirectorClock();
  private readonly timeline = new Timeline();
  private conducted = false;
  private cursor: number | null = null;
  private hype = 0;
  private barCache = new Map<string, NoteEvent[]>();
  private endScheduled = new Set<string>();
  private appliedSeq = -1;
  private hatRr = 0;

  // free-running clock (menus)
  private freeTimer: ReturnType<typeof setInterval> | null = null;
  private freeStart = 0;
  private freeSection: SectionId = 'menu';
  private freeBpm = 100;

  // state
  private chants: Record<string, AudioBuffer> = {};
  /** Use synthesized formant chops when no TTS chant buffer is supplied. */
  useFallbackChops = true;
  private ambienceId: AmbienceId | null = null;
  private ambience: { id: AmbienceId; srcs: AudioScheduledSourceNode[]; gain: GainNode; nodes: AudioNode[] } | null = null;
  private beds = new Map<BedId, { src: AudioBufferSourceNode; gain: GainNode }>();
  private slowmoOn = false;
  /** Resting delay of the tape stage (slowed sections warble around 4 ms). */
  private tapeBase = 0;
  private duckState = { until: 0, depth: 0 };
  private warmStarted = false;
  /** Stats of the last `render()` (QA). */
  lastRenderStats: EngineStats | null = null;
  /** QA stem solo (render only). */
  private soloMask: Stem[] | null = null;

  constructor(opts: EngineOptions = {}) {
    this.opts = opts;
    this.injected = opts.context ?? null;
    this.seed = (opts.seed ?? 0x5eed1e5) >>> 0;
    this.latencySec = Math.max(0, Math.min(0.2, (opts.latencyMs ?? 0) / 1000));
  }

  // ================================================================ lifecycle

  get state(): EngineState {
    const s = this._ctx?.state as string | undefined;
    if (!s) return 'none';
    if (s === 'running' || s === 'closed' || s === 'suspended') return s;
    return 'suspended'; // Safari 'interrupted'
  }

  get ctx(): BaseAudioContext | null {
    return this._ctx;
  }

  /** Creates/resumes the AudioContext. Call from a user gesture (iOS). */
  unlock(): void {
    try {
      if (!this._ctx) {
        this._ctx = this.injected ?? createRealtimeContext();
        if (!this._ctx) return;
        this.build();
      }
      const ctx = this._ctx;
      if (isRealtime(ctx)) {
        this.applyAudioSession();
        if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
        // iOS: start a silent buffer inside the gesture to fully unlock output
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.start(0);
        this.startWarmup();
        if (!this.conducted) this.startFreeRunWhenReady();
      }
    } catch {
      // audio is optional — the game keeps working without it
    }
  }

  suspend(): void {
    this.stopFreeRun();
    const ctx = this._ctx;
    if (ctx && isRealtime(ctx) && ctx.state === 'running') void ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    const ctx = this._ctx;
    if (!ctx || !isRealtime(ctx)) return;
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    // conducted: the director re-syncs the clock on the next pump; free run: keep (or create) its fixed mapping
    if (this.conducted) this.clock.reset();
    else this.startFreeRun();
  }

  setPrefs(p: AudioPrefs): void {
    this.prefs = { ...DEFAULT_PREFS, ...p };
    this.applyPrefs();
  }

  setSeed(seed: number): void {
    this.seed = seed >>> 0;
    this.barCache.clear();
  }

  private applyPrefs(): void {
    const g = this.g;
    if (!g) return;
    const t = g.ctx.currentTime;
    const p = this.prefs;
    const set = (param: AudioParam, v: number) => {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(v, t, 0.04);
    };
    set(g.out.gain, clamp01(p.volumeLimit));
    set(g.music.vol.gain, p.musicOn ? clamp01(p.musicVolume) : 0);
    set(g.sfxVol.gain, p.sfxOn ? clamp01(p.sfxVolume) : 0);
    set(g.voiceVol.gain, p.voiceOn ? clamp01(p.voiceVolume) : 0);
  }

  private applyAudioSession(): void {
    const mode = this.opts.audioSession ?? 'playback';
    if (mode === 'auto') return;
    try {
      const nav = (typeof navigator !== 'undefined' ? navigator : null) as (Navigator & { audioSession?: { type: string } }) | null;
      if (nav?.audioSession && nav.audioSession.type !== mode) nav.audioSession.type = mode;
    } catch {
      /* not supported */
    }
  }

  private build(): void {
    const ctx = this._ctx!;
    const g = buildGraph(ctx);
    this.g = g;
    const sr = ctx.sampleRate;
    this.noiseBuf = toAudioBuffer(ctx, [noiseData(Math.ceil(sr * 2), mulberry32(this.seed ^ 0xa11ce))]);
    this.inst = new Instruments(g, (id) => this.kit(id), this.noiseBuf, this.music);
    this.player = new SfxPlayer(ctx, g.sfx, g.sends.sfxVerb, this.seed);
    if (!isRealtime(ctx)) {
      // offline (render/QA): everything synchronously, right now
      this.loadReverbs();
      for (const id of CORE_KIT) this.kit(id);
    }
    this.applyPrefs();
    if (this.ambienceId) this.startAmbience(this.ambienceId);
    if (isRealtime(ctx)) {
      ctx.addEventListener?.('statechange', () => {
        // only the conducted clock is re-measured; the menu loop's mapping stays valid across a suspend
        if (ctx.state === 'running' && this.conducted) this.clock.reset();
      });
    }
  }

  /** Synchronous reverb IRs (offline renders, or worker fallback). */
  private loadReverbs(): void {
    const g = this.g;
    if (!g) return;
    const sr = g.ctx.sampleRate;
    if (!g.plate.buffer) g.plate.buffer = toAudioBuffer(g.ctx, makeIR(sr, { ...IR_PLATE, seed: this.seed }));
    if (!g.room.buffer) g.room.buffer = toAudioBuffer(g.ctx, makeIR(sr, { ...IR_ROOM, seed: this.seed + 1 }));
    this.loadHall();
  }

  private loadHall(): void {
    const g = this.g;
    if (!g || g.hallVerb.buffer) return;
    const ir = toAudioBuffer(g.ctx, makeIR(g.ctx.sampleRate, { ...IR_HALL, seed: this.seed + 2 }));
    g.hallVerb.buffer = ir;
    g.music.slowVerb.buffer = ir;
  }

  /** Lazily rendered music one-shot. */
  private kit(id: KitId): AudioBuffer {
    let b = this.kitCache.get(id);
    if (!b) {
      const sr = kitRate(id, this._ctx!.sampleRate);
      b = toAudioBuffer(this._ctx!, renderKit(id, sr, this.seed), sr);
      this.kitCache.set(id, b);
    }
    return b;
  }

  /**
   * Renders the rest of the sound bank (kit, hall IR, beds, every SFX) in a Web
   * Worker so the main thread never janks; falls back to small idle-time slices
   * on the main thread when workers are unavailable. Anything requested before
   * it is ready renders synchronously on first use.
   */
  private startWarmup(): void {
    if (this.warmStarted || typeof window === 'undefined') return;
    this.warmStarted = true;
    const kitOrder = ALL_KIT.filter((k) => !CORE_KIT.includes(k));
    const jobs: RenderJob[] = [];
    let id = 0;
    const sr = this._ctx!.sampleRate;
    for (const k of CORE_KIT) if (!this.kitCache.has(k)) jobs.push({ id: id++, kind: 'kit', name: k, sr: kitRate(k, sr), seed: this.seed });
    jobs.push({ id: id++, kind: 'ir', name: 'plate', sr, seed: this.seed });
    jobs.push({ id: id++, kind: 'ir', name: 'room', sr, seed: this.seed + 1 });
    jobs.push({ id: id++, kind: 'ir', name: 'hall', sr, seed: this.seed + 2 });
    for (const k of kitOrder) if (!this.kitCache.has(k)) jobs.push({ id: id++, kind: 'kit', name: k, sr: kitRate(k, sr), seed: this.seed });
    for (const [name, variant] of this.player?.missing(WARM_SFX) ?? []) jobs.push({ id: id++, kind: 'sfx', name, variant, sr: sfxRate(name, sr), seed: this.seed });
    void import('./renderWorker?worker&inline')
      .then((m) => this.warmWithWorker(new m.default(), jobs))
      .catch(() => this.warmOnMainThread(jobs));
  }

  private accept(job: RenderJob, chs: Float32Array[]): void {
    const ctx = this._ctx;
    if (!ctx || !chs.length) return;
    if (job.kind === 'kit') {
      if (!this.kitCache.has(job.name)) this.kitCache.set(job.name, toAudioBuffer(ctx, chs, job.sr));
    } else if (job.kind === 'sfx') this.player?.put(job.name, job.variant, chs);
    else if (this.g) {
      const g = this.g;
      if (job.name === 'plate' && !g.plate.buffer) g.plate.buffer = toAudioBuffer(ctx, chs);
      else if (job.name === 'room' && !g.room.buffer) g.room.buffer = toAudioBuffer(ctx, chs);
      else if (job.name === 'hall' && !g.hallVerb.buffer) {
        const ir = toAudioBuffer(ctx, chs);
        g.hallVerb.buffer = ir;
        g.music.slowVerb.buffer = ir;
      }
    }
  }

  private warmWithWorker(worker: Worker, jobs: RenderJob[]): void {
    const byId = new Map(jobs.map((j) => [j.id, j]));
    worker.onmessage = (e: MessageEvent<RenderReply>) => {
      const job = byId.get(e.data.id);
      if (job) {
        this.accept(job, e.data.chs);
        byId.delete(job.id);
      }
      if (!byId.size) worker.terminate();
    };
    worker.onerror = () => {
      worker.terminate();
      this.warmOnMainThread([...byId.values()]);
    };
    for (const j of jobs) worker.postMessage(j);
  }

  private warmOnMainThread(jobs: RenderJob[]): void {
    const queue = [...jobs];
    const step = () => {
      const ctx = this._ctx;
      if (!ctx || ctx.state === 'closed') return;
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < 6) {
        const j = queue.shift()!;
        if (j.kind === 'kit') void this.kit(j.name);
        else if (j.kind === 'sfx') this.player?.buffer(j.name, j.variant);
        else this.loadReverbs();
      }
      if (queue.length) setTimeout(step, this.conducted ? 120 : 30);
    };
    setTimeout(step, 30);
  }

  /** Starts the menu loop once the core kit has arrived from the worker (or after 500 ms). */
  private startFreeRunWhenReady(): void {
    const t0 = Date.now();
    const poll = () => {
      if (this.conducted || this.freeTimer !== null) return;
      const ready = CORE_KIT.every((k) => this.kitCache.has(k));
      if (ready || Date.now() - t0 > 500) this.startFreeRun();
      else setTimeout(poll, 30);
    };
    poll();
  }

  // ================================================================ conductor

  /** The game owns the clock from now on (mission running). */
  attachConductor(): void {
    this.conducted = true;
    this.stopFreeRun();
    this.resetSchedule();
  }

  /** Back to the self-running loop (menu / results). */
  detachConductor(): void {
    const cur = this.cursor !== null ? this.timeline.active(this.cursor) : null;
    if (cur && (cur.id === 'outro' || cur.id === 'menu')) {
      this.freeSection = cur.id;
      this.freeBpm = cur.bpm;
    } else this.freeSection = 'menu';
    this.conducted = false;
    this.resetSchedule();
    const ctx = this._ctx;
    if (ctx && isRealtime(ctx) && ctx.state === 'running') this.startFreeRun();
  }

  private resetSchedule(): void {
    const ctx = this._ctx;
    if (ctx) this.music.cancelFrom(ctx.currentTime + 0.005);
    this.clock.reset();
    this.timeline.clear();
    this.cursor = null;
    this.barCache.clear();
    this.endScheduled.clear();
    this.appliedSeq = -1;
  }

  setSection(id: SectionId, bpm: number, at: number, opts: SectionOptions = {}): void {
    if (!SECTIONS[id]) return;
    if (!this.conducted) {
      this.freeSection = id;
      this.freeBpm = clampBpm(bpm);
      if (this.freeTimer === null) return; // applied when the free run starts
      const now = this.freeNow();
      const cur = this.timeline.active(now);
      const start = cur ? nextBarAt(cur.at, cur.bpm, now + LOOKAHEAD_MS + 10) : now + 60;
      this.timeline.set(id, bpm, start, opts.bars);
      return;
    }
    this.timeline.set(id, bpm, at, opts.bars);
    const ctx = this._ctx;
    if (this.cursor !== null && at < this.cursor - 1e-6) {
      // the new section starts inside what is already scheduled: cancel those notes
      if (ctx && this.clock.ready) {
        const tCtx = this.clock.toCtx(at) - this.latencySec;
        this.music.cancelFrom(Math.max(tCtx, ctx.currentTime));
        const g = this.g;
        if (g) {
          for (const p of [g.bassPump.gain, g.melPump.gain]) {
            p.cancelScheduledValues(Math.max(tCtx, ctx.currentTime));
            p.setTargetAtTime(1, Math.max(tCtx, ctx.currentTime), 0.01);
          }
        }
        this.cursor = Math.max(at, this.clock.toDir(ctx.currentTime));
      } else this.cursor = at;
      this.appliedSeq = -1;
    }
  }

  setHype(level: number): void {
    this.hype = Number.isFinite(level) ? Math.max(0, Math.min(4, Math.round(level))) : 0;
  }

  /** Call every frame with the director clock (ms). */
  pump(directorNow: number): void {
    const ctx = this._ctx;
    if (!ctx || !this.g || !this.conducted || !Number.isFinite(directorNow)) return;
    if (isRealtime(ctx) && ctx.state !== 'running') return;
    this.clock.update(ctx.currentTime, directorNow);
    if (this.cursor !== null && directorNow + LOOKAHEAD_MS < this.cursor - 2000) {
      // director restarted / jumped backwards
      this.cursor = null;
      this.barCache.clear();
    }
    this.scheduleUntil(directorNow, directorNow + LOOKAHEAD_MS);
  }

  private freeNow(): number {
    const ctx = this._ctx;
    return ctx ? (ctx.currentTime - this.freeStart) * 1000 : 0;
  }

  private startFreeRun(): void {
    const ctx = this._ctx;
    if (this.freeTimer !== null || !ctx || !isRealtime(ctx) || !this.g) return;
    this.resetSchedule();
    this.freeStart = ctx.currentTime + 0.06;
    this.clock.set(this.freeStart);
    this.timeline.set(this.freeSection, this.freeBpm, 0);
    const tick = () => {
      const c = this._ctx;
      if (!c || c.state !== 'running' || this.conducted) return;
      const now = this.freeNow();
      this.scheduleUntil(now, now + LOOKAHEAD_MS + 40);
    };
    this.freeTimer = setInterval(tick, 25);
    tick();
  }

  private stopFreeRun(): void {
    if (this.freeTimer !== null) clearInterval(this.freeTimer);
    this.freeTimer = null;
  }

  private toCtx(dirMs: number): number {
    return this.clock.toCtx(dirMs) - this.latencySec;
  }

  private scheduleUntil(nowMs: number, untilMs: number): void {
    let from = this.cursor ?? nowMs - 20;
    if (from < nowMs - 60) from = nowMs - 60;
    if (untilMs <= from) return;
    for (const s of this.timeline.slices(from, untilMs)) this.scheduleSlice(s);
    this.cursor = untilMs;
    this.timeline.prune(nowMs - 4000);
    if (this.barCache.size > 48) {
      const keys = [...this.barCache.keys()];
      for (const k of keys.slice(0, keys.length - 32)) this.barCache.delete(k);
    }
    if (this.endScheduled.size > 256) this.endScheduled.clear();
    if (this._ctx) this.music.prune(this._ctx.currentTime);
  }

  private bar(e: SectionEntry, bar: number): NoteEvent[] {
    const key = `${e.seq}:${bar}:${this.hype}`;
    let ev = this.barCache.get(key);
    if (!ev) {
      const prev = this.timeline.prev(e);
      ev = generateBar({ section: e.id, bar, hype: this.hype, seed: this.seed, length: e.bars, prev: prev ? prev.id : null });
      this.barCache.set(key, ev);
    }
    return ev;
  }

  private scheduleSlice(s: Slice): void {
    const e = s.entry;
    const def = SECTIONS[e.id];
    if (e.seq !== this.appliedSeq) {
      this.applySection(e, s);
      this.appliedSeq = e.seq;
    }
    const step = stepMs(e.bpm);
    const gap = s.next ? SECTIONS[s.next.id].gapSteps * step : 0;
    if (this.prefs.musicOn) {
      if (gap && s.next && SECTIONS[s.next.id].gapMute) this.scheduleGapMute(s, gap);
      for (const ev of this.bar(e, s.bar)) {
        if (ev.endAligned || ev.pickup) continue;
        const tMs = s.barStart + (ev.step + swingOffsetSteps(ev.step, def.swing)) * step;
        if (tMs < s.from || tMs >= s.to) continue;
        if (gap && s.next && tMs >= s.next.at - gap && GAPPED.has(ev.inst)) continue;
        this.playEvent(ev, tMs, e, def, step);
      }
      this.scheduleEndAligned(s);
    }
  }

  /** Hard pre-drop silence: the whole music bus is muted for the gap before a drop. */
  private scheduleGapMute(s: Slice, gapMs: number): void {
    const next = s.next!;
    const start = next.at - gapMs;
    if (start < s.from || start >= s.to) return;
    const key = `gap:${next.seq}`;
    if (this.endScheduled.has(key)) return;
    this.endScheduled.add(key);
    const ctx = this._ctx!;
    const t0 = this.toCtx(start);
    if (t0 < ctx.currentTime) return;
    const gate = this.g!.music.gate.gain;
    gate.setTargetAtTime(0, t0, 0.006);
    gate.setTargetAtTime(1, this.toCtx(next.at), 0.0015);
  }

  /** Reverse cymbals / swells that must END on an upcoming downbeat (incl. the next section's). */
  private scheduleEndAligned(s: Slice): void {
    const e = s.entry;
    const b = barMs(e.bpm);
    const candidates = [s.barStart + b, s.barStart + 2 * b];
    if (s.next && s.next.at > s.from && candidates.every((c) => Math.abs(c - s.next!.at) > 1)) candidates.push(s.next.at);
    for (const T of candidates) {
      const x = this.timeline.active(T + 0.5);
      if (!x) continue;
      const xb = barMs(x.bpm);
      const bar = barIndexAt(x.at, x.bpm, T + 0.5);
      const barStart = x.at + bar * xb;
      if (Math.abs(barStart - T) > 1) continue;
      const step = stepMs(x.bpm);
      const xdefP = SECTIONS[x.id];
      for (const ev of this.bar(x, bar)) {
        if (ev.pickup) {
          // pickups: negative steps before this downbeat (e.g. the rising snare roll before a drop)
          const tMs = barStart + ev.step * step;
          if (tMs >= s.from && tMs < s.to) this.playEvent(ev, tMs, x, xdefP, step);
          continue;
        }
        if (!ev.endAligned || !END_ALIGNED.has(ev.inst)) continue;
        const key = `${x.seq}:${bar}:${ev.inst}:${ev.step}`;
        if (this.endScheduled.has(key)) continue;
        const endMs = barStart + ev.step * step;
        const kitId = END_ALIGNED_KIT[ev.inst];
        const buffer = kitId ? this.kit(kitId) : null;
        const durMs = Math.min((ev.len ?? 8) * step, buffer ? buffer.duration * 1000 : Infinity);
        const startMs = endMs - durMs;
        if (startMs >= s.to || endMs <= s.from) continue;
        this.endScheduled.add(key);
        const playFrom = Math.max(startMs, s.from);
        const ctx = this._ctx!;
        const t = this.toCtx(playFrom);
        if (t < ctx.currentTime - 0.03) continue;
        const when = Math.max(t, ctx.currentTime);
        if (!kitId || !buffer) {
          // synthesized riser: whatever is left of it still lands on the downbeat
          const left = (endMs - playFrom) / 1000;
          if (left > 0.15) this.inst!.riser(when, left, ev.vel * Math.min(1, left / (durMs / 1000) + 0.3));
          continue;
        }
        const offsetSec = buffer.duration - (endMs - playFrom) / 1000;
        const xdef = SECTIONS[x.id];
        this.inst!.sample(kitId, when, ev.vel * (ev.inst === 'swell' ? 0.6 : 0.5), this.g!.fx, {
          offset: Math.max(0, offsetSec),
          verb: 0.2,
          hall: xdef.hall > 0.3 ? 0.4 : 0,
        });
      }
    }
  }

  /** Section-level settings at the section's first downbeat. */
  private applySection(e: SectionEntry, s: Slice): void {
    const g = this.g!;
    const inst = this.inst!;
    const ctx = g.ctx;
    const def = SECTIONS[e.id];
    const style = STYLES[def.style];
    const T = Math.max(ctx.currentTime, this.toCtx(Math.max(e.at, s.from)));
    const beat = beatMs(e.bpm) / 1000;
    inst.setStyle(def.style, T);
    inst.pumpBass = def.pumpBass;
    inst.pumpMel = def.pumpMel;
    inst.beatSec = beat;
    // section filter (fixed or swept over the section length)
    const lp = g.music.sectionLP.frequency;
    g.music.sectionLP.Q.setTargetAtTime(def.filterQ, T, 0.05);
    lp.cancelScheduledValues(T);
    if (typeof def.filter === 'number') lp.setTargetAtTime(def.filter, T, 0.05);
    else {
      const bars = sectionLength(e.id, e.bars);
      const elapsed = Math.max(0, (s.from - e.at) / 1000);
      const total = (bars * barMs(e.bpm)) / 1000;
      const u = Math.min(1, elapsed / total);
      const from = def.filter.from * Math.pow(def.filter.to / def.filter.from, u);
      lp.setValueAtTime(from, T);
      lp.exponentialRampToValueAtTime(def.filter.to, T + Math.max(0.05, total - elapsed));
    }
    // section high-pass (build sweeps) — released instantly on the next section's downbeat
    const hpf = g.music.sectionHP.frequency;
    hpf.cancelScheduledValues(T);
    if (def.hpSweep) {
      const bars = sectionLength(e.id, e.bars);
      const total = (bars * barMs(e.bpm)) / 1000;
      hpf.setValueAtTime(def.hpSweep.from, T);
      hpf.exponentialRampToValueAtTime(def.hpSweep.to, T + Math.max(0.05, total - Math.max(0, (s.from - e.at) / 1000)));
    } else hpf.setTargetAtTime(20, T, 0.004);
    g.music.gate.gain.cancelScheduledValues(T);
    g.music.gate.gain.setTargetAtTime(1, T, 0.0015);
    const slow = this.slowmoOn;
    if (!this.soloMask || this.soloMask.includes('mel')) g.sends.verb.gain.setTargetAtTime(def.verb / 0.25, T, 0.15);
    if (!this.soloMask || this.soloMask.includes('fx')) g.sends.hall.gain.setTargetAtTime(def.hall, T, 0.2);
    inst.padHall(def.hall * 0.8, T);
    g.music.level.gain.setTargetAtTime(def.level, T, 0.05);
    const delaySec = Math.min(2.5, style.delayBeats * beat);
    g.delayL.delayTime.setValueAtTime(delaySec, T);
    g.delayR.delayTime.setValueAtTime(delaySec, T);
    for (const fb of g.delayFb) fb.gain.setTargetAtTime(style.delayFeedback, T, 0.1);
    // slowed sections get a gentle tape warble (the "slowed + reverb" wow)
    const warble = def.style === 'slowed';
    this.tapeBase = warble ? 0.004 : 0;
    if (!slow) {
      g.music.slowSend.gain.setTargetAtTime(0, T, 0.2);
      g.music.wobbleDepth.gain.setTargetAtTime(warble ? 0.0012 : 0, T, 0.3);
      try {
        g.music.tape.delayTime.setTargetAtTime(this.tapeBase, T, 0.3);
      } catch {
        /* tape-stop curve in progress */
      }
    }
    this.applyBeds(def.beds, T, def.bedGain ?? 1);
  }

  private applyBeds(beds: readonly BedId[], T: number, gainMul = 1): void {
    const g = this.g!;
    const base: Record<BedId, number> = { vinyl: 0.16, wind: 0.55 };
    const levels: Record<BedId, number> = { vinyl: base.vinyl * gainMul, wind: base.wind * gainMul };
    for (const id of ['vinyl', 'wind'] as BedId[]) {
      const want = beds.includes(id);
      const cur = this.beds.get(id);
      if (want && !cur) {
        const src = g.ctx.createBufferSource();
        src.buffer = this.kit(id);
        src.loop = true;
        const gain = g.ctx.createGain();
        gain.gain.setValueAtTime(0, T);
        gain.gain.setTargetAtTime(levels[id], T, 0.4);
        src.connect(gain).connect(g.fx);
        src.start(T);
        this.beds.set(id, { src, gain });
      } else if (want && cur) {
        cur.gain.gain.cancelScheduledValues(T);
        cur.gain.gain.setTargetAtTime(levels[id], T, 0.3);
      } else if (!want && cur) {
        cur.gain.gain.cancelScheduledValues(T);
        cur.gain.gain.setTargetAtTime(0, T, 0.35);
        try {
          cur.src.stop(T + 2.5);
        } catch {
          /* ignore */
        }
        const { src, gain } = cur;
        src.onended = () => {
          src.disconnect();
          gain.disconnect();
        };
        this.beds.delete(id);
      }
    }
  }

  private playEvent(ev: NoteEvent, tMs: number, e: SectionEntry, def: SectionDef, stepMsec: number): void {
    const ctx = this._ctx!;
    const inst = this.inst!;
    const g = this.g!;
    const t0 = this.toCtx(tMs);
    if (t0 < ctx.currentTime - 0.02) return;
    const t = Math.max(t0, ctx.currentTime);
    const stepSec = stepMsec / 1000;
    const style = STYLES[def.style];
    const hallFx = def.hall > 0.3 ? 0.35 : 0;
    switch (ev.inst) {
      case 'kick':
        inst.drum(style.kick, t, ev.vel, 'kick');
        break;
      case 'snare':
      case 'clap':
        if (def.style === 'slowed') inst.sample(ev.inst, t, ev.vel * 0.34, g.drums, { hall: 0.6 });
        else inst.drum(ev.inst, t, ev.vel, ev.inst, ev.rate ?? 1);
        break;
      case 'rim':
        inst.drum('rim', t, ev.vel, 'rim');
        break;
      case 'hat': {
        const v = ev.variant ?? this.hatRr++ % 3;
        inst.drum(v === 0 ? 'hat0' : v === 1 ? 'hat1' : 'hat2', t, ev.vel, 'hat', ev.rate ?? 1);
        break;
      }
      case 'ohat':
        inst.drum('ohat', t, ev.vel * 1.3, 'hat');
        break;
      case 'perc': {
        const v = ev.variant ?? 1;
        inst.drum(v === 0 ? 'perc0' : v === 2 ? 'perc2' : 'perc1', t, ev.vel, 'perc');
        break;
      }
      case 'heart':
        inst.drum('heart', t, ev.vel, 'heart');
        break;
      case 'crash':
        inst.sample('crash', t, ev.vel * 0.32, g.fx, { verb: 0.2, hall: hallFx });
        break;
      case 'impact':
        inst.sample('impact', t, ev.vel * 1.15, g.fx, { verb: 0.2, hall: e.id === 'finale' ? 0.8 : hallFx });
        inst.pump(t, 1);
        break;
      case 'subDrop':
        inst.sample('subDrop', t, ev.vel * 0.42, g.fx);
        break;
      case 'downlifter':
        inst.sample('downlifter', t, ev.vel * 0.55, g.fx, { verb: 0.3 });
        break;
      case 'cowbell':
        inst.cowbell(t, ev.note ?? 77, ev.vel * (ev.layer ? 0.8 : 1), style.cowbell, ev.pan ?? 0, def.style === 'slowed' || def.part === 'finale' ? 0.5 : 0);
        break;
      case 'bass':
        inst.bass(t, ev.note ?? 29, (ev.len ?? 2) * stepSec, ev.vel, ev.slide, ev.bend, def.style);
        break;
      case 'pad':
        if (ev.notes?.length) inst.pad(t, ev.notes, (ev.len ?? 16) * stepSec, ev.vel);
        break;
      case 'lead':
        inst.lead(t, ev.note ?? 77, (ev.len ?? 2) * stepSec, ev.vel, ev.bend);
        break;
      case 'chant':
        this.playChant(ev, t, stepSec);
        break;
      case 'riser':
        inst.riser(t, (ev.len ?? 16) * stepSec, ev.vel);
        break;
      default:
        break;
    }
  }

  private playChant(ev: NoteEvent, t: number, stepSec: number): void {
    const id = ev.chant ?? 'ch_hey';
    const len = (ev.len ?? 2) * stepSec;
    const buf = this.chants[id];
    if (buf) {
      this.inst!.chant(t, buf, ev.rate ?? 1, len, ev.vel);
      return;
    }
    if (!this.useFallbackChops) return;
    this.inst!.chant(t, this.kit(fallbackChop(id)), (ev.rate ?? 1) * 0.96, len, ev.vel * 0.7);
  }

  // ================================================================ SFX

  sfx(name: Sfx, opts: SfxOptions = {}): void {
    const ctx = this._ctx;
    if (!ctx || !this.player || !this.prefs.sfxOn) return;
    if (isRealtime(ctx) && ctx.state !== 'running') return;
    const t = this.sfxTime(opts.at);
    const def = this.player.play(name, t, opts);
    if (!def) return;
    if (def.duck) this.duckAt(t, def.duck[0], def.duck[1]);
    if (name === 'tapeStop') this.tapeStop(t);
  }

  private sfxTime(at: number | undefined): number {
    const ctx = this._ctx!;
    const now = ctx.currentTime;
    if (at === undefined || !Number.isFinite(at)) return now;
    if (this.conducted && this.clock.ready) return Math.max(now, this.toCtx(at));
    if (!isRealtime(ctx)) return Math.max(now, at / 1000); // offline QA: director ms == ctx ms
    return now;
  }

  /** Music tape-stop (pitch dives to zero), recovering on the next bar line. */
  private tapeStop(t: number): void {
    const g = this.g!;
    const D = 0.75;
    const base = this.slowmoOn ? 0.006 : this.tapeBase;
    const n = 48;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * D;
      curve[i] = base + (x * x) / (2 * D);
    }
    const dt = g.music.tape.delayTime;
    const tg = g.music.tapeGain.gain;
    try {
      dt.cancelScheduledValues(t);
      dt.setValueCurveAtTime(curve, t, D);
      tg.cancelScheduledValues(t);
      tg.setValueAtTime(1, t);
      tg.linearRampToValueAtTime(0, t + D);
      // back in on the next bar line
      let resume = t + D + 0.3;
      if (this.clock.ready && this.cursor !== null) {
        const dir = this.clock.toDir(t + D + 0.05);
        const cur = this.timeline.active(dir);
        if (cur) resume = Math.max(resume, this.toCtx(nextBarAt(cur.at, cur.bpm, dir)));
      }
      dt.setValueAtTime(base, resume - 0.03);
      tg.setValueAtTime(0, resume - 0.02);
      tg.setTargetAtTime(1, resume, 0.006);
    } catch {
      /* automation conflict — skip the effect */
    }
  }

  // ================================================================ ambience / slow-mo / duck / voice / chants

  setAmbience(id: AmbienceId | null): void {
    this.ambienceId = id;
    if (!this.g) return;
    const now = this.g.ctx.currentTime;
    if (this.ambience && this.ambience.id !== id) {
      const a = this.ambience;
      a.gain.gain.cancelScheduledValues(now);
      a.gain.gain.setTargetAtTime(0, now, 0.5);
      for (const s of a.srcs) {
        try {
          s.stop(now + 3);
        } catch {
          /* ignore */
        }
      }
      a.srcs[0].onended = () => a.nodes.forEach((n) => n.disconnect());
      this.ambience = null;
    }
    if (id && !this.ambience) this.startAmbience(id);
  }

  private startAmbience(id: AmbienceId): void {
    const g = this.g!;
    const ctx = g.ctx;
    const now = ctx.currentTime;
    const kitId: KitId = id === 'rain' ? 'rain' : id === 'wind' ? 'wind' : 'trainBed';
    const src = ctx.createBufferSource();
    src.buffer = this.kit(kitId);
    src.loop = true;
    const gain = ctx.createGain();
    const level = id === 'train' ? 0.75 : id === 'wind' ? 0.6 : 0.55;
    gain.gain.setValueAtTime(0, now);
    gain.gain.setTargetAtTime(level, now, 0.6);
    const nodes: AudioNode[] = [src, gain];
    const srcs: AudioScheduledSourceNode[] = [src];
    if (id === 'wind') {
      // slow gusts on top of the loop
      const bp = ctx.createBiquadFilter();
      bp.type = 'lowpass';
      bp.frequency.value = 1400;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.11;
      const depth = ctx.createGain();
      depth.gain.value = 700;
      lfo.connect(depth).connect(bp.frequency);
      src.connect(bp).connect(gain);
      lfo.start(now);
      srcs.push(lfo);
      nodes.push(bp, lfo, depth);
    } else src.connect(gain);
    gain.connect(g.amb);
    src.start(now, (this.seed % 1000) / 1000);
    this.ambience = { id, srcs, gain, nodes };
  }

  /** Slow motion on the music only: lowpass ≈500 Hz, more reverb, slight detune + wobble. */
  slowmo(on: boolean, ms = 350): void {
    this.slowmoOn = on;
    const g = this.g;
    if (!g || !this.inst) return;
    const t = g.ctx.currentTime;
    const tau = Math.max(0.02, ms / 1000 / 3);
    const lp = g.music.slowLP;
    lp.frequency.cancelScheduledValues(t);
    lp.frequency.setTargetAtTime(on ? 500 : 20000, t, tau);
    lp.Q.setTargetAtTime(on ? 1.3 : 0.9, t, tau);
    g.music.slowSend.gain.cancelScheduledValues(t);
    g.music.slowSend.gain.setTargetAtTime(on ? 0.55 : 0, t, tau);
    g.music.wobbleDepth.gain.setTargetAtTime(on ? 0.0022 : this.tapeBase ? 0.0012 : 0, t, tau);
    try {
      g.music.tape.delayTime.setTargetAtTime(on ? 0.006 : this.tapeBase, t, tau);
    } catch {
      /* tape stop curve in progress */
    }
    this.inst.detune = on ? Math.pow(2, -35 / 1200) : 1;
  }

  /** Dips the music (e.g. under voice lines): amount 0..1, held for `ms`. */
  duck(amount: number, ms: number): void {
    const ctx = this._ctx;
    if (!ctx) return;
    this.duckAt(ctx.currentTime, amount, ms);
  }

  private duckAt(t: number, amount: number, ms: number): void {
    const g = this.g;
    if (!g) return;
    const now = g.ctx.currentTime;
    const start = Math.max(now, t);
    const depth = Math.max(0, Math.min(0.95, amount));
    const until = start + Math.max(0, ms) / 1000;
    const active = this.duckState.until > start;
    const d = active ? Math.max(depth, this.duckState.depth) : depth;
    const u = Math.max(until, active ? this.duckState.until : 0);
    const p = g.music.duck.gain;
    p.cancelScheduledValues(start);
    p.setTargetAtTime(1 - d, start, 0.03);
    p.setTargetAtTime(1, u, 0.15);
    this.duckState = { until: u, depth: d };
  }

  /** VoiceManager connects TTS sources here (own gain = voiceVolume) → master. */
  get voiceInput(): AudioNode | null {
    return this.g?.voice ?? null;
  }

  /** Optional TTS vocal chops (ch_hey, ch_vai, …) used rhythmically in drops. */
  setChants(buffers: Record<string, AudioBuffer>): void {
    this.chants = { ...buffers };
  }

  stats(): EngineStats {
    const now = this._ctx?.currentTime ?? 0;
    const c = this.music.count(now);
    return {
      musicVoices: c.voices,
      musicNodes: c.nodes,
      peakMusicVoices: this.music.peakVoices,
      peakMusicNodes: this.music.peakNodes,
      createdVoices: this.music.created,
      sfxActive: this.player?.activeCount ?? 0,
      sfxPeak: this.player?.peakVoices ?? 0,
      sfxDropped: this.player?.dropped ?? 0,
      kitCached: this.kitCache.size,
      sfxCached: this.player?.cachedCount ?? 0,
      hallReady: !!this.g?.hallVerb.buffer,
    };
  }

  // ================================================================ offline render (QA)

  /**
   * Renders a section plan offline (48 kHz stereo) with music at full volume.
   * Sections are announced one beat early, as a director would.
   */
  async render(plan: RenderPlanItem[], bpm: number, opts: RenderOptions = {}): Promise<AudioBuffer> {
    const tempo = clampBpm(bpm);
    const sr = 48000;
    const barSec = 240 / tempo;
    const bars = plan.map((p) => Math.max(1, Math.round(p.bars)));
    const totalBars = bars.reduce((a, b) => a + b, 0);
    const length = Math.ceil((totalBars * barSec + 4) * sr);
    const OAC: typeof OfflineAudioContext | undefined =
      globalThis.OfflineAudioContext ?? (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!OAC || plan.length === 0) throw new Error('OfflineAudioContext unavailable or empty plan');
    const off = new OAC(2, length, sr);
    const eng = new AudioEngineV3({ context: off, seed: this.seed });
    eng.useFallbackChops = this.useFallbackChops;
    eng.setPrefs({ ...this.prefs, musicOn: true, sfxOn: true, musicVolume: 1, sfxVolume: 1, volumeLimit: 1 });
    eng.setChants(this.chants);
    eng.unlock();
    eng.attachConductor();
    if (opts.dry && eng.g) {
      const g = eng.g;
      for (const c of [g.music.glue, g.limiter]) {
        c.ratio.value = 1;
        c.threshold.value = 0;
      }
      g.clip.curve = null;
      g.musicClip.curve = null;
    }
    if (opts.solo?.length && eng.g) {
      const g = eng.g;
      const buses: Record<Stem, AudioParam[]> = {
        drums: [g.drums.gain],
        bass: [g.bassOut.gain],
        mel: [g.mel.gain, g.sends.delay.gain, g.sends.verb.gain],
        fx: [g.fx.gain, g.sends.hall.gain],
      };
      for (const stem of Object.keys(buses) as Stem[]) {
        if (opts.solo.includes(stem)) continue;
        for (const p of buses[stem]) p.value = 0;
      }
      eng.soloMask = opts.solo;
    }
    const starts: number[] = [];
    let acc = 0;
    for (const b of bars) {
      starts.push(acc * barSec * 1000);
      acc += b;
    }
    const beat = 60000 / tempo;
    let announced = -1;
    const update = (ms: number) => {
      while (announced + 1 < plan.length && (announced < 0 || starts[announced + 1] - beat <= ms + LOOKAHEAD_MS)) {
        announced++;
        eng.setSection(plan[announced].id, tempo, starts[announced], { bars: bars[announced] });
      }
      let cur = 0;
      for (let i = 0; i < plan.length; i++) if (starts[i] <= ms + LOOKAHEAD_MS) cur = i;
      eng.setHype(plan[cur].hype ?? 2);
      eng.pump(ms);
    };
    const chunk = 0.04;
    const total = length / sr;
    for (let k = 1; k * chunk < total - 0.05; k++) {
      const t = k * chunk;
      void off.suspend(t).then(() => {
        update(t * 1000);
        void off.resume();
      });
    }
    update(0);
    const out = await off.startRendering();
    this.lastRenderStats = eng.stats();
    return out;
  }
}

function createRealtimeContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    return new AC({ latencyHint: 'interactive' });
  } catch {
    return new AC();
  }
}

/** Single shared engine instance for the app. */
export const audio3 = new AudioEngineV3();

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (window as unknown as { __UNKNOWN_AUDIO3__?: AudioEngineV3 }).__UNKNOWN_AUDIO3__ = audio3;
}

