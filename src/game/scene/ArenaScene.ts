import Phaser from 'phaser';
import { WEAK_POINT_NODES } from '@/game/core/missionConfig';
import type { DirectorEvent } from '@/game/core/director';
import type { Action, AttackType } from '@/game/core/types';
import type { MissionSession } from '@/game/MissionSession';
import { getSettings, levelFactor } from '@/state/settings';
import { Enemy } from './Enemy';
import { Player } from './Player';
import { COLORS, generateBackdrop, generateTextures } from './textures';

interface Layout {
  W: number;
  H: number;
  S: number;
  cx: number;
  horizonY: number;
  enemyX: number;
  enemyY: number;
  playerX: number;
  playerY: number;
  lane: number;
  lensX: number;
  lensY: number;
  lensScale: number;
}

interface Effect {
  /** Returns false when finished. Draws into the shared fx graphics. */
  update(dt: number, g: Phaser.GameObjects.Graphics): boolean;
  /** Real-time effects ignore slow-mo (UI-like holographic elements). */
  real?: boolean;
}

export interface ArenaSceneData {
  session: MissionSession;
  dpr: number;
}

const ENEMY_UNIT = 0.8;

export class ArenaScene extends Phaser.Scene {
  private session!: MissionSession;
  private dpr = 1;
  private L!: Layout;
  private k0 = 1;

  private bgLayer!: Phaser.GameObjects.Layer;
  private worldLayer!: Phaser.GameObjects.Layer;
  private fxLayer!: Phaser.GameObjects.Layer;
  private topLayer!: Phaser.GameObjects.Layer;

  private backdrop!: Phaser.GameObjects.Image;
  private vignette!: Phaser.GameObjects.Image;
  private grid!: Phaser.GameObjects.Graphics;
  private zones!: Phaser.GameObjects.Graphics;
  private fxG!: Phaser.GameObjects.Graphics;
  private horizonGlow!: Phaser.GameObjects.Image;
  private shafts: Phaser.GameObjects.Image[] = [];
  private grain: Phaser.GameObjects.TileSprite | null = null;
  private tint!: Phaser.GameObjects.Rectangle;
  private flashRect!: Phaser.GameObjects.Rectangle;

  private enemy!: Enemy;
  private player!: Player;
  private lens!: Phaser.GameObjects.Container;
  private lensImg!: Phaser.GameObjects.Image;
  private lensNodes: Phaser.GameObjects.Image[] = [];
  private lensTimer!: Phaser.GameObjects.Graphics;

  private emBlue!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emRed!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emWhite!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emShards!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emAura!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emDust!: Phaser.GameObjects.Particles.ParticleEmitter;

  private effects: Effect[] = [];
  private telegraph: { attack: AttackType; duration: number; elapsed: number } | null = null;
  private zoneFade: { attack: AttackType; t: number } | null = null;
  private gap: { duration: number; elapsed: number; predictable: boolean; committed: boolean } | null = null;
  private recall: { duration: number; elapsed: number } | null = null;
  private tutorialProp: Phaser.GameObjects.Image | null = null;
  private vts = 1;
  private vtsTarget = 1;
  private hitStop = 0;
  private gridOffset = 0;
  private lastFlash = 0;
  private time0 = 0;
  private unsub: (() => void) | null = null;

  constructor() {
    super('arena');
  }

  init(data: ArenaSceneData): void {
    this.session = data.session;
    this.dpr = data.dpr;
  }

