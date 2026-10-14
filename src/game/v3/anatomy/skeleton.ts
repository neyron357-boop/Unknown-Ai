/**
 * Side-view humanoid skeleton: pelvis + feet IK for grounded stances, FK for spine, head and arms.
 *
 * Units are "body units" (an adult is ~100 tall); `s` converts to pixels. y grows downward.
 * Absolute angles in the character frame (facing right): dir(a) = (sin a, cos a)
 *   0 = down, +π/2 = forward, π = up, −π/2 = back. `facing` −1 mirrors x.
 */

export interface Vec {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerpV = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const norm = (a: Vec): Vec => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
/** Perpendicular pointing to the left of the direction (screen coords). */
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });

/** Unit vector for an absolute body angle. */
export function dir(angle: number, facing: number): Vec {
  return { x: Math.sin(angle) * facing, y: Math.cos(angle) };
}

/** Inverse of `dir` for a vector in screen space. */
export function angleOf(d: Vec, facing: number): number {
  return Math.atan2(d.x * facing, d.y);
}

export interface Body {
  /** Pelvis → lower spine → chest → neck base. */
  spineLow: number;
  spineHigh: number;
  chestToNeck: number;
  neck: number;
  headR: number;
  upperArm: number;
  forearm: number;
  hand: number;
  thigh: number;
  shin: number;
  ankle: number;
  foot: number;
  /** Shoulder offset forward/back from the spine line (depth cue in profile). */
  shoulderFwd: number;
  shoulderDown: number;
  hipOff: number;
  /** Weapon: grip → tip, and handle length behind the grip. */
  bladeLen: number;
  handleLen: number;
}

export type ArmGrip = 'one' | 'two';

export interface Pose {
  /** Pelvis relative to the root (ground point): forward and height above ground. */
  px: number;
  py: number;
  /** Ankle IK targets relative to the root (forward, height above ground). */
  fx: number;
  fy: number;
  bx: number;
  by: number;
  /** Foot pitch (+ toes up). */
  tF: number;
  tB: number;
  /** Torso lean (+ forward), extra chest bend, head tilt (+ chin down/forward). */
  lean: number;
  bend: number;
  head: number;
  /** Arm angles (absolute). */
  sF: number;
  eF: number;
  wF: number;
  sB: number;
  eB: number;
  wB: number;
  /** Weapon angle (absolute). */
  blade: number;
  /** 1 = both hands on the handle (back arm solved by IK). */
  twoHand: number;
}

export const POSE_KEYS = ['px', 'py', 'fx', 'fy', 'bx', 'by', 'tF', 'tB', 'lean', 'bend', 'head', 'sF', 'eF', 'wF', 'sB', 'eB', 'wB', 'blade', 'twoHand'] as const satisfies readonly (keyof Pose)[];

export type JointName =
  | 'root'
  | 'pelvis'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'shoulderF'
  | 'elbowF'
  | 'wristF'
  | 'handF'
  | 'shoulderB'
  | 'elbowB'
  | 'wristB'
  | 'handB'
  | 'hipF'
  | 'kneeF'
  | 'ankleF'
  | 'toeF'
  | 'hipB'
  | 'kneeB'
  | 'ankleB'
  | 'toeB'
  | 'grip'
  | 'tip'
  | 'pommel';

export type Joints = Record<JointName, Vec>;

export interface Frame {
  j: Joints;
  /** Torso up vector (unit, screen space). */
  up: Vec;
  /** Head up vector. */
  headUp: Vec;
  facing: number;
  s: number;
  /** Ragdoll splits: duplicated cut points (drawn as separate pieces). */
  cut?: {
    /** Waist cut: the upper half's own copy of the lower-spine point. */
    spineUpper?: Vec;
    /** Neck cut: the head's own copy of the neck base. */
    neckHead?: Vec;
    /** Severed limbs keep drawing between their own particles. */
    armF?: boolean;
    armB?: boolean;
    legF?: boolean;
    legB?: boolean;
  };
}

/** Two-bone IK in screen space. Returns the middle joint; `bendSign` picks the bend side. */
export function ik2(a: Vec, target: Vec, l1: number, l2: number, bendSign: number): { mid: Vec; end: Vec } {
  const d = sub(target, a);
  let dd = len(d);
  const maxReach = l1 + l2 - 1e-4;
  const minReach = Math.abs(l1 - l2) + 1e-4;
  const n = norm(d);
  dd = Math.max(minReach, Math.min(maxReach, dd));
  const end = add(a, mul(n, dd));
  // law of cosines
  const cosA = (l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd);
  const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const base = Math.atan2(n.y, n.x);
  const t = base + ang * bendSign;
  const mid = { x: a.x + Math.cos(t) * l1, y: a.y + Math.sin(t) * l1 };
  return { mid, end };
}

/**
 * Solves the pose into screen-space joints.
 * root = ground point under the character (px), s = pixels per unit.
 */
