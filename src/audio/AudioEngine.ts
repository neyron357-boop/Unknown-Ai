/**
 * UNKNOWN audio engine — everything is synthesized with the Web Audio API.
 * No samples, no licensing, tiny download.
 *
 * The music is *conducted by the game*: the MissionDirector announces sections
 * (round grooves) with their bpm and start time on its own clock, and the
 * engine schedules every 16th-note against that clock (`pump`). Enemy impacts
 * and the kick drum therefore land on the same beat.
 *
 *   layers → musicBus → musicFilter ─┐
 *   sfx ───→ sfxBus ─────────────────┼→ master → limiter → destination
 *   sends ─→ reverb ─────────────────┘
 *
 * The AudioContext is created/resumed only inside a user gesture (`unlock`).
 */

export type SectionId = 'menu' | 'intro' | 'takt' | 'phantoms' | 'overcharge' | 'ascension' | 'halftime' | 'finale' | 'breakdown' | 'outro';

export type SfxName =
  | 'ui'
  | 'tick'
  | 'tickHigh'
  | 'tickMid'
  | 'tickLow'
  | 'revealHigh'
  | 'revealMid'
  | 'revealLow'
  | 'enemySwing'
  | 'parryPerfect'
  | 'parryGood'
  | 'duck'
  | 'jump'
  | 'hit'
  | 'fooled'
  | 'stray'
  | 'whiff'
  | 'strike'
  | 'strikeOff'
  | 'strikeFinal'
  | 'orbSpawn'
  | 'orbGood'
  | 'orbBad'
  | 'clash'
  | 'recallBad'
  | 'ascend'
  | 'drop'
  | 'finisher'
  | 'lightning'
  | 'round'
  | 'card'
  | 'cardPick'
  | 'reboot'
  | 'echo'
  | 'phantomShift';

export interface AudioPrefs {
  musicOn: boolean;
  sfxOn: boolean;
  musicVolume: number;
  sfxVolume: number;
  volumeLimit: number;
}

type LayerName = 'pad' | 'kick' | 'snare' | 'hats' | 'rolls' | 'bass' | 'bell' | 'lead';
const LAYERS: LayerName[] = ['pad', 'kick', 'snare', 'hats', 'rolls', 'bass', 'bell', 'lead'];

// Note frequencies (Hz).
const F = {
  C1: 32.7, Db1: 34.65, Eb1: 38.89, F1: 43.65, Gb1: 46.25, G1: 49.0, Ab1: 51.91, Bb1: 58.27,
  C2: 65.41, Db2: 69.3, Eb2: 77.78, F2: 87.31, G2: 98.0, Ab2: 103.83, Bb2: 116.54,
  C3: 130.81, Db3: 138.59, Eb3: 155.56, F3: 174.61, G3: 196.0, Ab3: 207.65, Bb3: 233.08,
  C4: 261.63, Db4: 277.18, Eb4: 311.13, F4: 349.23, G4: 392.0, Ab4: 415.3, Bb4: 466.16,
  C5: 523.25, Db5: 554.37, Eb5: 622.25, F5: 698.46, G5: 783.99, Ab5: 830.61, Bb5: 932.33,
  C6: 1046.5, Db6: 1108.73, Eb6: 1244.51, F6: 1396.91,
};

type BassNote = [freq: number, lenSteps: number, glideTo?: number];

interface Groove {
  /** Base layer mix before hype. */
  mix: Partial<Record<LayerName, number>>;
  /** Layers that join at hype level n (index = level). */
  hype: LayerName[][];
  kick: number[];
  snare: number[];
  hats: string; // 32 chars: x = hat, o = accent, . = rest, 3 = triplet roll
  bass: Record<number, BassNote>;
  bell: Record<number, number>;
  lead: Record<number, number>;
  pad: number[]; // chord tones
  bellTone: 'cowbell' | 'glass';
}