  create(): void {
    this.L = this.computeLayout(this.scale.width, this.scale.height);
    this.k0 = this.L.S;
    generateTextures(this, this.k0);
    generateBackdrop(this, this.L.W, this.L.H, this.L.enemyY, this.L.horizonY);

    this.bgLayer = this.add.layer();
    this.worldLayer = this.add.layer();
    this.fxLayer = this.add.layer();
    this.topLayer = this.add.layer();

    this.backdrop = this.add.image(0, 0, 'backdrop').setOrigin(0);
    this.shafts = [-0.24, 0.24].map((rot) =>
      this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(COLORS.red).setAlpha(0.16).setRotation(rot),
    );
    this.horizonGlow = this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(COLORS.red).setAlpha(0.35);
    this.grid = this.add.graphics();
    this.zones = this.add.graphics();
    this.bgLayer.add([this.backdrop, ...this.shafts, this.horizonGlow, this.grid, this.zones]);

    const effectsHigh = getSettings().effects === 'high';
    this.emDust = this.add.particles(0, 0, 'spark', {
      x: { min: 0, max: this.L.W },
      y: { min: 0, max: this.L.H },
      lifespan: 7000,
      speedY: { min: -14 * this.L.S, max: -4 * this.L.S },
      speedX: { min: -4 * this.L.S, max: 4 * this.L.S },
      scale: { min: 0.08 * this.L.S, max: 0.28 * this.L.S },
      alpha: { start: 0.35, end: 0 },
      tint: [0x8fb8ff, 0xff7a8a, 0xffffff],
      blendMode: 'ADD',
      frequency: effectsHigh ? 140 : 420,
    });
    this.bgLayer.add(this.emDust);

    this.enemy = new Enemy(this, this.L.S * ENEMY_UNIT, this.k0);
    this.enemy.root.setAlpha(0);
    this.player = new Player(this, this.L.S, this.L.lane, this.fxLayer, this.k0);
    this.emAura = this.add.particles(0, 0, 'spark', {
      lifespan: 900,
      speedY: { min: -60 * this.L.S, max: -20 * this.L.S },
      speedX: { min: -12 * this.L.S, max: 12 * this.L.S },
      scale: { start: 0.35 * this.L.S, end: 0 },
      alpha: { start: 0.8, end: 0 },
      tint: COLORS.blue,
      blendMode: 'ADD',
      frequency: 90,
      emitting: true,
    });
    this.worldLayer.add([this.enemy.root, this.emAura, this.player.root]);

    const burst = (tint: number | number[], texture = 'spark') =>
      this.add.particles(0, 0, texture, {
        lifespan: { min: 300, max: 700 },
        speed: { min: 80 * this.L.S, max: 420 * this.L.S },
        scale: { start: 0.55 * this.L.S, end: 0 },
        alpha: { start: 1, end: 0 },
        tint,
        blendMode: 'ADD',
        emitting: false,
      });
    this.emBlue = burst([COLORS.blue, 0xbff3ff]);
    this.emRed = burst([COLORS.red, 0xff9aa6]);
    this.emWhite = burst(0xffffff);
    this.emShards = this.add.particles(0, 0, 'shard', {
      lifespan: { min: 900, max: 1800 },
      speed: { min: 120 * this.L.S, max: 680 * this.L.S },
      scale: { start: 1.1 * this.L.S, end: 0.2 * this.L.S },
      rotate: { min: 0, max: 360 },
      alpha: { start: 1, end: 0 },
      tint: [COLORS.red, 0xff6a7a, 0xffffff, 0x2a0a12],
      gravityY: 220 * this.L.S,
      blendMode: 'ADD',
      emitting: false,
    });
    this.fxG = this.add.graphics();
    this.fxLayer.add([this.emBlue, this.emRed, this.emWhite, this.emShards, this.fxG]);

    // Ascension lens (holographic schematic in thumb reach).
    this.lens = this.add.container(0, 0).setAlpha(0).setVisible(false);
    this.lensImg = this.add.image(0, 0, 'lens').setBlendMode(Phaser.BlendModes.ADD);
    this.lensTimer = this.add.graphics();
    this.lens.add(this.lensImg);
    for (let i = 0; i < WEAK_POINT_NODES.length; i++) {
      const n = this.add.image(0, 0, 'node').setBlendMode(Phaser.BlendModes.ADD).setTint(COLORS.blue).setAlpha(0.35);
      this.lensNodes.push(n);
      this.lens.add(n);
    }
    // Graphics must not be nested in a Container inside a Layer (Phaser 3.90 WebGL) — keep it in the layer.
    this.fxLayer.add([this.lens, this.lensTimer]);

    this.vignette = this.add.image(0, 0, 'vignette').setOrigin(0);
    this.tint = this.add.rectangle(0, 0, this.L.W, this.L.H, 0x061433, 1).setOrigin(0).setAlpha(0);
    this.flashRect = this.add.rectangle(0, 0, this.L.W, this.L.H, 0xffffff, 1).setOrigin(0).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    this.topLayer.add([this.tint, this.vignette]);
    if (effectsHigh) {
      this.grain = this.add.tileSprite(0, 0, this.L.W, this.L.H, 'noise').setOrigin(0).setAlpha(0.045).setBlendMode(Phaser.BlendModes.ADD);
      this.topLayer.add(this.grain);
    }
    this.topLayer.add(this.flashRect);

    this.applyLayout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);

