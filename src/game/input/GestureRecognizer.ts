import type { Action } from '@/game/core/types';

/**
 * One-handed touch grammar:
 *  - horizontal swipe ≥ swipeMinPx  → dodgeL / dodgeR (fires mid-swipe, no need to lift)
 *  - tap (release before moving)     → block
 *  - hold ≥ holdMs without moving    → block (fires while still holding)
 * In 'taps' mode (Ascension recall) every press is a positional tap instead.
 */
export interface GestureOptions {
  swipeMinPx?: number;
  holdMs?: number;
  onAction: (action: Action) => void;
  onTap: (x: number, y: number) => void;
}

interface PointerState {
  x0: number;
  y0: number;
  t0: number;
  /** Last known position (used by tick() for hold detection). */
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
    this.swipeMin = opts.swipeMinPx ?? 22;
    this.holdMs = opts.holdMs ?? 170;
  }

  down(id: number, x: number, y: number, t: number): void {
    if (this.mode === 'taps') {
      this.pointers.set(id, { x0: x, y0: y, t0: t, x, y, done: true });
      this.opts.onTap(x, y);
      return;
    }
    this.pointers.set(id, { x0: x, y0: y, t0: t, x, y, done: false });
  }

  move(id: number, x: number, y: number, t: number): void {
    const p = this.pointers.get(id);
    if (!p || p.done) return;
    p.x = x;
    p.y = y;
    const dx = x - p.x0;
    const dy = y - p.y0;
    if (Math.abs(dx) >= this.swipeMin && Math.abs(dx) > Math.abs(dy) * 1.1) {
      p.done = true;
      this.opts.onAction(dx < 0 ? 'dodgeL' : 'dodgeR');
      return;
    }
    // A clearly vertical drag is not a command; stop tracking it so it can't become a hold.
    if (Math.abs(dy) >= this.swipeMin * 1.5 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      p.done = true;
      return;
    }
    this.checkHold(p, x, y, t);
  }

  up(id: number, x: number, y: number, t: number): void {
    const p = this.pointers.get(id);
    this.pointers.delete(id);
    if (!p || p.done) return;
    const dist = Math.hypot(x - p.x0, y - p.y0);
    if (dist < this.swipeMin) {
      this.opts.onAction('block');
      return;
    }
    // Released after a short diagonal flick: classify by dominant horizontal direction.
    const dx = x - p.x0;
    if (Math.abs(dx) >= this.swipeMin * 0.8) this.opts.onAction(dx < 0 ? 'dodgeL' : 'dodgeR');
    void t;
  }

  cancel(id: number): void {
    this.pointers.delete(id);
  }

  /** Call every frame so a steady hold fires without waiting for movement events. */
  tick(t: number): void {
    for (const p of this.pointers.values()) if (!p.done) this.checkHold(p, p.x, p.y, t);
  }

  reset(): void {
    this.pointers.clear();
  }

  private checkHold(p: PointerState, x: number, y: number, t: number): void {
    if (t - p.t0 >= this.holdMs && Math.hypot(x - p.x0, y - p.y0) < 10) {
      p.done = true;
      this.opts.onAction('block');
    }
  }
}
