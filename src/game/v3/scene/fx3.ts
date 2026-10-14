import Phaser from 'phaser';
import type { Vec } from '../anatomy/skeleton';
import type { Dir } from '../core/types';

/** A short-lived procedural effect drawn into a shared Graphics each frame. */
export interface Effect {
  update(dt: number, g: Phaser.GameObjects.Graphics): boolean;
  /** Ignores slow-motion (UI-like effects). */
  real?: boolean;
}

export const real = (e: Effect): Effect => ((e.real = true), e);

/** Glowing stroke: wide soft passes and a hot core. */
export function neon(g: Phaser.GameObjects.Graphics, color: number, width: number, alpha: number, draw: () => void): void {
  g.lineStyle(width * 2.6, color, alpha * 0.12);
  draw();
  g.lineStyle(width * 1.3, color, alpha * 0.4);
  draw();
  g.lineStyle(Math.max(1, width * 0.45), 0xffffff, alpha);
  draw();
}

/** Anime crescent slash from a to b: white core, colored rim, fast head and slower tail. */
export function slashArc(a: Vec, b: Vec, bend: number, rim: number, width: number, ms: number): Effect {
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
      const head = Math.min(1, t / (ms * 0.18));
      const fade = t < ms * 0.25 ? 1 : 1 - (t - ms * 0.25) / (ms * 0.75);
      if (fade <= 0) return false;
      const tail = Math.max(0, head - 0.8 - (1 - fade) * 0.3);
      const steps = 18;
      for (const [w, al, col] of [
        [width * 2.4, 0.18, rim],
        [width * 1.1, 0.55, rim],
        [width * 0.42, 1, 0xffffff],
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

export function shockwave(x: number, y: number, maxR: number, width: number, color: number, ms: number, flat = 0.35): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      const p = t / ms;
      if (p >= 1) return false;
      const r = maxR * (1 - Math.pow(1 - p, 3));
      neon(g, color, width * (1 - p) + 1, 1 - p, () => g.strokeEllipse(x, y, r * 2, r * 2 * flat));
      return true;
    },
  };
}

export function speedLines(cx: number, cy: number, W: number, H: number, width: number, ms: number, color = 0xffffff): Effect {
  let t = 0;
  const rays = Array.from({ length: 30 }, (_, i) => ({ a: (i / 30) * Math.PI * 2 + Math.random() * 0.2, r0: 0.42 + Math.random() * 0.25, w: 1 + Math.random() * 2.5 }));
  const R = Math.hypot(W, H);
  return {
    update(dt, g) {
      t += dt;
      const p = t / ms;
      if (p >= 1) return false;
      for (const ray of rays) {
        const r0 = R * (ray.r0 - p * 0.15);
        g.lineStyle(ray.w * width, color, 0.5 * (1 - p));
        g.lineBetween(cx + Math.cos(ray.a) * r0, cy + Math.sin(ray.a) * r0, cx + Math.cos(ray.a) * R, cy + Math.sin(ray.a) * R);
      }
      return true;
    },
  };
}

/** A straight line that fades (tracers, dash streaks). */
export function streak(a: Vec, b: Vec, width: number, color: number, ms: number): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      const p = t / ms;
      if (p >= 1) return false;
      neon(g, color, width * (1 - p * 0.6), 1 - p, () => g.lineBetween(a.x, a.y, b.x, b.y));
      return true;
    },
  };
}

/** A bullet tracer flying from a to b over `ms` (arrives exactly at the end). */
export function tracer(a: Vec, b: Vec, width: number, color: number, ms: number): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      const p = Math.min(1, t / ms);
      const tail = Math.max(0, p - 0.18);
      const x0 = a.x + (b.x - a.x) * tail;
      const y0 = a.y + (b.y - a.y) * tail;
      const x1 = a.x + (b.x - a.x) * p;
      const y1 = a.y + (b.y - a.y) * p;
      neon(g, color, width, 1, () => g.lineBetween(x0, y0, x1, y1));
      return t < ms + 40;
    },
  };
}

/** Hanging execution cut: a hairline that breathes until it's cut. */
export function cutLine(a: Vec, b: Vec, width: number, ms: number, color = 0xffe8e0): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      if (t >= ms) return false;
      const grow = Math.min(1, t / 90);
      const pulse = 0.75 + Math.sin(t / 45) * 0.25;
      neon(g, color, width * pulse, 1, () => g.lineBetween(a.x, a.y, a.x + (b.x - a.x) * grow, a.y + (b.y - a.y) * grow));
      return true;
    },
  };
}

const DIRV: Record<Dir, Vec> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };

/** Execution glyph: a glowing cut across the body with an arrow showing the swipe. */
export function execGlyph(c: Vec, dir: Dir, size: number, ms: number, color = 0xff2a3a): Effect {
  let t = 0;
  const d = DIRV[dir];
  return {
    real: true,
    update(dt, g) {
      t += dt;
      const p = t / ms;
      if (p >= 1) return false;
      const a = p < 0.15 ? p / 0.15 : p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
      const a0 = { x: c.x - d.x * size, y: c.y - d.y * size };
      const a1 = { x: c.x + d.x * size, y: c.y + d.y * size };
      neon(g, color, size * 0.09, a, () => g.lineBetween(a0.x, a0.y, a1.x, a1.y));
      // arrow head
      const n = { x: -d.y, y: d.x };
      const h = { x: a1.x + d.x * size * 0.25, y: a1.y + d.y * size * 0.25 };
      neon(g, color, size * 0.07, a, () => {
        g.lineBetween(h.x, h.y, a1.x - d.x * size * 0.15 + n.x * size * 0.28, a1.y - d.y * size * 0.15 + n.y * size * 0.28);
        g.lineBetween(h.x, h.y, a1.x - d.x * size * 0.15 - n.x * size * 0.28, a1.y - d.y * size * 0.15 - n.y * size * 0.28);
      });
      return true;
    },
  };
}

/** Ghost swipe (first encounters): a translucent chevron sweeping in the slash direction. */
export function ghostSwipe(c: Vec, dir: Dir, size: number, until: () => boolean): Effect {
  let t = 0;
  const d = DIRV[dir];
  const n = { x: -d.y, y: d.x };
  return {
    real: true,
    update(dt, g) {
      t += dt;
      if (until()) return false;
      const p = (t % 700) / 700;
      const a = Math.sin(p * Math.PI);
      const off = (p - 0.5) * size * 1.6;
      const tip = { x: c.x + d.x * (off + size * 0.4), y: c.y + d.y * (off + size * 0.4) };
      const back = (k: number) => ({ x: tip.x - d.x * size * 0.45 + n.x * size * 0.42 * k, y: tip.y - d.y * size * 0.45 + n.y * size * 0.42 * k });
      neon(g, 0xffffff, size * 0.09, a * 0.9, () => {
        const b1 = back(1);
        const b2 = back(-1);
        g.lineBetween(b1.x, b1.y, tip.x, tip.y);
        g.lineBetween(tip.x, tip.y, b2.x, b2.y);
        g.lineBetween(c.x - d.x * size * 0.8, c.y - d.y * size * 0.8, tip.x - d.x * size * 0.1, tip.y - d.y * size * 0.1);
      });
      return true;
    },
  };
}

/** Laser sight (gunner): a thin red line with a dot, flickering. */
export function laser(from: () => Vec | null, to: () => Vec, width: number, until: () => boolean): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      if (until()) return false;
      const a = from();
      if (!a) return false;
      const b = to();
      const flick = 0.55 + Math.random() * 0.35;
      g.lineStyle(width, 0xff1a1a, flick * 0.7);
      g.lineBetween(a.x, a.y, b.x, b.y);
      g.fillStyle(0xff3030, flick);
      g.fillCircle(b.x, b.y, width * 2.2);
      return true;
    },
  };
}

/** Kusarigama chain (Fox): an arcing chain from hand to target and back. */
export function chain(from: () => Vec, to: Vec, width: number, ms: number): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      const p = t / ms;
      if (p >= 1) return false;
      const a = from();
      const k = p < 0.5 ? p * 2 : (1 - p) * 2;
      const b = { x: a.x + (to.x - a.x) * k, y: a.y + (to.y - a.y) * k };
      const sag = Math.sin(k * Math.PI) * width * 14;
      g.lineStyle(width, 0x0a0a0c, 1);
      g.beginPath();
      for (let i = 0; i <= 12; i++) {
        const u = i / 12;
        const x = a.x + (b.x - a.x) * u;
        const y = a.y + (b.y - a.y) * u + Math.sin(u * Math.PI) * sag;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
      return true;
    },
  };
}

export function glitchBands(W: number, H: number, s: number, ms: number, colors: number[]): Effect {
  let t = 0;
  return {
    real: true,
    update(dt, g) {
      t += dt;
      if (t >= ms) return false;
      for (let i = 0; i < 7; i++) {
        g.fillStyle(colors[i % colors.length], 0.1 + Math.random() * 0.2);
        g.fillRect((Math.random() - 0.5) * 40 * s, Math.random() * H, W, (3 + Math.random() * 22) * s);
      }
      return true;
    },
  };
}

