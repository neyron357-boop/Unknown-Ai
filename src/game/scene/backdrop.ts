import Phaser from 'phaser';
import { createRng } from '@/game/core/random';
import { paintFloor, paintMoon, paintSky, paintSkyline, type ThemeColors } from './textures';

export type ThemeId = 'takt' | 'phantoms' | 'overcharge' | 'ascension' | 'finale';

export interface Theme extends ThemeColors {
  rain: number;
  fog: number;
  fogColor: number;
  lightningEvery: number;
  windows: number;
  edge: number;
}

export const THEMES: Record<ThemeId, Theme> = {
  takt: { skyTop: '#07050a', skyMid: '#260810', horizon: '#4d0c1b', moon: 0xe23a4c, moonGlow: 0xff2a44, stars: 90, rain: 1, fog: 0.16, fogColor: 0xff2a44, lightningEvery: 16, windows: 0xff7a8a, edge: 0xff2a44 },
  phantoms: { skyTop: '#04060b', skyMid: '#0c1626', horizon: '#1b2c46', moon: 0xdce8ff, moonGlow: 0x5f9bff, stars: 140, rain: 0.35, fog: 0.5, fogColor: 0x8fb0ff, lightningEvery: 0, windows: 0x9cc6ff, edge: 0x7fb4ff },
  overcharge: { skyTop: '#09040e', skyMid: '#260a2c', horizon: '#5c1131', moon: 0xf0a060, moonGlow: 0xff6a3d, stars: 60, rain: 0.75, fog: 0.22, fogColor: 0xff6a3d, lightningEvery: 8, windows: 0xffb070, edge: 0xffa04a },
  ascension: { skyTop: '#110305', skyMid: '#3a050d', horizon: '#7a0d1d', moon: 0xffffff, moonGlow: 0xff2a44, stars: 40, rain: 0.25, fog: 0.3, fogColor: 0xff2a44, lightningEvery: 0, windows: 0xff5a6c, edge: 0xff2a44 },
  finale: { skyTop: '#0b0b12', skyMid: '#1d1f2e', horizon: '#3b3f5c', moon: 0xffffff, moonGlow: 0xbff3ff, stars: 160, rain: 0, fog: 0.2, fogColor: 0xbff3ff, lightningEvery: 0, windows: 0xbff3ff, edge: 0x39d5ff },
};

export interface BackdropLayout {
  W: number;
  H: number;
  S: number;
  groundY: number;
  floorBottom: number;
}

/**
 * Night rooftop: gradient sky with a huge moon, three parallax skyline layers,
 * drifting fog, rain, lightning, and a wet floor that reflects the fighters.
 */
