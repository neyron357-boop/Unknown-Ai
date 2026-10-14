import Phaser from 'phaser';
import type { Light } from '../anatomy/look';
import type { ActId } from '../core/types';
import { paintFacade, paintRoofProps, paintSky, paintSkyline, paintTemple, paintTrainRoof, paintTunnel } from './paint';

export interface WorldLayout {
  W: number;
  H: number;
  groundY: number;
  unit: number;
}

const LIGHTS: Record<ActId, Light> = {
  roof: { dir: { x: 0.5, y: -0.86 }, rimA: 0xffd9cf, rimHalo: 0x7a2e36, rimB: 0x7a0c18, fill: 0x050407, detail: 0x22202a, rimAW: 0.7, haloW: 1.6, rimBW: 0.55 },
  fall: { dir: { x: 0.2, y: -0.98 }, rimA: 0xe4ecff, rimHalo: 0x3c4a64, rimB: 0x9a1020, fill: 0x050507, detail: 0x22222c, rimAW: 0.7, haloW: 1.5, rimBW: 0.6 },
  train: { dir: { x: -0.6, y: -0.8 }, rimA: 0xd6e6ff, rimHalo: 0x2e4466, rimB: 0xff6a2a, fill: 0x040508, detail: 0x1e2230, rimAW: 0.7, haloW: 1.6, rimBW: 0.5 },
  temple: { dir: { x: 0.35, y: -0.94 }, rimA: 0xf6ede2, rimHalo: 0x6a4a40, rimB: 0xc0301a, fill: 0x050406, detail: 0x24202a, rimAW: 0.7, haloW: 1.7, rimBW: 0.6 },
};

type Obj = Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite | Phaser.GameObjects.Graphics | Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text | Phaser.GameObjects.Particles.ParticleEmitter;

/**
 * Environments for the four acts, with per-act lighting for the characters.
 * Everything is procedural and lives in the background layer.
 */
