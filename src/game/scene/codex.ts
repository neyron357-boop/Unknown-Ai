import Phaser from 'phaser';
import type { Vec } from './rig';
import { COLORS } from './textures';

/** Six rune glyphs as line segments in a [-1, 1] box (original shapes). */
export const GLYPHS: [number, number, number, number][][] = [
  [[0, -1, 0, 1], [0, -0.8, 0.7, -0.3], [0, -0.2, 0.7, 0.3]],
  [[-0.5, -1, -0.5, 1], [-0.5, -1, 0.5, -0.5], [0.5, -0.5, -0.5, 0], [-0.5, 0, 0.5, 1]],
  [[0, -0.2, 0, 1], [0, -0.2, -0.75, -1], [0, -0.2, 0.75, -1]],
  [[0, -1, 0.6, -0.3], [0.6, -0.3, 0, 0.4], [0, 0.4, -0.6, -0.3], [-0.6, -0.3, 0, -1], [0, 0.4, -0.6, 1], [0, 0.4, 0.6, 1]],
  [[-0.6, -1, -0.6, 1], [0.6, -1, 0.6, 1], [-0.6, -1, 0.6, 1], [0.6, -1, -0.6, 1]],
  [[-0.4, -1, -0.4, 1], [-0.4, -0.5, 0.5, 0], [0.5, 0, -0.4, 0.5]],
];

export function drawGlyph(g: Phaser.GameObjects.Graphics, i: number, x: number, y: number, size: number, color: number, alpha: number, width: number): void {
  const segs = GLYPHS[i % GLYPHS.length];
  for (const [w, a] of [
    [width * 2.6, 0.18],
    [width, 1],
  ] as const) {
    g.lineStyle(w, color, alpha * a);
    for (const [ax, ay, bx, by] of segs) g.lineBetween(x + ax * size, y + ay * size, x + bx * size, y + by * size);
  }
}

type NodeState = 'dim' | 'lit' | 'armed' | 'hit' | 'wrong';

/** The hex codex of runes in thumb reach — tap the runes in the order they lit. */
export class Codex {
  private readonly g: Phaser.GameObjects.Graphics;
  private center: Vec = { x: 0, y: 0 };
  private R = 1;
  private S = 1;
  private alpha = 0;
  private target = 0;
  private readonly state: NodeState[] = Array(6).fill('dim');
  private readonly flash: number[] = Array(6).fill(0);
  private t = 0;

  constructor(layer: Phaser.GameObjects.Layer, scene: Phaser.Scene) {
    this.g = scene.add.graphics();
    layer.add(this.g);
  }

  layout(cx: number, cy: number, R: number, S: number): void {
    this.center = { x: cx, y: cy };
    this.R = R;
    this.S = S;
  }

  nodePos(i: number): Vec {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return { x: this.center.x + Math.cos(a) * this.R, y: this.center.y + Math.sin(a) * this.R * 0.82 };
  }

  show(): void {
    this.target = 1;
    this.state.fill('dim');
  }

  hide(): void {
    this.target = 0;
  }

  light(i: number): void {
    this.state[i] = 'lit';
    this.flash[i] = 1;
  }

  arm(): void {
    for (let i = 0; i < 6; i++) this.state[i] = 'armed';
  }

  mark(i: number, correct: boolean): void {
    this.state[i] = correct ? 'hit' : 'wrong';
    this.flash[i] = 1;
  }

  /** Nearest rune within reach (device px), or null. */
  resolve(x: number, y: number): number | null {
    if (this.alpha < 0.5) return null;
    let best: number | null = null;
    let bestD = Infinity;
    for (let i = 0; i < 6; i++) {
      const p = this.nodePos(i);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return bestD <= this.R * 0.62 ? best : null;
  }

  update(dt: number): void {
    this.t += dt / 1000;
    this.alpha += (this.target - this.alpha) * Math.min(1, dt / 160);
    for (let i = 0; i < 6; i++) this.flash[i] = Math.max(0, this.flash[i] - dt / 500);
    const g = this.g;
    g.clear();
    if (this.alpha < 0.02) return;
    const a = this.alpha;
    const { S, R } = this;
    // frame
    g.fillStyle(0x020308, 0.6 * a);
    g.fillEllipse(this.center.x, this.center.y, R * 2.9, R * 2.5);
    g.lineStyle(1.2 * S, COLORS.blue, 0.35 * a);
    g.strokeEllipse(this.center.x, this.center.y, R * 2.9, R * 2.5);
    for (let i = 0; i < 6; i++) {
      const p = this.nodePos(i);
      const st = this.state[i];
      const f = this.flash[i];
      const col = st === 'wrong' ? COLORS.red : st === 'hit' ? COLORS.gold : COLORS.blue;
      const baseA = st === 'dim' ? 0.35 : st === 'armed' ? 0.65 + Math.sin(this.t * 5 + i) * 0.2 : 0.9;
      const size = 11 * S * (1 + f * 0.35);
      g.fillStyle(col, (0.08 + f * 0.35) * a);
      g.fillCircle(p.x, p.y, 21 * S * (1 + f * 0.3));
      g.lineStyle(1.4 * S, col, (st === 'armed' ? 0.7 : 0.3) * a);
      g.strokeCircle(p.x, p.y, 21 * S);
      drawGlyph(g, i, p.x, p.y, size, f > 0.05 ? 0xffffff : col, Math.min(1, baseA + f) * a, 2 * S);
    }
  }
}
