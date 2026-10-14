/**
 * FX & mixing graph: waveshaper curves, procedural reverb impulse responses
 * and the persistent bus graph.
 *
 *  drums ──────────────────────────────┐
 *  808 chains → bassPump ──────────────┤
 *  cowbell/pad/lead/chants → melPump ──┤
 *  risers/impacts/crash → fx ──────────┤
 *  plate/delay returns → melPump       │
 *  hall return ────────────────────────┴→ music.sum → sectionLP → hp → glue → drive → softclip
 *        → slowLP → tape(delay) → tapeGain → duck → level → vol(prefs) ─┐
 *  sfx → sfxVol ─────────────────────────────────────────────────────────┤
 *  ambience → ambGain → sfxVol                                           ├→ master → limiter → clip(≤0.97) → out(volumeLimit)
 *  voice → voiceVol ─────────────────────────────────────────────────────┘
 */
import { SVF, normalize, type Channels } from './dsp';
import { rngFor } from './rng';

// ---------------------------------------------------------------- curves

function curve(n: number, fn: (x: number) => number): Float32Array<ArrayBuffer> {
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) c[i] = fn((i / (n - 1)) * 2 - 1);
  return c;
}

export function tanhCurve(drive: number, n = 2048): Float32Array<ArrayBuffer> {
  const norm = Math.tanh(drive);
  return curve(n, (x) => Math.tanh(x * drive) / norm);
}

/** Near-square clipping with a short knee (the mandelão "Brazilian bass"). */
export function hardCurve(drive: number, n = 2048): Float32Array<ArrayBuffer> {
  const p = 5;
  const f = (x: number) => (x * drive) / Math.pow(1 + Math.pow(Math.abs(x * drive), p), 1 / p);
  const norm = f(1);
  return curve(n, (x) => f(x) / norm);
}

/** Asymmetric saturation → adds even harmonics (audible on phone speakers). */
export function asymCurve(drive: number, bias = 0.25, n = 2048): Float32Array<ArrayBuffer> {
  const f = (x: number) => Math.tanh(drive * (x + bias)) - Math.tanh(drive * bias);
  const norm = Math.max(Math.abs(f(1)), Math.abs(f(-1)));
  return curve(n, (x) => f(x) / norm);
}

/** Linear below `knee`, smooth saturation up to `ceiling`. Output never exceeds ±ceiling. */
export function softClipCurve(ceiling = 0.97, knee = 0.72, n = 4096): Float32Array<ArrayBuffer> {
  const range = ceiling - knee;
  return curve(n, (x) => {
    const a = Math.abs(x);
    if (a <= knee) return x;
    const y = knee + range * Math.tanh((a - knee) / range);
    return Math.sign(x) * Math.min(ceiling, y);
  });
}

// ---------------------------------------------------------------- impulse responses

export interface IROptions {
  seconds: number;
  predelay: number;
  /** Lowpass cutoff at the start and at the end of the tail (darkening). */
  bright: number;
  dark: number;
  /** Early reflections count. */
  early: number;
  seed: number;
}

/** Decorrelated stereo exponential-decay noise IR with darkening tail + early reflections. */
export function makeIR(sr: number, o: IROptions): Channels {
  const n = Math.ceil(sr * o.seconds);
  const pre = Math.floor(sr * o.predelay);
  const chs: Channels = [];
  for (let ch = 0; ch < 2; ch++) {
    const rng = rngFor(o.seed, 'ir', ch);
    const d = new Float32Array(n);
    const svf = new SVF(sr, o.bright, 0.6);
    for (let i = pre; i < n; i++) {
      const u = (i - pre) / (n - pre);
      if ((i & 63) === 0) svf.set(o.bright * Math.pow(o.dark / o.bright, u), 0.6);
      svf.tick(rng() * 2 - 1);
      // -60 dB at the end, gentle fade-in to avoid a hard onset
      d[i] = svf.lp * Math.pow(10, (-3 * u)) * Math.min(1, (i - pre) / (sr * 0.004));
    }
    for (let k = 0; k < o.early; k++) {
      const t = pre + Math.floor(sr * (0.004 + rng() * 0.06));
      if (t < n) d[t] += (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.5) * 0.6;
    }
    chs.push(d);
  }
  return normalize(chs, 0.9);
}