// Original 2-bar phrases written for this project (F minor family).
const TAKT: Groove = {
  mix: { pad: 0.5, kick: 1, snare: 0.9, hats: 0.6 },
  hype: [[], ['bass'], ['bell'], ['rolls'], ['lead']],
  kick: [0, 3, 10, 16, 19, 26, 29],
  snare: [8, 24],
  hats: 'x.x.o.x.x.x.o.x3x.x.o.x.x.x.o.x3',
  bass: { 0: [F.F1, 6], 10: [F.Ab1, 4], 16: [F.Db2, 6], 26: [F.C2, 6, F.Eb2] },
  bell: { 0: F.C6, 3: F.C6, 6: F.Bb5, 8: F.Ab5, 11: F.G5, 14: F.Ab5, 16: F.C6, 19: F.C6, 22: F.Eb6, 24: F.Db6, 27: F.C6, 30: F.Bb5 },
  lead: { 0: F.F4, 4: F.Ab4, 8: F.C5, 12: F.Bb4, 16: F.Db5, 20: F.C5, 24: F.Ab4, 28: F.G4 },
  pad: [F.F2, F.Ab2, F.C3, F.Eb3],
  bellTone: 'cowbell',
};

const PHANTOMS: Groove = {
  mix: { pad: 0.7, kick: 0.9, snare: 0.7, hats: 0.5, bell: 0.6 },
  hype: [[], ['bass'], ['rolls'], ['lead'], ['lead']],
  kick: [0, 6, 10, 16, 22, 26],
  snare: [8, 24],
  hats: 'x..x..x.x..x..x.x..x..x.x.3x..x.',
  bass: { 0: [F.Db2, 8], 10: [F.C2, 4], 16: [F.Bb1, 8], 26: [F.C2, 6, F.Db2] },
  bell: { 0: F.F5, 2: F.Ab5, 4: F.C6, 7: F.Ab5, 10: F.G5, 12: F.Eb5, 16: F.F5, 18: F.Ab5, 20: F.Db6, 23: F.C6, 26: F.Bb5, 28: F.G5 },
  lead: { 0: F.Db5, 8: F.C5, 16: F.Bb4, 24: F.C5 },
  pad: [F.Db3, F.F3, F.Ab3, F.C4],
  bellTone: 'glass',
};

const OVERCHARGE: Groove = {
  mix: { pad: 0.4, kick: 1, snare: 1, hats: 0.75, bass: 0.7 },
  hype: [[], ['bell'], ['rolls'], ['lead'], ['lead']],
  kick: [0, 3, 6, 10, 16, 19, 22, 26, 29],
  snare: [8, 24, 30],
  hats: 'xoxoxoxoxoxoxo33xoxoxoxoxoxo3333',
  bass: { 0: [F.F1, 3], 3: [F.F1, 3], 6: [F.Ab1, 4], 10: [F.F1, 6], 16: [F.Eb1, 3], 19: [F.Eb1, 3], 22: [F.Gb1, 4], 26: [F.Ab1, 6, F.C2] },
  bell: { 0: F.F5, 2: F.F5, 4: F.Ab5, 6: F.F5, 8: F.C6, 10: F.Bb5, 12: F.Ab5, 14: F.G5, 16: F.Eb5, 18: F.Eb5, 20: F.G5, 22: F.Eb5, 24: F.Bb5, 26: F.Ab5, 28: F.G5, 30: F.F5 },
  lead: { 0: F.C5, 2: F.Eb5, 4: F.F5, 8: F.Ab5, 12: F.G5, 16: F.Eb5, 20: F.F5, 24: F.C5, 28: F.Bb4 },
  pad: [F.F2, F.Ab2, F.C3, F.Eb3],
  bellTone: 'cowbell',
};

const ASCENSION: Groove = { ...TAKT, mix: { pad: 0.5, kick: 1, snare: 1, hats: 0.8, bass: 0.9, bell: 0.7 }, hype: [[], ['rolls'], ['lead'], ['lead'], ['lead']] };
const FINALE: Groove = { ...TAKT, mix: { pad: 0.6, kick: 1, snare: 1, hats: 0.9, bass: 1, bell: 0.9, rolls: 0.8, lead: 0.7 }, hype: [[], [], [], [], []] };
const BREAKDOWN: Groove = { ...TAKT, mix: { pad: 0.8, kick: 0.5, hats: 0.3 }, hype: [[], [], [], [], []], kick: [0, 16], snare: [], hats: '..x...x...x...x...x...x...x...x.' };
const HALFTIME: Groove = { ...TAKT, mix: { pad: 1, kick: 0.8 }, hype: [[], [], [], [], []], kick: [0, 2], snare: [], hats: '................................' };
const INTRO: Groove = { ...TAKT, mix: { pad: 0.9, kick: 0.6 }, hype: [[], [], [], [], []], kick: [0, 3, 16, 19], snare: [], hats: '................................' };
const MENU: Groove = { ...TAKT, mix: { pad: 0.7 }, hype: [[], [], [], [], []], kick: [], snare: [], hats: '................................' };

