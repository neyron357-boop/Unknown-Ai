/**
 * Real-time music instruments on top of the persistent graph.
 * Pre-rendered one-shots play as `BufferSource → Gain → bus` (2 nodes);
 * synthesized voices (808, pads, lead, risers) stay small and are
 * disconnected when they end. Every voice is registered so the engine can
 * cancel notes scheduled past a section change and report polyphony.
 */
import { COWBELL_REF, type KitId } from './kit';
import { asymCurve, hardCurve, tanhCurve, type Graph } from './fx';
import type { ShaperKind, StyleDef, StyleId } from './styles';
import { STYLES } from './styles';
import { mtof } from './theory';

export interface Voice {
  start: number;
  end: number;
  sources: AudioScheduledSourceNode[];
  env: GainNode | null;
  nodes: number;
  /** Extra teardown (e.g. disconnect LFO from detune params). */
  dispose?: () => void;
}

/** Registry of scheduled voices: cleanup, cancellation and polyphony stats. */
export class VoiceRegistry {
  private live: Voice[] = [];
  peakVoices = 0;
  peakNodes = 0;
  created = 0;

  add(v: Voice, all: AudioNode[]): void {
    this.created++;
    this.live.push(v);
    const last = v.sources[v.sources.length - 1];
    if (last) {
      last.onended = () => {
        for (const n of all) {
          try {
            n.disconnect();
          } catch {
            /* already disconnected */
          }
        }
        v.dispose?.();
      };
    }
  }

  /** Silences voices that start at/after `t` (ctx seconds). */
  cancelFrom(t: number): number {
    let n = 0;
    for (const v of this.live) {
      if (v.start < t - 1e-4) continue;
      n++;
      if (v.env) {
        try {
          v.env.gain.cancelScheduledValues(0);
          v.env.gain.setValueAtTime(0, 0);
        } catch {
          /* ignore */
        }
      }
      for (const s of v.sources) {
        try {
          s.stop(t);
        } catch {
          /* Safari < 14.1 throws on a second stop() — the zeroed envelope keeps it silent */
        }
      }
      v.end = Math.min(v.end, t);
    }
    return n;
  }

  /** Drops finished voices and updates the peak counters. */
  prune(now: number): void {
    let w = 0;
    let voices = 0;
    let nodes = 0;
    for (const v of this.live) {
      if (v.end + 0.25 < now) continue;
      this.live[w++] = v;
      if (v.start <= now + 0.2) {
        voices++;
        nodes += v.nodes;
      }
    }
    this.live.length = w;
    if (voices > this.peakVoices) this.peakVoices = voices;
    if (nodes > this.peakNodes) this.peakNodes = nodes;
  }

  /** Live voices at `now` (and node estimate). */
  count(now: number): { voices: number; nodes: number } {
    let voices = 0;
    let nodes = 0;
    for (const v of this.live) {
      if (v.start <= now + 0.2 && v.end >= now) {
        voices++;
        nodes += v.nodes;
      }
    }
    return { voices, nodes };
  }

  get size(): number {
    return this.live.length;
  }
}

interface BassChain {
  input: GainNode;
  dirty: GainNode;
  sub: GainNode;
  tone: BiquadFilterNode;
  layer: OscillatorType;
}

export interface PlayOpts {
  rate?: number;
  pan?: number;
  /** Seconds into the buffer to start from. */
  offset?: number;
  /** Max duration to play (seconds). */
  dur?: number;
  /** Extra send amounts (0..1) into the plate/hall/delay. */
  verb?: number;
  hall?: number;
  delay?: number;
}

export class Instruments {
  /** Playback-rate factor applied to new notes (slow-motion detune). */
  detune = 1;
  /** Current style (bass chain, cowbell flavour, cutoffs). */
  style: StyleId = 'mandelao';
  /** Sidechain depths of the current section. */
  pumpBass = 0;
  pumpMel = 0;
  beatSec = 0.46;

  private bassChains = new Map<StyleId, BassChain>();
  private lastBass: { env: GainNode; end: number } | null = null;
  private sendGains = new Map<string, GainNode>();

  constructor(
    private g: Graph,
    private kit: (id: KitId) => AudioBuffer,
    private noise: AudioBuffer,
    private voices: VoiceRegistry,
  ) {}

  private get ctx(): BaseAudioContext {
    return this.g.ctx;
  }

  /** Persistent per-route send gain (so per-note sends cost no extra nodes). */
  private send(name: string, target: AudioNode, amount: number): GainNode {
    let s = this.sendGains.get(name);
    if (!s) {
      s = this.ctx.createGain();
      s.gain.value = amount;
      s.connect(target);
      this.sendGains.set(name, s);
    }
    return s;
  }