export class World {
  act: ActId = 'roof';
  /** Current light for characters (flickers with lightning / lamps). */
  readonly light: Light = { ...LIGHTS.roof };
  private L: WorldLayout;
  private objs: Record<ActId, Obj[]> = { roof: [], fall: [], train: [], temple: [] };
  private sky!: Phaser.GameObjects.Image;
  private moon!: Phaser.GameObjects.Image;
  private moonGlow!: Phaser.GameObjects.Image;
  private moonHalo!: Phaser.GameObjects.Image;
  private eye!: Phaser.GameObjects.Graphics;
  private floor!: Phaser.GameObjects.Graphics;
  private rain!: Phaser.GameObjects.Particles.ParticleEmitter;
  private bolt!: Phaser.GameObjects.Graphics;
  private flashRect!: Phaser.GameObjects.Rectangle;
  private blink!: Phaser.GameObjects.Image;
  private neon!: Phaser.GameObjects.Text;
  private facadeA!: Phaser.GameObjects.TileSprite;
  private facadeB!: Phaser.GameObjects.TileSprite;
  private streaks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private tunnel!: Phaser.GameObjects.TileSprite;
  private cityBlur!: Phaser.GameObjects.TileSprite;
  private trainRoof!: Phaser.GameObjects.TileSprite;
  private lamps: Phaser.GameObjects.Image[] = [];
  private washes: Phaser.GameObjects.Image[] = [];
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private flames: Phaser.GameObjects.Image[] = [];
  private ash!: Phaser.GameObjects.Particles.ParticleEmitter;
  private fogs: Phaser.GameObjects.Image[] = [];
  private skylines: Phaser.GameObjects.Image[] = [];
  private t = 0;
  private flash = 0;
  private boltLife = 0;
  private eyeOpen = 0;
  private eyeTarget = 0;
  private inTunnel = false;
  private lampX = 0;
  private bloodRainOn = false;
  private rageMoon = 0;
  private trainSpeed = 1;
  /** Scroll speed of the fall facade (px/s), eases in/out. */
  private fallSpeed = 0;
  private flipped = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
    L: WorldLayout,
  ) {
    this.L = L;
    this.build();
    this.setAct('roof', true);
  }

  private add<T extends Obj>(act: ActId | null, o: T): T {
    this.layer.add(o);
    if (act) this.objs[act].push(o);
    return o;
  }

  private build(): void {
    const { W, H, groundY } = this.L;
    const s = this.scene;
    this.sky = this.add(null, s.add.image(0, 0, '__WHITE').setOrigin(0));
    this.moonHalo = this.add(null, s.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD));
    this.moonGlow = this.add(null, s.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD));
    this.moon = this.add(null, s.add.image(0, 0, 'moon'));
    this.eye = this.add(null, s.add.graphics());
    this.bolt = this.add(null, s.add.graphics().setBlendMode(Phaser.BlendModes.ADD));

    // ROOF
    paintSkyline(s, 'sl-roof-0', W * 1.3, H * 0.2, 101, '#1c0a10', '#ff8a6a', 0.08, 1);
    paintSkyline(s, 'sl-roof-1', W * 1.3, H * 0.28, 118, '#100609', '#ffb070', 0.1, 0);
    paintSkyline(s, 'sl-roof-2', W * 1.3, H * 0.36, 135, '#070306', '#ff6a5a', 0.12, 1);
    for (let i = 0; i < 3; i++) this.skylines.push(this.add('roof', s.add.image(W / 2, groundY - H * 0.04, `sl-roof-${i}`).setOrigin(0.5, 1)));
    this.neon = this.add('roof', s.add.text(W * 0.2, groundY - H * 0.21, 'ОТЕЛЬ', { fontFamily: '"Russo One", "Arial Black", sans-serif', fontSize: `${Math.round(W * 0.05)}px`, color: '#ff2a3a' }).setOrigin(0.5).setAlpha(0.85).setBlendMode(Phaser.BlendModes.ADD));
    paintRoofProps(s, 'roofProps', W, H * 0.4);
    this.add('roof', s.add.image(W / 2, groundY + 2, 'roofProps').setOrigin(0.5, 1));
    this.blink = this.add('roof', s.add.image(W - W * 0.087, groundY - H * 0.4 * 0.75, 'glow').setTint(0xff2020).setBlendMode(Phaser.BlendModes.ADD).setScale(0.25));

    // FALL
    paintFacade(s, 'facade', W, H * 0.8, 7);
    this.facadeA = this.add('fall', s.add.tileSprite(W * 0.5, 0, W * 1.1, H, 'facade').setOrigin(0.5, 0).setAlpha(0.9));
    this.facadeB = this.add('fall', s.add.tileSprite(W * 0.06, 0, W * 0.5, H, 'facade').setOrigin(0.5, 0).setTint(0x6a6070));

    // TRAIN
    paintTunnel(s, 'tunnel', W, H);
    paintSkyline(s, 'sl-train', W * 2, H * 0.3, 222, '#070a12', '#9fc4ff', 0.12, 0);
    this.cityBlur = this.add('train', s.add.tileSprite(W / 2, groundY - H * 0.02, W, H * 0.3, 'sl-train').setOrigin(0.5, 1));
    this.tunnel = this.add('train', s.add.tileSprite(W / 2, 0, W, H, 'tunnel').setOrigin(0.5, 0).setAlpha(0));
    for (let i = 0; i < 2; i++) this.washes.push(this.add('train', s.add.image(0, H * 0.3, 'glow').setTint(0x5a78b0).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0)));
    for (let i = 0; i < 2; i++) this.lamps.push(this.add('train', s.add.image(0, H * 0.18, 'glow').setTint(0xcfe0ff).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0)));
    paintTrainRoof(s, 'trainRoof', W * 1.2, H - groundY);
    this.trainRoof = this.add('train', s.add.tileSprite(W / 2, groundY, W, H - groundY, 'trainRoof').setOrigin(0.5, 0));

    // TEMPLE
    paintTemple(s, 'temple', W, H * 0.62);
    this.add('temple', s.add.image(W / 2, groundY + 4, 'temple').setOrigin(0.5, 1));
    for (const fx of [0.115, 0.885]) this.flames.push(this.add('temple', s.add.image(W * fx, groundY - H * 0.62 * 0.25, 'glow').setTint(0xff6a20).setBlendMode(Phaser.BlendModes.ADD)));
    for (let i = 0; i < 3; i++) this.fogs.push(this.add('temple', s.add.image(W * (0.2 + i * 0.3), groundY - H * 0.03, 'glow').setTint(0xa03040).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.18)));

    // floor (roof / train edge / temple stones)
    this.floor = this.add(null, s.add.graphics());

    // weather & particles
    this.rain = this.add(
      null,
      s.add.particles(0, 0, 'streak', {
        x: { min: -W * 0.1, max: W * 1.3 },
        y: -40,
        speedY: { min: H * 1.1, max: H * 1.5 },
        speedX: { min: -W * 0.3, max: -W * 0.22 },
        rotate: 12,
        lifespan: 1200,
        alpha: { min: 0.08, max: 0.3 },
        scaleX: 0.7,
        scaleY: { min: 0.6, max: 1.2 },
        frequency: 8,
        quantity: 2,
        blendMode: 'ADD',
      }),
    );
    this.streaks = this.add(
      'fall',
      s.add.particles(0, 0, 'streak', {
        x: { min: 0, max: W },
        y: H + 40,
        speedY: { min: -H * 2.4, max: -H * 1.6 },
        lifespan: 700,
        alpha: { min: 0.1, max: 0.35 },
        scaleX: 0.6,
        scaleY: { min: 1.5, max: 3.2 },
        frequency: 22,
        blendMode: 'ADD',
        emitting: false,
      }),
    );
    this.sparks = this.add(
      'train',
      s.add.particles(0, 0, 'spark', {
        lifespan: { min: 200, max: 500 },
        speedX: { min: -W * 0.9, max: -W * 0.4 },
        speedY: { min: -H * 0.12, max: H * 0.05 },
        gravityY: H * 0.6,
        scale: { start: 0.5, end: 0 },
        tint: [0xbfd8ff, 0xffffff, 0x7aa8ff],
        blendMode: 'ADD',
        emitting: false,
      }),
    );
    this.ash = this.add(
      'temple',
      s.add.particles(0, 0, 'spark', {
        x: { min: 0, max: W },
        y: -10,
        speedY: { min: H * 0.03, max: H * 0.07 },
        speedX: { min: -W * 0.03, max: W * 0.02 },
        lifespan: 9000,
        scale: { min: 0.15, max: 0.35 },
        alpha: { start: 0.7, end: 0 },
        tint: [0xff8a50, 0xffd0a0, 0xa02020],
        frequency: 120,
        blendMode: 'ADD',
        emitting: false,
      }),
    );
    this.flashRect = this.add(null, s.add.rectangle(0, 0, W, H, 0xffffff, 1).setOrigin(0).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD));
    this.layout(this.L);
  }

  layout(L: WorldLayout): void {
    this.L = L;
    const { W, H } = L;
    this.sky.setDisplaySize(W, H);
    this.flashRect.setSize(W, H);
    this.placeMoon();
  }

  private moonGeom() {
    const { W, H, groundY } = this.L;
    if (this.act === 'fall') return { x: W * 0.7, y: H * 0.12, r: W * 0.1 };
    if (this.act === 'temple') return { x: W * 0.5, y: groundY - H * 0.36, r: Math.min(W * 0.36, H * 0.17) };
    return { x: W * 0.68, y: groundY - H * 0.32, r: Math.min(W * 0.3, H * 0.15) };
  }

  private placeMoon(): void {
    const m = this.moonGeom();
    const tint = this.act === 'roof' ? 0xd2444e : this.act === 'train' ? 0xbcc8e0 : this.act === 'fall' ? 0xe6e0e8 : this.rageMoon > 0.5 ? 0xd02030 : 0xf2ebe0;
    const glow = this.act === 'roof' ? 0xff2a3a : this.act === 'train' ? 0x6080c0 : this.act === 'temple' && this.rageMoon > 0.5 ? 0xff1020 : 0xffd0c0;
    this.moon.setPosition(m.x, m.y).setDisplaySize(m.r * 2, m.r * 2).setTint(tint);
    this.moonGlow.setPosition(m.x, m.y).setScale((m.r * 3.4) / 128).setTint(glow).setAlpha(0.45);
    this.moonHalo.setPosition(m.x, m.y).setScale((m.r * 7) / 128).setTint(glow).setAlpha(0.18);
    const visible = !(this.act === 'train' && this.inTunnel);
    this.moon.setVisible(visible);
    this.moonGlow.setVisible(visible);
    this.moonHalo.setVisible(visible);
  }

  setAct(act: ActId, instant = false): void {
    this.act = act;
    const { W, H, groundY } = this.L;
    for (const [a, list] of Object.entries(this.objs) as [ActId, Obj[]][]) for (const o of list) o.setVisible(a === act);
    Object.assign(this.light, LIGHTS[act]);
    const sky = {
      roof: { top: '#0a0306', mid: '#320610', horizon: '#6a0e1c', stars: 60 },
      fall: { top: '#040408', mid: '#0e0e18', horizon: '#1c1a26', stars: 120 },
      train: { top: '#03050a', mid: '#0a1220', horizon: '#162436', stars: 90 },
      temple: { top: '#0c0306', mid: '#2a060c', horizon: '#561018', stars: 40 },
    }[act];
    paintSky(this.scene, `sky-${act}`, W, H, act === 'fall' ? H : groundY, sky, 11 + act.length);
    this.sky.setTexture(`sky-${act}`).setDisplaySize(W, H);
    this.rain.emitting = act === 'roof' || act === 'temple' || this.bloodRainOn;
    this.rain.frequency = act === 'temple' ? 30 : 8;
    this.streaks.emitting = act === 'fall';
    this.ash.emitting = act === 'temple';
    this.fallSpeed = act === 'fall' ? (instant ? H * 1.6 : 0) : 0;
    this.inTunnel = false;
    this.drawFloor();
    this.placeMoon();
    if (!instant) this.flashOnce(0.6);
  }

  private drawFloor(): void {
    const { W, H, groundY } = this.L;
    const g = this.floor;
    g.clear();
    if (this.act === 'fall') return;
    if (this.act === 'train') {
      g.fillStyle(this.light.rimA, 0.35);
      g.fillRect(0, groundY - 1, W, 2);
      return;
    }
    const top = this.act === 'temple' ? 0x14100f : 0x0d0a0d;
    g.fillGradientStyle(top, top, 0x030203, 0x030203, 1);
    g.fillRect(0, groundY, W, H - groundY);
    g.fillStyle(this.light.rimA, 0.55);
    g.fillRect(0, groundY - 1, W, 2);
    g.fillStyle(this.light.rimB, 0.25);
    g.fillRect(0, groundY + 1, W, 4);
    if (this.act === 'temple') {
      // stone seams and spider lilies along the edge
      g.lineStyle(1, 0x241c1c, 1);
      for (let i = 0; i < 9; i++) {
        const y = groundY + (H - groundY) * (i / 9) ** 1.6;
        g.lineBetween(0, y, W, y);
      }
      for (let i = 0; i < 26; i++) {
        const x = (i / 26) * W + ((i * 37) % 13);
        g.fillStyle(0xc0101c, 0.85);
        g.fillCircle(x, groundY + 6 + (i % 3) * 3, 2.2 + (i % 4));
      }
    }
  }

  /** Per-beat life: lamps in the tunnel, lightning on the roof drop, neon flicker. */
  beat(n: number, bar: number, intensity: number): void {
    if (this.act === 'roof' && intensity >= 3 && bar === 0) this.lightning(0.6);
    if (this.act === 'train' && this.inTunnel) this.lampX = this.L.W * 1.25;
    if (this.act === 'train' && n % 16 === 0) this.setTunnel(!this.inTunnel);
    if (this.act === 'temple') for (const f of this.flames) f.setScale(0.55 + Math.random() * 0.15);
    if (n % 7 === 0) this.neon.setAlpha(Math.random() < 0.5 ? 0.25 : 0.85);
  }

  setTunnel(on: boolean): void {
    this.inTunnel = on;
    this.scene.tweens.add({ targets: this.tunnel, alpha: on ? 1 : 0, duration: 120 });
    this.placeMoon();
  }

  lightning(power = 1): void {
    const { W, groundY } = this.L;
    const g = this.bolt;
    g.clear();
    let x = W * (0.15 + Math.random() * 0.7);
    let y = 0;
    g.lineStyle(Math.max(2, W * 0.004), 0xf0f4ff, 0.95);
    g.beginPath();
    g.moveTo(x, y);
    while (y < groundY * 0.7) {
      x += (Math.random() - 0.5) * W * 0.06;
      y += W * (0.02 + Math.random() * 0.04);
      g.lineTo(x, y);
    }
    g.strokePath();
    this.boltLife = 140;
    this.flashOnce(0.32 * power);
  }

  flashOnce(alpha: number): void {
    this.flash = Math.max(this.flash, alpha);
  }

  /** Character light flicker for lightning / lamps. */
  private lightPulse = 0;

  setMoonEye(open: boolean): void {
    this.eyeTarget = open ? 1 : 0;
  }

  setRageMoon(on: boolean): void {
    this.rageMoon = on ? 1 : 0;
    this.placeMoon();
  }

  setBloodRain(on: boolean): void {
    this.bloodRainOn = on;
    this.rain.emitting = on || this.act === 'roof' || this.act === 'temple';
    this.rain.setParticleTint(on ? 0xc0101c : 0xffffff);
    this.rain.frequency = on ? 4 : this.act === 'temple' ? 30 : 8;
  }

  setMirror(on: boolean): void {
    if (this.flipped === on) return;
    this.flipped = on;
    const { W } = this.L;
    for (const list of Object.values(this.objs))
      for (const o of list) {
        if ('setFlipX' in o && typeof (o as Phaser.GameObjects.Image).setFlipX === 'function') (o as Phaser.GameObjects.Image).setFlipX(on);
        if ('x' in o && !(o instanceof Phaser.GameObjects.Particles.ParticleEmitter)) (o as Phaser.GameObjects.Image).x = W - (o as Phaser.GameObjects.Image).x;
      }
    this.moon.x = W - this.moon.x;
    this.moonGlow.x = this.moon.x;
    this.moonHalo.x = this.moon.x;
    this.light.dir = { x: -this.light.dir.x, y: this.light.dir.y };
  }

  /** The train decelerates / the fall slows at the end of an act. */
  setSpeed(k: number): void {
    this.trainSpeed = k;
  }

  update(dtMs: number, vts: number, heroX: number): void {
    const dt = (dtMs / 1000) * vts;
    this.t += dt;
    const { W, H } = this.L;
    if (this.boltLife > 0) {
      this.boltLife -= dtMs;
      if (this.boltLife <= 0) this.bolt.clear();
    }
    this.flash *= Math.pow(0.0005, dtMs / 1000);
    this.flashRect.setAlpha(this.flash);
    this.lightPulse = Math.max(this.lightPulse * Math.pow(0.01, dtMs / 1000), this.flash);
    const base = LIGHTS[this.act];
    this.light.rimA = this.flash > 0.1 ? 0xffffff : base.rimA;

    if (this.act === 'roof') {
      this.blink.setAlpha(Math.sin(this.t * 3) > 0.3 ? 0.9 : 0.1);
      this.skylines.forEach((sl, i) => (sl.x = W / 2 + (heroX - W / 2) * (0.02 + i * 0.03) * -1));
    }
    if (this.act === 'fall') {
      this.fallSpeed += (H * 1.6 - this.fallSpeed) * Math.min(1, dtMs / 600);
      this.facadeA.tilePositionY += this.fallSpeed * dt * 0.55;
      this.facadeB.tilePositionY += this.fallSpeed * dt * 0.9;
    }
    if (this.act === 'train') {
      const speed = W * 3.2 * this.trainSpeed;
      this.trainRoof.tilePositionX += speed * dt;
      this.cityBlur.tilePositionX += speed * dt * 0.08;
      this.tunnel.tilePositionX += speed * dt * 0.9;
      if (this.inTunnel) {
        this.lampX -= speed * dt * 0.9;
        this.lamps.forEach((l, i) => {
          const x = this.lampX + i * W * 0.9;
          l.setPosition(x, H * 0.16).setScale(1.6).setAlpha(0.9);
          // the lamp washes the tunnel wall and the fighters below it
          this.washes[i].setPosition(x, H * 0.36).setScale((W * 1.1) / 128, (H * 0.5) / 128).setAlpha(0.55);
        });
        // the light sweeps across the fighters as a lamp passes
        const lx = this.lampX - W / 2;
        const d = Math.hypot(lx, H * 0.4) || 1;
        this.light.dir = { x: (lx / d) * (this.flipped ? -1 : 1), y: -0.6 };
        if (Math.random() < 0.05) this.sparks.explode(6, W * (0.2 + Math.random() * 0.6), this.L.groundY);
      } else {
        this.lamps.forEach((l) => l.setAlpha(0));
        this.washes.forEach((l) => l.setAlpha(0));
        this.light.dir = { x: this.flipped ? 0.6 : -0.6, y: -0.8 };
      }
    }
    if (this.act === 'temple') {
      this.fogs.forEach((f, i) => f.setScale((W * 0.9) / 128, (H * 0.08) / 128).setX(W * (0.2 + i * 0.3) + Math.sin(this.t * 0.2 + i) * W * 0.05));
      this.flames.forEach((f) => f.setAlpha(0.5 + Math.random() * 0.2));
    }
    // the moon's eye
    this.eyeOpen += (this.eyeTarget - this.eyeOpen) * Math.min(1, dtMs / 400);
    this.drawEye(heroX);
  }

  private drawEye(heroX: number): void {
    const g = this.eye;
    g.clear();
    if (this.eyeOpen < 0.02 || !this.moon.visible) return;
    const m = this.moonGeom();
    const mx = this.flipped ? this.L.W - m.x : m.x;
    const w = m.r * 0.95;
    const h = m.r * 0.42 * this.eyeOpen;
    g.fillStyle(0x0a0002, 0.95);
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.lineTo(mx + Math.cos(a) * w, m.y + Math.sin(a) * h * (Math.sin(a) > 0 ? 1 : 1));
    }
    g.closePath();
    g.fillPath();
    const look = Math.max(-1, Math.min(1, (heroX - mx) / (this.L.W * 0.5)));
    const ix = mx + look * w * 0.45;
    g.fillStyle(0xd0101c, 1);
    g.fillCircle(ix, m.y + h * 0.1, Math.min(h * 0.9, m.r * 0.3));
    g.fillStyle(0x000000, 1);
    g.fillEllipse(ix, m.y + h * 0.1, Math.min(h * 0.4, m.r * 0.1), Math.min(h * 0.85, m.r * 0.27));
  }
}