// ------------------------------------------------------------------ kinetic words

export type WordStyle = 'blood' | 'impact' | 'combo' | 'whisper' | 'small';

const WORD_FONT: Record<WordStyle, string> = {
  blood: '"Rubik Wet Paint", "Russo One", Impact, sans-serif',
  impact: '"Russo One", Impact, sans-serif',
  combo: '"Rubik Wet Paint", "Russo One", Impact, sans-serif',
  whisper: '"Rubik Glitch", "Russo One", Impact, sans-serif',
  small: '"Russo One", Impact, sans-serif',
};

/** Manga onomatopoeia and big kinetic words, with an ink-brush stroke behind. */
export class Words {
  private pool: { text: Phaser.GameObjects.Text; brush: Phaser.GameObjects.Image }[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
    private unit: number,
  ) {}

  setUnit(u: number): void {
    this.unit = u;
  }

  pop(word: string, x: number, y: number, style: WordStyle = 'impact', opts: { rot?: number; size?: number; color?: string; hold?: number } = {}): void {
    let item = this.pool.find((p) => !p.text.visible);
    if (!item) {
      const brush = this.scene.add.image(0, 0, 'brush').setVisible(false);
      const text = this.scene.add.text(0, 0, '', { fontFamily: WORD_FONT.impact }).setOrigin(0.5).setVisible(false);
      this.layer.add([brush, text]);
      item = { text, brush };
      this.pool.push(item);
    }
    const { text, brush } = item;
    const size = Math.round((opts.size ?? (style === 'combo' ? 26 : style === 'small' ? 7 : style === 'whisper' ? 22 : 15)) * this.unit);
    const rot = opts.rot ?? (Math.random() - 0.5) * 0.35;
    const color = opts.color ?? (style === 'blood' || style === 'combo' ? '#d0101e' : style === 'whisper' ? '#ff2a3a' : '#ffffff');
    text
      .setText(word)
      .setFontFamily(WORD_FONT[style])
      .setFontSize(size)
      .setColor(color)
      .setStroke(style === 'impact' || style === 'small' ? '#a0101c' : '#000000', Math.max(3, size * 0.1))
      .setShadow(0, 0, '#000000', size * 0.15, true, true)
      .setPosition(x, y)
      .setRotation(rot)
      .setAlpha(style === 'whisper' ? 0.55 : 1)
      .setScale(1.8)
      .setVisible(true);
    const showBrush = style === 'impact' || style === 'combo';
    brush
      .setVisible(showBrush)
      .setPosition(x, y)
      .setRotation(rot)
      .setTint(style === 'combo' ? 0x000000 : 0x000000)
      .setAlpha(0.85)
      .setDisplaySize(text.width * 1.25 + size, size * 1.15);
    this.scene.tweens.killTweensOf([text, brush]);
    this.scene.tweens.add({ targets: text, scale: 1, duration: 110, ease: 'Back.easeOut' });
    const hold = opts.hold ?? (style === 'combo' ? 650 : style === 'whisper' ? 1600 : 320);
    this.scene.tweens.add({ targets: [text, brush], alpha: 0, y: y - size * (style === 'whisper' ? 0 : 0.4), delay: hold, duration: style === 'whisper' ? 700 : 360, ease: 'Quad.easeIn', onComplete: () => (text.setVisible(false), brush.setVisible(false)) });
  }
}

export const KILL_WORDS: Record<string, string[]> = {
  bisect: ['ЗАН!', 'ХРЯСЬ!', 'РАЗРЕЗ'],
  decap: ['ЧИК!', 'ВЖУХ!', 'ГОЛОВА!'],
  cleave: ['ШРРК!', 'ХЛЮП!', 'ВЖИК!'],
  impale: ['ДЗЫН!', 'ВВЕРХ!', 'ШАРК!'],
  burst: ['БАМ!!', 'КРОВЬ!', 'ФАРШ!'],
  shot: ['БАХ!', 'ПЫЩ!'],
  shove: ['ПРОЧЬ!', 'ВОН!'],
  parry: ['ДЗИНЬ!', 'КЛАНГ!', 'ЗВЯК!'],
  miss: ['ГХ!', 'УХ!'],
};

export const COMBO_WORDS: [number, string][] = [
  [10, 'РЕЗНЯ'],
  [20, 'КРОВАВЫЙ ТАКТ'],
  [30, 'БЕЗУМИЕ'],
  [45, 'НЕУДЕРЖИМ'],
  [60, 'БОГ РИТМА'],
];