export const IR_PLATE: Omit<IROptions, 'seed'> = { seconds: 2.2, predelay: 0.012, bright: 9000, dark: 2600, early: 10 };
export const IR_HALL: Omit<IROptions, 'seed'> = { seconds: 5.5, predelay: 0.03, bright: 6500, dark: 1100, early: 14 };
export const IR_ROOM: Omit<IROptions, 'seed'> = { seconds: 1.0, predelay: 0.006, bright: 8000, dark: 2500, early: 8 };

// ---------------------------------------------------------------- Web Audio helpers

export function toAudioBuffer(ctx: BaseAudioContext, chs: Channels, sampleRate = ctx.sampleRate): AudioBuffer {
  const b = ctx.createBuffer(chs.length, chs[0].length, sampleRate);
  for (let c = 0; c < chs.length; c++) b.getChannelData(c).set(chs[c]);
  return b;
}

function gain(ctx: BaseAudioContext, v = 1): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

function panner(ctx: BaseAudioContext, pan: number): AudioNode {
  if (typeof ctx.createStereoPanner !== 'function') return gain(ctx, 1);
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  return p;
}

function shaper(ctx: BaseAudioContext, c: Float32Array<ArrayBuffer>, oversample: OverSampleType = 'none'): WaveShaperNode {
  const s = ctx.createWaveShaper();
  s.curve = c;
  s.oversample = oversample;
  return s;
}

export interface Graph {
  ctx: BaseAudioContext;
  out: GainNode;
  master: GainNode;
  /** Master dynamics (exposed for QA bypass). */
  limiter: DynamicsCompressorNode;
  clip: WaveShaperNode;
  musicClip: WaveShaperNode;
  music: {
    sum: GainNode;
    sectionLP: BiquadFilterNode;
    /** Section high-pass (build sweeps). */
    sectionHP: BiquadFilterNode;
    /** Hard mute used for the pre-drop silence. */
    gate: GainNode;
    glue: DynamicsCompressorNode;
    drive: GainNode;
    slowLP: BiquadFilterNode;
    /** Slow-motion reverb send (tapped after the clipper, returns into slowLP — no cycle). */
    slowSend: GainNode;
    slowVerb: ConvolverNode;
    tape: DelayNode;
    tapeGain: GainNode;
    wobbleDepth: GainNode;
    duck: GainNode;
    level: GainNode;
    vol: GainNode;
  };
  drums: GainNode;
  bassPump: GainNode;
  /** 808 bus output (static level; the pump automates `bassPump`). */
  bassOut: GainNode;
  mel: GainNode;
  melPump: GainNode;
  fx: GainNode;
  /** Instrument sub-buses feeding `mel` (persistent pans/filters). */
  cowbellL: AudioNode;
  cowbellR: AudioNode;
  cowbellC: AudioNode;
  padL: AudioNode;
  padR: AudioNode;
  padFilter: BiquadFilterNode;
  lead: GainNode;
  leadL: AudioNode;
  leadR: AudioNode;
  chant: GainNode;
  sends: { verb: GainNode; hall: GainNode; delay: GainNode; sfxVerb: GainNode };
  delayL: DelayNode;
  delayR: DelayNode;
  /** Both feedback hops (L→R, R→L); keep their gains equal. */
  delayFb: [GainNode, GainNode];
  plate: ConvolverNode;
  hallVerb: ConvolverNode;
  room: ConvolverNode;
  hallReturn: GainNode;
  sfx: GainNode;
  sfxVol: GainNode;
  amb: GainNode;
  voice: GainNode;
  voiceVol: GainNode;
  lfo: OscillatorNode;
  leadLfo: GainNode;
}

