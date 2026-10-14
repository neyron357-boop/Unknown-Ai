import Phaser from 'phaser';
import { createRng } from '../core/random';

/**
 * Procedural textures (Canvas2D, painted once). No external art: instant load, offline.
 * White/grayscale textures are tinted at draw time.
 */

export function paint(scene: Phaser.Scene, key: string, w: number, h: number, painter: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const W = Math.max(1, Math.ceil(w));
  const H = Math.max(1, Math.ceil(h));
  const tex = scene.textures.createCanvas(key, W, H);
  if (!tex) return;
  painter(tex.getContext(), W, H);
  tex.refresh();
}

export function paintBase(scene: Phaser.Scene): void {
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
  paint(scene, 'streak', 4, 64, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(1, 0, 2, 64);
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
  paint(scene, 'noise', 128, 128, (ctx) => {
    const img = ctx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
  // blood splats (white, tinted at draw time)
  for (let k = 0; k < 6; k++) {
    paint(scene, `splat${k}`, 96, 96, (ctx) => {
      const rng = createRng(1000 + k * 17);
      ctx.fillStyle = '#ffffff';
      const blob = (x: number, y: number, r: number) => {
        ctx.beginPath();
        const n = 9;
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const rr = r * (0.75 + rng() * 0.5);
          const px = x + Math.cos(a) * rr;
          const py = y + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.quadraticCurveTo(x + Math.cos(a - 0.35) * rr * 1.2, y + Math.sin(a - 0.35) * rr * 1.2, px, py);
        }
        ctx.fill();
      };
      blob(48, 48, 14 + rng() * 6);
      const dir = rng() * Math.PI * 2;
      for (let i = 0; i < 14; i++) {
        const a = dir + (rng() - 0.5) * 2.2;
        const d = 16 + rng() * 26;
        blob(48 + Math.cos(a) * d, 48 + Math.sin(a) * d, 1.2 + rng() * 4.5);
      }
      // directional streaks
      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const a = dir + (rng() - 0.5) * 0.9;
        ctx.lineWidth = 1.5 + rng() * 3;
        ctx.beginPath();
        ctx.moveTo(48 + Math.cos(a) * 10, 48 + Math.sin(a) * 10);
        ctx.lineTo(48 + Math.cos(a) * (28 + rng() * 18), 48 + Math.sin(a) * (28 + rng() * 18));
        ctx.stroke();
      }
    });
  }
  // a drip trail for screen blood
  paint(scene, 'drip', 12, 96, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 96);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.85, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(3, 0);
    ctx.lineTo(9, 0);
    ctx.lineTo(8, 80);
    ctx.quadraticCurveTo(6, 96, 4, 80);
    ctx.closePath();
    ctx.fill();
  });
  // ink brush stroke behind kinetic words
  paint(scene, 'brush', 256, 64, (ctx) => {
    const rng = createRng(77);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(6, 34);
    for (let x = 6; x <= 250; x += 8) ctx.lineTo(x, 10 + rng() * 6 + (x < 30 ? (30 - x) * 0.6 : 0));
    for (let x = 250; x >= 6; x -= 8) ctx.lineTo(x, 54 - rng() * 6 - (x > 220 ? (x - 220) * 0.5 : 0));
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 40; i++) {
      ctx.globalAlpha = 0.5 + rng() * 0.5;
      ctx.fillRect(rng() * 256, 6 + rng() * 52, 1 + rng() * 3, 1 + rng() * 2);
    }
    ctx.globalAlpha = 1;
  });
  // glass crack overlay
  paint(scene, 'crack', 256, 256, (ctx) => {
    const rng = createRng(9);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 12; i++) {
      let x = 128;
      let y = 128;
      let a = (i / 12) * Math.PI * 2 + rng() * 0.3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 7; k++) {
        a += (rng() - 0.5) * 0.6;
        x += Math.cos(a) * (10 + rng() * 14);
        y += Math.sin(a) * (10 + rng() * 14);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let r = 18; r < 120; r += 22 + rng() * 10) {
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const rr = r * (0.85 + rng() * 0.3);
        if (i === 0) ctx.moveTo(128 + Math.cos(a) * rr, 128 + Math.sin(a) * rr);
        else ctx.lineTo(128 + Math.cos(a) * rr, 128 + Math.sin(a) * rr);
      }
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });
  // grayscale moon, lit from the upper right
  paint(scene, 'moon', 256, 256, (ctx) => {
    const R = 128;
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
    const rng = createRng(77);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + rng() * 0.05})`;
      ctx.fillRect(rng() * R * 2, rng() * R * 2, 2, 2);
    }
    ctx.restore();
  });
}

export function paintVignette(scene: Phaser.Scene, w: number, h: number): void {
  paint(scene, 'vignette', w * 0.5, h * 0.5, (ctx, W, H) => {
    const v = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.32, W / 2, H * 0.45, Math.max(W, H) * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  });
}

export interface SkyColors {
  top: string;
  mid: string;
  horizon: string;
  stars: number;
}

export function paintSky(scene: Phaser.Scene, key: string, w: number, h: number, horizon: number, c: SkyColors, seed: number): void {
  const k = 0.5;
  paint(scene, key, w * k, h * k, (ctx) => {
    ctx.scale(k, k);
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, c.top);
    g.addColorStop(0.6, c.mid);
    g.addColorStop(1, c.horizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, horizon + 2);
    ctx.fillStyle = '#030204';
    ctx.fillRect(0, horizon, w, h - horizon);
    const rng = createRng(seed);
    for (let i = 0; i < c.stars; i++) {
      const r = rng() * 1.6 + 0.3;
      ctx.fillStyle = `rgba(255,255,255,${0.12 + rng() * 0.45})`;
      ctx.fillRect(rng() * w, rng() * horizon * 0.7, r, r);
    }
  });
}

/** Skyline silhouettes with lit windows; `style` 0 = modern towers, 1 = old blocks with water tanks. */
export function paintSkyline(scene: Phaser.Scene, key: string, w: number, h: number, seed: number, fill: string, windows: string, density: number, style = 0): void {
  paint(scene, key, w, h, (ctx) => {
    const rng = createRng(seed);
    let x = -10;
    const k = w / 780;
    while (x < w + 10) {
      const bw = (22 + rng() * 52) * k;
      const bh = h * (0.28 + rng() * 0.72);
      ctx.fillStyle = fill;
      ctx.fillRect(x, h - bh, bw, bh);
      if (style === 1 && rng() < 0.35) {
        // water tank on legs
        const tx = x + bw * (0.2 + rng() * 0.4);
        ctx.fillRect(tx, h - bh - 14 * k, 2 * k, 14 * k);
        ctx.fillRect(tx + 12 * k, h - bh - 14 * k, 2 * k, 14 * k);
        ctx.beginPath();
        ctx.ellipse(tx + 7 * k, h - bh - 22 * k, 9 * k, 10 * k, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (rng() < 0.3) ctx.fillRect(x + bw * 0.45, h - bh - bh * 0.2, Math.max(1, bw * 0.06), bh * 0.2);
      const cols = Math.floor(bw / (7 * k));
      const rows = Math.floor(bh / (9 * k));
      for (let c = 0; c < cols; c++)
        for (let r = 0; r < rows; r++)
          if (rng() < density) {
            ctx.fillStyle = windows;
            ctx.globalAlpha = 0.2 + rng() * 0.65;
            ctx.fillRect(x + 3 * k + c * 7 * k, h - bh + 4 * k + r * 9 * k, 2.4 * k, 3.4 * k);
            ctx.globalAlpha = 1;
          }
      x += bw + rng() * 5 * k;
    }
  });
}

/** Roof props (foreground-ish silhouettes): water tower, antenna mast, vents. */
export function paintRoofProps(scene: Phaser.Scene, key: string, w: number, h: number): void {
  paint(scene, key, w, h, (ctx) => {
    const k = w / 780;
    ctx.fillStyle = '#050407';
    // water tower on the left
    const tx = 40 * k;
    const base = h;
    ctx.fillRect(tx + 8 * k, base - 120 * k, 5 * k, 120 * k);
    ctx.fillRect(tx + 70 * k, base - 120 * k, 5 * k, 120 * k);
    ctx.fillRect(tx + 8 * k, base - 70 * k, 67 * k, 3 * k);
    ctx.beginPath();
    ctx.moveTo(tx, base - 120 * k);
    ctx.lineTo(tx + 84 * k, base - 120 * k);
    ctx.lineTo(tx + 80 * k, base - 210 * k);
    ctx.quadraticCurveTo(tx + 42 * k, base - 248 * k, tx + 4 * k, base - 210 * k);
    ctx.closePath();
    ctx.fill();
    // antenna mast on the right
    const ax = w - 70 * k;
    ctx.fillRect(ax, base - 300 * k, 4 * k, 300 * k);
    for (let i = 0; i < 6; i++) ctx.fillRect(ax - (18 - i * 2) * k, base - (280 - i * 40) * k, (40 - i * 4) * k, 2 * k);
    // vents
    ctx.fillRect(w * 0.62, base - 26 * k, 48 * k, 26 * k);
    ctx.fillRect(w * 0.62 + 6 * k, base - 34 * k, 36 * k, 8 * k);
    ctx.fillRect(w * 0.3, base - 18 * k, 30 * k, 18 * k);
  });
}

/** Building facade for the free fall (tiles vertically). */
export function paintFacade(scene: Phaser.Scene, key: string, w: number, h: number, seed: number): void {
  paint(scene, key, w, h, (ctx) => {
    const rng = createRng(seed);
    const k = w / 780;
    ctx.fillStyle = '#0b0a0f';
    ctx.fillRect(0, 0, w, h);
    const cols = 6;
    const cw = w / cols;
    const rows = Math.round(h / (120 * k));
    const rh = h / rows;
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rows; r++) {
        const x = c * cw + cw * 0.18;
        const y = r * rh + rh * 0.2;
        const lit = rng();
        ctx.fillStyle = lit < 0.18 ? '#c89b62' : lit < 0.26 ? '#a01a24' : '#15131a';
        ctx.globalAlpha = lit < 0.26 ? 0.55 + rng() * 0.3 : 1;
        ctx.fillRect(x, y, cw * 0.64, rh * 0.56);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#060508';
        ctx.fillRect(x + cw * 0.31, y, 2 * k, rh * 0.56);
      }
    for (let r = 0; r <= rows; r++) {
      ctx.fillStyle = '#040306';
      ctx.fillRect(0, r * rh - 3 * k, w, 6 * k);
    }
  });
}

/** Tunnel wall segment with a lamp (tiles horizontally). */
export function paintTunnel(scene: Phaser.Scene, key: string, w: number, h: number): void {
  paint(scene, key, w, h, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#07080c');
    g.addColorStop(0.5, '#10131a');
    g.addColorStop(1, '#050508');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0b0d12';
    for (let x = 0; x < w; x += w / 4) ctx.fillRect(x, 0, w / 60, h);
    // cable runs
    ctx.strokeStyle = '#020203';
    ctx.lineWidth = Math.max(2, w / 200);
    for (const y of [0.22, 0.27, 0.31]) {
      ctx.beginPath();
      ctx.moveTo(0, h * y);
      ctx.bezierCurveTo(w * 0.3, h * (y + 0.03), w * 0.7, h * (y + 0.03), w, h * y);
      ctx.stroke();
    }
  });
}

/** Temple arena: torii gate, stone lanterns, the cliff edge. */
export function paintTemple(scene: Phaser.Scene, key: string, w: number, h: number): void {
  paint(scene, key, w, h, (ctx) => {
    const k = w / 780;
    ctx.fillStyle = '#040305';
    // torii
    const cx = w * 0.5;
    const top = h - 520 * k;
    ctx.fillRect(cx - 190 * k, top + 70 * k, 22 * k, 450 * k);
    ctx.fillRect(cx + 168 * k, top + 70 * k, 22 * k, 450 * k);
    ctx.beginPath();
    ctx.moveTo(cx - 280 * k, top + 10 * k);
    ctx.quadraticCurveTo(cx, top + 40 * k, cx + 280 * k, top + 10 * k);
    ctx.lineTo(cx + 268 * k, top + 42 * k);
    ctx.quadraticCurveTo(cx, top + 66 * k, cx - 268 * k, top + 42 * k);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - 230 * k, top + 92 * k, 460 * k, 18 * k);
    ctx.fillRect(cx - 12 * k, top + 52 * k, 24 * k, 52 * k);
    // stone lanterns
    for (const lx of [cx - 300 * k, cx + 300 * k]) {
      ctx.fillRect(lx - 10 * k, h - 120 * k, 20 * k, 120 * k);
      ctx.fillRect(lx - 28 * k, h - 132 * k, 56 * k, 14 * k);
      ctx.fillRect(lx - 20 * k, h - 172 * k, 40 * k, 40 * k);
      ctx.beginPath();
      ctx.moveTo(lx - 36 * k, h - 172 * k);
      ctx.lineTo(lx, h - 200 * k);
      ctx.lineTo(lx + 36 * k, h - 172 * k);
      ctx.closePath();
      ctx.fill();
    }
  });
}

/** Train roof strip (tiles horizontally): ribs, vents, a car gap. */
export function paintTrainRoof(scene: Phaser.Scene, key: string, w: number, h: number): void {
  paint(scene, key, w, h, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#26262e');
    g.addColorStop(0.08, '#121218');
    g.addColorStop(1, '#040406');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#08080b';
    for (let x = 0; x < w; x += w / 10) ctx.fillRect(x, 0, w / 160, h * 0.4);
    ctx.fillStyle = '#000000';
    ctx.fillRect(w * 0.94, 0, w * 0.06, h);
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(0, 0, w, Math.max(1, h * 0.012));
  });
}