export function solve(body: Body, p: Pose, root: Vec, facing: number, s: number): Frame {
  const F = (fwd: number, upAmt: number): Vec => ({ x: root.x + fwd * facing * s, y: root.y - upAmt * s });
  const pelvis = F(p.px, p.py);
  const up = dir(Math.PI - p.lean, facing); // lean 0 → straight up
  const spine = add(pelvis, mul(up, body.spineLow * s));
  const upChest = dir(Math.PI - p.lean - p.bend, facing);
  const chest = add(spine, mul(upChest, body.spineHigh * s));
  const neck = add(chest, mul(upChest, body.chestToNeck * s));
  const headUp = dir(Math.PI - p.lean - p.bend - p.head, facing);
  const head = add(neck, mul(headUp, (body.neck + body.headR) * s));

  // forward perpendicular of the chest (screen space): up rotated 90° toward the facing side
  const fwd = { x: -upChest.y * facing, y: upChest.x * facing };
  const shoulderBase = add(chest, mul(upChest, -body.shoulderDown * s));
  const shoulderF = add(shoulderBase, mul(fwd, body.shoulderFwd * s));
  const shoulderB = add(shoulderBase, mul(fwd, -body.shoulderFwd * 0.6 * s));

  const elbowF = add(shoulderF, mul(dir(p.sF, facing), body.upperArm * s));
  const wristF = add(elbowF, mul(dir(p.eF, facing), body.forearm * s));
  const handF = add(wristF, mul(dir(p.wF, facing), body.hand * s));
  const grip = add(wristF, mul(dir(p.wF, facing), body.hand * 0.45 * s));
  const bladeDir = dir(p.blade, facing);
  const tip = add(grip, mul(bladeDir, body.bladeLen * s));
  const pommel = add(grip, mul(bladeDir, -body.handleLen * s));

  let elbowB: Vec;
  let wristB: Vec;
  let handB: Vec;
  if (p.twoHand > 0.01) {
    // back hand on the handle behind the front hand
    const target = lerpV(add(grip, mul(bladeDir, -body.handleLen * 0.62 * s)), add(add(shoulderB, mul(dir(p.sB, facing), body.upperArm * s)), mul(dir(p.eB, facing), body.forearm * s)), 1 - p.twoHand);
    const sol = ik2(shoulderB, target, body.upperArm * s, body.forearm * s, facing > 0 ? 1 : -1);
    elbowB = sol.mid;
    wristB = sol.end;
    handB = add(wristB, mul(bladeDir, body.hand * 0.6 * s));
  } else {
    elbowB = add(shoulderB, mul(dir(p.sB, facing), body.upperArm * s));
    wristB = add(elbowB, mul(dir(p.eB, facing), body.forearm * s));
    handB = add(wristB, mul(dir(p.wB, facing), body.hand * s));
  }

  // legs: hips slightly apart in depth, knees bend forward
  const hipF = add(pelvis, mul(fwd, body.hipOff * 0.5 * s));
  const hipB = add(pelvis, mul(fwd, -body.hipOff * 0.5 * s));
  const ankleTargetF = F(p.fx, p.fy + body.ankle);
  const ankleTargetB = F(p.bx, p.by + body.ankle);
  // bend sign: knee toward facing
  const bend = facing > 0 ? -1 : 1;
  const legF = ik2(hipF, ankleTargetF, body.thigh * s, body.shin * s, bend);
  const legB = ik2(hipB, ankleTargetB, body.thigh * s, body.shin * s, bend);
  const toeF = add(legF.end, mul(dir(Math.PI / 2 + p.tF, facing), body.foot * s));
  const toeB = add(legB.end, mul(dir(Math.PI / 2 + p.tB, facing), body.foot * s));

  return {
    j: {
      root,
      pelvis,
      spine,
      chest,
      neck,
      head,
      shoulderF,
      elbowF,
      wristF,
      handF,
      shoulderB,
      elbowB,
      wristB,
      handB,
      hipF,
      kneeF: legF.mid,
      ankleF: legF.end,
      toeF,
      hipB,
      kneeB: legB.mid,
      ankleB: legB.end,
      toeB,
      grip,
      tip,
      pommel,
    },
    up: upChest,
    headUp,
    facing,
    s,
  };
}

export function lerpPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export const clonePose = (p: Pose): Pose => ({ ...p });

/** A neutral pose to build others from. */
export const NEUTRAL: Pose = {
  px: 0,
  py: 51,
  fx: 6,
  fy: 0,
  bx: -6,
  by: 0,
  tF: 0,
  tB: 0,
  lean: 0.05,
  bend: 0,
  head: 0,
  sF: 0.15,
  eF: 0.3,
  wF: 0.4,
  sB: -0.1,
  eB: 0.15,
  wB: 0.1,
  blade: 0.6,
  twoHand: 0,
};

export function pose(over: Partial<Pose>, base: Pose = NEUTRAL): Pose {
  return { ...base, ...over };
}
