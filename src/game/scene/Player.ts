import Phaser from 'phaser';
import type { Action } from '@/game/core/types';
import { COLORS } from './textures';

/**
 * The anomaly. Seen from behind, at the bottom of the screen — the thumb lives
 * here, so does the hero. Dashes between three lanes, raises a shield.
 */
export class Player {
  readonly root: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Image;
  private readonly floorLight: Phaser.GameObjects.Image;
  private readonly auraGlow: Phaser.GameObjects.Image;
  private readonly spine: Phaser.GameObjects.Image;
  private readonly shield: Phaser.GameObjects.Image;
  private readonly ring: Phaser.GameObjects.Graphics;

  private t = 0;
  private aura = 0;
  private laneTarget = 0;
  private lane = 0;
  private dashTween: Phaser.Tweens.Tween | null = null;
  private ringProgress = -1;
  private ringLocked = false;
  private flicker = 0;
  private ghostTimer = 0;
  private ghostsLeft = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private s: number,
    private laneWidth: number,
    private readonly fxLayer: Phaser.GameObjects.Layer,
    /** Device px per unit the textures were painted at. */
    private readonly k0: number,
  ) {
    this.root = scene.add.container(0, 0);
    this.floorLight = scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(COLORS.blue).setAlpha(0.35);
    this.ring = scene.add.graphics();
    this.auraGlow = scene.add.image(0, -60 * s, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(COLORS.blue).setAlpha(0.2);
    this.body = scene.add.image(0, 0, 'player').setOrigin(0.5, 140 / 150);
    this.spine = scene.add.image(0, -52 * s, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(COLORS.blue).setAlpha(0.7);
    this.shield = scene.add.image(0, -8 * s, 'shield').setOrigin(0.5, 100 / 110).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.root.add([this.floorLight, this.auraGlow, this.body, this.spine, this.shield]);
    // Graphics nested in a Container inside a Layer does not render reliably in Phaser 3.90 (WebGL),
    // so the ring lives in the fx layer and follows the hero's feet.
    fxLayer.add(this.ring);
  }

  /** Display scale for painted textures. */
  private get ts(): number {
    return this.s / this.k0;
  }

  setLayout(s: number, laneWidth: number): void {
    this.s = s;
    this.auraGlow.y = -60 * s;
    this.spine.y = -52 * s;
    this.shield.y = -8 * s;
    this.laneWidth = laneWidth;
    this.root.x = this.baseX + this.lane * this.laneWidth;
  }

  baseX = 0;

  get laneIndex(): number {
    return this.laneTarget;
  }

  setAura(v: number): void {
    this.aura = v;
  }

  /** Dash to a lane (-1, 0, 1) with afterimages. */
  dashTo(lane: number, fast = true): void {
    if (lane === this.laneTarget && !this.dashTween) return;
    this.laneTarget = lane;
    this.dashTween?.stop();
    this.ghostsLeft = fast ? 4 : 0;
    this.ghostTimer = 0;
    this.spawnGhost(0.55);
    this.dashTween = this.scene.tweens.addCounter({
      from: this.lane,
      to: lane,
      duration: fast ? 110 : 240,
      ease: fast ? 'Expo.easeOut' : 'Sine.easeInOut',
      onUpdate: (tw) => {
        this.lane = tw.getValue() ?? lane;
      },
      onComplete: () => {
        this.dashTween = null;
      },
    });
  }

  act(action: Action): void {
    if (action === 'block') this.raiseShield();
    else this.dashTo(action === 'dodgeL' ? -1 : 1);
  }

  raiseShield(): void {
    this.scene.tweens.killTweensOf(this.shield);
    this.shield.setAlpha(1).setScale(0.75 * this.ts);
    this.scene.tweens.add({ targets: this.shield, scale: 1.05 * this.ts, duration: 140, ease: 'Back.easeOut' });
  }

  shieldImpact(): void {
    this.shield.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => this.shield.clearTint());
    this.scene.tweens.add({ targets: this.shield, scale: 1.18 * this.ts, yoyo: true, duration: 90 });
  }

  lowerShield(): void {
    this.scene.tweens.add({ targets: this.shield, alpha: 0, duration: 220 });
  }

  returnToCenter(): void {
    if (this.laneTarget !== 0) this.dashTo(0, false);
    this.lowerShield();
  }

  hurt(): void {
    this.flicker = 380;
    this.body.setTint(0xff4060);
    this.scene.time.delayedCall(380, () => this.body.clearTint());
  }

  stagger(): void {
    this.flicker = 320;
    this.scene.tweens.add({ targets: this.body, angle: { from: -6, to: 6 }, duration: 60, yoyo: true, repeat: 2, onComplete: () => this.body.setAngle(0) });
  }

  /** Materialise from particles of light (Awakening cinematic). */
  materialize(durationMs: number): void {
    this.body.setAlpha(0);
    this.spine.setAlpha(0);
    const ghost = this.scene.add.image(this.root.x, this.root.y, 'playerGhost').setOrigin(0.5, 140 / 150).setScale(0, this.ts * 1.4);
    ghost.setBlendMode(Phaser.BlendModes.ADD).setTint(COLORS.blue);
    this.fxLayer.add(ghost);
    this.scene.tweens.add({ targets: ghost, scaleX: this.body.scaleX, scaleY: this.body.scaleY, duration: durationMs * 0.45, delay: durationMs * 0.25, ease: 'Expo.easeOut' });
    this.scene.tweens.add({ targets: ghost, alpha: 0, duration: durationMs * 0.3, delay: durationMs * 0.7, onComplete: () => ghost.destroy() });
    this.scene.tweens.add({ targets: [this.body, this.spine], alpha: 1, duration: durationMs * 0.3, delay: durationMs * 0.6 });
  }

  /** Countdown ring of the prediction window: 1 → 0. Negative hides it. */
  setRing(progress: number, locked = false): void {
    this.ringProgress = progress;
    this.ringLocked = locked;
  }

  spawnGhost(alpha = 0.4): void {
    const g = this.scene.add
      .image(this.root.x, this.root.y, 'playerGhost')
      .setOrigin(0.5, 140 / 150)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(COLORS.blue)
      .setAlpha(alpha)
      .setScale(this.body.scaleX, this.body.scaleY);
    this.fxLayer.add(g);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    this.t += dt;
    this.root.x = this.baseX + this.lane * this.laneWidth;
    if (this.ghostsLeft > 0) {
      this.ghostTimer -= dtMs;
      if (this.ghostTimer <= 0) {
        this.spawnGhost(0.35);
        this.ghostsLeft--;
        this.ghostTimer = 24;
      }
    }
    const breathe = 1 + Math.sin(this.t * 2.2) * 0.012;
    this.body.setScale(this.ts, this.ts * breathe);
    this.spine.setScale(0.28 * this.s, 0.9 * this.s);
    this.spine.setAlpha(0.55 + Math.sin(this.t * 3.4) * 0.15 + this.aura / 400);
    this.auraGlow.setScale((1.4 + this.aura / 70) * this.s);
    this.auraGlow.setAlpha(0.14 + this.aura / 260);
    this.floorLight.setScale(2.2 * this.s, 0.5 * this.s).setAlpha(0.28 + this.aura / 500);
    if (this.flicker > 0) {
      this.flicker -= dtMs;
      this.body.setVisible(Math.floor(this.flicker / 45) % 2 === 0 || this.flicker <= 0);
    } else if (!this.body.visible) this.body.setVisible(true);
    this.drawRing();
  }

  private drawRing(): void {
    const g = this.ring;
    g.setPosition(this.root.x, this.root.y);
    g.clear();
    if (this.ringProgress < 0) return;
    const rx = 52 * this.s;
    const ry = 15 * this.s;
    const p = Phaser.Math.Clamp(this.ringProgress, 0, 1);
    g.lineStyle(2 * this.s, this.ringLocked ? 0xffffff : COLORS.blue, this.ringLocked ? 0.95 : 0.25);
    g.strokeEllipse(0, 0, rx * 2, ry * 2);
    if (!this.ringLocked) {
      // shrinking countdown arc
      g.lineStyle(3 * this.s, COLORS.blue, 0.9);
      g.beginPath();
      const steps = 40;
      const end = Math.PI * 2 * p;
      for (let i = 0; i <= steps; i++) {
        const a = -Math.PI / 2 + (end * i) / steps;
        const x = Math.cos(a) * rx * (0.7 + 0.3 * p);
        const y = Math.sin(a) * ry * (0.7 + 0.3 * p);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }
  }
}