/** Builds every persistent node. IR buffers are attached later (idle time). */
export function buildGraph(ctx: BaseAudioContext): Graph {
  // ---- output stage
  const out = gain(ctx, 0.9);
  out.connect(ctx.destination);
  const clip = shaper(ctx, softClipCurve(0.89, 0.7), '2x');
  clip.connect(out);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  limiter.connect(clip);
  const master = gain(ctx, 1);
  master.connect(limiter);

  // ---- music chain
  const vol = gain(ctx, 0.7);
  vol.connect(master);
  const level = gain(ctx, 1);
  level.connect(vol);
  const gate = gain(ctx, 1);
  gate.connect(level);
  const duck = gain(ctx, 1);
  duck.connect(gate);
  const tapeGain = gain(ctx, 1);
  tapeGain.connect(duck);
  const tape = ctx.createDelay(2);
  tape.delayTime.value = 0;
  tape.connect(tapeGain);
  const slowLP = biquad(ctx, 'lowpass', 20000, 0.9);
  slowLP.connect(tape);
  const post = gain(ctx, 0.92);
  post.connect(slowLP);
  const slowSend = gain(ctx, 0);
  const slowVerb = ctx.createConvolver();
  const slowReturn = gain(ctx, 1);
  post.connect(slowSend).connect(slowVerb).connect(slowReturn).connect(slowLP);
  const mclip = shaper(ctx, softClipCurve(0.98, 0.7), '2x');
  mclip.connect(post);
  const drive = gain(ctx, 1.05);
  drive.connect(mclip);
  // glue: slow-ish attack lets kick/clap transients punch through, release breathes with the groove
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -14;
  glue.knee.value = 6;
  glue.ratio.value = 2.5;
  glue.attack.value = 0.018;
  glue.release.value = 0.12;
  glue.connect(drive);
  const hp = biquad(ctx, 'highpass', 28, 0.7);
  const mud = biquad(ctx, 'peaking', 320, 1);
  mud.gain.value = -2.5;
  const air = biquad(ctx, 'highshelf', 7500, 0.7);
  air.gain.value = 3;
  hp.connect(mud).connect(air).connect(glue);
  const sectionHP = biquad(ctx, 'highpass', 20, 0.7);
  sectionHP.connect(hp);
  const sectionLP = biquad(ctx, 'lowpass', 20000, 0.8);
  sectionLP.connect(sectionHP);
  // input trim: instrument levels are written hot, the trim keeps the glue/clip stage in its sweet spot
  const sum = gain(ctx, 0.5);
  sum.connect(sectionLP);

  // slow-motion wobble: LFO → delayTime (depth 0 until slowmo)
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.55;
  const wobbleDepth = gain(ctx, 0);
  lfo.connect(wobbleDepth).connect(tape.delayTime);
  // shared vibrato LFO for the screech lead (detune in cents)
  const leadLfo = gain(ctx, 22);
  const vib = ctx.createOscillator();
  vib.frequency.value = 5.6;
  vib.connect(leadLfo);
  lfo.start();
  vib.start();

  // ---- instrument buses
  const drums = gain(ctx, 1);
  drums.connect(sum);
  const bassOut = gain(ctx, 1);
  bassOut.connect(sum);
  const bassPump = gain(ctx, 1);
  bassPump.connect(bassOut);
  const melPump = gain(ctx, 1);
  melPump.connect(sum);
  const mel = gain(ctx, 1);
  mel.connect(melPump);
  const fx = gain(ctx, 1);
  fx.connect(sum);

  // cowbell: presence + Haas widener (dry left-ish, 12 ms copy right-ish) — wide yet mono-safe enough
  const cowbellBus = gain(ctx, 1);
  const cowPresence = biquad(ctx, 'peaking', 2000, 0.9);
  cowPresence.gain.value = 1;
  const cowNotch = biquad(ctx, 'peaking', 3200, 2.5);
  cowNotch.gain.value = -3;
  cowbellBus.connect(cowNotch).connect(cowPresence);
  const cowDry = panner(ctx, -0.25);
  cowPresence.connect(cowDry).connect(mel);
  const haas = ctx.createDelay(0.05);
  haas.delayTime.value = 0.012;
  const haasGain = gain(ctx, 0.62);
  const haasPan = panner(ctx, 0.7);
  cowPresence.connect(haas).connect(haasGain).connect(haasPan).connect(mel);
  const cowbellL = panner(ctx, -0.4);
  const cowbellR = panner(ctx, 0.4);
  const cowbellC = gain(ctx, 1);
  cowbellL.connect(cowbellBus);
  cowbellR.connect(cowbellBus);
  cowbellC.connect(cowbellBus);

  const padFilter = biquad(ctx, 'lowpass', 1200, 0.5);
  const padHp = biquad(ctx, 'highpass', 160, 0.6);
  const padOut = gain(ctx, 1);
  padFilter.connect(padHp).connect(padOut);
  padOut.connect(mel);
  const padL = panner(ctx, -0.6);
  const padR = panner(ctx, 0.6);
  padL.connect(padFilter);
  padR.connect(padFilter);

  const lead = gain(ctx, 1);
  const leadHp = biquad(ctx, 'highpass', 320);
  const leadShape = shaper(ctx, tanhCurve(5), '2x');
  const leadPeak = biquad(ctx, 'peaking', 2600, 1.1);
  leadPeak.gain.value = 2;
  const leadCut = biquad(ctx, 'peaking', 3500, 2);
  leadCut.gain.value = -4;
  const leadLp = biquad(ctx, 'lowpass', 11000);
  lead.connect(leadHp).connect(leadShape).connect(leadPeak).connect(leadCut).connect(leadLp).connect(mel);
  // supersaw voices are split across two panned inputs (wide lead)
  const leadL = panner(ctx, -0.75);
  const leadR = panner(ctx, 0.75);
  leadL.connect(lead);
  leadR.connect(lead);

  const chant = gain(ctx, 1);
  const chantHp = biquad(ctx, 'highpass', 150);
  const chantShape = shaper(ctx, tanhCurve(1.8));
  const chantPeak = biquad(ctx, 'peaking', 2400, 1);
  chantPeak.gain.value = 3;
  chant.connect(chantHp).connect(chantShape).connect(chantPeak).connect(mel);

  // ---- sends
  const verb = gain(ctx, 1);
  const plate = ctx.createConvolver();
  const verbReturn = gain(ctx, 0.9);
  verb.connect(plate).connect(verbReturn).connect(melPump);

  const hall = gain(ctx, 1);
  const hallVerb = ctx.createConvolver();
  const hallReturn = gain(ctx, 1);
  hall.connect(hallVerb).connect(hallReturn).connect(sum);

  // ping-pong delay
  const delay = gain(ctx, 1);
  const delayL = ctx.createDelay(3);
  const delayR = ctx.createDelay(3);
  const delayFb = gain(ctx, 0.32);
  const delayFb2 = gain(ctx, 0.32);
  const dlp = biquad(ctx, 'lowpass', 3800);
  const dhp = biquad(ctx, 'highpass', 400);
  const dRet = gain(ctx, 0.55);
  const dPanL = panner(ctx, -0.85);
  const dPanR = panner(ctx, 0.85);
  delay.connect(dhp).connect(delayL);
  delayL.connect(dPanL).connect(dRet);
  delayL.connect(dlp).connect(delayFb).connect(delayR);
  delayR.connect(dPanR).connect(dRet);
  delayR.connect(delayFb2).connect(delayL);
  dRet.connect(melPump);

  // ---- sfx, ambience, voice
  const sfxVol = gain(ctx, 0.85);
  sfxVol.connect(master);
  const sfx = gain(ctx, 1);
  sfx.connect(sfxVol);
  const sfxVerb = gain(ctx, 1);
  const room = ctx.createConvolver();
  const roomReturn = gain(ctx, 0.8);
  sfxVerb.connect(room).connect(roomReturn).connect(sfxVol);
  const amb = gain(ctx, 0.5);
  amb.connect(sfxVol);
  const voiceVol = gain(ctx, 0.9);
  voiceVol.connect(master);
  const voice = gain(ctx, 1);
  voice.connect(voiceVol);

  return {
    ctx,
    out,
    master,
    limiter,
    clip,
    musicClip: mclip,
    music: { sum, sectionLP, sectionHP, gate, glue, drive, slowLP, slowSend, slowVerb, tape, tapeGain, wobbleDepth, duck, level, vol },
    drums,
    bassPump,
    bassOut,
    mel,
    melPump,
    fx,
    cowbellL,
    cowbellR,
    cowbellC,
    padL,
    padR,
    padFilter,
    lead,
    leadL,
    leadR,
    chant,
    sends: { verb, hall, delay, sfxVerb },
    delayL,
    delayR,
    delayFb: [delayFb, delayFb2],
    plate,
    hallVerb,
    room,
    hallReturn,
    sfx,
    sfxVol,
    amb,
    voice,
    voiceVol,
    lfo,
    leadLfo,
  };
}
