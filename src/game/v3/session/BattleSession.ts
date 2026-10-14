import { audio3, voice } from '@/audio/bus';
import { useHud3 } from '@/state/hud3';
import type { EpisodeResponse } from '@/voice/dynamic';
import type { VoiceCue } from '@/voice/lines';
import { BattleDirector, type BattleCheckpoint, type BattleEvent } from '../core/battle';
import type { BattleResult } from '../core/metrics';
import type { Dir, ModeId } from '../core/types';
import { SlashRecognizer } from '../input/slash';
import { bindAudio3 } from './bindAudio3';
import { bindHud3, type SceneHudHooks } from './bindHud3';
import { bindVoice } from './bindVoice';

export interface BattleSessionOptions {
  mode: ModeId;
  ease: number;
  hints: boolean;
  seed?: number;
  resume?: BattleCheckpoint | null;
  episode?: EpisodeResponse | null;
  /** Fetch live Gemini TTS for the episode's key lines. */
  liveVoice?: boolean;
  onCheckpoint?: (cp: BattleCheckpoint) => void;
  onComplete?: (result: BattleResult) => void;
}

/**
 * Glue between the pure BattleDirector and the outside world: touch slashes (stamped with the
 * time the finger moved), the music conductor, voices, the HUD store, pause and checkpoints.
 * The Phaser scene drives `tick()` from its update loop.
 */
export class BattleSession {
  readonly director: BattleDirector;
  readonly slashes: SlashRecognizer;
  readonly hud: SceneHudHooks;
  readonly startedAt = Date.now();
  private paused = false;
  private lastTickPerf = performance.now();
  private readonly unbind: (() => void)[] = [];
  /** Debug-only speed multiplier (?speed=4) for automated play-throughs. */
  private readonly speed: number;
  /** Renderer hook so visuals freeze together with the rules. */
  onPauseChange: ((paused: boolean) => void) | null = null;

  constructor(private readonly opts: BattleSessionOptions) {
    this.director = new BattleDirector({ mode: opts.mode, ease: opts.ease, hints: opts.hints, seed: opts.seed, resume: opts.resume ?? null });
    this.speed = readDebugSpeed();
    this.slashes = new SlashRecognizer({ onSlash: (dir, t) => this.input(dir, t) });
    const hud = bindHud3(this.director);
    this.hud = hud.hooks;
    this.unbind.push(hud.dispose, bindAudio3(this.director), bindVoice(this.director, { episode: opts.episode ?? null, live: !!opts.liveVoice, say: hud.say }));
    this.unbind.push(
      this.director.on((e: BattleEvent) => {
        if (e.type === 'segment') {
          const cp = this.director.getCheckpoint();
          if (cp) {
            opts.onCheckpoint?.(cp);
            useHud3.setState({ saved: { id: Date.now() } });
          }
        }
        if (e.type === 'complete') opts.onComplete?.(e.result);
      }),
    );
    if (import.meta.env.DEV) (window as unknown as { __SESSION__?: BattleSession }).__SESSION__ = this;
  }

  get mode(): ModeId {
    return this.opts.mode;
  }

  start(): void {
    audio3.setSeed(this.director.seed);
    audio3.attachConductor();
    // the music engine chops the chant clips of the voice bank into the beat
    void voice
      .load()
      .then(() => voice.getChantBuffers())
      .then((b) => Object.keys(b).length && audio3.setChants(b))
      .catch(() => undefined);
    this.lastTickPerf = performance.now();
    this.director.start();
  }

  tick(dtMs: number): void {
    if (this.paused) return;
    // Clamp frame gaps so a hitch never steals a timing window.
    this.director.update(Math.min(dtMs, 100) * this.speed);
    this.lastTickPerf = performance.now();
    audio3.pump(this.director.getNow());
  }

  /** Converts a performance.now()-clock timestamp into director time. */
  private toDirector(tPerf: number): number {
    return this.director.getNow() + (tPerf - this.lastTickPerf) * this.speed;
  }

  /** A slash in the direction the player sees (the director un-mirrors it). */
  input(dir: Dir, tPerf = performance.now()): void {
    if (this.paused) return;
    this.director.input(dir, this.toDirector(tPerf));
  }

  bark(cue: VoiceCue): void {
    voice.play(cue);
  }

  isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    if (this.paused || this.director.getPhase() === 'complete') return;
    this.paused = true;
    this.slashes.reset();
    useHud3.setState({ paused: true });
    this.onPauseChange?.(true);
    voice.stopAll();
    audio3.suspend();
  }

  /** Must be called from a user gesture (iOS audio). */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastTickPerf = performance.now();
    useHud3.setState({ paused: false });
    this.onPauseChange?.(false);
    audio3.unlock();
    audio3.resume();
  }

  dispose(): void {
    for (const off of this.unbind) off();
    this.unbind.length = 0;
    this.slashes.reset();
    audio3.detachConductor();
    // back to the menu loop — also when leaving from the pause screen, where the context is still resuming
    audio3.resume();
  }
}

function readDebugSpeed(): number {
  if (!import.meta.env.DEV) return 1;
  try {
    const v = Number(new URLSearchParams(window.location.search).get('speed'));
    return v > 0 && v <= 20 ? v : 1;
  } catch {
    return 1;
  }
}
