/**
 * SFX playback: lazily rendered + cached buffers (round-robin variants),
 * per-sound throttling, a global polyphony cap with voice stealing, pan /
 * gain / pitch options. Each hit = BufferSource → Gain (→ Panner) → bus.
 */
import { toAudioBuffer } from './fx';
import { mulberry32, type Rng } from './rng';
import { SFX_DEFS, renderSfx, sfxRate, type SfxDef } from './sfxlib';
import { SFX_NAMES, type Sfx, type SfxOptions } from './types';

interface ActiveSfx {
  name: Sfx;
  start: number;
  end: number;
  src: AudioBufferSourceNode;
  env: GainNode;
  priority: number;
}

export class SfxPlayer {
  /** Max simultaneous SFX voices. */
  maxVoices = 20;
  /** Max instances of the same SFX starting within `throttleSec`. */
  maxSame = 2;
  throttleSec = 0.035;

  private cache = new Map<string, AudioBuffer>();
  private active: ActiveSfx[] = [];
  private recent = new Map<Sfx, number[]>();
  private rr = new Map<Sfx, number>();
  private sends = new Map<number, GainNode>();
  private jitter: Rng;
  peakVoices = 0;
  dropped = 0;

  constructor(
    private ctx: BaseAudioContext,
    private dest: AudioNode,
    private verb: AudioNode,
    private seed: number,
  ) {
    this.jitter = mulberry32(seed ^ 0x51f);
  }

  isReady(name: Sfx, variant = 0): boolean {
    return this.cache.has(`${name}:${variant}`);
  }

  /** Stores a buffer rendered elsewhere (worker); ignored if already cached. */
  put(name: Sfx, variant: number, chs: Float32Array[]): void {
    const key = `${name}:${variant}`;
    if (this.cache.has(key) || !chs.length) return;
    this.cache.set(key, toAudioBuffer(this.ctx, chs, sfxRate(name, this.ctx.sampleRate)));
  }

  /** Every (name, variant) not yet rendered, in `order`. */
  missing(order: readonly Sfx[] = SFX_NAMES): [Sfx, number][] {
    const out: [Sfx, number][] = [];
    for (const name of order) for (let v = 0; v < SFX_DEFS[name].variants; v++) if (!this.cache.has(`${name}:${v}`)) out.push([name, v]);
    return out;
  }

  buffer(name: Sfx, variant: number): AudioBuffer {
    const key = `${name}:${variant}`;
    let b = this.cache.get(key);
    if (!b) {
      const sr = sfxRate(name, this.ctx.sampleRate);
      b = toAudioBuffer(this.ctx, renderSfx(name, sr, this.seed, variant), sr);
      this.cache.set(key, b);
    }
    return b;
  }

  /** Next (name, variant) not yet rendered — for idle-time pre-warming. */
  nextToWarm(order: readonly Sfx[] = SFX_NAMES): [Sfx, number] | null {
    for (const name of order) {
      const n = SFX_DEFS[name].variants;
      for (let v = 0; v < n; v++) if (!this.cache.has(`${name}:${v}`)) return [name, v];
    }
    return null;
  }

  private sendFor(amount: number): GainNode {
    const key = Math.round(amount * 100);
    let s = this.sends.get(key);
    if (!s) {
      s = this.ctx.createGain();
      s.gain.value = amount;
      s.connect(this.verb);
      this.sends.set(key, s);
    }
    return s;
  }

  private prune(now: number): void {
    this.active = this.active.filter((a) => a.end > now);
  }

  /** Plays an SFX at ctx time `t`. Returns its definition, or null if dropped. */
  play(name: Sfx, t: number, o: SfxOptions = {}): SfxDef | null {
    const def = SFX_DEFS[name];
    if (!def) return null;
    const now = this.ctx.currentTime;
    this.prune(now);
    // throttle identical sounds stacking on the same instant
    const times = (this.recent.get(name) ?? []).filter((x) => Math.abs(x - t) < this.throttleSec);
    if (times.length >= this.maxSame && def.priority < 2) {
      this.dropped++;
      return null;
    }
    times.push(t);
    this.recent.set(name, times);
    // polyphony cap
    if (this.active.length >= this.maxVoices) {
      if (def.priority === 0) {
        this.dropped++;
        return null;
      }
      let victim = -1;
      for (let i = 0; i < this.active.length; i++) {
        const a = this.active[i];
        if (a.priority > def.priority) continue;
        if (victim < 0 || a.priority < this.active[victim].priority || a.start < this.active[victim].start) victim = i;
      }
      if (victim < 0) {
        this.dropped++;
        return null;
      }
      const v = this.active[victim];
      try {
        v.env.gain.cancelScheduledValues(now);
        v.env.gain.setTargetAtTime(0, now, 0.01);
        v.src.stop(now + 0.06);
      } catch {
        /* ignore */
      }
      this.active.splice(victim, 1);
    }

    const variant = (this.rr.get(name) ?? 0) % def.variants;
    this.rr.set(name, variant + 1);
    const buffer = this.buffer(name, variant);
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const jit = name === 'ui' || name === 'uiConfirm' || name === 'combo' ? 1 : 1 + (this.jitter() - 0.5) * 0.05;
    const rate = Math.max(0.25, Math.min(4, (o.pitch ?? 1) * jit));
    src.playbackRate.value = rate;
    const env = ctx.createGain();
    env.gain.value = def.gain * Math.max(0, o.gain ?? 1);
    src.connect(env);
    const nodes: AudioNode[] = [src, env];
    let out: AudioNode = env;
    if (o.pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      env.connect(p);
      out = p;
      nodes.push(p);
    }
    out.connect(this.dest);
    if (def.verb > 0) out.connect(this.sendFor(def.verb));
    const start = Math.max(t, now);
    const dur = buffer.duration / rate;
    src.start(start);
    src.onended = () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    };
    this.active.push({ name, start, end: start + dur, src, env, priority: def.priority });
    if (this.active.length > this.peakVoices) this.peakVoices = this.active.length;
    return def;
  }

  get cachedCount(): number {
    return this.cache.size;
  }

  get activeCount(): number {
    return this.active.length;
  }
}
