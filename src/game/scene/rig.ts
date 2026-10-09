import type Phaser from 'phaser';

/**
 * Procedural skeletal rig for side-view silhouette fighters.
 *
 * Angles are absolute in the fighter's local frame (facing right):
 *   dir(a) = (sin a, cos a)  →  0 = down, +π/2 = forward, π = up, −π/2 = back.
 * The torso uses `lean` (0 upright, + forward). Facing −1 mirrors x.
 */
export interface Pose {
  x: number;
  y: number;
  lean: number;
  head: number;
  sF: number;
  eF: number;
  sB: number;
  eB: number;
  hF: number;
  kF: number;
  hB: number;
  kB: number;
  blade: number;
}

export const POSE_KEYS: (keyof Pose)[] = ['x', 'y', 'lean', 'head', 'sF', 'eF', 'sB', 'eB', 'hF', 'kF', 'hB', 'kB', 'blade'];

export interface Body {
  thigh: number;
  shin: number;
  foot: number;
  torso: number;
  shoulderAt: number;
  neck: number;
  headR: number;
  upperArm: number;
  forearm: number;
  bladeLen: number;
  bladeWidth: number;
  handle: number;
  /** Side-view torso outline: [forward, up-fraction of torso length] pairs, back side first. */
  torsoProfile: [number, number][];
  w: {
    chest: number;
    waist: number;
    hip: number;
    thigh: [number, number];
    shin: [number, number];
    upperArm: [number, number];
    forearm: [number, number];
    neck: number;
  };
}

export const HERO_BODY: Body = {
  thigh: 30,
  shin: 30,
  foot: 11,
  torso: 40,
  shoulderAt: 35,
  neck: 6,
  headR: 9.5,
  upperArm: 23,
  forearm: 21,
  bladeLen: 66,
  bladeWidth: 2.6,
  handle: 9,
  torsoProfile: [[-6, -0.05], [-7.5, 0.35], [-7, 0.75], [-4.5, 1.0], [1, 1.06], [6.5, 0.92], [8.5, 0.7], [5.5, 0.38], [6, -0.05]],
  w: { chest: 23, waist: 14, hip: 16, thigh: [12.5, 8.5], shin: [8.5, 5.5], upperArm: [8.5, 6], forearm: [6.5, 5], neck: 6.5 },
};

export const VERDICT_BODY: Body = {
  thigh: 38,
  shin: 38,
  foot: 15,
  torso: 54,
  shoulderAt: 48,
  neck: 9,
  headR: 11.5,
  upperArm: 31,
  forearm: 29,
  bladeLen: 112,
  bladeWidth: 9,
  handle: 14,
  torsoProfile: [[-11, -0.05], [-14, 0.4], [-13, 0.82], [-6, 1.02], [3, 1.08], [14, 0.95], [19, 0.7], [13, 0.4], [11, 0.05], [3, -0.12]],
  w: { chest: 48, waist: 27, hip: 28, thigh: [21, 13], shin: [14, 10], upperArm: [16, 11], forearm: [12.5, 10], neck: 12 },
};

export interface Vec {
  x: number;
  y: number;
}

export interface Joints {
  pelvis: Vec;
  chest: Vec;
  neck: Vec;
  head: Vec;
  shoulderF: Vec;
  shoulderB: Vec;
  elbowF: Vec;
  handF: Vec;
  elbowB: Vec;
  handB: Vec;
  hipF: Vec;
  hipB: Vec;
  kneeF: Vec;
  ankleF: Vec;
  toeF: Vec;
  kneeB: Vec;
  ankleB: Vec;
  toeB: Vec;
  bladeBase: Vec;
  bladeTip: Vec;
  /** Unit "up" of the torso and of the head (for attachments). */
  up: Vec;
  headUp: Vec;
}

const dir = (a: number, facing: number): Vec => ({ x: Math.sin(a) * facing, y: Math.cos(a) });
const add = (p: Vec, d: Vec, k: number): Vec => ({ x: p.x + d.x * k, y: p.y + d.y * k });

