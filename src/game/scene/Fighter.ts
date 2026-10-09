import { clonePose, HERO_BODY, lerpPose, limb, poly, ribbon, solve, Strand, VERDICT_BODY, type Body, type Joints, type Pose, type Vec } from './rig';
import { HERO, VERDICT } from './poses';
import type Phaser from 'phaser';

export type Ease = (t: number) => number;
export const EASE = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

export interface Key {
  pose: Pose;
  dur: number;
  ease?: Ease;
}

/** Keyframe player with smooth blending from wherever the pose currently is. */
export class Animator {
  readonly pose: Pose;
  private from: Pose;
  private keys: Key[] = [];
  private t = 0;

  constructor(initial: Pose) {
    this.pose = clonePose(initial);
    this.from = clonePose(initial);
  }

  play(keys: Key[]): void {
    this.from = clonePose(this.pose);
    this.keys = keys.filter((k) => k.dur >= 0);
    this.t = 0;
  }

  get busy(): boolean {
    return this.keys.length > 0;
  }

  update(dt: number): void {
    if (!this.keys.length) return;
    this.t += dt;
    while (this.keys.length && this.t >= this.keys[0].dur) {
      this.t -= this.keys[0].dur;
      this.from = clonePose(this.keys[0].pose);
      this.keys.shift();
    }
    if (!this.keys.length) {
      lerpPose(this.from, this.from, 1, this.pose);
      return;
    }
    const k = this.keys[0];
    const e = (k.ease ?? EASE.outCubic)(k.dur > 0 ? Math.min(1, this.t / k.dur) : 1);
    lerpPose(this.from, k.pose, e, this.pose);
  }
}

export interface FighterStyle {
  rim: number;
  fill: number;
  fillBack: number;
  emissive: number;
  eye: number;
}

export const HERO_STYLE: FighterStyle = { rim: 0x39d5ff, fill: 0x06070c, fillBack: 0x12151f, emissive: 0xbff3ff, eye: 0xbff3ff };
export const VERDICT_STYLE: FighterStyle = { rim: 0xff2a44, fill: 0x07060a, fillBack: 0x1a0c12, emissive: 0xff4a62, eye: 0xff2a44 };
export const PHANTOM_STYLE: FighterStyle = { rim: 0xd9e6ff, fill: 0x0b1020, fillBack: 0x141a2e, emissive: 0xe8f0ff, eye: 0xf2f6ff };

type Mapper = (v: Vec) => Vec;
const ID: Mapper = (v) => v;

/**
 * A side-view silhouette fighter: skeleton + keyframes + secondary motion
 * (scarf, hair, cape) + blade trail. Drawn as a neon-rimmed silhouette in
 * three passes (glow, rim, fill) so overlapping limbs read as one shape.
 */
export class Fighter {
  readonly body: Body;
  readonly anim: Animator;
  facing: 1 | -1;
  home: Vec = { x: 0, y: 0 };
  s = 1;
  style: FighterStyle;
  alpha = 1;
  /** ms of white hit-flash left. */
  flash = 0;
  /** x jitter amplitude (px) for glitch/phantom wobble. */
  jitter = 0;
  /** 0..1 extra blade energy (overcharge). */
  energy = 0;
  visible = true;
  airborne = false;
  joints!: Joints;
  readonly trail: { b: Vec; t: Vec; age: number; cont: boolean }[] = [];
  private trailLive = false;
  private time = Math.random() * 10;
  private readonly strands: Strand[] = [];
  private lastTip: Vec | null = null;
  haloAngle = 0;

  constructor(readonly kind: 'hero' | 'verdict', facing: 1 | -1, style?: FighterStyle) {
    this.body = kind === 'hero' ? HERO_BODY : VERDICT_BODY;
    this.facing = facing;
    this.style = style ?? (kind === 'hero' ? HERO_STYLE : VERDICT_STYLE);
    this.anim = new Animator(kind === 'hero' ? HERO.idle : VERDICT.idle);
    if (kind === 'hero') {
      this.strands.push(new Strand(10, 7, 0, 0)); // scarf
      for (let i = 0; i < 4; i++) this.strands.push(new Strand(3, 4.5, 0, 0)); // hair spikes
      this.strands.push(new Strand(6, 8, 0, 0), new Strand(6, 8, 0, 0)); // coat tails
    } else {
      this.strands.push(new Strand(9, 14, 0, 0), new Strand(9, 13, 0, 0)); // cape
    }
  }

