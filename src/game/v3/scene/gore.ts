import Phaser from 'phaser';
import type { Vec } from '../anatomy/skeleton';

export type GoreLevel = 'high' | 'low' | 'off';

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  c: number;
}

interface Spray {
  at: () => Vec | null;
  dir: () => Vec;
  until: number;
  rate: number;
  power: number;
  acc: number;
}

const BLOOD = [0xb3121f, 0xd41428, 0x8a0a12, 0xe8182e];

/**
 * Stylized gore: droplets with gravity that land as floor decals, stump sprays that pump
 * with the music, blood mist, and splatter on the "camera lens". With gore off, the same
 * shapes become black ink so the action stays readable.
 */
export class Gore {
  private drops: Drop[] = [];
  private sprays: Spray[] = [];
  private g: Phaser.GameObjects.Graphics;
  private decals: Phaser.GameObjects.RenderTexture;
  private stamp: Phaser.GameObjects.Image;
  private mistPool: Phaser.GameObjects.Image[] = [];
  private screenPool: Phaser.GameObjects.Image[] = [];
  private dripPool: Phaser.GameObjects.Image[] = [];
  level: GoreLevel = 'high';
  /** Gravity (px/s²). Negative while free-falling: blood streams upward. */
  gravity: number;
  floorY: number;
  hasFloor = true;
  private W: number;
  private H: number;
  private beatPulse = 0;
  private time = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly fxLayer: Phaser.GameObjects.Layer,
    floorLayer: Phaser.GameObjects.Layer,
    private readonly screenLayer: Phaser.GameObjects.Layer,
    L: { W: number; H: number; groundY: number },
  ) {
    this.W = L.W;
    this.H = L.H;
    this.floorY = L.groundY;
    this.gravity = L.H * 1.5;
    this.g = scene.add.graphics();
    fxLayer.add(this.g);
    this.decals = scene.add.renderTexture(0, L.groundY - 6, L.W, L.H - L.groundY + 6).setOrigin(0);
    floorLayer.add(this.decals);
    this.stamp = scene.make.image({ key: 'splat0' }, false);
  }

  layout(L: { W: number; H: number; groundY: number }): void {
    this.W = L.W;
    this.H = L.H;
    this.floorY = L.groundY;
    this.decals.setPosition(0, L.groundY - 6).resize(L.W, L.H - L.groundY + 6);
  }

  private color(i: number): number {
    return this.level === 'off' ? 0x050505 : BLOOD[i % BLOOD.length];
  }

  private scaleCount(n: number): number {
    return Math.round(n * (this.level === 'high' ? 1 : 0.45));
  }

  /** Droplet explosion biased along `dir` (unit), `power` ≈ 0.5..3. */
  burst(x: number, y: number, dir: Vec, power = 1, spread = 0.9): void {
    const n = this.scaleCount(28 * power);
    const sp = this.H * 0.5 * Math.sqrt(power);
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dir.y, dir.x) + (Math.random() - 0.5) * spread * 2;
      const v = sp * (0.25 + Math.random() * 0.9);
      this.drops.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - this.H * 0.12 * Math.random(), size: 2 + Math.random() * 5.5 * Math.min(1.6, power), life: 2.5, c: i });
    }
    if (this.drops.length > 900) this.drops.splice(0, this.drops.length - 900);
    this.mist(x, y, this.W * 0.06 * Math.sqrt(power));
  }

  /** A stump that pumps blood (pulses with the beat). */
  spray(at: () => Vec | null, dir: () => Vec, ms: number, power = 1): void {
    if (this.level === 'off') return;
    this.sprays.push({ at, dir, until: this.time + ms / 1000, rate: 60 * power, power, acc: 0 });
  }

  mist(x: number, y: number, r: number): void {
    if (this.level === 'off') return;
    let m = this.mistPool.find((p) => !p.visible);
    if (!m) {
      m = this.scene.add.image(0, 0, 'glow');
      this.fxLayer.add(m);
      this.mistPool.push(m);
    }
    m.setPosition(x, y).setVisible(true).setTint(0x7a0610).setAlpha(0.75).setScale((r * 2) / 128);
    this.scene.tweens.killTweensOf(m);
    this.scene.tweens.add({ targets: m, scale: (r * 5) / 128, alpha: 0, duration: 650, ease: 'Quad.easeOut', onComplete: () => m!.setVisible(false) });
  }

  splatFloor(x: number, size: number, stretch = 1, alpha = 0.9): void {
    if (!this.hasFloor) return;
    const st = this.stamp;
    st.setTexture(`splat${Math.floor(Math.random() * 6)}`);
    st.setPosition(x, 6 + Math.random() * 10).setRotation(Math.random() * 0.4 - 0.2);
    st.setScale((size / 96) * stretch, (size / 96) * 0.32);
    st.setTint(this.level === 'off' ? 0x101010 : Math.random() < 0.5 ? 0x7a0610 : 0x9a0c16);
    st.setAlpha(alpha);
    this.decals.draw(st);
  }

  clearDecals(): void {
    this.decals.clear();
  }

  /** Blood on the camera lens. `power` 0..1. */
  screenSplat(power: number): void {
    if (this.level === 'off') return;
    const n = 1 + Math.round(power * 3);
    for (let i = 0; i < n; i++) {
      let im = this.screenPool.find((p) => !p.visible);
      if (!im) {
        im = this.scene.add.image(0, 0, 'splat0');
        this.screenLayer.add(im);
        this.screenPool.push(im);
      }
      const edge = Math.random();
      const x = edge < 0.5 ? (Math.random() < 0.5 ? this.W * 0.06 : this.W * 0.94) : this.W * (0.15 + Math.random() * 0.7);
      const y = edge < 0.5 ? this.H * (0.15 + Math.random() * 0.7) : Math.random() < 0.5 ? this.H * 0.08 : this.H * 0.92;
      im.setTexture(`splat${Math.floor(Math.random() * 6)}`).setPosition(x, y).setRotation(Math.random() * Math.PI * 2);
      im.setScale((this.W * (0.25 + power * 0.35)) / 96).setTint(0x6a050c).setAlpha(0.85).setVisible(true);
      this.scene.tweens.killTweensOf(im);
      this.scene.tweens.add({ targets: im, alpha: 0, delay: 500, duration: 1300, onComplete: () => im!.setVisible(false) });
      if (Math.random() < 0.7) this.drip(x, y);
    }
  }

  private drip(x: number, y: number): void {
    let d = this.dripPool.find((p) => !p.visible);
    if (!d) {
      d = this.scene.add.image(0, 0, 'drip').setOrigin(0.5, 0);
      this.screenLayer.add(d);
      this.dripPool.push(d);
    }
    d.setPosition(x + (Math.random() - 0.5) * this.W * 0.05, y).setTint(0x6a050c).setAlpha(0.85).setVisible(true).setScale(this.W / 700, 0.2);
    this.scene.tweens.killTweensOf(d);
    this.scene.tweens.add({ targets: d, scaleY: this.H / 480, y: y + this.H * 0.05, duration: 1600, ease: 'Quad.easeIn' });
    this.scene.tweens.add({ targets: d, alpha: 0, delay: 1000, duration: 900, onComplete: () => d!.setVisible(false) });
  }

  beat(): void {
    this.beatPulse = 1;
  }

  update(dtMs: number, vts: number): void {
    const dt = (dtMs / 1000) * vts;
    this.time += dt;
    this.beatPulse = Math.max(0, this.beatPulse - dtMs / 260);
    // stump sprays
    for (const s of this.sprays) {
      const p = s.at();
      if (!p) continue;
      const pump = 0.35 + this.beatPulse * 1.4;
      s.acc += s.rate * pump * dt;
      const d = s.dir();
      while (s.acc >= 1) {
        s.acc -= 1;
        const a = Math.atan2(d.y, d.x) + (Math.random() - 0.5) * 0.5;
        const v = this.H * (0.25 + Math.random() * 0.35) * (0.6 + this.beatPulse * 0.8) * s.power;
        this.drops.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: 1.2 + Math.random() * 3, life: 2, c: Math.floor(Math.random() * 4) });
      }
    }
    this.sprays = this.sprays.filter((s) => s.until > this.time);

    // droplets
    const g = this.g;
    g.clear();
    const floor = this.floorY;
    const keep: Drop[] = [];
    for (const d of this.drops) {
      d.vy += this.gravity * dt;
      d.vx *= 1 - 0.6 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.life -= dt;
      if (this.hasFloor && d.y >= floor && d.vy > 0) {
        if (d.size > 2.2 && Math.random() < 0.6) this.splatFloor(d.x, d.size * 6, 1 + Math.min(2, Math.abs(d.vx) / (this.H * 0.4)), 0.8);
        continue;
      }
      if (d.life <= 0 || d.y < -this.H * 0.2 || d.y > this.H * 1.2) continue;
      keep.push(d);
      const len = Math.min(0.03, dt * 1.5);
      g.lineStyle(d.size, this.color(d.c), 0.95);
      g.lineBetween(d.x, d.y, d.x - d.vx * len, d.y - d.vy * len);
    }
    this.drops = keep;
  }

  get count(): number {
    return this.drops.length;
  }
}
