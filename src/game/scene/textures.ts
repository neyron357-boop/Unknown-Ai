import Phaser from 'phaser';

/**
 * Procedural art. Every texture is painted with Canvas2D (gradients + shadowBlur
 * neon) once at boot, at device resolution, then rendered as cheap sprites.
 * No external assets → instant load, offline-ready, no licensing.
 */

export const COLORS = {
  void: 0x050507,
  graphite: 0x12131a,
  red: 0xff2a44,
  redDeep: 0x9b0f24,
  blue: 0x39d5ff,
  blueDeep: 0x1a5cff,
  white: 0xffffff,
  gold: 0xffd27a,
};

const CSS = {
  red: '#ff2a44',
  redHot: '#ff6a7a',
  blue: '#39d5ff',
  blueHot: '#bff3ff',
};

type Painter = (ctx: CanvasRenderingContext2D) => void;

function paint(scene: Phaser.Scene, key: string, w: number, h: number, k: number, painter: Painter): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, Math.ceil(w * k), Math.ceil(h * k));
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.save();
  ctx.scale(k, k);
  painter(ctx);
  ctx.restore();
  tex.refresh();
}

function neonStroke(ctx: CanvasRenderingContext2D, color: string, width: number, blur: number, core = '#ffffff', coreAlpha = 0.7) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width * 2.4;
  ctx.globalAlpha = 0.25;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = width;
  ctx.shadowBlur = blur;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = core;
  ctx.globalAlpha = coreAlpha;
  ctx.lineWidth = Math.max(0.6, width * 0.35);
  ctx.stroke();
  ctx.restore();
}

