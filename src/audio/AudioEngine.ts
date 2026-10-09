/**
 * UNKNOWN audio engine — everything is synthesized with the Web Audio API.
 * No samples, no licensing issues, tiny download.
 *
 * Signal flow:
 *   layers → musicBus → musicFilter ─┐
 *   sfx ────→ sfxBus ────────────────┼→ master → limiter → destination
 *   (sends) → reverb ────────────────┘
 *
 * The context is created/resumed only inside a user gesture (`unlock()`),
 * as required by mobile Safari.
 */

export type Intensity = 'off' | 'ambient' | 'tension' | 'combat' | 'overdrive';

export type SfxName =
  | 'ui'
  | 'whooshL'
  | 'whooshR'
  | 'shield'
  | 'block'
  | 'impact'
  | 'counter'
  | 'telegraphL'
  | 'telegraphR'
  | 'telegraphCrush'
  | 'telegraphPierce'
  | 'read'
  | 'predict'
  | 'stagger'
  | 'ignored'
  | 'slowmoIn'
  | 'heartbeat'
  | 'riser'
  | 'drop'
  | 'finisher'
  | 'reboot'
  | 'echo'
  | 'awaken'
  | 'enemyIntro'
  | 'tutorialOk';

export interface AudioPrefs {
  musicOn: boolean;
  sfxOn: boolean;
  musicVolume: number;
  sfxVolume: number;
  volumeLimit: number;
}

type LayerName = 'pad' | 'hats' | 'drums' | 'bass' | 'bell' | 'rolls';

const LAYER_MIX: Record<Intensity, Record<LayerName, number>> = {
  off: { pad: 0, hats: 0, drums: 0, bass: 0, bell: 0, rolls: 0 },
  ambient: { pad: 0.9, hats: 0, drums: 0, bass: 0, bell: 0, rolls: 0 },
  tension: { pad: 0.7, hats: 0.55, drums: 0.35, bass: 0.55, bell: 0, rolls: 0 },
  combat: { pad: 0.45, hats: 0.7, drums: 1, bass: 1, bell: 0.75, rolls: 0 },
  overdrive: { pad: 0.35, hats: 0.8, drums: 1, bass: 1, bell: 0.9, rolls: 0.7 },
};

const BPM: Record<Intensity, number> = { off: 120, ambient: 120, tension: 128, combat: 140, overdrive: 150 };

// F minor. Frequencies in Hz.
const N = {
  F1: 43.65, G1: 49.0, Ab1: 51.91, Bb1: 58.27, C2: 65.41, Db2: 69.3, Eb2: 77.78,
  F2: 87.31, Ab2: 103.83, C3: 130.81, Eb3: 155.56,
  G5: 783.99, Ab5: 830.61, Bb5: 932.33, C6: 1046.5, Db6: 1108.73, Eb6: 1244.51, F6: 1396.91,
};

