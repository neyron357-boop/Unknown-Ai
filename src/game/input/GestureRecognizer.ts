import type { Action } from '@/game/core/types';

/**
 * One-handed touch grammar for the rhythm duel:
 *  - tap (release, or a still hold ≥ holdMs) → 'tap'   (parry / strike)
 *  - swipe ≥ swipeMinPx along the dominant axis → 'up' | 'down' | 'left' | 'right'
 * Every action carries the time the finger *touched down*, so rhythm judging is
 * fair even though a tap is only certain on release.
 * In 'taps' mode (rune recall) every press is a positional tap, reported instantly.
 */
export interface GestureOptions {
  swipeMinPx?: number;
  holdMs?: number;
  onAction: (action: Action, t: number, x: number, y: number) => void;
  onTap: (x: number, y: number, t: number) => void;
}

interface PointerState {
  x0: number;
  y0: number;
  t0: number;
  x: number;
  y: number;
  done: boolean;
}

export class GestureRecognizer {
  mode: 'actions' | 'taps' = 'actions';
  private readonly pointers = new Map<number, PointerState>();
  private readonly swipeMin: number;
  private readonly holdMs: number;

  constructor(private readonly opts: GestureOptions) {
    this.swipeMin = opts.swipeMinPx ?? 18;
    this.holdMs = opts.holdMs ?? 90;
  }

  down(id: number, x: number, y: number, t: number): void {
    if (this.mode === 'taps') {
      this.pointers.set(id, { x0: x, y0: y, t0: t, x, y, done: true });
      this.opts.onTap(x, y, t);
      return;
    }
    this.pointers.set(id, { x0: x, y0: y, t0: t, x, y, done: false });
  }

  move(id: number, x: number, y: number, _t: number): void {
    const p = this.pointers.get(id);
    if (!p || p.done) return;
    p.x = x;
    p.y = y;
    const swipe = this.classify(p, this.swipeMin);
    if (swipe) this.fire(p, swipe);
  }

  up(id: number, x: number, y: number, _t: number): void {
    const p = this.pointers.get(id);
    this.pointers.delete(id);
    if (!p || p.done) return;
    p.x = x;
    p.y = y;
    // A short flick that ended before crossing the threshold still counts as a swipe.
    this.fire(p, this.classify(p, this.swipeMin * 0.7) ?? 'tap');
  }

  cancel(id: number): void {
    this.pointers.delete(id);
  }

  /** Call every frame: a still finger becomes a tap without waiting for release. */
  tick(t: number): void {
    for (const p of this.pointers.values()) {
      if (!p.done && t - p.t0 >= this.holdMs && Math.hypot(p.x - p.x0, p.y - p.y0) < 8) this.fire(p, 'tap');
    }
  }

  reset(): void {
    this.pointers.clear();
  }

  private classify(p: PointerState, min: number): Action | null {
    const dx = p.x - p.x0;
    const dy = p.y - p.y0;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return null;
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'up' : 'down';
  }

  private fire(p: PointerState, action: Action): void {
    p.done = true;
    this.opts.onAction(action, p.t0, p.x0, p.y0);
  }
}