    this.session.tapResolver = (x, y) => this.resolveTap(x, y);
    this.unsub = this.session.on((e) => this.onEvent(e));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());

    this.cameras.main.setBackgroundColor(COLORS.void);
    if (import.meta.env.DEV) (window as unknown as { __ARENA__?: ArenaScene }).__ARENA__ = this;
    this.session.start();
  }

  // ------------------------------------------------------------------ layout

  private computeLayout(W: number, H: number): Layout {
    const S = Math.min(W / 390, H / 844);
    const lensR = Math.min(W * 0.4, H * 0.21);
    return {
      W,
      H,
      S,
      cx: W / 2,
      horizonY: H * 0.47,
      enemyX: W / 2,
      enemyY: H * 0.3,
      playerX: W / 2,
      playerY: H * 0.8,
      lane: Math.min(W * 0.29, 118 * S),
      lensX: W / 2,
      lensY: H * 0.585,
      lensScale: lensR / (150 * this.k0 || 1),
    };
  }

  private onResize(size: Phaser.Structs.Size): void {
    this.L = this.computeLayout(size.width, size.height);
    generateBackdrop(this, this.L.W, this.L.H, this.L.enemyY, this.L.horizonY);
    this.backdrop.setTexture('backdrop');
    this.vignette.setTexture('vignette');
    this.applyLayout();
  }

  private applyLayout(): void {
    const L = this.L;
    L.lensScale = Math.min(L.W * 0.4, L.H * 0.21) / (150 * this.k0);
    this.cameras.main.setSize(L.W, L.H);
    this.tint.setSize(L.W, L.H);
    this.flashRect.setSize(L.W, L.H);
    this.grain?.setSize(L.W, L.H);
    this.enemy.root.setPosition(L.enemyX, L.enemyY);
    this.enemy.setScaleUnit(L.S * ENEMY_UNIT);
    this.player.baseX = L.playerX;
    this.player.root.y = L.playerY;
    this.player.setLayout(L.S, L.lane);
    this.horizonGlow.setPosition(L.cx, L.horizonY).setScale((L.W * 1.6) / 128, (14 * L.S) / 128);
    this.shafts.forEach((s, i) => s.setPosition(L.cx + (i ? 1 : -1) * 70 * L.S, L.enemyY - 10 * L.S).setScale((150 * L.S) / 128, (L.H * 1.1) / 128));
    this.lens.setPosition(L.lensX, L.lensY);
    this.lensImg.setScale(L.lensScale);
    this.lensNodes.forEach((n, i) => {
      const p = WEAK_POINT_NODES[i];
      n.setPosition(p.x * 150 * this.k0 * L.lensScale, p.y * 170 * this.k0 * L.lensScale).setScale(1.25 * L.lensScale);
    });
  }

  // ------------------------------------------------------------------ frame loop

  update(_time: number, delta: number): void {
    if (this.session.isPaused()) return;
    this.session.tick(delta);

    // Visual time: slow-mo and hit-stop never affect rule timing (owned by the director).
    this.vts += (this.vtsTarget - this.vts) * Math.min(1, delta / 120);
    let vdt = delta * this.vts;
    if (this.hitStop > 0) {
      this.hitStop -= delta;
      vdt = delta * 0.03;
    }
    this.time0 += vdt;
    this.tweens.timeScale = this.hitStop > 0 ? 0.05 : this.vts;
    for (const em of [this.emBlue, this.emRed, this.emWhite, this.emShards, this.emAura, this.emDust]) em.timeScale = this.vts;

    this.enemy.update(vdt);
    this.player.update(vdt);
    this.emAura.setPosition(this.player.root.x, this.player.root.y - 40 * this.L.S);

    if (this.telegraph) {
      this.telegraph.elapsed += delta;
      this.enemy.charge(this.telegraph.attack, Math.min(1, this.telegraph.elapsed / this.telegraph.duration));
    }
    if (this.gap) {
      this.gap.elapsed += delta;
      if (this.gap.predictable && !this.gap.committed) this.player.setRing(1 - this.gap.elapsed / this.gap.duration);
    }
    if (this.recall) this.recall.elapsed += delta;

    this.drawGrid(vdt);
    this.drawZones(delta);
    this.drawLensTimer();
    this.fxG.clear();
    this.effects = this.effects.filter((e) => e.update(e.real ? delta : vdt, this.fxG));

    if (this.grain) this.grain.setTilePosition(Math.random() * 128, Math.random() * 128);
    const sway = Math.sin(this.time0 / 1700) * 0.05;
    this.shafts[0].rotation = -0.24 + sway;
    this.shafts[1].rotation = 0.24 - sway;
    if (this.tutorialProp) this.tutorialProp.setScale((this.L.S / this.k0) * (1 + Math.sin(this.time0 / 180) * 0.08));
  }

  private drawGrid(vdt: number): void {
    const { W, H, cx, horizonY, S } = this.L;
    const g = this.grid;
    g.clear();
    this.gridOffset = (this.gridOffset + vdt / 2600) % 1;
    const span = H - horizonY;
    g.lineStyle(1 * S, 0x2c3c66, 0.32);
    for (let i = -9; i <= 9; i++) {
      g.lineBetween(cx + i * W * 0.025, horizonY, cx + i * W * 0.16, H);
    }
    for (let j = 0; j < 12; j++) {
      const t = (j + this.gridOffset) / 12;
      const y = horizonY + span * Math.pow(t, 2.1);
      g.lineStyle(1 * S, 0x2c3c66, 0.12 + t * 0.4);
      g.lineBetween(0, y, W, y);
    }
    g.lineStyle(1.5 * S, COLORS.red, 0.55);
    g.lineBetween(0, horizonY, W, horizonY);
  }

  /** Floor danger zones. Shape + colour + sound all encode the attack (redundant cues). */
  private drawZones(delta: number): void {
    const g = this.zones;
    g.clear();
    let attack: AttackType | null = null;
    let p = 0;
    let alphaMul = 1;
    if (this.telegraph) {
      attack = this.telegraph.attack;
      p = Math.min(1, this.telegraph.elapsed / this.telegraph.duration);
    } else if (this.zoneFade) {
      this.zoneFade.t -= delta;
      if (this.zoneFade.t <= 0) this.zoneFade = null;
      else {
        attack = this.zoneFade.attack;
        p = 1;
        alphaMul = this.zoneFade.t / 260;
      }
    }
    if (!attack) return;
    const { W, H, cx, horizonY, S, playerY, lane } = this.L;
    const top = horizonY + (H - horizonY) * 0.18;
    const flicker = p > 0.75 ? 0.75 + Math.sin(this.time0 / 22) * 0.25 : 1;
    const a = (0.15 + p * 0.45) * flicker * alphaMul;
    const persp = (y: number) => (y - horizonY) / (H - horizonY);

    if (attack === 'slashL' || attack === 'slashR') {
      const dir = attack === 'slashL' ? -1 : 1;
      const edge = cx + dir * -0.12 * W; // inner boundary just past the centre lane
      const far = cx + dir * W * 1.2;
      const bands = 12;
      for (let b = 0; b < bands; b++) {
        const y0 = top + ((H - top) * b) / bands;
        const y1 = top + ((H - top) * (b + 1)) / bands;
        const t0 = persp(y0);
        const t1 = persp(y1);
        const ex0 = cx + (edge - cx) * t0;
        const ex1 = cx + (edge - cx) * t1;
        const fx0 = cx + (far - cx) * t0;
        const fx1 = cx + (far - cx) * t1;
        g.fillStyle(COLORS.red, a * Math.pow((b + 0.5) / bands, 1.4));
        g.fillPoints([new Phaser.Math.Vector2(ex0, y0), new Phaser.Math.Vector2(fx0, y0), new Phaser.Math.Vector2(fx1, y1), new Phaser.Math.Vector2(ex1, y1)], true);
      }
      // hazard stripes sweeping outward
      g.lineStyle(3 * S, 0xff6a7a, a * 0.8);
      const phase = (this.time0 / 300) % 1;
      for (let k = 0; k < 6; k++) {
        const t = (k + phase) / 6;
        const x = cx + (edge - cx) * 1 + dir * t * W * 0.6;
        g.lineBetween(x, H, x + dir * 30 * S, top + (H - top) * 0.5);
      }
      // bright boundary — "get out past this line"
      g.lineStyle(2.5 * S, 0xffffff, Math.min(1, a * 1.6));
      g.lineBetween(cx + (edge - cx) * persp(top), top, edge, H);
    } else if (attack === 'crush') {
      for (let b = 0; b < 10; b++) {
        const y0 = top + ((H - top) * b) / 10;
        g.fillStyle(COLORS.red, a * 0.4 * Math.pow((b + 0.5) / 10, 1.3));
        g.fillRect(0, y0, W, (H - top) / 10 + 1);
      }
      for (let k = 0; k < 4; k++) {
        const r = (1 - ((p + k * 0.25) % 1)) * W * 0.75;
        g.lineStyle(3 * S, 0xff6a7a, a * 1.2);
        g.strokeEllipse(this.player.root.x, playerY, r * 2, r * 0.56);
      }
      g.lineStyle(2 * S, 0xffffff, Math.min(1, a * 1.5));
      g.strokeEllipse(this.player.root.x, playerY, lane * 1.1, lane * 0.3);
    } else {
      // pierce: a narrow white-hot column at the centre lane
      const w0 = 18 * S;
      const w1 = lane * 0.55;
      g.fillStyle(0xe8f6ff, a * 0.5);
      g.fillPoints(
        [
          new Phaser.Math.Vector2(cx - w0, this.L.enemyY),
          new Phaser.Math.Vector2(cx + w0, this.L.enemyY),
          new Phaser.Math.Vector2(cx + w1, H),
          new Phaser.Math.Vector2(cx - w1, H),
        ],
        true,
      );
      g.lineStyle(2 * S, 0xffffff, Math.min(1, a * 1.8));
      const dash = 14 * S;
      for (let y = this.L.enemyY; y < H; y += dash * 2) g.lineBetween(cx, y, cx, Math.min(H, y + dash));
    }
  }

  private drawLensTimer(): void {
    const g = this.lensTimer;
    g.clear();
    if (!this.recall) return;
    g.setPosition(this.lens.x, this.lens.y);
    const p = 1 - Math.min(1, this.recall.elapsed / this.recall.duration);
    const r = 146 * this.k0 * this.L.lensScale * this.lens.scaleX;
    g.lineStyle(3 * this.L.S, COLORS.blue, 0.9);
    g.beginPath();
    g.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p, false);
    g.strokePath();
  }

  // ------------------------------------------------------------------ events

  private onEvent(e: DirectorEvent): void {
    const L = this.L;
    switch (e.type) {
      case 'stage':
        if (e.loop === 'overdrive') this.enemy.setOverdrive(true);
        break;
      case 'cinematic':
        this.playCinematic(e.id, e.durationMs);
        break;
      case 'tutorialStep':
        this.spawnTutorialProp(e.expect);
        break;
      case 'tutorialResult':
        if (e.result === 'wrong') {
          this.shake(80, 0.002);
        } else {
          this.completeTutorialProp(e.action ?? null);
        }
        break;
      case 'gap':
        this.gap = { duration: e.durationMs, elapsed: 0, predictable: e.predictable, committed: false };
        if (!e.predictable) this.player.setRing(-1);
        break;
      case 'predictCommit':
        if (this.gap) this.gap.committed = true;
        this.player.setRing(1, true);
        this.player.act(e.action);
        break;
      case 'inputIgnored':
        this.emRed.explode(4, this.player.root.x, L.playerY - 20 * L.S);
        break;
      case 'telegraph':
        this.gap = null;
        this.player.setRing(-1);
        this.telegraph = { attack: e.attack, duration: e.durationMs, elapsed: 0 };
        this.enemy.telegraph(e.attack);
        this.emRed.explode(6, L.enemyX, L.enemyY - 40 * L.S);
        break;
      case 'reaction':
        this.player.act(e.action);
        break;
      case 'stagger':
        this.player.stagger();
        this.emRed.explode(10, this.player.root.x, L.playerY - 50 * L.S);
        this.shake(120, 0.003);
        break;
      case 'resolve':
        if (e.record.outcome === 'read') this.counterHit();
        break;
      case 'strike':
        this.onStrike(e.attack, e.damage > 0, e.dodged);
        break;
      case 'meters':
        this.player.setAura(e.aura);
        this.emAura.frequency = e.aura >= 100 ? 25 : 110 - e.aura * 0.7;
        break;
      case 'reboot':
        this.rebootFx(e.durationMs);
        break;
      case 'ascendTrigger':
        this.ascendTrigger();
        break;
      case 'ascendNode':
        this.showNode(e.node, e.onMs);
        break;
      case 'ascendRecall':
        this.recall = { duration: e.durationMs, elapsed: 0 };
        this.lensNodes.forEach((n) => {
          n.setAlpha(0.7).setTint(COLORS.blue);
          this.tweens.add({ targets: n, alpha: 0.35, yoyo: true, repeat: -1, duration: 420 });
        });
        break;
      case 'ascendTap':
        this.onAscendTap(e.tap.node, e.tap.expected, e.tap.correct);
        break;
      case 'ascendStrike':
        this.ascendStrike(e.final, e.hits, e.total);
        break;
      case 'finisher':
        this.finisher(e.durationMs);
        break;
      default:
        break;
    }
  }

  private playCinematic(id: string, ms: number): void {
    const L = this.L;
    const cam = this.cameras.main;
    if (id === 'awaken') {
      cam.fadeIn(Math.min(1400, ms * 0.5), 0, 0, 0);
      this.player.root.x = L.playerX;
      this.player.materialize(ms);
      // horizontal line of light opening the world
      this.effects.push(lineOfLight(L.cx, L.playerY, L.W, L.S, ms * 0.6));
      this.time.delayedCall(ms * 0.65, () => this.emBlue.explode(40, L.playerX, L.playerY - 60 * L.S));
    } else if (id === 'enemyIntro') {
      this.pillar(L.enemyX, L.enemyY, 90 * L.S, L.H * 0.9, COLORS.red, ms * 0.55);
      this.time.delayedCall(ms * 0.2, () => {
        this.enemy.materialize(ms * 0.8);
        this.shake(500, 0.004);
        this.flash(COLORS.red, 0.35, 260);
        this.emRed.explode(50, L.enemyX, L.enemyY);
      });
    } else if (id === 'patternIntro') {
      this.effects.push(scanSweep(L.enemyX, L.enemyY - 180 * L.S * ENEMY_UNIT, L.enemyY + 160 * L.S * ENEMY_UNIT, 180 * L.S, L.S, ms * 0.6));
      this.zoomPulse(1.04, 500);
    } else if (id === 'overdriveIntro') {
      this.vtsTarget = 1;
      this.tweens.add({ targets: this.tint, alpha: 0, duration: 500 });
      this.hideLens();
      this.enemy.relax();
      this.time.delayedCall(ms * 0.35, () => {
        this.effects.push(shockwave(L.enemyX, L.enemyY, L.W * 0.9, L.S, COLORS.red, 700));
        this.shake(600, 0.006);
        this.flash(COLORS.red, 0.4, 300);
        this.emRed.explode(60, L.enemyX, L.enemyY - 40 * L.S);
      });
    }
  }

  private spawnTutorialProp(expect: Action): void {
    const L = this.L;
    this.tutorialProp?.destroy();
    if (expect === 'block') {
      const wave = this.add.image(L.cx, L.horizonY - 40 * L.S, 'ring').setTint(COLORS.red).setBlendMode(Phaser.BlendModes.ADD).setScale(L.S / this.k0 * 3, L.S / this.k0 * 0.9);
      this.fxLayer.add(wave);
      this.tweens.add({ targets: wave, y: L.playerY - 120 * L.S, duration: 1800, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
      this.tutorialProp = wave;
    } else {
      const x = L.playerX + (expect === 'dodgeR' ? 1 : -1) * L.lane;
      const shard = this.add.image(x, L.playerY - 50 * L.S, 'echoShard').setBlendMode(Phaser.BlendModes.ADD);
      this.fxLayer.add(shard);
      shard.setAlpha(0);
      this.tweens.add({ targets: shard, alpha: 1, duration: 400 });
      this.tutorialProp = shard;
    }
  }

  private completeTutorialProp(action: Action | null): void {
    const prop = this.tutorialProp;
    this.tutorialProp = null;
    if (action) this.player.act(action);
    const L = this.L;
    if (prop) {
      this.tweens.killTweensOf(prop);
      this.emBlue.explode(26, prop.x, prop.y);
      if (action === 'block') {
        this.player.shieldImpact();
        this.effects.push(shockwave(this.player.root.x, L.playerY - 30 * L.S, L.lane * 1.6, L.S, COLORS.blue, 450));
      }
      this.tweens.add({ targets: prop, alpha: 0, scale: prop.scale * 1.8, duration: 260, onComplete: () => prop.destroy() });
    }
    this.time.delayedCall(420, () => this.player.returnToCenter());
  }

  private counterHit(): void {
    const L = this.L;
    const from = new Phaser.Math.Vector2(this.player.root.x, L.playerY - 70 * L.S);
    const to = new Phaser.Math.Vector2(L.enemyX, L.enemyY - 30 * L.S);
    this.effects.push(slash(from.x, from.y, to.x, to.y, COLORS.blue, 6 * L.S, 360));
    this.time.delayedCall(90, () => {
      this.enemy.hurt(0.6);
      this.emBlue.explode(18, to.x, to.y);
      this.emWhite.explode(8, to.x, to.y);
      this.hitStop = 60;
      this.flash(COLORS.blue, 0.18, 160);
    });
  }

  private onStrike(attack: AttackType, hit: boolean, dodged: Action | null): void {
    const L = this.L;
    this.enemy.strike(attack);
    this.zoneFade = { attack, t: 260 };
    this.telegraph = null;
    const py = L.playerY - 50 * L.S;
    if (attack === 'slashL' || attack === 'slashR') {
      const dir = attack === 'slashL' ? -1 : 1;
      const x0 = L.cx + dir * L.W * 0.62;
      const x1 = L.cx - dir * L.W * 0.1;
      this.effects.push(slash(x0, py - 90 * L.S, x1, py + 50 * L.S, COLORS.red, 9 * L.S, 340));
    } else if (attack === 'crush') {
      this.effects.push(shockwave(this.player.root.x, L.playerY, L.W * 0.9, L.S, COLORS.red, 520));
    } else {
      this.effects.push(beam(L.cx, L.enemyY - 40 * L.S, L.H, 26 * L.S, 0xe8f6ff, 300));
    }
    if (hit) {
      this.player.hurt();
      this.emRed.explode(28, this.player.root.x, py);
      this.hitStop = 80;
      this.shake(260, 0.012);
      this.flash(COLORS.red, 0.32, 220);
    } else if (dodged === 'block') {
      this.player.shieldImpact();
      this.emBlue.explode(22, this.player.root.x, L.playerY - 80 * L.S);
      this.emWhite.explode(10, this.player.root.x, L.playerY - 80 * L.S);
      this.hitStop = 50;
      this.shake(140, 0.004);
    } else {
      this.emRed.explode(12, L.cx, py);
      this.shake(90, 0.002);
    }
    this.time.delayedCall(300, () => this.player.returnToCenter());
  }

  private rebootFx(ms: number): void {
    const L = this.L;
    this.flash(0xffffff, 0.25, 200);
    this.effects.push(glitch(L.W, L.H, L.S, ms * 0.6));
    this.player.returnToCenter();
    this.time.delayedCall(ms * 0.35, () => this.player.materialize(ms * 0.6));
  }

  // ------------------------------------------------------------------ ascension

  private ascendTrigger(): void {
    const L = this.L;
    this.effects = [];
    this.tweens.add({ targets: this.player.root, alpha: 0.3, duration: 400 });
    this.telegraph = null;
    this.zoneFade = null;
    this.gap = null;
    this.player.setRing(-1);
    this.hitStop = 90;
    this.vtsTarget = 0.12;
    this.tweens.add({ targets: this.tint, alpha: 0.42, duration: 500 });
    this.flash(COLORS.blue, 0.3, 300);
    this.emBlue.explode(60, this.player.root.x, L.playerY - 60 * L.S);
    this.effects.push(real(shockwave(this.player.root.x, L.playerY - 60 * L.S, L.W * 1.2, L.S, COLORS.blue, 700)));
    this.zoomPulse(1.05, 900, false);
    this.player.returnToCenter();
    this.enemy.showNodes('dim');
    this.lens.setVisible(true).setAlpha(0).setScale(0.7);
    this.lensNodes.forEach((n) => {
      this.tweens.killTweensOf(n);
      n.setAlpha(0.3).setTint(COLORS.blue).setScale(1.25 * L.lensScale);
    });
    // Lens animations must run in real time even while the world is slowed.
    this.realTween({ targets: this.lens, alpha: 1, scale: 1, duration: 600, ease: 'Expo.easeOut' });
  }

  private showNode(i: number, onMs: number): void {
    const n = this.lensNodes[i];
    const L = this.L;
    this.tweens.killTweensOf(n);
    n.setTint(0xffffff).setAlpha(1).setScale(2.3 * L.lensScale);
    this.realTween({ targets: n, scale: 1.25 * L.lensScale, alpha: 0.3, duration: onMs, ease: 'Expo.easeOut', onComplete: () => n.setTint(COLORS.blue) });
    this.enemy.lightNode(i, onMs);
    const a = this.lensNodeWorld(i);
    const b = this.enemy.nodeWorld(i);
    this.effects.push(real(link(a.x, a.y, b.x, b.y, L.S, onMs * 1.6)));
    this.emWhite.explode(10, a.x, a.y);
  }

  private onAscendTap(node: number | null, expected: number, correct: boolean): void {
    const L = this.L;
    const target = node ?? expected;
    const a = this.lensNodeWorld(target);
    if (node !== null) {
      const n = this.lensNodes[node];
      this.tweens.killTweensOf(n);
      n.setTint(correct ? 0xffffff : COLORS.red).setAlpha(1).setScale(2 * L.lensScale);
      this.realTween({ targets: n, scale: 1.25 * L.lensScale, alpha: correct ? 0.15 : 0.5, duration: 260 });
    }
    if (correct) {
      const b = this.enemy.nodeWorld(expected);
      this.effects.push(real(slash(a.x, a.y, b.x, b.y, COLORS.blue, 6 * L.S, 700)));
      this.emBlue.explode(16, a.x, a.y);
      this.emWhite.explode(14, b.x, b.y);
      this.enemy.hurt(0.4);
      this.shake(90, 0.003);
    } else {
      this.emRed.explode(12, a.x, a.y);
      this.shake(60, 0.002);
    }
  }

  private ascendStrike(final: boolean, hits: number, total: number): void {
    const L = this.L;
    this.recall = null;
    this.hideLens();
    this.enemy.showNodes('off');
    // Charge, then everything lands on the bass drop (audio drops at +900ms).
    this.realTween({ targets: this.tint, alpha: 0.6, duration: 800 });
    this.realDelay(900, () => {
      this.vtsTarget = 1;
      this.vts = 0.6;
      this.tweens.add({ targets: this.player.root, alpha: 1, duration: 300 });
      this.tweens.add({ targets: this.tint, alpha: 0, duration: 700 });
      this.flash(0xffffff, final ? 0.75 : 0.55, 320);
      this.player.spawnGhost(0.9);
      const cuts = 2 + hits;
      for (let c = 0; c < cuts; c++) {
        const ang = -0.9 + (1.8 * c) / Math.max(1, cuts - 1) + (c % 2 ? 0.25 : -0.25);
        const r = 130 * L.S;
        this.effects.push(
          slash(L.enemyX - Math.cos(ang) * r, L.enemyY - Math.sin(ang) * r, L.enemyX + Math.cos(ang) * r, L.enemyY + Math.sin(ang) * r, c % 2 ? COLORS.blue : 0xffffff, 7 * L.S, 520 + c * 60),
        );
      }
      this.enemy.hurt(1.5);
      this.hitStop = 110;
      this.shake(500, final ? 0.02 : 0.014);
      this.emWhite.explode(40, L.enemyX, L.enemyY);
      this.emRed.explode(50, L.enemyX, L.enemyY);
      this.effects.push(shockwave(L.enemyX, L.enemyY, L.W * 1.3, L.S, 0xffffff, 700));
      this.zoomPulse(1.0, 600, false);
    });
    void total;
  }

  private finisher(ms: number): void {
    const L = this.L;
    this.effects.push(cracks(L.enemyX, L.enemyY, 150 * L.S, L.S, ms * 0.3));
    this.vtsTarget = 0.35;
    this.time.delayedCall(ms * 0.08, () => {
      this.flash(0xffffff, 0.9, 700);
      this.shake(700, 0.025);
      this.emShards.explode(getSettings().effects === 'high' ? 90 : 40, L.enemyX, L.enemyY - 20 * L.S);
      this.emWhite.explode(50, L.enemyX, L.enemyY);
      this.effects.push(shockwave(L.enemyX, L.enemyY, L.W * 1.8, L.S, COLORS.red, 1200));
      this.enemy.shatterHide();
    });
    this.time.delayedCall(ms * 0.35, () => {
      this.vtsTarget = 1;
    });
  }

  /** Soft vertical light pillar (sprite-based, no hard edges). */
  private pillar(x: number, yCenter: number, width: number, height: number, color: number, ms: number): void {
    const glow = this.add.image(x, yCenter, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(color).setAlpha(0);
    const core = this.add.image(x, yCenter, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffffff).setAlpha(0);
    glow.setScale((width * 2.4) / 128, height / 128);
    core.setScale((width * 0.5) / 128, (height * 0.9) / 128);
    this.fxLayer.add([glow, core]);
    this.tweens.add({ targets: [glow, core], alpha: { from: 0, to: 0.9 }, duration: ms * 0.25, yoyo: true, hold: ms * 0.3, onComplete: () => {
      glow.destroy();
      core.destroy();
    } });
    this.tweens.add({ targets: core, scaleX: 0.02, duration: ms, ease: 'Expo.easeIn' });
  }

  private hideLens(): void {
    this.recall = null;
    this.lensNodes.forEach((n) => this.tweens.killTweensOf(n));
    this.realTween({ targets: this.lens, alpha: 0, scale: 1.15, duration: 300, onComplete: () => this.lens.setVisible(false) });
  }

  private lensNodeWorld(i: number): Phaser.Math.Vector2 {
    const n = this.lensNodes[i];
    return new Phaser.Math.Vector2(this.lens.x + n.x * this.lens.scaleX, this.lens.y + n.y * this.lens.scaleY);
  }

  /** CSS px tap → nearest lens node within reach (fat-finger friendly). */
  private resolveTap(xCss: number, yCss: number): number | null {
    const p = this.cameras.main.getWorldPoint(xCss * this.dpr, yCss * this.dpr);
    let best: number | null = null;
    let bestD = Infinity;
    for (let i = 0; i < this.lensNodes.length; i++) {
      const w = this.lensNodeWorld(i);
      const d = Phaser.Math.Distance.Between(p.x, p.y, w.x, w.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const reach = 58 * this.L.S;
    return bestD <= reach ? best : null;
  }

  // ------------------------------------------------------------------ helpers

  /** Tween that ignores the slow-mo time scale (UI-like elements during Ascension). */
  private realTween(config: Phaser.Types.Tweens.TweenBuilderConfig): void {
    const duration = (config.duration as number) ?? 300;
    const tw = this.tweens.add({ ...config, duration });
    // Compensate the global tween time scale every frame.
    const fix = () => {
      if (!tw.isPlaying() && !tw.isPendingRemove()) return;
      tw.timeScale = this.tweens.timeScale > 0 ? 1 / this.tweens.timeScale : 1;
    };
    fix();
    const onUpdate = () => fix();
    this.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
    tw.once(Phaser.Tweens.Events.TWEEN_COMPLETE, () => this.events.off(Phaser.Scenes.Events.UPDATE, onUpdate));
    tw.once(Phaser.Tweens.Events.TWEEN_STOP, () => this.events.off(Phaser.Scenes.Events.UPDATE, onUpdate));
  }

  private realDelay(ms: number, fn: () => void): void {
    let left = ms;
    const tick = (_t: number, delta: number) => {
      if (this.session.isPaused()) return;
      left -= delta;
      if (left <= 0) {
        this.events.off(Phaser.Scenes.Events.UPDATE, tick);
        fn();
      }
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, tick);
  }

  private shake(ms: number, intensity: number): void {
    const f = levelFactor(getSettings().shake);
    if (f <= 0) return;
    this.cameras.main.shake(ms, intensity * f, true);
  }

  /** Photosensitivity guard: flashes are scaled by the setting and limited to ~3 per second. */
  private flash(color: number, alpha: number, ms: number): void {
    const f = levelFactor(getSettings().flashes);
    if (f <= 0) return;
    const now = performance.now();
    const tooSoon = now - this.lastFlash < 340;
    this.lastFlash = now;
    const a = Math.min(0.6, alpha * 0.7 * f * (tooSoon ? 0.35 : 1));
    this.tweens.killTweensOf(this.flashRect);
    this.flashRect.setFillStyle(color, 1).setAlpha(a);
    this.realTween({ targets: this.flashRect, alpha: 0, duration: ms, ease: 'Quad.easeOut' });
  }

  private zoomPulse(z: number, ms: number, yoyo = true): void {
    if (getSettings().reduceMotion) return;
    const cam = this.cameras.main;
    this.tweens.killTweensOf(cam);
    this.realTween({ targets: cam, zoom: z, duration: ms / (yoyo ? 2 : 1), yoyo, ease: 'Sine.easeInOut' });
  }

  private cleanup(): void {
    this.unsub?.();
    this.unsub = null;
    this.session.tapResolver = null;
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
  }
}

// ---------------------------------------------------------------------- effects

function neon(g: Phaser.GameObjects.Graphics, color: number, width: number, alpha: number, draw: () => void): void {
  g.lineStyle(width * 2.2, color, alpha * 0.1);
  draw();
  g.lineStyle(width * 1.2, color, alpha * 0.28);
  draw();
  g.lineStyle(width * 0.55, color, alpha * 0.8);
  draw();
  g.lineStyle(Math.max(1, width * 0.22), 0xffffff, alpha);
  draw();
}

function real(e: Effect): Effect {
  e.real = true;
  return e;
}

function slash(x0: number, y0: number, x1: number, y1: number, color: number, width: number, ms: number): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      const head = Math.min(1, t / (ms * 0.18));
      const fade = t < ms * 0.25 ? 1 : 1 - (t - ms * 0.25) / (ms * 0.75);
      if (fade <= 0) return false;
      const tail = Math.max(0, head - 0.85 + (1 - fade) * 0.9);
      const ax = x0 + (x1 - x0) * tail;
      const ay = y0 + (y1 - y0) * tail;
      const bx = x0 + (x1 - x0) * head;
      const by = y0 + (y1 - y0) * head;
      neon(g, color, width * (0.4 + 0.6 * fade), fade, () => g.lineBetween(ax, ay, bx, by));
      return true;
    },
  };
}

function shockwave(x: number, y: number, maxR: number, s: number, color: number, ms: number): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      const p = t / ms;
      if (p >= 1) return false;
      const r = maxR * (1 - Math.pow(1 - p, 3));
      neon(g, color, 4 * s * (1 - p) + 1, 1 - p, () => g.strokeEllipse(x, y, r * 2, r * 0.6));
      return true;
    },
  };
}

