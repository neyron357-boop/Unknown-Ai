import Phaser from 'phaser';
import { WEAK_POINT_NODES } from '@/game/core/missionConfig';
import type { AttackType } from '@/game/core/types';
import { COLORS } from './textures';

/** Arm rotations (radians) for each pose. Positive raises the screen-left arm. */
const POSES: Record<AttackType | 'idle', { l: number; r: number; lift: number; halo: number }> = {
  idle: { l: 0.12, r: -0.12, lift: 0, halo: 1 },
  slashL: { l: 1.75, r: -0.2, lift: -6, halo: 1.1 },
  slashR: { l: 0.2, r: -1.75, lift: -6, halo: 1.1 },
  crush: { l: 2.5, r: -2.5, lift: -26, halo: 1.55 },
  pierce: { l: -0.45, r: 0.45, lift: 6, halo: 0.85 },
};

const STRIKE: Record<AttackType, { l: number; r: number; lift: number }> = {
  slashL: { l: -0.7, r: -0.2, lift: 4 },
  slashR: { l: 0.2, r: 0.7, lift: 4 },
  crush: { l: -0.25, r: 0.25, lift: 18 },
  pierce: { l: -0.6, r: 0.6, lift: 0 },
};

/**
 * VERDICT — the Zenith Council's enforcer. Built from pre-painted textures:
 * body, two blade arms on shoulder pivots, a perspective halo, glowing core.
 */
export class Enemy {
  readonly root: Phaser.GameObjects.Container;
  private readonly rig: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Image;
  private readonly armL: Phaser.GameObjects.Image;
  private readonly armR: Phaser.GameObjects.Image;
  private readonly haloWrap: Phaser.GameObjects.Container;
  private readonly halo: Phaser.GameObjects.Image;
  private readonly core: Phaser.GameObjects.Image;
  private readonly visor: Phaser.GameObjects.Image;
  private readonly aura: Phaser.GameObjects.Image;
  readonly nodes: Phaser.GameObjects.Image[] = [];

  private t = 0;
  private pose = { ...POSES.idle };
  private target = { ...POSES.idle };
  private poseSpeed = 8;
  private haloSpin = 0.6;
  private coreBoost = 0;
  private overdrive = false;
  private s: number;