  get idlePose(): Pose {
    return this.kind === 'hero' ? HERO.idle : VERDICT.idle;
  }

  place(home: Vec, s: number): void {
    this.home = home;
    this.s = s;
    this.joints = solve(this.body, this.anim.pose, home, this.facing, s);
    this.resetCloth();
  }

  resetCloth(): void {
    const j = this.joints ?? solve(this.body, this.anim.pose, this.home, this.facing, this.s);
    this.strands.forEach((st) => st.reset(j.neck.x, j.neck.y));
  }

  /** Play a sequence and come back to idle. */
  act(keys: Key[], back = 320): void {
    this.anim.play([...keys, { pose: this.idlePose, dur: back, ease: EASE.inOutSine }]);
  }

  update(dtMs: number, wind: number): void {
    this.time += dtMs / 1000;
    this.anim.update(dtMs);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs);
    const p = clonePose(this.anim.pose);
    // breathing & micro-motion so nobody is ever a statue
    const b = Math.sin(this.time * 2.1);
    p.lean += b * 0.015;
    p.sF += Math.sin(this.time * 2.1 + 0.8) * 0.025;
    p.blade += Math.sin(this.time * 1.6) * 0.03;
    p.head += Math.sin(this.time * 1.3) * 0.02;
    const root = { x: this.home.x + (this.jitter ? (Math.random() - 0.5) * this.jitter : 0), y: this.home.y };
    this.joints = solve(this.body, p, root, this.facing, this.s);
    this.stepCloth(dtMs / 1000, wind);
    this.sampleTrail(dtMs);
  }

  private stepCloth(dt: number, wind: number): void {
    const j = this.joints;
    const s = this.s;
    const back = -this.facing;
    if (this.kind === 'hero') {
      const anchor = { x: j.neck.x + back * 3 * s, y: j.neck.y + 2 * s };
      this.strands[0].step(anchor, dt, 260 * s, (back * 420 + wind * 260) * s, Math.sin(this.time * 7) * 60 * s, 0.9, 7 * s);
      for (let i = 1; i <= 4; i++) {
        // roots along the back-top arc of the head
        const th = 0.15 + i * 0.38;
        const base = { x: j.head.x + back * Math.sin(th) * this.body.headR * 0.85 * s, y: j.head.y - Math.cos(th) * this.body.headR * 0.85 * s };
        this.strands[i].step(base, dt, 60 * s, (back * 620 + wind * 200) * s, -200 * s + Math.sin(this.time * 9 + i) * 50 * s, 0.82, (5.5 + i * 0.9) * s);
      }
      // coat tails from the waist, heavier
      const waist = { x: (j.pelvis.x * 2 + j.chest.x) / 3, y: (j.pelvis.y * 2 + j.chest.y) / 3 };
      this.strands[5].step({ x: waist.x + back * 5 * s, y: waist.y }, dt, 420 * s, (back * 260 + wind * 240) * s, Math.sin(this.time * 4) * 40 * s, 0.9, 8 * s);
      this.strands[6].step({ x: waist.x + back * 1 * s, y: waist.y + 2 * s }, dt, 460 * s, (back * 200 + wind * 220) * s, Math.sin(this.time * 4 + 1) * 40 * s, 0.9, 7.5 * s);
    } else {
      const sh = j.shoulderB;
      this.strands[0].step({ x: sh.x + back * 6 * s, y: sh.y - 4 * s }, dt, 520 * s, (back * 240 + wind * 220) * s, 0, 0.94, 14 * s);
      this.strands[1].step({ x: sh.x + back * 16 * s, y: sh.y + 4 * s }, dt, 520 * s, (back * 300 + wind * 220) * s, Math.sin(this.time * 3) * 40 * s, 0.94, 13 * s);
    }
  }

  private sampleTrail(dtMs: number): void {
    for (const t of this.trail) t.age += dtMs;
    while (this.trail.length && this.trail[0].age > 140) this.trail.shift();
    const tip = this.joints.bladeTip;
    const speed = this.lastTip ? Math.hypot(tip.x - this.lastTip.x, tip.y - this.lastTip.y) / Math.max(dtMs, 1) : 0;
    this.lastTip = { ...tip };
    // only consecutive fast frames are joined; a pause breaks the smear
    const fast = speed > 0.35 * this.s;
    if (fast) this.trail.push({ b: { ...this.joints.handF }, t: { ...tip }, age: 0, cont: this.trailLive });
    this.trailLive = fast;
  }

  // ------------------------------------------------------------------ drawing

  /**
   * Draws the silhouette. `map` transforms points (reflection), `alphaMul` scales opacity,
   * `glow` toggles the soft outer pass.
   */
  draw(g: Phaser.GameObjects.Graphics, opts: { map?: Mapper; alphaMul?: number; glow?: boolean; impact?: 'dark' | 'light' | null } = {}): void {
    if (!this.visible || this.alpha <= 0) return;
    const map = opts.map ?? ID;
    const a = this.alpha * (opts.alphaMul ?? 1);
    const s = this.s;
    const st = this.style;
    if (opts.impact) {
      // Manga impact frame: flat silhouettes.
      g.fillStyle(opts.impact === 'light' ? 0x000000 : 0xffffff, a);
      this.shapes(g, map, 0, null);
      return;
    }
    if (opts.glow !== false) {
      g.fillStyle(st.rim, 0.1 * a);
      this.shapes(g, map, 3.6 * s, null);
    }
    g.fillStyle(this.flash > 0 ? 0xffffff : st.rim, 0.95 * a);
    this.shapes(g, map, 1.25 * s, null);
    const flashMix = this.flash > 0;
    this.shapes(g, map, 0, (back) => g.fillStyle(flashMix ? 0xffffff : back ? st.fillBack : st.fill, a));
    this.emissive(g, map, a);
  }

  private shapes(g: Phaser.GameObjects.Graphics, map: Mapper, grow: number, fill: ((back: boolean) => void) | null): void {
    const j = this.joints;
    const s = this.s;
    const w = this.body.w;
    const M = (v: Vec) => map(v);
    const setFill = (back: boolean) => fill?.(back);

    // cloth behind everything
    setFill(true);
    if (this.kind === 'hero') {
      ribbon(g, this.strands[0].pts.map(M), 7 * s, 2.5 * s, grow, 0.35);
      ribbon(g, this.strands[5].pts.map(M), 15 * s, 13 * s, grow, 0.4);
      ribbon(g, this.strands[6].pts.map(M), 13 * s, 10 * s, grow, 0.45);
    } else {
      const c0 = this.strands[0].pts.map(M);
      const c1 = this.strands[1].pts.map(M);
      ribbon(g, c0, 26 * s, 38 * s, grow, 0.45);
      ribbon(g, c1, 22 * s, 32 * s, grow, 0.5);
    }
    // back limbs
    setFill(true);
    limb(g, M(j.shoulderB), M(j.elbowB), w.upperArm[0] * s, w.upperArm[1] * s, grow);
    limb(g, M(j.elbowB), M(j.handB), w.forearm[0] * s, w.forearm[1] * s, grow);
    limb(g, M(j.hipB), M(j.kneeB), w.thigh[0] * s, w.thigh[1] * s, grow);
    limb(g, M(j.kneeB), M(j.ankleB), w.shin[0] * s, w.shin[1] * s, grow);
    limb(g, M(j.ankleB), M(j.toeB), w.shin[1] * s, w.shin[1] * 0.6 * s, grow);
    if (this.kind === 'verdict') this.pauldron(g, M, j.shoulderB, grow, -1);

    // torso, neck, head
    setFill(false);
    const up = j.up;
    const fw = { x: -up.y * this.facing, y: up.x * this.facing };
    const T = this.body.torso;
    const torso = this.body.torsoProfile.map(([f, u]) => M({ x: j.pelvis.x + (fw.x * f + up.x * u * T) * s, y: j.pelvis.y + (fw.y * f + up.y * u * T) * s }));
    poly(g, torso, grow, M({ x: j.pelvis.x + up.x * T * 0.5 * s, y: j.pelvis.y + up.y * T * 0.5 * s }));
    limb(g, M(j.pelvis), M(j.pelvis), w.hip * s, w.hip * s, grow);
    limb(g, M(j.chest), M(j.head), w.neck * s, w.neck * 0.8 * s, grow);
    const hr = this.body.headR * s;
    const h = M(j.head);
    g.fillCircle(h.x, h.y, hr + grow);
    if (this.kind === 'hero') {
      // hair mass: a cap over the skull, swept back
      const up = this.mapDir(map, j.head, j.headUp);
      const fs = this.facingMapped(map);
      const back = { x: -up.y * -fs, y: up.x * -fs };
      poly(g, [
        { x: h.x + up.x * hr * 1.15 + back.x * hr * 0.2, y: h.y + up.y * hr * 1.15 + back.y * hr * 0.2 },
        { x: h.x - back.x * hr * 0.75 + up.x * hr * 0.55, y: h.y - back.y * hr * 0.75 + up.y * hr * 0.55 },
        { x: h.x - back.x * hr * 1.0 + up.x * hr * 0.05, y: h.y - back.y * hr * 1.0 + up.y * hr * 0.05 },
        { x: h.x + back.x * hr * 1.25 - up.x * hr * 0.15, y: h.y + back.y * hr * 1.25 - up.y * hr * 0.15 },
        { x: h.x + back.x * hr * 1.0 + up.x * hr * 0.9, y: h.y + back.y * hr * 1.0 + up.y * hr * 0.9 },
      ], grow, h);
      for (let i = 1; i <= 4; i++) {
        const pts = this.strands[i].pts;
        const base = M(pts[0]);
        const tip = M(pts[pts.length - 1]);
        const nx = -(tip.y - base.y);
        const ny = tip.x - base.x;
        const nl = Math.hypot(nx, ny) || 1;
        const half = (3.2 * s) + grow;
        poly(g, [
          { x: base.x + (nx / nl) * half, y: base.y + (ny / nl) * half },
          { x: tip.x + ((tip.x - base.x) / nl) * grow, y: tip.y + ((tip.y - base.y) / nl) * grow },
          { x: base.x - (nx / nl) * half, y: base.y - (ny / nl) * half },
        ]);
      }
    } else {
      // crown of three spikes
      const up = this.mapDir(map, j.head, j.headUp);
      const fwd = { x: -up.y * this.facingMapped(map), y: up.x * this.facingMapped(map) };
      for (const [off, len, lean] of [
        [-0.6, 20, -0.35],
        [0.05, 26, -0.1],
        [0.7, 18, 0.25],
      ] as const) {
        const bx = h.x + (fwd.x * off * hr) + up.x * hr * 0.6;
        const by = h.y + (fwd.y * off * hr) + up.y * hr * 0.6;
        const tx = bx + (up.x + fwd.x * lean) * len * s;
        const ty = by + (up.y + fwd.y * lean) * len * s;
        poly(g, [
          { x: bx + fwd.x * 4 * s + fwd.x * grow, y: by + fwd.y * 4 * s + fwd.y * grow },
          { x: tx + up.x * grow, y: ty + up.y * grow },
          { x: bx - fwd.x * 4 * s - fwd.x * grow, y: by - fwd.y * 4 * s - fwd.y * grow },
        ]);
      }
    }

    // front limbs
    setFill(false);
    limb(g, M(j.hipF), M(j.kneeF), w.thigh[0] * s, w.thigh[1] * s, grow);
    limb(g, M(j.kneeF), M(j.ankleF), w.shin[0] * s, w.shin[1] * s, grow);
    limb(g, M(j.ankleF), M(j.toeF), w.shin[1] * s, w.shin[1] * 0.6 * s, grow);
    if (this.kind === 'verdict') this.cleaver(g, M, grow);
    limb(g, M(j.shoulderF), M(j.elbowF), w.upperArm[0] * s, w.upperArm[1] * s, grow);
    limb(g, M(j.elbowF), M(j.handF), w.forearm[0] * s, w.forearm[1] * s, grow);
    if (this.kind === 'verdict') this.pauldron(g, M, j.shoulderF, grow, 1);
    // handle
    limb(g, M(j.bladeBase), M(j.handF), 3.2 * s, 3.2 * s, grow);
  }

  private facingMapped(map: Mapper): number {
    const a = map({ x: 0, y: 0 });
    const b = map({ x: 1, y: 0 });
    return (b.x - a.x) * this.facing;
  }

  private mapDir(map: Mapper, origin: Vec, d: Vec): Vec {
    const a = map(origin);
    const b = map({ x: origin.x + d.x, y: origin.y + d.y });
    return { x: b.x - a.x, y: b.y - a.y };
  }

  private pauldron(g: Phaser.GameObjects.Graphics, M: Mapper, sh: Vec, grow: number, side: number): void {
    const s = this.s;
    const up = this.joints.up;
    // torso-forward (perpendicular to up, toward the facing side)
    const fw = { x: -up.y * this.facing, y: up.x * this.facing };
    const k = side > 0 ? 1 : 0.8;
    const L = (f: number, u: number): Vec => ({ x: sh.x + (fw.x * f + up.x * u) * s * k, y: sh.y + (fw.y * f + up.y * u) * s * k });
    poly(g, [L(-15, 4), L(-6, 15), L(9, 17), L(20, 7), L(17, -8), L(4, -13), L(-12, -7)].map(M), grow);
  }

  /** VERDICT's executioner cleaver. */
  private cleaver(g: Phaser.GameObjects.Graphics, M: Mapper, grow: number): void {
    const j = this.joints;
    const s = this.s;
    const bx = j.bladeTip.x - j.handF.x;
    const by = j.bladeTip.y - j.handF.y;
    const len = Math.hypot(bx, by) || 1;
    const ux = bx / len;
    const uy = by / len;
    const nx = -uy;
    const ny = ux;
    const at = (t: number, w: number): Vec => ({ x: j.handF.x + ux * len * t + nx * w * s, y: j.handF.y + uy * len * t + ny * w * s });
    const pts = [at(0.08, 3), at(0.3, 9), at(0.72, 11), at(0.93, 7), at(1.0, -2), at(0.72, -5), at(0.3, -4.5), at(0.08, -3)].map(M);
    poly(g, pts, grow);
  }

  private emissive(g: Phaser.GameObjects.Graphics, map: Mapper, a: number): void {
    const j = this.joints;
    const s = this.s;
    const st = this.style;
    const M = map;
    const fwdSign = this.facingMapped(map);
    if (this.kind === 'hero') {
      // energy katana: colored body + white core
      const base = M(j.handF);
      const tip = M(j.bladeTip);
      const e = this.energy;
      g.fillStyle(e > 0.05 ? 0xffd27a : st.rim, 0.85 * a);
      limb(g, base, tip, (this.body.bladeWidth + 1.4 + e * 2) * s, 1.2 * s, 0);
      g.fillStyle(0xffffff, a);
      limb(g, base, tip, this.body.bladeWidth * 0.5 * s, 0.6 * s, 0);
      // eye
      const h = M(j.head);
      g.fillStyle(st.eye, a);
      g.fillRect(h.x + fwdSign * 3.5 * s - 2.2 * s, h.y - 1.2 * s, 4.4 * s, 1.6 * s);
    } else {
      // visor slit + core + cleaver edge
      const h = M(j.head);
      g.fillStyle(st.eye, a);
      g.fillRect(h.x + fwdSign * 2 * s - 5 * s, h.y - 1.5 * s, 10 * s, 2.4 * s);
      const c = M({ x: (j.chest.x * 2 + j.pelvis.x) / 3, y: (j.chest.y * 2 + j.pelvis.y) / 3 });
      g.fillStyle(st.emissive, a);
      g.fillCircle(c.x, c.y, 3.4 * s);
      const bx = j.bladeTip.x - j.handF.x;
      const by = j.bladeTip.y - j.handF.y;
      const len = Math.hypot(bx, by) || 1;
      const nx = -by / len;
      const ny = bx / len;
      const e0 = M({ x: j.handF.x + bx * 0.3 + nx * 9 * s, y: j.handF.y + by * 0.3 + ny * 9 * s });
      const e1 = M({ x: j.handF.x + bx * 0.72 + nx * 11 * s, y: j.handF.y + by * 0.72 + ny * 11 * s });
      const e2 = M({ x: j.bladeTip.x - nx * 2 * s, y: j.bladeTip.y - ny * 2 * s });
      g.lineStyle(1.6 * s, st.emissive, 0.9 * a);
      g.beginPath();
      g.moveTo(e0.x, e0.y);
      g.lineTo(e1.x, e1.y);
      g.lineTo(e2.x, e2.y);
      g.strokePath();
    }
  }

  /** Halo behind VERDICT's head: a tilted ring of segments (drawn additively). */
  drawHalo(g: Phaser.GameObjects.Graphics, color: number, alpha: number): void {
    if (this.kind !== 'verdict' || !this.visible) return;
    const j = this.joints;
    const s = this.s;
    const up = j.headUp;
    const cx = j.head.x + up.x * 34 * s - this.facing * 5 * s;
    const cy = j.head.y + up.y * 34 * s;
    const rx = 36 * s;
    const ry = 9 * s;
    const tilt = -0.18 * this.facing;
    const segs = 10;
    for (let i = 0; i < segs; i++) {
      const a0 = this.haloAngle + (i / segs) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / segs - 0.25;
      const front = Math.sin((a0 + a1) / 2) > 0;
      g.lineStyle((front ? 2.8 : 1.6) * s, color, alpha * this.alpha * (front ? 1 : 0.45));
      g.beginPath();
      for (let k = 0; k <= 6; k++) {
        const a = a0 + ((a1 - a0) * k) / 6;
        const ex = Math.cos(a) * rx;
        const ey = Math.sin(a) * ry;
        const x = cx + ex * Math.cos(tilt) - ey * Math.sin(tilt);
        const y = cy + ex * Math.sin(tilt) + ey * Math.cos(tilt);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }
  }

  /** Additive blade trail (anime smear). */
  drawTrail(g: Phaser.GameObjects.Graphics, color: number): void {
    const n = this.trail.length;
    for (let i = 1; i < n; i++) {
      const p = this.trail[i - 1];
      const q = this.trail[i];
      if (!q.cont) continue;
      // a huge jump between samples means a dropped frame, not a swing: skip the slab
      if (Math.hypot(q.t.x - p.t.x, q.t.y - p.t.y) > this.body.bladeLen * this.s * 0.6) continue;
      const life = 1 - q.age / 140;
      if (life <= 0) continue;
      // the smear hugs the outer half of the blade, with a hot edge along the tip path
      const pb = { x: p.b.x + (p.t.x - p.b.x) * 0.35, y: p.b.y + (p.t.y - p.b.y) * 0.35 };
      const qb = { x: q.b.x + (q.t.x - q.b.x) * 0.35, y: q.b.y + (q.t.y - q.b.y) * 0.35 };
      g.fillStyle(color, 0.38 * life * this.alpha);
      g.beginPath();
      g.moveTo(pb.x, pb.y);
      g.lineTo(p.t.x, p.t.y);
      g.lineTo(q.t.x, q.t.y);
      g.lineTo(qb.x, qb.y);
      g.closePath();
      g.fillPath();
      g.lineStyle(2 * this.s * life, 0xffffff, 0.8 * life * this.alpha);
      g.lineBetween(p.t.x, p.t.y, q.t.x, q.t.y);
    }
  }

  /** Points of interest for effects. */
  get bladeMid(): Vec {
    const j = this.joints;
    return { x: (j.handF.x + j.bladeTip.x) / 2, y: (j.handF.y + j.bladeTip.y) / 2 };
  }

  get core(): Vec {
    const j = this.joints;
    return { x: (j.chest.x * 2 + j.pelvis.x) / 3, y: (j.chest.y * 2 + j.pelvis.y) / 3 };
  }
}

export { HERO, VERDICT };