/** Generates all textures. `k` = device pixels per design unit. */
export function generateTextures(scene: Phaser.Scene, k: number): void {
  // Soft radial glow (used additively for lights, auras, flares).
  paint(scene, 'glow', 128, 128, 1, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });

  paint(scene, 'spark', 16, 16, 1, (ctx) => {
    const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 16);
  });

  paint(scene, 'shard', 14, 22, 1, (ctx) => {
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(14, 9);
    ctx.lineTo(5, 22);
    ctx.lineTo(0, 8);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });

  paint(scene, 'streak', 8, 96, 1, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 96);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(2, 0, 4, 96);
  });

  paint(scene, 'noise', 128, 128, 1, (ctx) => {
    const img = ctx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });

  // ---- Player: the anomaly, seen from behind, hood up.
  paint(scene, 'player', 120, 150, k, (ctx) => {
    ctx.translate(60, 140);
    // cloak
    ctx.beginPath();
    ctx.moveTo(-28, -84);
    ctx.bezierCurveTo(-36, -60, -40, -28, -44, 0);
    ctx.lineTo(-31, -7);
    ctx.lineTo(-22, 3);
    ctx.lineTo(-11, -6);
    ctx.lineTo(0, 4);
    ctx.lineTo(11, -6);
    ctx.lineTo(22, 3);
    ctx.lineTo(31, -7);
    ctx.lineTo(44, 0);
    ctx.bezierCurveTo(40, -28, 36, -60, 28, -84);
    ctx.quadraticCurveTo(0, -94, -28, -84);
    ctx.closePath();
    const body = ctx.createLinearGradient(0, -94, 0, 4);
    body.addColorStop(0, '#151a26');
    body.addColorStop(1, '#040509');
    ctx.fillStyle = body;
    ctx.fill();
    neonStroke(ctx, CSS.blue, 1.8, 12);
    // cloak folds
    ctx.beginPath();
    ctx.moveTo(-14, -78);
    ctx.lineTo(-22, -10);
    ctx.moveTo(14, -78);
    ctx.lineTo(22, -10);
    ctx.strokeStyle = 'rgba(57,213,255,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // hood
    ctx.beginPath();
    ctx.moveTo(-15, -86);
    ctx.quadraticCurveTo(-19, -110, 0, -126);
    ctx.quadraticCurveTo(19, -110, 15, -86);
    ctx.quadraticCurveTo(0, -80, -15, -86);
    ctx.closePath();
    ctx.fillStyle = '#07080e';
    ctx.fill();
    neonStroke(ctx, CSS.blue, 1.6, 10);
    // spine light
    ctx.beginPath();
    ctx.moveTo(0, -82);
    ctx.lineTo(0, -22);
    neonStroke(ctx, CSS.blue, 2.2, 16, '#ffffff', 0.95);
    // shoulder nodes
    for (const x of [-22, 22]) {
      ctx.beginPath();
      ctx.arc(x, -80, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = CSS.blueHot;
      ctx.shadowColor = CSS.blue;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  });

  // White silhouette used for afterimages and materialisation.
  paint(scene, 'playerGhost', 120, 150, k, (ctx) => {
    ctx.translate(60, 140);
    ctx.beginPath();
    ctx.moveTo(-28, -84);
    ctx.bezierCurveTo(-36, -60, -40, -28, -44, 0);
    ctx.lineTo(44, 0);
    ctx.bezierCurveTo(40, -28, 36, -60, 28, -84);
    ctx.quadraticCurveTo(19, -110, 0, -126);
    ctx.quadraticCurveTo(-19, -110, -28, -84);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 8;
    ctx.fill();
  });

  // ---- Enemy "VERDICT": torso + head + crown + fading lower body.
  paint(scene, 'enemyBody', 240, 400, k, (ctx) => {
    ctx.translate(120, 210);
    // lower body, fading into fog
    ctx.beginPath();
    ctx.moveTo(-30, 64);
    ctx.lineTo(-48, 176);
    ctx.lineTo(-14, 152);
    ctx.lineTo(0, 182);
    ctx.lineTo(14, 152);
    ctx.lineTo(48, 176);
    ctx.lineTo(30, 64);
    ctx.closePath();
    const legs = ctx.createLinearGradient(0, 60, 0, 182);
    legs.addColorStop(0, 'rgba(18,18,26,1)');
    legs.addColorStop(1, 'rgba(18,18,26,0)');
    ctx.fillStyle = legs;
    ctx.fill();
    ctx.save();
    const legStroke = ctx.createLinearGradient(0, 60, 0, 182);
    legStroke.addColorStop(0, CSS.red);
    legStroke.addColorStop(1, 'rgba(255,42,68,0)');
    ctx.strokeStyle = legStroke;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    // torso
    ctx.beginPath();
    ctx.moveTo(-74, -92);
    ctx.lineTo(-40, -106);
    ctx.lineTo(40, -106);
    ctx.lineTo(74, -92);
    ctx.lineTo(54, -20);
    ctx.lineTo(30, 64);
    ctx.lineTo(0, 82);
    ctx.lineTo(-30, 64);
    ctx.lineTo(-54, -20);
    ctx.closePath();
    const torso = ctx.createLinearGradient(0, -106, 0, 82);
    torso.addColorStop(0, '#1b1b24');
    torso.addColorStop(1, '#09090d');
    ctx.fillStyle = torso;
    ctx.fill();
    neonStroke(ctx, CSS.red, 2.2, 16, '#ffd0d6', 0.65);
    // armour plates
    ctx.beginPath();
    ctx.moveTo(-40, -106);
    ctx.lineTo(-24, -32);
    ctx.lineTo(0, -16);
    ctx.lineTo(24, -32);
    ctx.lineTo(40, -106);
    ctx.moveTo(-54, -20);
    ctx.lineTo(-24, -32);
    ctx.moveTo(54, -20);
    ctx.lineTo(24, -32);
    ctx.moveTo(0, -16);
    ctx.lineTo(0, 82);
    ctx.moveTo(-30, 64);
    ctx.lineTo(-14, 10);
    ctx.lineTo(0, -16);
    ctx.moveTo(30, 64);
    ctx.lineTo(14, 10);
    ctx.lineTo(0, -16);
    ctx.strokeStyle = 'rgba(255,42,68,0.45)';
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // head
    ctx.beginPath();
    ctx.moveTo(-21, -112);
    ctx.lineTo(-15, -152);
    ctx.lineTo(0, -166);
    ctx.lineTo(15, -152);
    ctx.lineTo(21, -112);
    ctx.lineTo(0, -100);
    ctx.closePath();
    ctx.fillStyle = '#101017';
    ctx.fill();
    neonStroke(ctx, CSS.red, 1.8, 12, '#ffd0d6', 0.6);
    // crown
    ctx.beginPath();
    ctx.moveTo(-15, -152);
    ctx.lineTo(-30, -182);
    ctx.moveTo(15, -152);
    ctx.lineTo(30, -182);
    ctx.moveTo(0, -166);
    ctx.lineTo(0, -196);
    neonStroke(ctx, CSS.red, 1.6, 12);
    // visor slit
    ctx.beginPath();
    ctx.moveTo(0, -150);
    ctx.lineTo(0, -116);
    neonStroke(ctx, CSS.redHot, 2.6, 18, '#ffffff', 1);
  });

  // ---- Enemy arm + blade (screen-left variant; flipped for the right side).
  paint(scene, 'enemyArm', 110, 300, k, (ctx) => {
    ctx.translate(84, 22); // shoulder pivot
    // pauldron
    ctx.beginPath();
    ctx.moveTo(-6, -16);
    ctx.lineTo(16, -6);
    ctx.lineTo(10, 18);
    ctx.lineTo(-20, 24);
    ctx.lineTo(-24, 2);
    ctx.closePath();
    ctx.fillStyle = '#15151d';
    ctx.fill();
    neonStroke(ctx, CSS.red, 1.6, 10);
    // arm
    ctx.beginPath();
    ctx.moveTo(-10, 18);
    ctx.lineTo(-30, 80);
    ctx.lineTo(-36, 128);
    ctx.strokeStyle = '#2a0a12';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.stroke();
    neonStroke(ctx, CSS.red, 1.4, 8, '#ffd0d6', 0.4);
    // blade
    ctx.beginPath();
    ctx.moveTo(-30, 118);
    ctx.lineTo(-44, 124);
    ctx.lineTo(-66, 272);
    ctx.lineTo(-34, 136);
    ctx.closePath();
    const blade = ctx.createLinearGradient(-30, 118, -66, 272);
    blade.addColorStop(0, '#2b0b12');
    blade.addColorStop(1, '#ff2a44');
    ctx.fillStyle = blade;
    ctx.fill();
    neonStroke(ctx, CSS.red, 1.4, 14, '#ffffff', 0.9);
  });

  // ---- Halo ring (viewed flat; squashed by its container for perspective).
  paint(scene, 'halo', 200, 200, k, (ctx) => {
    ctx.translate(100, 100);
    for (let i = 0; i < 9; i++) {
      const a0 = (i / 9) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(0, 0, 84, a0, a0 + (Math.PI * 2) / 9 - 0.16);
      neonStroke(ctx, CSS.red, 2.4, 14, '#ffd0d6', 0.8);
    }
    ctx.beginPath();
    ctx.arc(0, 0, 70, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,42,68,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // ---- Shield dome.
  paint(scene, 'shield', 170, 110, k, (ctx) => {
    ctx.translate(85, 100);
    ctx.beginPath();
    ctx.ellipse(0, 0, 76, 90, 0, Math.PI * 1.08, Math.PI * 1.92);
    neonStroke(ctx, CSS.blue, 2.4, 18, '#ffffff', 0.9);
    // hex lattice hint
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, 74, 88, 0, Math.PI, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(57,213,255,0.28)';
    ctx.lineWidth = 0.8;
    const r = 11;
    for (let row = 0; row < 9; row++) {
      for (let col = -5; col <= 5; col++) {
        const cx = col * r * 1.75 + (row % 2 ? r * 0.87 : 0);
        const cy = -row * r * 1.5 - 4;
        ctx.beginPath();
        for (let s = 0; s < 6; s++) {
          const a = (Math.PI / 3) * s + Math.PI / 6;
          const px = cx + Math.cos(a) * r;
          const py = cy + Math.sin(a) * r;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  });

  // ---- Weak point node (diamond).
  paint(scene, 'node', 40, 40, k, (ctx) => {
    ctx.translate(20, 20);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(11, 0);
    ctx.lineTo(0, 11);
    ctx.lineTo(-11, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fill();
    neonStroke(ctx, '#ffffff', 1.8, 10, '#ffffff', 1);
  });

  paint(scene, 'ring', 64, 64, k, (ctx) => {
    ctx.translate(32, 32);
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    neonStroke(ctx, '#ffffff', 1.6, 8, '#ffffff', 1);
  });

  // ---- Echo shard (tutorial pickup).
  paint(scene, 'echoShard', 40, 60, k, (ctx) => {
    ctx.translate(20, 30);
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(10, 0);
    ctx.lineTo(0, 24);
    ctx.lineTo(-10, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(57,213,255,0.25)';
    ctx.fill();
    neonStroke(ctx, CSS.blue, 1.8, 14, '#ffffff', 1);
  });

  // ---- Ascension lens (holographic schematic of the enemy).
  paint(scene, 'lens', 300, 300, k, (ctx) => {
    ctx.translate(150, 150);
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, 140, 0, Math.PI * 2);
    neonStroke(ctx, CSS.blue, 1.2, 10, '#ffffff', 0.6);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, 128, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(57,213,255,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r0 = i % 6 === 0 ? 122 : 132;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * 140, Math.sin(a) * 140);
      ctx.strokeStyle = 'rgba(57,213,255,0.5)';
      ctx.stroke();
    }
    // schematic silhouette of the torso
    ctx.beginPath();
    ctx.moveTo(-100, -86);
    ctx.lineTo(-54, -100);
    ctx.lineTo(54, -100);
    ctx.lineTo(100, -86);
    ctx.lineTo(74, -10);
    ctx.lineTo(40, 86);
    ctx.lineTo(0, 108);
    ctx.lineTo(-40, 86);
    ctx.lineTo(-74, -10);
    ctx.closePath();
    ctx.fillStyle = 'rgba(57,213,255,0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(57,213,255,0.35)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // scan lines
    ctx.strokeStyle = 'rgba(57,213,255,0.06)';
    for (let y = -140; y < 140; y += 6) {
      ctx.beginPath();
      ctx.moveTo(-140, y);
      ctx.lineTo(140, y);
      ctx.stroke();
    }
  });
}

/** Full-screen backdrop gradient, regenerated on resize. */
export function generateBackdrop(scene: Phaser.Scene, w: number, h: number, enemyY: number, horizonY: number): void {
  paint(scene, 'backdrop', w, h, 1, (ctx) => {
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#0b0609');
    base.addColorStop(0.45, '#0c0d13');
    base.addColorStop(1, '#030305');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // crimson light behind the antagonist
    const r = ctx.createRadialGradient(w / 2, enemyY, 0, w / 2, enemyY, w * 0.9);
    r.addColorStop(0, 'rgba(160,16,40,0.38)');
    r.addColorStop(0.5, 'rgba(90,8,24,0.12)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, w, h);
    // cold floor light under the player
    const b = ctx.createRadialGradient(w / 2, h * 0.86, 0, w / 2, h * 0.86, w * 0.75);
    b.addColorStop(0, 'rgba(30,120,200,0.16)');
    b.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, w, h);
    // horizon haze
    const hz = ctx.createLinearGradient(0, horizonY - h * 0.06, 0, horizonY + h * 0.05);
    hz.addColorStop(0, 'rgba(0,0,0,0)');
    hz.addColorStop(0.55, 'rgba(255,42,68,0.07)');
    hz.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, horizonY - h * 0.06, w, h * 0.11);
  });

  paint(scene, 'vignette', w, h, 1, (ctx) => {
    const v = ctx.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.35, w / 2, h * 0.5, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  });
}