const GROOVES: Record<SectionId, Groove> = {
  menu: MENU,
  intro: INTRO,
  takt: TAKT,
  phantoms: PHANTOMS,
  overcharge: OVERCHARGE,
  ascension: ASCENSION,
  halftime: HALFTIME,
  finale: FINALE,
  breakdown: BREAKDOWN,
  outro: MENU,
};

const RUNE_NOTES = [F.F5, F.Ab5, F.C6, F.Eb6, F.F6, F.Ab5 * 2];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private sfxBus!: GainNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private dist!: Float32Array<ArrayBuffer>;
  private layers = {} as Record<LayerName, GainNode>;

  private prefs: AudioPrefs = { musicOn: true, sfxOn: true, musicVolume: 0.7, sfxVolume: 0.85, volumeLimit: 0.9 };

  // conductor state (director clock, ms)
  private section: { id: SectionId; bpm: number; at: number } = { id: 'menu', bpm: 90, at: 0 };
  private nextStep = 0;
  private nextStepAt = 0;
  private hype = 0;
  private offset: number | null = null; // ctx seconds − director seconds
  private conducted = false;
  private freeTimer: number | null = null;
  private freeClock = 0;
  private lastPadAt = -Infinity;

  /** Diagnostics: context state ('none' before the first gesture). */
  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture handler. */
  unlock(): void {
    try {
      if (!this.ctx) this.build();
      const ctx = this.ctx!;
      if (ctx.state !== 'running') void ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
      if (!this.conducted) this.startFreeRun();
    } catch {
      // Audio is optional — the game keeps working without it.
    }
  }

  suspend(): void {
    this.stopFreeRun();
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') void this.ctx.resume();
    this.offset = null;
    if (!this.conducted) this.startFreeRun();
  }

  setPrefs(prefs: AudioPrefs): void {
    this.prefs = prefs;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(clamp01(prefs.volumeLimit), t, 0.05);
    this.musicBus.gain.setTargetAtTime(prefs.musicOn ? clamp01(prefs.musicVolume) * 0.75 : 0, t, 0.08);
    this.sfxBus.gain.setTargetAtTime(prefs.sfxOn ? clamp01(prefs.sfxVolume) : 0, t, 0.05);
  }

  // ------------------------------------------------------------------ conductor

  /** The game owns the clock from now on (mission running). */
  attachConductor(): void {
    this.conducted = true;
    this.stopFreeRun();
    this.offset = null;
  }

  /** Back to the self-running menu groove. */
  detachConductor(): void {
    this.conducted = false;
    this.setSection('menu', 84, 0);
    this.setHype(0);
    if (this.unlocked) this.startFreeRun();
  }

  setSection(id: SectionId, bpm: number, at: number): void {
    this.section = { id, bpm, at };
    this.nextStep = 0;
    this.nextStepAt = at;
    this.lastPadAt = -Infinity;
    this.applyMix(0.25);
    if (!this.ctx) return;
    const f = this.musicFilter.frequency;
    const t = this.ctx.currentTime;
    f.cancelScheduledValues(t);
    f.setTargetAtTime(id === 'halftime' ? 420 : id === 'breakdown' ? 1400 : 18000, t, id === 'halftime' ? 0.25 : 0.05);
  }

  setHype(level: number): void {
    if (level === this.hype) return;
    this.hype = level;
    this.applyMix(0.15);
  }

  /** Called every frame with the director clock (ms). Schedules notes ~150ms ahead. */
  pump(directorNow: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const measured = ctx.currentTime - directorNow / 1000;
    // Smooth frame jitter; hard-resync after pauses/hitches.
    if (this.offset === null || Math.abs(measured - this.offset) > 0.08) this.offset = measured;
    else this.offset += (measured - this.offset) * 0.05;
    this.schedule(directorNow + 150, (dirMs) => this.offset! + dirMs / 1000);
  }

  private schedule(untilDirMs: number, toCtx: (dirMs: number) => number): void {
    const ctx = this.ctx!;
    const stepMs = 60000 / this.section.bpm / 4;
    let guard = 0;
    while (this.nextStepAt < untilDirMs && guard++ < 64) {
      const when = toCtx(this.nextStepAt);
      if (when >= ctx.currentTime - 0.02) this.playStep(this.nextStep, Math.max(when, ctx.currentTime), stepMs / 1000);
      this.nextStep++;
      this.nextStepAt += stepMs;
    }
  }

  private startFreeRun(): void {
    if (this.freeTimer !== null || !this.ctx) return;
    this.freeClock = 0;
    this.section = { ...this.section, at: 0 };
    this.nextStep = 0;
    this.nextStepAt = 0;
    const startCtx = this.ctx.currentTime + 0.05;
    this.freeTimer = window.setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      this.freeClock = (this.ctx.currentTime - startCtx) * 1000;
      this.schedule(this.freeClock + 150, (dirMs) => startCtx + dirMs / 1000);
    }, 40);
  }

  private stopFreeRun(): void {
    if (this.freeTimer !== null) window.clearInterval(this.freeTimer);
    this.freeTimer = null;
  }

  private applyMix(fadeSec: number): void {
    if (!this.ctx) return;
    const g = GROOVES[this.section.id];
    const mix: Record<LayerName, number> = { pad: 0, kick: 0, snare: 0, hats: 0, rolls: 0, bass: 0, bell: 0, lead: 0 };
    for (const [k, v] of Object.entries(g.mix) as [LayerName, number][]) mix[k] = v;
    for (let lvl = 1; lvl <= Math.min(this.hype, 4); lvl++) for (const l of g.hype[lvl] ?? []) mix[l] = Math.max(mix[l], 0.85);
    const t = this.ctx.currentTime;
    for (const name of LAYERS) this.layers[name].gain.setTargetAtTime(mix[name], t, fadeSec / 3);
  }

  private playStep(step: number, t: number, stepSec: number): void {
    if (!this.prefs.musicOn) return;
    const g = GROOVES[this.section.id];
    const s = step % 32;
    const bar4 = Math.floor(step / 16) % 4 === 3; // every 4th bar: fill
    if (s % 16 === 0 && t - this.lastPadAt > stepSec * 15) {
      this.lastPadAt = t;
      this.pad(t, stepSec * 16, g.pad);
    }
    if (g.kick.includes(s)) this.kick(t, 0.9, 150, 42, this.layers.kick);
    if (g.snare.includes(s)) this.snare(t, 0.5, this.layers.snare);
    if (bar4 && s % 16 >= 12) this.snare(t, 0.22 + (s % 16 - 12) * 0.06, this.layers.rolls);
    const h = g.hats[s];
    if (h === 'x' || h === 'o') this.hat(t, h === 'o' ? 0.15 : 0.09, this.layers.hats);
    if (h === '3') {
      for (let k = 0; k < 3; k++) this.hat(t + (k * stepSec) / 3, 0.07, this.layers.rolls);
    }
    const b = g.bass[s];
    if (b) this.bass808(t, b[0], stepSec * b[1], b[2]);
    const bell = g.bell[s];
    if (bell) g.bellTone === 'glass' ? this.glass(t, bell, this.layers.bell) : this.cowbell(t, bell, this.layers.bell);
    const lead = g.lead[s];
    if (lead) this.lead(t, lead, stepSec * 3);
  }

  // ------------------------------------------------------------------ SFX

  sfx(name: SfxName, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.prefs.sfxOn) return;
    const t = ctx.currentTime + 0.004;
    switch (name) {
      case 'ui':
        this.tone(t, 1400, 0.05, 'sine', 0.16, { to: 1900 });
        break;
      case 'tick':
        this.tone(t, 900, 0.035, 'square', 0.05, { filter: 2400, pan });
        break;
      case 'tickHigh':
        this.tone(t, 2200, 0.04, 'triangle', 0.09, { pan });
        break;
      case 'tickMid':
        this.tone(t, 1250, 0.04, 'triangle', 0.09, { pan });
        break;
      case 'tickLow':
        this.tone(t, 520, 0.06, 'triangle', 0.12, { pan });
        break;
      case 'revealHigh':
        this.tone(t, 1600, 0.25, 'sawtooth', 0.06, { to: 3200, filter: 5000, pan });
        this.tone(t, 3200, 0.2, 'sine', 0.06, { pan, send: 0.4 });
        break;
      case 'revealMid':
        [1180, 1770, 2660].forEach((f) => this.tone(t, f, 0.3, 'sine', 0.06, { pan, send: 0.3 }));
        break;
      case 'revealLow':
        this.tone(t, 70, 0.35, 'sawtooth', 0.22, { to: 110, filter: 500, dist: true, pan });
        break;
      case 'enemySwing':
        this.noiseSweep(t, 0.22, 600, 3000, 0.4, pan, 'bandpass');
        this.tone(t, 90, 0.2, 'sine', 0.25, { to: 50 });
        break;
      case 'parryPerfect':
        [520, 1310, 2470, 3890, 5200].forEach((f, i) => this.tone(t, f, 0.9 - i * 0.12, 'sine', 0.2 - i * 0.03, { send: 0.7, pan }));
        this.noiseBurst(t, 0.06, 4000, 0.5, pan, 'highpass');
        this.kick(t, 0.8, 200, 60);
        this.tone(t, 2000, 0.4, 'sawtooth', 0.04, { to: 6000, filter: 8000 });
        break;
      case 'parryGood':
        [480, 1230, 2310].forEach((f, i) => this.tone(t, f, 0.45 - i * 0.1, 'sine', 0.15 - i * 0.03, { send: 0.4, pan }));
        this.noiseBurst(t, 0.04, 3500, 0.3, pan, 'highpass');
        break;
      case 'duck':
        this.noiseSweep(t, 0.2, 3000, 500, 0.35, pan, 'bandpass');
        break;
      case 'jump':
        this.noiseSweep(t, 0.2, 500, 3200, 0.35, pan, 'bandpass');
        this.tone(t, 300, 0.15, 'sine', 0.08, { to: 600 });
        break;
      case 'hit':
        this.kick(t, 1, 130, 36);
        this.noiseBurst(t, 0.2, 1000, 0.55, pan, 'lowpass', true);
        this.tone(t, 80, 0.3, 'square', 0.12, { to: 40, filter: 900 });
        break;
      case 'fooled':
        for (let i = 0; i < 6; i++) this.tone(t + i * 0.02, 2000 + ((i * 731) % 2500), 0.12, 'square', 0.05, { filter: 6000, pan });
        this.noiseBurst(t, 0.25, 6000, 0.25, pan, 'highpass');
        this.tone(t, 300, 0.4, 'sawtooth', 0.08, { to: 150, filter: 1500 });
        break;
      case 'stray':
        this.tone(t, 180, 0.08, 'square', 0.06, { filter: 700 });
        break;
      case 'whiff':
        this.noiseSweep(t, 0.12, 2500, 900, 0.14, pan, 'bandpass');
        break;
      case 'strike':
        this.noiseSweep(t, 0.14, 7000, 1500, 0.5, pan, 'bandpass');
        this.tone(t, 1800, 0.05, 'square', 0.06, { filter: 5000 });
        this.kick(t + 0.03, 0.55, 160, 70);
        break;
      case 'strikeOff':
        this.noiseSweep(t, 0.12, 4000, 1200, 0.25, pan, 'bandpass');
        break;
      case 'strikeFinal':
        this.noiseSweep(t, 0.25, 9000, 900, 0.6, pan, 'bandpass');
        this.kick(t + 0.02, 1, 180, 40);
        this.noiseBurst(t + 0.02, 0.4, 2500, 0.35, pan, 'lowpass', true, 0.5);
        break;
      case 'orbSpawn':
        this.tone(t, 1320, 0.25, 'triangle', 0.07, { pan: -0.7, send: 0.5 });
        this.tone(t + 0.05, 1760, 0.25, 'triangle', 0.07, { pan: 0.7, send: 0.5 });
        break;
      case 'orbGood':
        [880, 1109, 1319, 1760].forEach((f, i) => this.tone(t + i * 0.04, f, 0.3, 'triangle', 0.1, { send: 0.5, pan }));
        break;
      case 'orbBad':
        [660, 622, 494].forEach((f, i) => this.tone(t + i * 0.06, f, 0.25, 'square', 0.05, { filter: 1800, pan }));
        break;
      case 'clash':
        this.kick(t, 1, 220, 30);
        [400, 950, 1730, 2900].forEach((f) => this.tone(t, f, 1.4, 'sine', 0.12, { send: 1 }));
        this.noiseBurst(t, 1.1, 3000, 0.45, 0, 'lowpass', true, 0.9);
        this.tone(t, F.F1 * 2, 1.4, 'sine', 0.5, { to: F.F1, dist: true });
        break;
      case 'recallBad':
        this.tone(t, 200, 0.2, 'square', 0.07, { filter: 800 });
        break;
      case 'ascend':
        this.noiseSweep(t, 1.0, 9000, 300, 0.4, 0, 'lowpass');
        this.kick(t + 0.05, 1, 90, 28);
        this.tone(t, 110, 1.6, 'sine', 0.3, { to: 55 });
        [F.F4, F.Ab4, F.C5, F.Eb5].forEach((f, i) => this.tone(t + 0.2 + i * 0.12, f, 2, 'sine', 0.05, { send: 1 }));
        break;
      case 'drop':
        this.kick(t, 1, 150, 32);
        this.tone(t, F.F1 * 2, 1.4, 'sine', 0.55, { to: F.F1, dist: true });
        this.noiseBurst(t, 1.2, 5000, 0.25, 0, 'highpass', false, 0.8);
        break;
      case 'finisher':
        this.kick(t, 1, 180, 30);
        this.noiseBurst(t, 1.6, 2500, 0.45, 0, 'lowpass', true, 0.9);
        [349, 523, 698, 1046].forEach((f, i) => this.tone(t + 0.15 + i * 0.06, f, 2.2, 'triangle', 0.09, { send: 0.9 }));
        this.tone(t, F.F1 * 2, 2.2, 'sine', 0.5, { to: F.F1 * 0.8, dist: true });
        break;
      case 'lightning':
        this.noiseBurst(t, 0.08, 5000, 0.4, pan, 'highpass');
        this.noiseBurst(t + 0.05, 1.4, 300, 0.35, 0, 'lowpass', false, 0.6);
        break;
      case 'round':
        this.noiseSweep(t, 0.6, 300, 8000, 0.25, 0, 'bandpass');
        this.kick(t + 0.6, 0.9, 140, 35);
        break;
      case 'card':
        this.tone(t, 1760, 0.2, 'triangle', 0.08, { send: 0.6, pan });
        break;
      case 'cardPick':
        [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(t + i * 0.035, f, 0.4, 'triangle', 0.09, { send: 0.7 }));
        break;
      case 'reboot':
        for (let i = 0; i < 8; i++) this.tone(t + i * 0.06, 200 + ((i * 377) % 900), 0.05, 'square', 0.08, { filter: 3000 });
        this.tone(t + 0.5, 60, 1.2, 'sawtooth', 0.12, { to: 240, filter: 1200 });
        break;
      case 'echo':
        this.tone(t, 2637, 0.07, 'sine', 0.05, { pan: -0.3, send: 0.6 });
        this.tone(t + 0.06, 3520, 0.09, 'sine', 0.04, { pan: 0.3, send: 0.6 });
        break;
      case 'phantomShift':
        this.noiseSweep(t, 0.4, 8000, 400, 0.2, pan, 'bandpass');
        this.tone(t, 1200, 0.4, 'sine', 0.05, { to: 300, send: 0.8 });
        break;
    }
  }

  /** Rune bell: pitch encodes the order (an audio memory aid). */
  rune(order: number, ok = true): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.prefs.sfxOn) return;
    const t = ctx.currentTime + 0.004;
    if (!ok) return this.sfx('recallBad');
    const f = RUNE_NOTES[Math.min(order, RUNE_NOTES.length - 1)];
    this.tone(t, f, 0.9, 'triangle', 0.18, { send: 0.8 });
    this.tone(t, f * 2, 0.5, 'sine', 0.05, { send: 0.8 });
  }

  /** Orb value chime: higher value → higher pitch. */
  orbValue(value: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.prefs.sfxOn) return;
    const f = 440 * Math.pow(2, Math.min(value, 40) / 24);
    this.tone(ctx.currentTime + 0.004, f, 0.3, 'triangle', 0.1, { send: 0.5 });
  }

  // ------------------------------------------------------------------ instruments

  private build(): void {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 2;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(limiter);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicFilter.Q.value = 0.8;
    this.musicFilter.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.musicFilter);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.makeImpulse(2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.32;
    this.reverbSend.connect(reverb);
    reverb.connect(this.master);
    this.noise = this.makeNoise(2);
    this.dist = makeDistortion(3.2);
    for (const name of LAYERS) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.musicBus);
      this.layers[name] = g;
    }
    this.setPrefs(this.prefs);
    this.applyMix(0.1);
  }

  private pad(t: number, dur: number, notes: number[]): void {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420, t);
    lp.frequency.linearRampToValueAtTime(900, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(420, t + dur);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.045, t + Math.min(0.6, dur / 3));
    out.gain.setValueAtTime(0.045, t + dur * 0.8);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    lp.connect(out);
    out.connect(this.layers.pad);
    out.connect(this.reverbSend);
    notes.forEach((f, i) => {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det + i;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.4);
      }
    });
  }

  private kick(t: number, vol: number, from: number, to: number, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + 0.12);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g);
    g.connect(dest ?? this.sfxBus);
    o.start(t);
    o.stop(t + 0.45);
    // click transient
    const c = ctx.createOscillator();
    const cg = ctx.createGain();
    c.frequency.value = 2400;
    cg.gain.setValueAtTime(vol * 0.15, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    c.connect(cg).connect(dest ?? this.sfxBus);
    c.start(t);
    c.stop(t + 0.02);
  }

  private snare(t: number, vol: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(bp).connect(g);
    g.connect(dest);
    g.connect(this.reverbSend);
    src.start(t, Math.random() * 1.5, 0.22);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(230, t);
    o.frequency.exponentialRampToValueAtTime(170, t + 0.08);
    og.gain.setValueAtTime(vol * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(dest);
    o.start(t);
    o.stop(t + 0.12);
  }

  private hat(t: number, vol: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    src.connect(hp).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5, 0.06);
  }

  private bass808(t: number, f: number, dur: number, glideTo?: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.9, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    if (glideTo) o.frequency.setTargetAtTime(glideTo, t + dur * 0.55, dur * 0.12);
    const sh = ctx.createWaveShaper();
    sh.curve = this.dist;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.012);
    g.gain.setValueAtTime(0.4, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(sh).connect(lp).connect(g).connect(this.layers.bass);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private cowbell(t: number, f: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 1.6;
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.15, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    bp.connect(g);
    g.connect(dest);
    g.connect(this.reverbSend);
    for (const ratio of [1, 1.481]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * ratio * 0.5;
      o.connect(bp);
      o.start(t);
      o.stop(t + 0.32);
    }
  }

  private glass(t: number, f: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    g.connect(dest);
    g.connect(this.reverbSend);
    for (const [ratio, type] of [
      [1, 'sine'],
      [2.76, 'sine'],
      [5.4, 'triangle'],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * ratio;
      const og = ctx.createGain();
      og.gain.value = 1 / ratio;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 0.72);
    }
  }

  private lead(t: number, f: number, dur: number): void {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    lp.connect(g);
    g.connect(this.layers.lead);
    g.connect(this.reverbSend);
    for (const det of [-9, 0, 9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private tone(
    t: number,
    f: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    opts: { to?: number; pan?: number; send?: number; filter?: number; dist?: boolean } = {},
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.012, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (opts.dist) {
      const sh = ctx.createWaveShaper();
      sh.curve = this.dist;
      node = node.connect(sh);
    }
    if (opts.filter) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = opts.filter;
      node = node.connect(lp);
    }
    node.connect(g);
    this.panned(g, opts.pan).connect(this.sfxBus);
    if (opts.send) {
      const s = ctx.createGain();
      s.gain.value = opts.send;
      g.connect(s).connect(this.reverbSend);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(t: number, dur: number, freq: number, vol: number, pan: number, type: BiquadFilterType, dist = false, send = 0): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = src.connect(f);
    if (dist) {
      const sh = ctx.createWaveShaper();
      sh.curve = this.dist;
      node = node.connect(sh);
    }
    node.connect(g);
    this.panned(g, pan).connect(this.sfxBus);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.reverbSend);
    }
    src.start(t, 0, Math.min(dur + 0.05, 1.95));
  }

  private noiseSweep(t: number, dur: number, from: number, to: number, vol: number, pan: number, type: BiquadFilterType): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = type === 'bandpass' ? 1.4 : 0.7;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    this.panned(g, pan).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5, Math.min(dur + 0.05, 1.45));
  }

  private panned(node: AudioNode, pan?: number): AudioNode {
    if (!pan) return node;
    const ctx = this.ctx!;
    if (typeof ctx.createStereoPanner !== 'function') return node;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    return node.connect(p);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }
}

function makeDistortion(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Single shared engine instance for the app. */
export const audio = new AudioEngine();
if (import.meta.env.DEV) (window as unknown as { __UNKNOWN_AUDIO__?: AudioEngine }).__UNKNOWN_AUDIO__ = audio;
