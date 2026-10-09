import Phaser from 'phaser';
import type { Vec } from './rig';

export interface Effect {
  update(dt: number, g: Phaser.GameObjects.Graphics): boolean;
  /** Real-time effects ignore slow motion. */
  real?: boolean;
}

export function neon(g: Phaser.GameObjects.Graphics, color: number, width: number, alpha: number, draw: () => void): void {
  g.lineStyle(width * 2.4, color, alpha * 0.12);
  draw();
  g.lineStyle(width * 1.2, color, alpha * 0.35);
  draw();
  g.lineStyle(width * 0.55, color, alpha * 0.85);
  draw();
  g.lineStyle(Math.max(1, width * 0.22), 0xffffff, alpha);
  draw();
}

export function real(e: Effect): Effect {
  e.real = true;
  return e;
}

/** Curved anime slash: a crescent sweeping from a to b. */
export function slashArc(a: Vec, b: Vec, bend: number, color: number, width: number, ms: number): Effect {
  let t = 0;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  const pt = (u: number): Vec => ({
    x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * cx + u * u * b.x,
    y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * cy + u * u * b.y,
  });
  return {
    update(dt, g) {
      t += dt;
      const head = Math.min(1, t / (ms * 0.22));
      const fade = t < ms * 0.3 ? 1 : 1 - (t - ms * 0.3) / (ms * 0.7);
      if (fade <= 0) return false;
      const tail = Math.max(0, head - 0.75 - (1 - fade) * 0.3);
      // crescent: thick in the middle, thin at the ends
      const steps = 16;
      for (const [w, al, col] of [
        [width * 2.6, 0.12, color],
        [width * 1.3, 0.4, color],
        [width * 0.45, 1, 0xffffff],
      ] as const) {
        for (let i = 0; i < steps; i++) {
          const u0 = tail + ((head - tail) * i) / steps;
          const u1 = tail + ((head - tail) * (i + 1)) / steps;
          const thick = Math.sin(((i + 0.5) / steps) * Math.PI);
          const p0 = pt(u0);
          const p1 = pt(u1);
          g.lineStyle(Math.max(0.5, w * thick * fade), col, al * fade);
          g.lineBetween(p0.x, p0.y, p1.x, p1.y);
        }
      }
      return true;
    },
  };
}

export function shockwave(x: number, y: number, maxR: number, s: number, color: number, ms: number, flat = 0.32): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      const p = t / ms;
      if (p >= 1) return false;
      const r = maxR * (1 - Math.pow(1 - p, 3));
      neon(g, color, 4 * s * (1 - p) + 1, 1 - p, () => g.strokeEllipse(x, y, r * 2, r * 2 * flat));
      return true;
    },
  };
}

export function speedLines(cx: number, cy: number, W: number, H: number, s: number, ms: number, color = 0xffffff): Effect {
  let t = 0;
  const rays = Array.from({ length: 28 }, (_, i) => ({ a: (i / 28) * Math.PI * 2 + Math.random() * 0.2, r0: 0.45 + Math.random() * 0.25, w: 1 + Math.random() * 2.5 }));
  const R = Math.hypot(W, H);
  return {
    update(dt, g) {
      t += dt;
      const p = t / ms;
      if (p >= 1) return false;
      for (const ray of rays) {
        const r0 = R * (ray.r0 - p * 0.15);
        g.lineStyle(ray.w * s, color, 0.5 * (1 - p));
        g.lineBetween(cx + Math.cos(ray.a) * r0, cy + Math.sin(ray.a) * r0, cx + Math.cos(ray.a) * R, cy + Math.sin(ray.a) * R);
      }
      return true;
    },
  };
}

export function line(a: Vec, b: Vec, s: number, color: number, ms: number): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      const p = t / ms;
      if (p >= 1) return false;
      g.lineStyle(1.6 * s, color, 0.6 * (1 - p));
      g.lineBetween(a.x, a.y, b.x, b.y);
      return true;
    },
  };
}

/** The finisher's cut: a hairline that hangs in the air, breathing, until the split. */
export function cutLine(a: Vec, b: Vec, s: number, ms: number): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      if (t >= ms) return false;
      const grow = Math.min(1, t / 90);
      const pulse = 0.75 + Math.sin(t / 45) * 0.25;
      const ex = a.x + (b.x - a.x) * grow;
      const ey = a.y + (b.y - a.y) * grow;
      neon(g, 0xbff3ff, 3 * s * pulse, 1, () => g.lineBetween(a.x, a.y, ex, ey));
      return true;
    },
  };
}

export function glitchBands(W: number, H: number, s: number, ms: number, colors: number[]): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      if (t >= ms) return false;
      for (let i = 0; i < 6; i++) {
        g.fillStyle(colors[i % colors.length], 0.1 + Math.random() * 0.18);
        g.fillRect((Math.random() - 0.5) * 40 * s, Math.random() * H, W, (3 + Math.random() * 18) * s);
      }
      return true;
    },
  };
}

/** Pooled floating damage / score numbers. */
export class Popups {
  private readonly pool: Phaser.GameObjects.Text[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
  ) {}

  spawn(x: number, y: number, text: string, color: string, size: number): void {
    let t = this.pool.find((p) => !p.visible);
    if (!t) {
      t = this.scene.add.text(0, 0, '', { fontFamily: '"Unbounded Variable", "Arial Black", sans-serif', fontStyle: '800', stroke: '#000000' }).setOrigin(0.5);
      this.layer.add(t);
      this.pool.push(t);
    }
    t.setText(text).setColor(color).setFontSize(Math.round(size)).setStroke('#000000', Math.max(2, size / 7));
    t.setPosition(x + (Math.random() - 0.5) * size, y).setVisible(true).setAlpha(1).setScale(1.6);
    this.scene.tweens.killTweensOf(t);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.easeOut' });
    this.scene.tweens.add({
      targets: t,
      y: y - size * 2.2,
      alpha: 0,
      delay: 260,
      duration: 520,
      ease: 'Quad.easeIn',
      onComplete: () => t!.setVisible(false),
    });
  }
}
