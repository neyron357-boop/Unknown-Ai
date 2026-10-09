import { audio } from '@/audio/AudioEngine';
import { DuelDirector, type Checkpoint, type DirectorEvent } from '@/game/core/director';
import type { MissionResult } from '@/game/core/metrics';
import type { Action, ModeId, UpgradeId } from '@/game/core/types';
import { GestureRecognizer } from '@/game/input/GestureRecognizer';
import { useHud } from '@/state/hud';
import { bindAudio } from './bindAudio';
import { bindHud } from './bindHud';

export interface SessionOptions {
  mode: ModeId;
  ease: number;
  hints: boolean;
  resume?: Checkpoint | null;
  onCheckpoint?: (cp: Checkpoint) => void;
  onComplete?: (result: MissionResult) => void;
}

/**
 * Glue between the pure DuelDirector and the outside world: HUD store, audio
 * conductor, touch input (with touch-down timestamps), pause and persistence.
 * The Phaser scene drives `tick()` from its update loop.
 */
export class MissionSession {
  readonly director: DuelDirector;
  readonly gestures: GestureRecognizer;
  readonly startedAt = Date.now();
  private paused = false;
  private lastTickPerf = performance.now();
  private readonly unbind: (() => void)[] = [];
  /** Debug-only speed multiplier (?speed=4) for automated play-throughs. */
  private readonly speed: number;
  /** Scene hooks: rune under a tap (css px), orb side under a tap. */
  tapResolver: ((x: number, y: number) => number | null) | null = null;
  sideResolver: ((x: number) => 'left' | 'right') | null = null;
  /** Renderer hook so visuals freeze together with the rules. */
  onPauseChange: ((paused: boolean) => void) | null = null;

  constructor(private readonly opts: SessionOptions) {
    this.director = new DuelDirector({ mode: opts.mode, ease: opts.ease, hints: opts.hints, resume: opts.resume ?? undefined });
    this.speed = readDebugSpeed();
    if (import.meta.env.DEV) (window as unknown as { __UNKNOWN_SESSION__?: MissionSession }).__UNKNOWN_SESSION__ = this;
    this.gestures = new GestureRecognizer({
      onAction: (a, t, x) => this.input(a, t, x),
      onTap: (x, y, t) => this.tap(x, y, t),
    });
    this.unbind.push(bindHud(this.director), bindAudio(this.director));
    this.unbind.push(
      this.director.on((e) => {
        if (e.type === 'round') {
          const cp = this.director.getCheckpoint();
          if (cp) opts.onCheckpoint?.(cp);
        }
        if (e.type === 'recall') this.gestures.mode = 'taps';
        if (e.type === 'finisher' || e.type === 'complete') this.gestures.mode = 'actions';
        if (e.type === 'complete') opts.onComplete?.(e.result);
      }),
    );
  }

  get mode(): ModeId {
    return this.opts.mode;
  }

  on(listener: (e: DirectorEvent) => void): () => void {
    const off = this.director.on(listener);
    this.unbind.push(off);
    return off;
  }

  start(): void {
    audio.attachConductor();
    this.lastTickPerf = performance.now();
    this.director.start();
  }

  tick(dtMs: number): void {
    if (this.paused) return;
    // Clamp frame gaps so a hitch never steals a timing window.
    this.director.update(Math.min(dtMs, 100) * this.speed);
    this.lastTickPerf = performance.now();
    this.gestures.tick(this.lastTickPerf);
    audio.pump(this.director.getNow());
  }

  /** Converts a performance.now() timestamp into director time. */
  private toDirector(tPerf: number): number {
    return this.director.getNow() + (tPerf - this.lastTickPerf) * this.speed;
  }

  input(action: Action, tPerf = performance.now(), x?: number): void {
    if (this.paused) return;
    let a = action;
    // During the energy choice a tap picks the side it landed on.
    if (a === 'tap' && x !== undefined && this.director.isOrbActive() && this.sideResolver) a = this.sideResolver(x);
    this.director.input(a, this.toDirector(tPerf));
  }

  tap(x: number, y: number, tPerf = performance.now()): void {
    if (this.paused || !this.tapResolver) return;
    this.director.tapNode(this.tapResolver(x, y), this.toDirector(tPerf));
  }

  chooseUpgrade(id: UpgradeId): void {
    this.director.chooseUpgrade(id);
  }

  isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.gestures.reset();
    useHud.setState({ paused: true });
    this.onPauseChange?.(true);
    audio.suspend();
  }

  /** Must be called from a user gesture (iOS audio). */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastTickPerf = performance.now();
    useHud.setState({ paused: false });
    this.onPauseChange?.(false);
    audio.unlock();
    audio.resume();
  }

  dispose(): void {
    for (const off of this.unbind) off();
    this.unbind.length = 0;
    this.gestures.reset();
    audio.detachConductor();
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