function beam(x: number, y0: number, y1: number, width: number, color: number, ms: number): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      const p = t / ms;
      if (p >= 1) return false;
      const w = width * (1 - p * 0.7);
      g.fillStyle(color, 0.18 * (1 - p));
      g.fillRect(x - w * 1.8, y0, w * 3.6, y1 - y0);
      g.fillStyle(color, 0.55 * (1 - p));
      g.fillRect(x - w / 2, y0, w, y1 - y0);
      g.fillStyle(0xffffff, 0.9 * (1 - p));
      g.fillRect(x - w / 6, y0, w / 3, y1 - y0);
      return true;
    },
  };
}

function link(x0: number, y0: number, x1: number, y1: number, s: number, ms: number): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      const p = t / ms;
      if (p >= 1) return false;
      g.lineStyle(1.5 * s, 0xbff3ff, 0.55 * (1 - p));
      g.lineBetween(x0, y0, x1, y1);
      return true;
    },
  };
}

function lineOfLight(cx: number, y: number, w: number, s: number, ms: number): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      const p = t / ms;
      if (p >= 1) return false;
      const half = (w / 2) * Math.min(1, p * 2.2);
      const a = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
      neon(g, COLORS.blue, 3 * s, a, () => g.lineBetween(cx - half, y, cx + half, y));
      return true;
    },
  };
}