  constructor(
    private readonly scene: Phaser.Scene,
    s: number,
    /** Device px per unit the textures were painted at. */
    private readonly k0: number,
  ) {
    this.s = s;
    this.root = scene.add.container(0, 0);
    this.aura = scene.add.image(0, -30 * s, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(COLORS.red).setAlpha(0.35);
    this.rig = scene.add.container(0, 0);
    this.haloWrap = scene.add.container(0, -150 * s);
    this.halo = scene.add.image(0, 0, 'halo');
    this.haloWrap.add(this.halo);
    this.haloWrap.setScale(1, 0.26);

    this.body = scene.add.image(0, 0, 'enemyBody').setOrigin(120 / 240, 210 / 400);
    this.armL = scene.add.image(-64 * s, -92 * s, 'enemyArm').setOrigin(84 / 110, 22 / 300);
    this.armR = scene.add.image(64 * s, -92 * s, 'enemyArm').setOrigin(1 - 84 / 110, 22 / 300).setFlipX(true);
    this.core = scene.add.image(0, -40 * s, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(COLORS.red);
    this.visor = scene.add.image(0, -133 * s, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xff6a7a);

    this.rig.add([this.armL, this.armR, this.body, this.core, this.visor]);
    this.root.add([this.aura, this.haloWrap, this.rig]);

    for (let i = 0; i < WEAK_POINT_NODES.length; i++) {
      const n = scene.add.image(0, 0, 'node').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      this.nodes.push(n);
      this.rig.add(n);
    }
    this.layoutNodes();
    this.applyTextureScale();
    this.applyPose();
  }

  setScaleUnit(s: number): void {
    this.s = s;
    this.armL.x = -64 * s;
    this.armR.x = 64 * s;
    this.layoutNodes();
    this.applyTextureScale();
  }

  private applyTextureScale(): void {
    const ts = this.s / this.k0;
    this.body.setScale(ts);
    this.armL.setScale(ts);
    this.armR.setScale(ts);
    this.halo.setScale(ts);
  }

  /** Enemy-local position of a weak-point node (for link lines & hit sparks). */
  nodeWorld(i: number): Phaser.Math.Vector2 {
    const n = this.nodes[i];
    const m = n.getWorldTransformMatrix();
    return new Phaser.Math.Vector2(m.tx, m.ty);
  }

  private layoutNodes(): void {
    WEAK_POINT_NODES.forEach((p, i) => {
      this.nodes[i].setPosition(p.x * 95 * this.s, -24 * this.s + p.y * 150 * this.s);
    });
  }

  setOverdrive(on: boolean): void {
    this.overdrive = on;
    const tint = on ? 0xff8a9a : 0xffffff;
    this.body.setTint(tint);
    this.armL.setTint(tint);
    this.armR.setTint(tint);
    this.halo.setTint(on ? 0xffb0b8 : 0xffffff);
    this.haloSpin = on ? 1.6 : 0.6;
  }

  telegraph(attack: AttackType): void {
    this.target = { ...POSES[attack] };
    this.poseSpeed = 7;
    if (attack === 'pierce') {
      this.core.setTint(0xe8f6ff);
      this.visor.setTint(0xbff3ff);
    }
  }

  /** Called every frame with telegraph progress 0..1 to intensify the build-up. */
  charge(attack: AttackType, p: number): void {
    this.coreBoost = attack === 'pierce' ? p * 2.2 : p * 0.9;
  }

  strike(attack: AttackType): void {
    const s = STRIKE[attack];
    this.target = { l: s.l, r: s.r, lift: s.lift, halo: POSES[attack].halo };
    this.poseSpeed = 34;
    this.coreBoost = 1.4;
    this.scene.time.delayedCall(260, () => this.relax());
  }

  relax(): void {
    this.target = { ...POSES.idle };
    this.poseSpeed = 5;
    this.coreBoost = 0;
    this.core.setTint(COLORS.red);
    this.visor.setTint(0xff6a7a);
  }

  /** White hit-flash + recoil. */
  hurt(power = 1): void {
    this.body.setTintFill(0xffffff);
    this.armL.setTintFill(0xffffff);
    this.armR.setTintFill(0xffffff);
    this.scene.time.delayedCall(70 + power * 30, () => this.setOverdrive(this.overdrive));
    this.rig.y = -14 * this.s * power;
  }

  /** Materialisation for the intro cinematic. */
  materialize(durationMs: number): void {
    this.root.setAlpha(0);
    this.rig.setScale(1, 0.02);
    this.haloWrap.setAlpha(0);
    this.scene.tweens.add({ targets: this.root, alpha: 1, duration: durationMs * 0.25, ease: 'Sine.easeIn' });
    this.scene.tweens.add({ targets: this.rig, scaleY: 1, duration: durationMs * 0.35, delay: durationMs * 0.15, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: this.haloWrap, alpha: 1, duration: 500, delay: durationMs * 0.5 });
  }

  shatterHide(): void {
    this.scene.tweens.add({ targets: this.root, alpha: 0, duration: 400, ease: 'Expo.easeOut' });
  }

  showNodes(mode: 'off' | 'dim'): void {
    for (const n of this.nodes) {
      n.setVisible(mode !== 'off');
      n.setAlpha(0.22).setScale(0.8 * (this.s / this.k0)).setTint(0xff9aa6);
    }
  }

  lightNode(i: number, durationMs: number): void {
    const n = this.nodes[i];
    const ts = this.s / this.k0;
    n.setVisible(true).setAlpha(1).setScale(1.7 * ts).setTint(0xffffff);
    this.scene.tweens.add({ targets: n, scale: 0.9 * ts, alpha: 0.3, duration: durationMs, ease: 'Expo.easeOut' });
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    this.t += dt;
    const k = 1 - Math.exp(-this.poseSpeed * dt);
    this.pose.l += (this.target.l - this.pose.l) * k;
    this.pose.r += (this.target.r - this.pose.r) * k;
    this.pose.lift += (this.target.lift - this.pose.lift) * k;
    this.pose.halo += (this.target.halo - this.pose.halo) * k;
    this.rig.y += (0 - this.rig.y) * Math.min(1, dt * 6);
    this.applyPose();
    this.halo.rotation += dt * this.haloSpin;
    const pulse = 0.85 + Math.sin(this.t * 3.1) * 0.15;
    this.core.setScale((0.32 + this.coreBoost * 0.35) * pulse * this.s);
    this.core.setAlpha(Math.min(1, 0.7 + this.coreBoost * 0.3));
    this.visor.setScale(0.22 * this.s * (1 + this.coreBoost * 0.4), 0.42 * this.s);
    this.aura.setScale(3.4 * this.s * (1 + this.coreBoost * 0.12) * (this.overdrive ? 1.2 : 1));
    this.aura.setAlpha((this.overdrive ? 0.42 : 0.3) + Math.sin(this.t * 1.7) * 0.05);
  }

  private applyPose(): void {
    const bob = Math.sin(this.t * 1.4) * 4 * this.s;
    this.armL.rotation = this.pose.l + Math.sin(this.t * 1.1) * 0.03;
    this.armR.rotation = this.pose.r - Math.sin(this.t * 1.1 + 0.6) * 0.03;
    this.rig.setPosition(this.rig.x, this.rig.y);
    this.body.y = this.pose.lift * this.s + bob;
    this.armL.y = -92 * this.s + this.pose.lift * this.s + bob;
    this.armR.y = -92 * this.s + this.pose.lift * this.s + bob;
    this.core.y = -40 * this.s + this.pose.lift * this.s + bob;
    this.visor.y = -133 * this.s + this.pose.lift * this.s + bob;
    this.haloWrap.y = -150 * this.s + this.pose.lift * this.s * 1.3 + bob * 1.4;
    this.haloWrap.setScale(this.pose.halo, 0.26 * this.pose.halo);
    for (let i = 0; i < this.nodes.length; i++) {
      const p = WEAK_POINT_NODES[i];
      this.nodes[i].y = -24 * this.s + p.y * 150 * this.s + this.pose.lift * this.s + bob;
    }
  }
}
