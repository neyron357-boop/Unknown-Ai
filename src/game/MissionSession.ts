import { audio } from '@/audio/AudioEngine';
import { MissionDirector, type Checkpoint, type DirectorEvent } from '@/game/core/director';
import type { MissionResult } from '@/game/core/metrics';
import type { Action, ModeId } from '@/game/core/types';
import { GestureRecognizer } from '@/game/input/GestureRecognizer';
import { bindAudio } from './bindAudio';
import { bindHud } from './bindHud';
import { useHud } from '@/state/hud';

export interface SessionOptions {
  mode: ModeId;
  telegraphScale: number;
  hints: boolean;
  resume?: Checkpoint | null;
  onCheckpoint?: (cp: Checkpoint) => void;
  onComplete?: (result: MissionResult) => void;
}

/**
 * MissionSession glues the pure MissionDirector to the outside world:
 * HUD store, audio, input, pause/resume and persistence callbacks.
 * The Phaser scene drives `tick()` from its update loop and renders events.
 */
export class MissionSession {
  readonly director: MissionDirector;
  readonly gestures: GestureRecognizer;
  readonly startedAt = Date.now();
  private paused = false;
  private lastTickWall = performance.now();
  private readonly unbind: (() => void)[] = [];
  /** Debug-only speed multiplier (?speed=4) for automated play-throughs. */
  private readonly speed: number;
  /** Scene hook for positional taps during Ascension (screen px → node index). */
  tapResolver: ((x: number, y: number) => number | null) | null = null;
  /** Renderer hook so visuals (tweens, timers) freeze together with the rules. */
  onPauseChange: ((paused: boolean) => void) | null = null;

  constructor(private readonly opts: SessionOptions) {
    this.director = new MissionDirector({
      mode: opts.mode,
      telegraphScale: opts.telegraphScale,
      hints: opts.hints,
      resume: opts.resume ?? undefined,
    });
    this.speed = readDebugSpeed();
    // Dev-only automation hook (used by the Playwright play-through script).
    if (import.meta.env.DEV) (window as unknown as { __UNKNOWN_SESSION__?: MissionSession }).__UNKNOWN_SESSION__ = this;
    this.gestures = new GestureRecognizer({
      onAction: (a) => this.input(a),
      onTap: (x, y) => this.tap(x, y),
    });
    this.unbind.push(bindHud(this.director), bindAudio(this.director));
    this.unbind.push(
      this.director.on((e) => {
        if (e.type === 'stage' && (e.loop === 'pattern' || e.loop === 'overdrive')) {
          const cp = this.director.getCheckpoint();
          if (cp) opts.onCheckpoint?.(cp);
        }
        if (e.type === 'ascendRecall') this.gestures.mode = 'taps';
        if (e.type === 'ascendStrike' || e.type === 'complete') this.gestures.mode = 'actions';
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
    this.lastTickWall = performance.now();
    this.director.start();
  }

  tick(dtMs: number): void {
    this.lastTickWall = performance.now();
    if (this.paused) return;
    // Clamp huge frame gaps (e.g. after a hitch) so timing stays fair.
    this.director.update(Math.min(dtMs, 100) * this.speed);
    this.gestures.tick(performance.now());
  }

  input(action: Action): void {
    if (this.paused) return;
    this.director.input(action, performance.now() - this.lastTickWall);
  }

  tap(x: number, y: number): void {
    if (this.paused || !this.tapResolver) return;
    const node = this.tapResolver(x, y);
    this.director.tapNode(node, performance.now() - this.lastTickWall);
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
    this.lastTickWall = performance.now();
    useHud.setState({ paused: false });
    this.onPauseChange?.(false);
    audio.unlock();
    audio.resume();
  }

  dispose(): void {
    for (const off of this.unbind) off();
    this.unbind.length = 0;
    this.gestures.reset();
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