  // ---------------------------------------------------------------- sampler

  /** Plays a pre-rendered buffer: source → gain → dest (+ optional sends). Returns the env gain. */
  sample(id: KitId, t: number, vel: number, dest: AudioNode, o: PlayOpts = {}): GainNode | null {
    const buffer = this.kit(id);
    if (!buffer) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const rate = (o.rate ?? 1) * this.detune;
    if (rate !== 1) src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = vel;
    src.connect(g);
    g.connect(dest);
    const nodes: AudioNode[] = [src, g];
    if (o.verb) g.connect(this.send(`verb${o.verb}`, this.g.sends.verb, o.verb));
    if (o.hall) g.connect(this.send(`hall${o.hall}`, this.g.sends.hall, o.hall));
    if (o.delay) g.connect(this.send(`delay${o.delay}`, this.g.sends.delay, o.delay));
    const offset = Math.max(0, o.offset ?? 0);
    const remaining = (buffer.duration - offset) / rate;
    const dur = Math.min(remaining, o.dur ?? remaining);
    src.start(t, offset);
    src.stop(t + dur + 0.01);
    this.voices.add({ start: t, end: t + dur, sources: [src], env: g, nodes: 2 }, nodes);
    return g;
  }

  // ---------------------------------------------------------------- drums

  drum(id: KitId, t: number, vel: number, kind: 'kick' | 'snare' | 'clap' | 'hat' | 'perc' | 'rim' | 'heart', rate = 1): void {
    const levels = { kick: 1, snare: 0.66, clap: 0.6, hat: 0.42, perc: 0.38, rim: 0.3, heart: 1.2 } as const;
    const st = STYLES[this.style];
    const v = vel * levels[kind] * (kind === 'kick' ? st.kickGain : kind === 'hat' ? st.hatGain : 1);
    if (kind === 'snare' || kind === 'clap') {
      this.sample(id, t, v, this.g.drums, { verb: 0.18, rate });
      return;
    }
    if (kind === 'heart') {
      this.sample(id, t, v, this.g.drums, { hall: 0.25 });
      return;
    }
    this.sample(id, t, v, this.g.drums, { rate });
    if (kind === 'kick') this.pump(t, vel);
  }

  /** Sidechain "pump": dips the 808 and melodic buses on a kick. */
  pump(t: number, vel = 1): void {
    // ~1 ms attack, 20 ms hold, ~75–100 ms release: the hard phonk duck
    const rel = Math.min(0.045, Math.max(0.025, this.beatSec * 0.075));
    const duck = (p: AudioParam, depth: number) => {
      if (depth <= 0) return;
      p.setTargetAtTime(1 - depth * Math.min(1, vel), t, 0.0012);
      p.setTargetAtTime(1, t + 0.02, rel);
    };
    duck(this.g.bassPump.gain, this.pumpBass);
    duck(this.g.melPump.gain, this.pumpMel);
  }

  // ---------------------------------------------------------------- 808

  private bassChain(style: StyleId): BassChain {
    let c = this.bassChains.get(style);
    if (c) return c;
    const ctx = this.ctx;
    const s: StyleDef = STYLES[style];
    const input = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = shapeCurve(s.bassCurve, s.bassDrive);
    shaper.oversample = '2x';
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = s.bassTone;
    tone.Q.value = 0.6;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 70; // the driven path carries the audible harmonics, the sub path the weight
    const dirty = ctx.createGain();
    dirty.gain.value = s.bassDirty;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = s.bassMid[0];
    mid.Q.value = 0.9;
    mid.gain.value = s.bassMid[1];
    input.connect(shaper).connect(tone).connect(mid).connect(hp).connect(dirty).connect(this.g.bassPump);
    const subLp = ctx.createBiquadFilter();
    subLp.type = 'lowpass';
    subLp.frequency.value = 120;
    const sub = ctx.createGain();
    sub.gain.value = s.bassSub;
    input.connect(subLp).connect(sub).connect(this.g.bassPump);
    c = { input, dirty, sub, tone, layer: s.bassLayer };
    this.bassChains.set(style, c);
    return c;
  }

