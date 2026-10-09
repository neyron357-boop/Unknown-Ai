import Phaser from 'phaser';
import { createRng } from '@/game/core/random';

/**
 * Procedural textures, painted once with Canvas2D. No external assets:
 * instant load, offline-ready, no licensing.
 */

export const COLORS = {
  void: 0x050507,
  red: 0xff2a44,
  redHot: 0xff6a7a,
  blue: 0x39d5ff,
  blueHot: 0xbff3ff,
  gold: 0xffd27a,
  white: 0xffffff,
};

function paint(scene: Phaser.Scene, key: string, w: number, h: number, painter: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
  if (!tex) return;
  painter(tex.getContext());
  tex.refresh();
}

export function generateBaseTextures(scene: Phaser.Scene): void {
  paint(scene, 'glow', 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  paint(scene, 'spark', 16, 16, (ctx) => {
    const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 16);
  });
  paint(scene, 'shard', 14, 22, (ctx) => {
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(14, 9);
    ctx.lineTo(5, 22);
    ctx.lineTo(0, 8);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });
  paint(scene, 'streak', 4, 64, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(1, 0, 2, 64);
  });
  paint(scene, 'noise', 128, 128, (ctx) => {
    const img = ctx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}

export interface ThemeColors {
  skyTop: string;
  skyMid: string;
  horizon: string;
  moon: number;
  moonGlow: number;
  stars: number;
}

/** Sky gradient (half resolution — it's soft anyway). */
export function paintSky(scene: Phaser.Scene, key: string, w: number, h: number, horizonY: number, t: ThemeColors, seed: number): void {
  const k = 0.5;
  paint(scene, key, w * k, h * k, (ctx) => {
    ctx.scale(k, k);
    const g = ctx.createLinearGradient(0, 0, 0, horizonY);
    g.addColorStop(0, t.skyTop);
    g.addColorStop(0.62, t.skyMid);
    g.addColorStop(1, t.horizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, horizonY + 2);
    ctx.fillStyle = '#040306';
    ctx.fillRect(0, horizonY, w, h - horizonY);
    const rng = createRng(seed);
    for (let i = 0; i < t.stars; i++) {
      const x = rng() * w;
      const y = rng() * horizonY * 0.7;
      const r = rng() * 1.6 + 0.3;
      ctx.fillStyle = `rgba(255,255,255,${0.15 + rng() * 0.5})`;
      ctx.fillRect(x, y, r, r);
    }
  });
}

/** Distant skyline silhouettes with lit windows. */
export function paintSkyline(scene: Phaser.Scene, key: string, w: number, height: number, seed: number, fill: string, windows: string, density: number): void {
  paint(scene, key, w, height, (ctx) => {
    const rng = createRng(seed);
    let x = -10;
    while (x < w + 10) {
      const bw = (18 + rng() * 46) * (w / 780);
      const bh = height * (0.3 + rng() * 0.7);
      ctx.fillStyle = fill;
      ctx.fillRect(x, height - bh, bw, bh);
      if (rng() < 0.3) {
        // antenna / spire
        ctx.fillRect(x + bw * 0.45, height - bh - bh * 0.18, Math.max(1, bw * 0.08), bh * 0.18);
      }
      const cols = Math.floor(bw / 7);
      const rows = Math.floor(bh / 9);
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (rng() < density) {
            ctx.fillStyle = windows;
            ctx.globalAlpha = 0.25 + rng() * 0.6;
            ctx.fillRect(x + 3 + c * 7, height - bh + 4 + r * 9, 2.4, 3.4);
            ctx.globalAlpha = 1;
          }
        }
      }
      x += bw + rng() * 6;
    }
  });
}

export function paintVignette(scene: Phaser.Scene, w: number, h: number): void {
  paint(scene, 'vignette', w * 0.5, h * 0.5, (ctx) => {
    const W = w * 0.5;
    const H = h * 0.5;
    const v = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.45, Math.max(W, H) * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.88)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  });
}

/** Grayscale moon (tinted per theme): lit from the upper right, soft craters, bright limb. */
export function paintMoon(scene: Phaser.Scene): void {
  const R = 128;
  paint(scene, 'moon', R * 2, R * 2, (ctx) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.clip();
    const body = ctx.createRadialGradient(R * 1.35, R * 0.62, R * 0.1, R * 1.1, R * 0.9, R * 1.25);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.55, '#d8d8d8');
    body.addColorStop(1, '#6a6a6a');
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, R * 2, R * 2);
    const craters: [number, number, number, number][] = [
      [0.68, 0.78, 0.3, 0.16],
      [1.38, 0.58, 0.13, 0.12],
      [1.28, 1.32, 0.21, 0.14],
      [0.82, 1.42, 0.1, 0.1],
      [1.62, 1.02, 0.08, 0.1],
    ];
    for (const [cx, cy, cr, a] of craters) {
      const g = ctx.createRadialGradient(cx * R, cy * R, 0, cx * R, cy * R, cr * R);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(0.75, `rgba(0,0,0,${a * 0.8})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, R * 2, R * 2);
    }
    // grain
    const rng = createRng(77);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + rng() * 0.05})`;
      ctx.fillRect(rng() * R * 2, rng() * R * 2, 2, 2);
    }
    ctx.restore();
    // lit limb
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(R, R, R - 2.5, -Math.PI * 0.85, Math.PI * 0.2);
    ctx.stroke();
  });
}

/** Darkens reflections with distance from the waterline. */
export function paintReflFade(scene: Phaser.Scene, h: number): void {
  paint(scene, 'reflFade', 8, Math.max(8, h), (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(4,4,7,0)');
    g.addColorStop(0.45, 'rgba(4,4,7,0.55)');
    g.addColorStop(1, 'rgba(3,3,5,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, h);
  });
}

export function paintFloor(scene: Phaser.Scene, w: number, h: number): void {
  paint(scene, 'floor', 8, Math.max(8, h), (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(18,12,22,0.82)');
    g.addColorStop(0.3, 'rgba(7,6,11,0.94)');
    g.addColorStop(0.62, 'rgba(3,3,5,1)');
    g.addColorStop(1, 'rgba(2,2,3,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, h);
  });
  void w;
}