/** Forward kinematics. `root` = ground point under the fighter, `s` = px per unit. */
export function solve(body: Body, pose: Pose, root: Vec, facing: number, s: number, grounded = true): Joints {
  // Leg drop decides how high the pelvis sits so the lowest foot touches the ground.
  const legDrop = (h: number, k: number) => Math.cos(h) * body.thigh + Math.cos(k) * body.shin;
  const drop = Math.max(legDrop(pose.hF, pose.kF), legDrop(pose.hB, pose.kB), 10);
  const pelvis: Vec = {
    x: root.x + pose.x * facing * s,
    y: root.y - (grounded ? drop : body.thigh + body.shin) * s + pose.y * s,
  };
  const up: Vec = { x: Math.sin(pose.lean) * facing, y: -Math.cos(pose.lean) };
  const chest = add(pelvis, up, body.torso * s);
  const shoulder = add(pelvis, up, body.shoulderAt * s);
  const headUp: Vec = { x: Math.sin(pose.lean + pose.head) * facing, y: -Math.cos(pose.lean + pose.head) };
  const neck = add(chest, up, body.neck * 0.5 * s);
  const head = add(neck, headUp, (body.neck * 0.5 + body.headR) * s);
  const side: Vec = { x: -up.y * facing, y: up.x * facing }; // perpendicular, toward "forward"
  const shoulderF = add(shoulder, side, 2 * s);
  const shoulderB = add(shoulder, side, -3 * s);
  const elbowF = add(shoulderF, dir(pose.sF, facing), body.upperArm * s);
  const handF = add(elbowF, dir(pose.eF, facing), body.forearm * s);
  const elbowB = add(shoulderB, dir(pose.sB, facing), body.upperArm * s);
  const handB = add(elbowB, dir(pose.eB, facing), body.forearm * s);
  const hipF = add(pelvis, { x: facing, y: 0 }, 2 * s);
  const hipB = add(pelvis, { x: facing, y: 0 }, -2.5 * s);
  const kneeF = add(hipF, dir(pose.hF, facing), body.thigh * s);
  const ankleF = add(kneeF, dir(pose.kF, facing), body.shin * s);
  const kneeB = add(hipB, dir(pose.hB, facing), body.thigh * s);
  const ankleB = add(kneeB, dir(pose.kB, facing), body.shin * s);
  const footDir = (k: number) => dir(Math.PI / 2 + Math.max(-0.6, Math.min(0.6, (k + 0.1) * 0.6)), facing);
  const toeF = add(ankleF, footDir(pose.kF), body.foot * s);
  const toeB = add(ankleB, footDir(pose.kB), body.foot * s);
  const bd = dir(pose.blade, facing);
  const bladeBase = add(handF, bd, -body.handle * 0.4 * s);
  const bladeTip = add(handF, bd, body.bladeLen * s);
  return { pelvis, chest, neck, head, shoulderF, shoulderB, elbowF, handF, elbowB, handB, hipF, hipB, kneeF, ankleF, toeF, kneeB, ankleB, toeB, bladeBase, bladeTip, up, headUp };
}

export function lerpPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export const clonePose = (p: Pose): Pose => ({ ...p });

// ---------------------------------------------------------------- drawing primitives

/** Tapered capsule between two points (filled). `grow` thickens it (outline passes). */
export function limb(g: Phaser.GameObjects.Graphics, a: Vec, b: Vec, wa: number, wb: number, grow: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const ra = wa / 2 + grow;
  const rb = wb / 2 + grow;
  g.beginPath();
  g.moveTo(a.x + nx * ra, a.y + ny * ra);
  g.lineTo(b.x + nx * rb, b.y + ny * rb);
  g.lineTo(b.x - nx * rb, b.y - ny * rb);
  g.lineTo(a.x - nx * ra, a.y - ny * ra);
  g.closePath();
  g.fillPath();
  g.fillCircle(a.x, a.y, ra);
  g.fillCircle(b.x, b.y, rb);
}

