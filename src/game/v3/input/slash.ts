import type { Dir } from '../core/types';

/**
 * Touch grammar for the v3 battle: every swipe is a slash in one of four directions.
 *
 *  - A slash fires the moment the finger has travelled `minPx` along the dominant axis,
 *    stamped with the time of that pointer event (the slash, not the touch-down).
 *  - Zig-zag chaining: without lifting, a turn into a new direction fires another slash
 *    (left-right-left on consecutive beats is one fluid gesture).
 *  - A short flick that ends before the threshold still counts on release.
 *  - Taps are reported separately (menus, pausing) and never attack.
 */
export interface SlashOptions {
  minPx?: number;
  onSlash: (dir: Dir, t: number, x: number, y: number) => void;
  onTap?: (x: number, y: number, t: number) => void;
}

interface Track {
  ox: number;
  oy: number;
  t0: number;
  x: number;
  y: number;
  last: Dir | null;
  fired: number;
}

export class SlashRecognizer {
  private readonly pointers = new Map<number, Track>();
  private readonly min: number;

  constructor(private readonly opts: SlashOptions) {
    this.min = opts.minPx ?? 16;
  }

  down(id: number, x: number, y: number, t: number): void {
    this.pointers.set(id, { ox: x, oy: y, t0: t, x, y, last: null, fired: 0 });
  }

  move(id: number, x: number, y: number, t: number): void {
    const p = this.pointers.get(id);
    if (!p) return;
    p.x = x;
    p.y = y;
    const dir = classify(x - p.ox, y - p.oy, this.min);
    if (!dir) return;
    if (dir === p.last) {
      // continuing the same slash: let the origin follow the finger
      p.ox = x;
      p.oy = y;
      return;
    }
    p.last = dir;
    p.fired++;
    p.ox = x;
    p.oy = y;
    this.opts.onSlash(dir, t, x, y);
  }

  up(id: number, x: number, y: number, t: number): void {
    const p = this.pointers.get(id);
    this.pointers.delete(id);
    if (!p) return;
    if (p.fired === 0) {
      const dir = classify(x - p.ox, y - p.oy, this.min * 0.65);
      if (dir) this.opts.onSlash(dir, t, x, y);
      else if (t - p.t0 < 350) this.opts.onTap?.(x, y, t);
    }
  }

  cancel(id: number): void {
    this.pointers.delete(id);
  }

  reset(): void {
    this.pointers.clear();
  }
}

export function classify(dx: number, dy: number, min: number): Dir | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}