export class Backdrop {
  private skyA: Phaser.GameObjects.Image;
  private skyB: Phaser.GameObjects.Image;
  private skyKey = 0;
  private moonGlow: Phaser.GameObjects.Image;
  private moonHalo: Phaser.GameObjects.Image;
  private moon: Phaser.GameObjects.Image;
  private skylines: Phaser.GameObjects.Image[] = [];
  private fogs: Phaser.GameObjects.Image[] = [];
  private floor: Phaser.GameObjects.Image;
  private edge: Phaser.GameObjects.Graphics;
  private puddles: Phaser.GameObjects.Image[] = [];
  private bolt: Phaser.GameObjects.Graphics;
  private skyFlash: Phaser.GameObjects.Rectangle;
  private rain: Phaser.GameObjects.Particles.ParticleEmitter;
  private splash: Phaser.GameObjects.Particles.ParticleEmitter;
  private theme: Theme = THEMES.takt;
  themeId: ThemeId = 'takt';
  private L!: BackdropLayout;
  private t = 0;
  private boltLife = 0;
  private pulse = 0;
  private readonly rng = createRng(1337);
  flashScale = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
    L: BackdropLayout,
  ) {
    this.L = L;
    this.skyA = scene.add.image(0, 0, '__WHITE').setOrigin(0);
    this.skyB = scene.add.image(0, 0, '__WHITE').setOrigin(0).setAlpha(0);
    this.moonHalo = scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD);
    this.moonGlow = scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD);
    this.moon = scene.add.image(0, 0, '__WHITE');
    for (let i = 0; i < 3; i++) this.skylines.push(scene.add.image(0, 0, '__WHITE').setOrigin(0.5, 1));
    for (let i = 0; i < 4; i++) this.fogs.push(scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD));
    this.bolt = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.skyFlash = scene.add.rectangle(0, 0, 10, 10, 0xffffff, 1).setOrigin(0).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    this.floor = scene.add.image(0, 0, '__WHITE').setOrigin(0);
    this.edge = scene.add.graphics();
    for (let i = 0; i < 5; i++) this.puddles.push(scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD));
    this.rain = scene.add.particles(0, 0, 'streak', {
      x: { min: -100, max: 1000 },
      y: -40,
      speedY: { min: 900, max: 1300 },
      speedX: { min: -260, max: -200 },
      rotate: 12,
      lifespan: 1600,
      alpha: { min: 0.08, max: 0.3 },
      scaleX: 1,
      scaleY: { min: 0.5, max: 1.1 },
      frequency: 10,
      quantity: 2,
      blendMode: 'ADD',
    });
    this.splash = scene.add.particles(0, 0, 'spark', {
      x: { min: 0, max: 1000 },
      y: 0,
      speedY: { min: -60, max: -20 },
      speedX: { min: -40, max: 40 },
      lifespan: 260,
      scale: { start: 0.25, end: 0 },
      alpha: { start: 0.5, end: 0 },
      frequency: 30,
      blendMode: 'ADD',
    });
    layer.add([this.skyA, this.skyB, this.moonHalo, this.moonGlow, this.moon, this.bolt, this.skyFlash, ...this.skylines, ...this.fogs, this.rain, this.floor, this.edge, ...this.puddles, this.splash]);
    this.paintStatic();
    this.layout(L);
    this.setTheme('takt', 0);
  }

  private paintStatic(): void {
    const { W, H, groundY } = this.L;
    paintFloor(this.scene, W, H - groundY);
    this.floor.setTexture('floor');
    const sk: [string, string, number, number][] = [
      ['#16101c', '#ffffff', 0.08, 0.16],
      ['#0d0a12', '#ffffff', 0.1, 0.24],
      ['#050408', '#ffffff', 0.14, 0.32],
    ];
    sk.forEach(([fill, win, density, hFrac], i) => {
      paintSkyline(this.scene, `skyline${i}`, W * 1.3, H * hFrac, 100 + i * 17, fill, win, density);
      this.skylines[i].setTexture(`skyline${i}`);
    });
  }

  layout(L: BackdropLayout): void {
    const prev = this.L;
    this.L = L;
    if (!prev || prev.W !== L.W || prev.H !== L.H) {
      this.paintStatic();
      this.paintThemeSky(this.skyKey % 2 === 0 ? this.skyA : this.skyB, this.themeId);
    }
    const { W, H, S, groundY, floorBottom } = L;
    this.skyA.setDisplaySize(W, H);
    this.skyB.setDisplaySize(W, H);
    this.skyFlash.setSize(W, groundY);
    this.skylines.forEach((s, i) => s.setPosition(W / 2, groundY + 2).setDisplaySize(W * 1.3, H * [0.16, 0.24, 0.32][i]));
    this.floor.setPosition(0, groundY).setDisplaySize(W, H - groundY);
    this.fogs.forEach((f, i) => f.setPosition(W * (0.1 + i * 0.3), groundY - H * (0.04 + (i % 2) * 0.05)).setScale((W * 0.9) / 128, (H * 0.1) / 128));
    this.puddles.forEach((p, i) => p.setPosition(W * (0.12 + i * 0.2 + (i % 2) * 0.05), groundY + (floorBottom - groundY) * (0.25 + (i % 3) * 0.22)).setScale((W * 0.22) / 128, (5 * S) / 128));
    this.rain.setPosition(0, 0);
    this.rain.updateConfig({
      x: { min: -W * 0.1, max: W * 1.3 },
      speedY: { min: 900 * S, max: 1300 * S },
      speedX: { min: -260 * S, max: -200 * S },
      scaleX: S * 0.6,
      scaleY: { min: 0.5 * S, max: 1.1 * S },
      lifespan: (H / (900 * S)) * 1000,
    });
    this.splash.setPosition(0, groundY);
    this.splash.updateConfig({ x: { min: 0, max: W }, scale: { start: 0.25 * S, end: 0 }, speedY: { min: -60 * S, max: -20 * S } });
    this.drawMoon();
    this.drawEdge();
  }

  private moonGeom() {
    const { W, H, groundY } = this.L;
    const r = Math.min(W * 0.31, H * 0.155);
    return { x: W * 0.64, y: groundY - (groundY - H * 0.1) * 0.62, r };
  }

  private drawMoon(): void {
    const m = this.moonGeom();
    if (!this.scene.textures.exists('moon')) paintMoon(this.scene);
    this.moon.setTexture('moon').setPosition(m.x, m.y).setDisplaySize(m.r * 2, m.r * 2).setTint(this.theme.moon);
    this.moonGlow.setPosition(m.x, m.y).setScale((m.r * 3.2) / 128).setTint(this.theme.moonGlow).setAlpha(0.5);
    this.moonHalo.setPosition(m.x, m.y).setScale((m.r * 7) / 128).setTint(this.theme.moonGlow).setAlpha(0.2);
  }

  private drawEdge(): void {
    const { W, S, groundY } = this.L;
    const g = this.edge;
    g.clear();
    g.fillStyle(this.theme.edge, 0.18);
    g.fillRect(0, groundY - 3 * S, W, 6 * S);
    g.fillStyle(this.theme.edge, 0.85);
    g.fillRect(0, groundY - 0.75 * S, W, 1.5 * S);
  }

  private paintThemeSky(img: Phaser.GameObjects.Image, id: ThemeId): void {
    const key = `sky-${id}`;
    paintSky(this.scene, key, this.L.W, this.L.H, this.L.groundY, THEMES[id], 7 + id.length);
    img.setTexture(key).setDisplaySize(this.L.W, this.L.H);
  }

  setTheme(id: ThemeId, fadeMs = 900): void {
    this.themeId = id;
    this.theme = THEMES[id];
    const incoming = this.skyKey % 2 === 0 ? this.skyB : this.skyA;
    const outgoing = this.skyKey % 2 === 0 ? this.skyA : this.skyB;
    this.skyKey++;
    this.paintThemeSky(incoming, id);
    if (fadeMs <= 0) {
      incoming.setAlpha(1);
      outgoing.setAlpha(0);
    } else {
      incoming.setAlpha(0);
      this.layer.bringToTop(incoming);
      this.layer.moveBelow(incoming, this.moonHalo);
      this.scene.tweens.add({ targets: incoming, alpha: 1, duration: fadeMs });
      this.scene.tweens.add({ targets: outgoing, alpha: 0, duration: fadeMs });
    }
    this.skylines.forEach((s, i) => s.setTint(this.theme.windows).setAlpha(i === 2 ? 1 : 0.9));
    this.fogs.forEach((f) => f.setTint(this.theme.fogColor));
    this.puddles.forEach((p) => p.setTint(this.theme.moonGlow));
    this.rain.frequency = this.theme.rain > 0 ? 10 / this.theme.rain : -1;
    this.rain.emitting = this.theme.rain > 0;
    this.splash.emitting = this.theme.rain > 0.3;
    this.drawMoon();
    this.drawEdge();
  }

  /** Called on every music beat. */
  beat(n: number, hype: number): void {
    this.pulse = 0.25 + hype * 0.1;
    if (this.theme.lightningEvery && n > 0 && n % this.theme.lightningEvery === this.theme.lightningEvery - 2) this.lightning(0.7);
  }

  lightning(power = 1): void {
    const { W, groundY, S } = this.L;
    const g = this.bolt;
    g.clear();
    let x = W * (0.1 + this.rng() * 0.8);
    let y = 0;
    const target = groundY * (0.55 + this.rng() * 0.25);
    g.lineStyle(2.2 * S, 0xe8f0ff, 0.95);
    g.beginPath();
    g.moveTo(x, y);
    while (y < target) {
      x += (this.rng() - 0.5) * 34 * S;
      y += (10 + this.rng() * 22) * S;
      g.lineTo(x, y);
      if (this.rng() < 0.18) {
        // a short fork
        g.moveTo(x, y);
        g.lineTo(x + (this.rng() - 0.5) * 50 * S, y + 30 * S);
        g.moveTo(x, y);
      }
    }
    g.strokePath();
    this.boltLife = 160;
    this.skyFlash.setAlpha(0.28 * power * this.flashScale);
    this.scene.tweens.add({ targets: this.skyFlash, alpha: 0, duration: 380 });
  }

  /** Slow-motion multiplier for rain and fog (Ascension). */
  setTimeScale(ts: number): void {
    this.rain.timeScale = ts;
    this.splash.timeScale = ts;
  }

  update(dt: number): void {
    this.t += dt / 1000;
    if (this.boltLife > 0) {
      this.boltLife -= dt;
      this.bolt.setAlpha(Math.max(0, this.boltLife / 160));
      if (this.boltLife <= 0) this.bolt.clear();
    }
    this.pulse = Math.max(0, this.pulse - dt / 400);
    const { W } = this.L;
    this.fogs.forEach((f, i) => {
      f.x = ((W * (0.1 + i * 0.3) + this.t * (12 + i * 6) * (W / 390)) % (W * 1.4)) - W * 0.2;
      f.setAlpha(this.theme.fog * (0.6 + 0.4 * Math.sin(this.t * 0.4 + i)));
    });
    this.skylines.forEach((s, i) => (s.x = W / 2 + Math.sin(this.t * 0.05 + i) * (6 + i * 4) * (W / 390)));
    this.moonGlow.setAlpha(0.5 + this.pulse * 0.4);
    this.puddles.forEach((p, i) => p.setAlpha(0.18 + this.pulse * 0.3 + Math.sin(this.t * 1.3 + i) * 0.05));
  }
}