export function poly(g: Phaser.GameObjects.Graphics, pts: Vec[], grow = 0, center?: Vec): void {
  if (pts.length < 3) return;
  let c = center;
  if (!c) {
    c = { x: 0, y: 0 };
    for (const p of pts) {
      c.x += p.x / pts.length;
      c.y += p.y / pts.length;
    }
  }
  g.beginPath();
  pts.forEach((p, i) => {
    let x = p.x;
    let y = p.y;
    if (grow) {
      const dx = p.x - c!.x;
      const dy = p.y - c!.y;
      const d = Math.hypot(dx, dy) || 1;
      x += (dx / d) * grow;
      y += (dy / d) * grow;
    }
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.closePath();
  g.fillPath();
}

// ---------------------------------------------------------------- verlet cloth strands

export class Strand {
  readonly pts: { x: number; y: number; px: number; py: number }[] = [];

  constructor(
    count: number,
    private readonly segLen: number,
    x: number,
    y: number,
  ) {
    for (let i = 0; i < count; i++) this.pts.push({ x, y: y + i * segLen, px: x, py: y + i * segLen });
  }

  reset(x: number, y: number): void {
    this.pts.forEach((p, i) => {
      p.x = p.px = x;
      p.y = p.py = y + i * this.segLen;
    });
  }

  /** Pin the first point and integrate the rest. Wind is in px/s². */
  step(anchor: Vec, dt: number, gravity: number, windX: number, windY: number, damping = 0.92, segLen = this.segLen): void {
    const d = Math.min(dt, 0.033);
    const p0 = this.pts[0];
    p0.px = p0.x = anchor.x;
    p0.py = p0.y = anchor.y;
    for (let i = 1; i < this.pts.length; i++) {
      const p = this.pts[i];
      const vx = (p.x - p.px) * damping;
      const vy = (p.y - p.py) * damping;
      p.px = p.x;
      p.py = p.y;
      p.x += vx + windX * d * d;
      p.y += vy + (gravity + windY) * d * d;
    }
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 1; i < this.pts.length; i++) {
        const a = this.pts[i - 1];
        const b = this.pts[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const diff = (dist - segLen) / dist;
        if (i === 1) {
          b.x -= dx * diff;
          b.y -= dy * diff;
        } else {
          a.x += dx * diff * 0.5;
          a.y += dy * diff * 0.5;
          b.x -= dx * diff * 0.5;
          b.y -= dy * diff * 0.5;
        }
      }
      this.pts[0].x = anchor.x;
      this.pts[0].y = anchor.y;
    }
  }

  /** Filled ribbon along the strand, width tapering from w0 to w1. */
  ribbon(g: Phaser.GameObjects.Graphics, w0: number, w1: number, grow = 0, jagged = 0): void {
    ribbon(g, this.pts, w0, w1, grow, jagged);
  }
}

/** Filled ribbon through points, width tapering from w0 to w1 (optional jagged tail). */
export function ribbon(g: Phaser.GameObjects.Graphics, pts: Vec[], w0: number, w1: number, grow = 0, jagged = 0): void {
  const n = pts.length;
  if (n < 2) return;
  const left: Vec[] = [];
  const right: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[Math.min(n - 1, i + 1)];
    const o = pts[Math.max(0, i - 1)];
    const dx = q.x - o.x;
    const dy = q.y - o.y;
    const len = Math.hypot(dx, dy) || 1;
    const t = i / (n - 1);
    let w = (w0 + (w1 - w0) * t) / 2 + grow;
    if (jagged && i > n / 2) w *= i % 2 ? 1 : 1 - jagged;
    left.push({ x: p.x - (dy / len) * w, y: p.y + (dx / len) * w });
    right.push({ x: p.x + (dy / len) * w, y: p.y - (dx / len) * w });
  }
  g.beginPath();
  g.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < n; i++) g.lineTo(left[i].x, left[i].y);
  for (let i = n - 1; i >= 0; i--) g.lineTo(right[i].x, right[i].y);
  g.closePath();
  g.fillPath();
}