/** 2-bar loop, 32 sixteenth steps. Original phrases written for this project. */
const KICK = new Set([0, 3, 10, 16, 19, 26, 29]);
const SNARE = new Set([8, 24]);
const HATS = new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]);
const ROLLS = new Set([13, 14, 15, 28, 29, 30, 31]);
const BASS: Record<number, { f: number; len: number; glideTo?: number }> = {
  0: { f: N.F1, len: 6 },
  10: { f: N.Ab1, len: 4 },
  16: { f: N.Db2, len: 6 },
  26: { f: N.C2, len: 6, glideTo: N.Eb2 },
};
const BELL: Record<number, number> = {
  0: N.C6, 3: N.C6, 6: N.Bb5, 8: N.Ab5, 11: N.G5, 14: N.Ab5,
  16: N.C6, 19: N.C6, 22: N.Eb6, 24: N.Db6, 27: N.C6, 30: N.Bb5,
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private musicBus!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private sfxBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private distCurve!: Float32Array<ArrayBuffer>;
  private layers = {} as Record<LayerName, GainNode>;

  private prefs: AudioPrefs = { musicOn: true, sfxOn: true, musicVolume: 0.7, sfxVolume: 0.85, volumeLimit: 0.9 };
  private intensity: Intensity = 'off';
  private bpm = 120;
  private pendingBpm: number | null = null;
  private timeScale = 1;
  private step = 0;
  private nextStepTime = 0;
  private timer: number | null = null;
  private slowmo = false;

  /** Diagnostics: context state ('none' before the first gesture). */
  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture handler (touchend / click / keydown). */
  unlock(): void {
    try {
      if (!this.ctx) this.build();
      const ctx = this.ctx!;
      if (ctx.state !== 'running') void ctx.resume();
      // iOS: playing a silent buffer inside the gesture fully unlocks output.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
      this.startScheduler();
    } catch {
      // Audio is optional — the game must keep working without it.
    }
  }

  /** Called when the app goes to background. */
  suspend(): void {
    this.stopScheduler();
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  /** Resume after returning to foreground (call from a gesture on iOS). */
  resume(): void {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') void this.ctx.resume();
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.startScheduler();
  }

  setPrefs(prefs: AudioPrefs): void {
    this.prefs = prefs;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(clamp01(prefs.volumeLimit), t, 0.05);
    this.musicBus.gain.setTargetAtTime(prefs.musicOn ? clamp01(prefs.musicVolume) * 0.8 : 0, t, 0.08);
    this.sfxBus.gain.setTargetAtTime(prefs.sfxOn ? clamp01(prefs.sfxVolume) : 0, t, 0.05);
  }

  setIntensity(level: Intensity, fadeSec = 0.6): void {
    this.intensity = level;
    this.pendingBpm = BPM[level];
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const mix = LAYER_MIX[level];
    for (const name of Object.keys(mix) as LayerName[]) {
      this.layers[name].gain.setTargetAtTime(mix[name], t, fadeSec / 3);
    }
  }

  getIntensity(): Intensity {
    return this.intensity;
  }

  /** Slow-motion: tempo halves, music sinks under a low-pass, heartbeat on top. */
  setSlowmo(on: boolean): void {
    if (this.slowmo === on) return;
    this.slowmo = on;
    this.timeScale = on ? 0.5 : 1;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = this.musicFilter.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    if (on) {
      f.exponentialRampToValueAtTime(320, t + 0.5);
      this.musicFilter.Q.setTargetAtTime(7, t, 0.1);
    } else {
      f.exponentialRampToValueAtTime(18000, t + 0.08);
      this.musicFilter.Q.setTargetAtTime(0.7, t, 0.05);
    }
  }

  // ------------------------------------------------------------------ SFX

  sfx(name: SfxName): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.prefs.sfxOn) return;
    const t = ctx.currentTime + 0.005;
    switch (name) {
      case 'ui':
        this.tone(t, 1400, 0.05, 'sine', 0.18, { to: 1900 });
        break;
      case 'tutorialOk':
        this.tone(t, 880, 0.12, 'triangle', 0.22);
        this.tone(t + 0.07, 1320, 0.16, 'triangle', 0.2);
        break;
      case 'whooshL':
      case 'whooshR':
        this.noiseSweep(t, 0.22, 900, 4200, 0.5, name === 'whooshL' ? -0.7 : 0.7, 'bandpass');
        break;
      case 'shield':
        [523, 784, 1046].forEach((f, i) => this.tone(t + i * 0.02, f, 0.35, 'sine', 0.13, { to: f * 1.02, send: 0.4 }));
        break;
      case 'block':
        [410, 1130, 2390, 3870].forEach((f, i) => this.tone(t, f, 0.5 - i * 0.08, 'sine', 0.2 - i * 0.03, { send: 0.5 }));
        this.noiseBurst(t, 0.05, 3000, 0.35, 0, 'highpass');
        break;
      case 'impact':
        this.kick(t, 0.9, 120, 38);
        this.noiseBurst(t, 0.18, 900, 0.55, 0, 'lowpass', true);
        this.tone(t, 70, 0.3, 'square', 0.12, { to: 40 });
        break;
      case 'counter':
        this.kick(t, 0.8, 160, 45);
        this.noiseSweep(t, 0.16, 6000, 1200, 0.45, 0, 'bandpass');
        this.tone(t + 0.02, 220, 0.18, 'sawtooth', 0.12, { to: 110, dist: true });
        break;
      case 'telegraphL':
      case 'telegraphR':
        this.tone(t, 300, 0.32, 'sawtooth', 0.12, { to: 1300, pan: name === 'telegraphL' ? -0.85 : 0.85, filter: 2600 });
        this.tone(t, 2400, 0.25, 'sine', 0.05, { to: 3600, pan: name === 'telegraphL' ? -0.85 : 0.85 });
        break;
      case 'telegraphCrush':
        this.tone(t, 46, 0.55, 'sawtooth', 0.32, { to: 95, filter: 420, dist: true });
        this.noiseSweep(t, 0.5, 200, 900, 0.18, 0, 'lowpass');
        break;
      case 'telegraphPierce':
        this.tone(t, 900, 0.45, 'sine', 0.13, { to: 3200 });
        this.tone(t, 905, 0.45, 'square', 0.04, { to: 3230, filter: 5000 });
        break;
      case 'read':
        [1046, 1318, 1568, 2093].forEach((f, i) => this.tone(t + i * 0.045, f, 0.35, 'triangle', 0.13, { send: 0.6 }));
        this.noiseSweep(t, 0.25, 2000, 9000, 0.12, 0, 'highpass');
        break;
      case 'predict':
        this.tone(t, 1760, 0.06, 'sine', 0.12);
        break;
      case 'stagger':
        this.tone(t, 160, 0.28, 'sawtooth', 0.14, { to: 120, dist: true });
        this.tone(t, 167, 0.28, 'sawtooth', 0.1, { to: 118 });
        break;
      case 'ignored':
        this.tone(t, 300, 0.05, 'square', 0.04, { filter: 900 });
        break;
      case 'slowmoIn':
        this.noiseSweep(t, 0.9, 9000, 300, 0.4, 0, 'lowpass');
        this.kick(t + 0.05, 1, 90, 28);
        this.tone(t, 110, 1.4, 'sine', 0.3, { to: 55 });
        break;
      case 'heartbeat':
        this.kick(t, 0.55, 70, 35);
        this.kick(t + 0.18, 0.4, 65, 34);
        break;
      case 'riser':
        this.noiseSweep(t, 1.1, 400, 12000, 0.3, 0, 'bandpass');
        this.tone(t, 220, 1.1, 'sawtooth', 0.07, { to: 880, filter: 3000 });
        break;
      case 'drop':
        this.kick(t, 1, 150, 32);
        this.tone(t, N.F1 * 2, 1.4, 'sine', 0.55, { to: N.F1, dist: true });
        this.noiseBurst(t, 1.2, 5000, 0.25, 0, 'highpass', false, 0.8);
        break;
      case 'finisher':
        this.kick(t, 1, 180, 30);
        this.noiseBurst(t, 1.6, 2500, 0.45, 0, 'lowpass', true, 0.9);
        [349, 523, 698, 1046].forEach((f, i) => this.tone(t + 0.15 + i * 0.06, f, 2.2, 'triangle', 0.09, { send: 0.9 }));
        this.tone(t, N.F1 * 2, 2.2, 'sine', 0.5, { to: N.F1 * 0.8, dist: true });
        break;
      case 'reboot':
        for (let i = 0; i < 8; i++) this.tone(t + i * 0.06, 200 + ((i * 377) % 900), 0.05, 'square', 0.08, { filter: 3000 });
        this.tone(t + 0.5, 60, 1.2, 'sawtooth', 0.12, { to: 240, filter: 1200 });
        break;
      case 'echo':
        this.tone(t, 2637, 0.07, 'sine', 0.06, { pan: -0.3, send: 0.6 });
        this.tone(t + 0.06, 3520, 0.09, 'sine', 0.05, { pan: 0.3, send: 0.6 });
        break;
      case 'awaken':
        this.tone(t, 43.65, 3, 'sine', 0.4, { to: 87.3 });
        this.noiseSweep(t, 2.6, 150, 5000, 0.12, 0, 'bandpass');
        this.tone(t + 1.2, 698, 2, 'triangle', 0.05, { send: 1 });
        break;
      case 'enemyIntro':
        this.kick(t, 1, 110, 30);
        this.tone(t, 55, 2.2, 'sawtooth', 0.2, { to: 41, filter: 600, dist: true });
        this.noiseBurst(t, 1.2, 1800, 0.3, 0, 'lowpass', true, 0.7);
        break;
    }
  }

  /** Short pitched pluck used for weak points: pitch encodes order (an audio memory aid). */
  pluck(order: number, ok = true): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.prefs.sfxOn) return;
    const t = ctx.currentTime + 0.005;
    const scale = [N.F6 / 2, N.Ab5, N.C6, N.Eb6, N.F6];
    const f = ok ? scale[Math.min(order, scale.length - 1)] : 180;
    this.tone(t, f, ok ? 0.4 : 0.2, ok ? 'triangle' : 'square', ok ? 0.2 : 0.08, { send: ok ? 0.5 : 0, filter: ok ? undefined : 700 });
  }

  // ------------------------------------------------------------------ internals

  private build(): void {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 2;
    this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.2;
    this.limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.connect(this.limiter);

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicFilter.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.musicFilter);

    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);

    this.noise = this.makeNoise(2);
    this.distCurve = makeDistortion(3.2);

    for (const name of ['pad', 'hats', 'drums', 'bass', 'bell', 'rolls'] as LayerName[]) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.musicBus);
      this.layers[name] = g;
    }
    this.setPrefs(this.prefs);
    this.setIntensity(this.intensity, 0.1);
    this.nextStepTime = ctx.currentTime + 0.1;
  }

  private startScheduler(): void {
    if (this.timer !== null || !this.ctx) return;
    if (this.nextStepTime < this.ctx.currentTime) this.nextStepTime = this.ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  private stopScheduler(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const ahead = ctx.currentTime + 0.12;
    // Never try to catch up after a long stall (tab switch etc.).
    if (this.nextStepTime < ctx.currentTime - 0.2) this.nextStepTime = ctx.currentTime + 0.02;
    while (this.nextStepTime < ahead) {
      if (this.step % 16 === 0 && this.pendingBpm !== null) {
        this.bpm = this.pendingBpm;
        this.pendingBpm = null;
      }
      this.playStep(this.step, this.nextStepTime);
      this.nextStepTime += 60 / this.bpm / 4 / this.timeScale;
      this.step = (this.step + 1) % 32;
    }
  }

  private playStep(step: number, t: number): void {
    if (!this.prefs.musicOn || this.intensity === 'off') return;
    const mix = LAYER_MIX[this.intensity];
    const stepDur = 60 / this.bpm / 4 / this.timeScale;
    if (mix.pad > 0 && step % 16 === 0) this.pad(t, stepDur * 16);
    if (mix.drums > 0) {
      if (KICK.has(step)) this.kick(t, 0.85, 140, 42, this.layers.drums);
      if (SNARE.has(step)) this.snare(t, this.layers.drums);
    }
    if (mix.hats > 0 && HATS.has(step)) this.hat(t, step % 4 === 2 ? 0.16 : 0.1, this.layers.hats);
    if (mix.rolls > 0 && ROLLS.has(step)) {
      this.hat(t, 0.08, this.layers.rolls);
      this.hat(t + stepDur / 2, 0.06, this.layers.rolls);
    }
    if (mix.bass > 0 && BASS[step]) {
      const b = BASS[step];
      this.bass808(t, b.f, stepDur * b.len, b.glideTo);
    }
    if (mix.bell > 0 && BELL[step] !== undefined) this.cowbell(t, BELL[step], this.layers.bell);
  }

  // --- instruments -------------------------------------------------------------------

  private pad(t: number, dur: number): void {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(380, t);
    lp.frequency.linearRampToValueAtTime(760, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(380, t + dur);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.06, t + 0.6);
    out.gain.setValueAtTime(0.06, t + dur - 0.4);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    lp.connect(out);
    out.connect(this.layers.pad);
    out.connect(this.reverbSend);
    for (const [f, det] of [[N.F2, -7], [N.F2, 7], [N.Ab2, 0], [N.C3, -4], [N.Eb3, 5]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.4);
    }
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
  }

  private snare(t: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(bp).connect(g);
    g.connect(dest);
    g.connect(this.reverbSend);
    src.start(t, Math.random() * 1.5, 0.25);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    og.gain.setValueAtTime(0.25, t);
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
    hp.frequency.value = 7500;
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
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.distCurve;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.012);
    g.gain.setValueAtTime(0.42, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(shaper).connect(lp).connect(g).connect(this.layers.bass);
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
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    bp.connect(g);
    g.connect(dest);
    g.connect(this.reverbSend);
    for (const ratio of [1, 1.481]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * ratio * 0.5;
      o.connect(bp);
      o.start(t);
      o.stop(t + 0.34);
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
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.015, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (opts.dist) {
      const sh = ctx.createWaveShaper();
      sh.curve = this.distCurve;
      node = node.connect(sh);
    }
    if (opts.filter) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = opts.filter;
      node = node.connect(lp);
    }
    node = node.connect(g);
    const out = this.panned(g, opts.pan);
    out.connect(this.sfxBus);
    if (opts.send) {
      const s = ctx.createGain();
      s.gain.value = opts.send;
      g.connect(s).connect(this.reverbSend);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(
    t: number,
    dur: number,
    freq: number,
    vol: number,
    pan: number,
    type: BiquadFilterType,
    dist = false,
    send = 0,
  ): void {
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
      sh.curve = this.distCurve;
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
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.6);
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
    p.pan.value = pan;
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