  /** Distorted 808 with pitch punch, optional onset dive (`bend`) and end slide. */
  bass(t: number, midi: number, durSec: number, vel: number, slide?: number, bend?: number, style: StyleId = this.style): void {
    const ctx = this.ctx;
    const s = STYLES[style];
    const chain = this.bassChain(style);
    const f = mtof(midi) * this.detune;
    // mono: choke the previous 808
    if (this.lastBass && this.lastBass.end > t) {
      const p = this.lastBass.env.gain;
      p.cancelScheduledValues(t);
      p.setTargetAtTime(0, t, 0.006);
    }
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o2.type = chain.layer;
    const env = ctx.createGain();
    const o2g = ctx.createGain();
    o2g.gain.value = chain.layer === 'triangle' ? 0.3 : 0.16;
    o1.connect(env);
    o2.connect(o2g).connect(env);
    env.connect(chain.input);
    const start = bend ? f * Math.pow(2, bend / 12) : f * s.bassPunch;
    // pitch dive: bigger bends take longer to land (the mandelão "bwOOM")
    const settle = bend ? Math.min(0.25, 0.05 + 0.01 * Math.abs(bend)) : 0.03;
    for (const [o, mul] of [
      [o1, 1],
      [o2, 2],
    ] as const) {
      o.frequency.setValueAtTime(start * mul, t);
      o.frequency.exponentialRampToValueAtTime(f * mul, t + settle);
      if (slide !== undefined && slide !== midi) {
        const glide = Math.min(0.11, durSec * 0.5);
        const ts = Math.max(t + settle + 0.005, t + durSec - glide);
        o.frequency.setValueAtTime(f * mul, ts);
        o.frequency.exponentialRampToValueAtTime(mtof(slide) * this.detune * mul, t + durSec);
      }
    }
    const peakG = 0.85 * vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peakG, t + 0.004);
    env.gain.setTargetAtTime(peakG * 0.35, t + 0.01, s.bassDecay);
    const rel = t + Math.max(0.05, durSec - 0.012);
    env.gain.setTargetAtTime(0, rel, 0.014);
    const end = rel + 0.09;
    o1.start(t);
    o2.start(t);
    o1.stop(end);
    o2.stop(end);
    this.lastBass = { env, end };
    this.voices.add({ start: t, end, sources: [o1, o2], env, nodes: 4 }, [o1, o2, o2g, env]);
  }

  /** Applies a style's 808 tone settings (called on section change). */
  setStyle(style: StyleId, t: number): void {
    this.style = style;
    const s = STYLES[style];
    this.g.padFilter.frequency.setTargetAtTime(s.padCutoff, t, 0.1);
    this.bassChain(style);
  }

  // ---------------------------------------------------------------- cowbell (pitched 808 sampler)

  cowbell(t: number, midi: number, vel: number, flavor: 'dirty' | 'clean' | 'unison', pan = 0, hall = 0): void {
    const useHi = Math.abs(midi - COWBELL_REF.hi) < Math.abs(midi - COWBELL_REF.lo);
    const ids: Record<typeof flavor, [KitId, KitId]> = {
      dirty: ['cowDirtyLo', 'cowDirtyHi'],
      clean: ['cowCleanLo', 'cowCleanHi'],
      unison: ['cowUniLo', 'cowUniHi'],
    };
    const id = ids[flavor][useHi ? 1 : 0];
    const ref = useHi ? COWBELL_REF.hi : COWBELL_REF.lo;
    const dest = pan < -0.1 ? this.g.cowbellL : pan > 0.1 ? this.g.cowbellR : this.g.cowbellC;
    this.sample(id, t, vel * 0.84 * STYLES[this.style].cowbellGain, dest, { rate: Math.pow(2, (midi - ref) / 12), verb: 0.26, delay: 0.3, hall });
  }

  // ---------------------------------------------------------------- pad (Memphis dark)

  pad(t: number, notes: readonly number[], durSec: number, vel: number): void {
    const ctx = this.ctx;
    const gL = ctx.createGain();
    const gR = ctx.createGain();
    const atk = Math.min(0.35, durSec * 0.2);
    const peakG = 0.08 * vel * STYLES[this.style].padGain;
    for (const g of [gL, gR]) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peakG, t + atk);
      g.gain.setTargetAtTime(peakG * 0.75, t + atk, durSec * 0.5);
      g.gain.setTargetAtTime(0, t + durSec, 0.18);
    }
    gL.connect(this.g.padL);
    gR.connect(this.g.padR);
    const verb = this.send('padVerb', this.g.sends.verb, 0.5);
    gL.connect(verb);
    gR.connect(verb);
    const end = t + durSec + 0.9;
    const oscs: OscillatorNode[] = [];
    notes.forEach((n, i) => {
      const f = mtof(n) * this.detune;
      for (const [g, det] of [
        [gL, -9 - i * 1.5],
        [gR, 9 + i * 1.5],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(end);
        oscs.push(o);
      }
    });
    this.voices.add({ start: t, end, sources: oscs, env: gL, nodes: oscs.length + 2 }, [...oscs, gL, gR]);
  }

  /** Hall send for slowed sections (pads bloom into the huge reverb). */
  padHall(amount: number, t: number): void {
    this.send('padHall', this.g.sends.hall, 0).gain.setTargetAtTime(amount, t, 0.2);
  }

  // ---------------------------------------------------------------- screech lead (hyper)

  lead(t: number, midi: number, durSec: number, vel: number, bend?: number): void {
    const ctx = this.ctx;
    const f = mtof(midi) * this.detune;
    const envL = ctx.createGain();
    const envR = ctx.createGain();
    const peakG = 0.05 * vel;
    for (const env of [envL, envR]) {
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peakG, t + 0.006);
      env.gain.setTargetAtTime(peakG * 0.8, t + 0.02, 0.3);
      env.gain.setTargetAtTime(0, t + durSec, 0.025);
      env.connect(this.send('leadDelay', this.g.sends.delay, 0.28));
      env.connect(this.send('leadVerb', this.g.sends.verb, 0.3));
    }
    envL.connect(this.g.leadL);
    envR.connect(this.g.leadR);
    const end = t + durSec + 0.15;
    const oscs: OscillatorNode[] = [];
    // 5-voice supersaw, 15-cent spread, alternating sides
    [-15, 7, 0, -7, 15].forEach((det, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      if (bend) {
        o.frequency.setValueAtTime(f * Math.pow(2, bend / 12), t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
      } else o.frequency.value = f;
      o.detune.value = det;
      this.g.leadLfo.connect(o.detune);
      o.connect(i === 2 ? envL : i % 2 ? envR : envL);
      if (i === 2) o.connect(envR);
      o.start(t);
      o.stop(end);
      oscs.push(o);
    });
    const lfo = this.g.leadLfo;
    this.voices.add(
      {
        start: t,
        end,
        sources: oscs,
        env: envL,
        nodes: 7,
        dispose: () => {
          for (const o of oscs) {
            try {
              lfo.disconnect(o.detune);
            } catch {
              /* ignore */
            }
          }
        },
      },
      [...oscs, envL, envR],
    );
  }

  // ---------------------------------------------------------------- vocal chops

  chant(t: number, buffer: AudioBuffer, rate: number, lenSec: number, vel: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate * this.detune;
    const env = ctx.createGain();
    const len = Math.min(lenSec, buffer.duration / rate);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.004);
    env.gain.setTargetAtTime(0, t + len, 0.014);
    src.connect(env);
    env.connect(this.g.chant);
    env.connect(this.send('chantVerb', this.g.sends.verb, 0.3));
    env.connect(this.send('chantDelay', this.g.sends.delay, 0.16));
    src.start(t);
    src.stop(t + len + 0.1);
    this.voices.add({ start: t, end: t + len + 0.1, sources: [src], env, nodes: 2 }, [src, env]);
  }

  // ---------------------------------------------------------------- riser (sized to the build)

  riser(t: number, durSec: number, vel: number, startMidi = 53): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(7200, t + durSec);
    bp.Q.setValueAtTime(1.2, t);
    bp.Q.linearRampToValueAtTime(3.5, t + durSec);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.28 * vel, t + durSec);
    env.gain.setTargetAtTime(0, t + durSec, 0.01);
    src.connect(bp).connect(env);
    const tone = ctx.createGain();
    tone.gain.setValueAtTime(0, t);
    tone.gain.linearRampToValueAtTime(0.06 * vel, t + durSec);
    tone.gain.setTargetAtTime(0, t + durSec, 0.01);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(6000, t + durSec);
    const oscs: OscillatorNode[] = [];
    for (const det of [-12, 12]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = det;
      o.frequency.setValueAtTime(mtof(startMidi), t);
      o.frequency.exponentialRampToValueAtTime(mtof(startMidi + 12), t + durSec);
      o.connect(lp);
      oscs.push(o);
    }
    lp.connect(tone);
    env.connect(this.g.fx);
    tone.connect(this.g.fx);
    env.connect(this.send('riserVerb', this.g.sends.verb, 0.4));
    const end = t + durSec + 0.08;
    src.start(t, (t * 0.37) % 1);
    src.stop(end);
    for (const o of oscs) {
      o.start(t);
      o.stop(end);
    }
    this.voices.add({ start: t, end, sources: [src, ...oscs], env, nodes: 8 }, [src, bp, env, tone, lp, ...oscs]);
  }
}

export function shapeCurve(kind: ShaperKind, drive: number): Float32Array<ArrayBuffer> {
  return kind === 'hard' ? hardCurve(drive) : kind === 'asym' ? asymCurve(drive) : tanhCurve(drive);
}