function scanSweep(x: number, yTop: number, yBottom: number, halfW: number, s: number, ms: number): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      const p = t / ms;
      if (p >= 1) return false;
      const y = yTop + (yBottom - yTop) * p;
      neon(g, COLORS.blue, 2 * s, 1 - p * 0.5, () => g.lineBetween(x - halfW, y, x + halfW, y));
      g.lineStyle(1 * s, COLORS.blue, 0.15);
      for (let k = 1; k < 6; k++) g.lineBetween(x - halfW, y - k * 9 * s, x + halfW, y - k * 9 * s);
      return true;
    },
  };
}

function cracks(x: number, y: number, r: number, s: number, ms: number): Effect {
  const lines: { a: number; len: number; bend: number }[] = [];
  for (let i = 0; i < 9; i++) lines.push({ a: (i / 9) * Math.PI * 2 + (i % 3) * 0.2, len: r * (0.6 + ((i * 37) % 10) / 25), bend: ((i * 53) % 10) / 20 - 0.25 });
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      const p = Math.min(1, t / ms);
      if (t > ms * 1.8) return false;
      const fade = t > ms ? 1 - (t - ms) / (ms * 0.8) : 1;
      for (const l of lines) {
        const mx = x + Math.cos(l.a) * l.len * 0.5 * p;
        const my = y + Math.sin(l.a) * l.len * 0.5 * p;
        const ex = x + Math.cos(l.a + l.bend) * l.len * p;
        const ey = y + Math.sin(l.a + l.bend) * l.len * p;
        neon(g, 0xffffff, 2 * s, fade, () => {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(mx, my);
          g.lineTo(ex, ey);
          g.strokePath();
        });
      }
      return true;
    },
  };
}

function glitch(w: number, h: number, s: number, ms: number): Effect {
  let t = 0;
  return {
    update(dt, g) {
      t += dt;
      if (t >= ms) return false;
      for (let i = 0; i < 7; i++) {
        const y = Math.random() * h;
        const hh = (4 + Math.random() * 22) * s;
        g.fillStyle(Math.random() > 0.5 ? COLORS.blue : COLORS.red, 0.12 + Math.random() * 0.2);
        g.fillRect((Math.random() - 0.5) * 40 * s, y, w, hh);
      }
      return true;
    },
  };
}
