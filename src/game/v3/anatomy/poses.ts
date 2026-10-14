import { NEUTRAL, pose, type Pose } from './skeleton';

/**
 * Pose library. Feet are IK targets (stances stay planted), arms are FK.
 * Angles: 0 = down, π/2 = forward, π = up. Pelvis height ~51 = standing.
 */

const PI = Math.PI;

// ------------------------------------------------------------------ hero (katana, two hands)

const H_GUARD = pose({ px: 0, py: 46.5, fx: 10, bx: -11, tB: -0.25, lean: 0.14, bend: 0.06, head: -0.06, sF: 0.6, eF: 1.45, wF: 1.7, sB: 0.5, eB: 1.2, wB: 1.4, blade: 2.35, twoHand: 1 });

export const HERO = {
  guard: H_GUARD,
  breathe: pose({ py: 46, lean: 0.17, sF: 0.62, blade: 2.3 }, H_GUARD),
  low: pose({ py: 45, fx: 11, bx: -12, lean: 0.18, sF: 0.35, eF: 0.75, wF: 1.0, blade: 1.05, twoHand: 1 }, H_GUARD),
  // horizontal slash toward facing
  slashWind: pose({ px: -2, py: 45, fx: 9, bx: -13, lean: -0.05, bend: -0.1, head: 0.05, sF: 2.7, eF: 3.5, wF: 3.7, blade: 3.9, twoHand: 1 }, H_GUARD),
  slashHit: pose({ px: 8, py: 42, fx: 20, bx: -14, tB: -0.6, lean: 0.55, bend: 0.12, head: -0.1, sF: 1.65, eF: 1.55, wF: 1.5, blade: 1.55, twoHand: 1 }, H_GUARD),
  slashFollow: pose({ px: 9, py: 41, fx: 21, bx: -13, tB: -0.6, lean: 0.62, bend: 0.15, sF: 0.9, eF: 0.4, wF: 0.2, blade: 0.25, twoHand: 0.6 }, H_GUARD),
  // diagonal finishing cut (kesa)
  kesaWind: pose({ px: -2, py: 46, sF: 2.9, eF: 3.6, wF: 3.9, blade: 4.2, lean: -0.08, twoHand: 1 }, H_GUARD),
  kesaHit: pose({ px: 13, py: 40, fx: 24, bx: -15, tB: -0.7, lean: 0.75, bend: 0.2, sF: 1.1, eF: 0.75, wF: 0.6, blade: 0.6, twoHand: 1 }, H_GUARD),
  // rising cut (anti-air)
  upWind: pose({ px: 0, py: 38, fx: 11, bx: -11, tB: -0.4, lean: 0.35, bend: 0.1, head: -0.25, sF: 0.25, eF: 0.1, wF: 0.0, blade: -0.25, twoHand: 1 }, H_GUARD),
  upHit: pose({ px: 3, py: 57, fx: 9, fy: 5, bx: -9, by: 12, tF: -0.4, tB: -0.8, lean: -0.12, bend: -0.15, head: -0.55, sF: 2.95, eF: 3.1, wF: 3.2, blade: 3.2, twoHand: 1 }, H_GUARD),
  // downward cut (at a crawler)
  downWind: pose({ px: 0, py: 50, fx: 9, bx: -10, lean: -0.05, head: 0.15, sF: 3.0, eF: 3.5, wF: 3.6, blade: 3.7, twoHand: 1 }, H_GUARD),
  downHit: pose({ px: 10, py: 33, fx: 20, bx: -12, tB: -0.9, lean: 0.95, bend: 0.25, head: 0.35, sF: 0.95, eF: 0.35, wF: 0.2, blade: 0.1, twoHand: 1 }, H_GUARD),
  // parries (boss)
  parryHigh: pose({ px: -2, py: 44, fx: 9, bx: -13, lean: 0.0, bend: -0.05, head: -0.3, sF: 2.6, eF: 1.95, wF: 1.8, blade: 1.55, twoHand: 1 }, H_GUARD),
  parryLow: pose({ px: 2, py: 37, fx: 13, bx: -13, tB: -0.5, lean: 0.45, bend: 0.2, head: 0.1, sF: 0.75, eF: 0.45, wF: 0.3, blade: 0.05, twoHand: 1 }, H_GUARD),
  parryMid: pose({ px: 4, py: 44, fx: 15, bx: -12, lean: 0.3, sF: 1.35, eF: 1.75, wF: 2.0, blade: 2.15, twoHand: 1 }, H_GUARD),
  // reactions
  hit: pose({ px: -8, py: 47, fx: 6, bx: -14, lean: -0.32, bend: -0.25, head: -0.45, sF: 0.9, eF: 1.9, wF: 2.0, sB: -0.6, eB: -0.2, blade: 2.6, twoHand: 0 }, H_GUARD),
  stagger: pose({ px: -4, py: 42, fx: 9, bx: -13, lean: 0.55, bend: 0.3, head: 0.5, sF: 0.3, eF: 0.15, wF: 0.1, blade: 0.4, twoHand: 0 }, H_GUARD),
  kneel: pose({ px: 0, py: 27, fx: 14, fy: 0, bx: -10, by: 0, tF: 0, tB: -1.3, lean: 0.45, bend: 0.3, head: 0.45, sF: 0.45, eF: 0.35, wF: 0.3, sB: 0.1, eB: 0.1, wB: 0.1, blade: 1.25, twoHand: 0 }, H_GUARD),
  dash: pose({ px: 14, py: 38, fx: 26, bx: -22, tB: -0.9, lean: 0.95, bend: 0.2, head: -0.2, sF: -0.35, eF: -0.6, wF: -0.7, blade: -0.7, twoHand: 0.7 }, H_GUARD),
  land: pose({ px: 0, py: 32, fx: 15, bx: -15, tB: -0.4, lean: 0.55, bend: 0.25, head: 0.2, sF: -0.4, eF: -0.2, wF: -0.2, sB: 1.5, eB: 1.4, blade: -0.45, twoHand: 0 }, H_GUARD),
  fall: pose({ px: 0, py: 51, fx: 8, fy: 16, bx: -9, by: 7, tF: 0.3, tB: -0.4, lean: 0.25, bend: 0.1, head: -0.2, sF: 2.2, eF: 2.6, wF: 2.6, sB: -1.4, eB: -1.0, blade: 2.9, twoHand: 0 }, H_GUARD),
  victory: pose({ px: 0, py: 49.5, fx: 6, bx: -8, tB: 0, lean: 0.04, bend: 0, head: 0.22, sF: 0.5, eF: 0.32, wF: 0.3, sB: -0.05, eB: 0.1, wB: 0.1, blade: 0.42, twoHand: 0 }, H_GUARD),
  chiburi: pose({ px: 2, py: 47, fx: 10, bx: -9, lean: 0.12, head: 0.1, sF: 1.25, eF: 0.75, wF: 0.5, blade: 0.85, twoHand: 0 }, H_GUARD),
  whiff: pose({ px: 6, py: 44, fx: 18, bx: -12, tB: -0.4, lean: 0.4, sF: 1.3, eF: 0.9, wF: 0.8, blade: 0.9, twoHand: 1 }, H_GUARD),
};

// ------------------------------------------------------------------ thugs (one-handed weapon)

const T_IDLE = pose({ px: 0, py: 48, fx: 8, bx: -9, tB: -0.15, lean: 0.12, bend: 0.06, head: -0.04, sF: 0.75, eF: 1.55, wF: 1.7, sB: 0.2, eB: 0.9, wB: 1.0, blade: 2.5, twoHand: 0 });

export const THUG = {
  idle: T_IDLE,
  run: pose({ lean: 0.35, sF: 0.9, eF: 2.0, wF: 2.2, blade: 2.9 }, T_IDLE),
  wind: pose({ px: -3, py: 47, fx: 8, bx: -11, lean: -0.1, bend: -0.12, head: 0.05, sF: 2.8, eF: 3.4, wF: 3.6, sB: 1.4, eB: 1.8, blade: 3.9 }, T_IDLE),
  strike: pose({ px: 5, py: 43, fx: 16, bx: -12, tB: -0.5, lean: 0.55, bend: 0.15, head: -0.05, sF: 1.3, eF: 0.95, wF: 0.9, sB: -0.5, eB: -0.1, blade: 0.9 }, T_IDLE),
  feint: pose({ px: -1, py: 47, sF: 2.4, eF: 2.9, wF: 3.1, blade: 3.4, lean: -0.05, head: -0.1 }, T_IDLE),
  hurt: pose({ px: -7, py: 46, fx: 5, bx: -13, lean: -0.35, bend: -0.25, head: -0.5, sF: 1.4, eF: 2.4, sB: -0.8, eB: -0.4, blade: 3.2 }, T_IDLE),
  taunt: pose({ py: 49, lean: -0.08, head: -0.2, sF: 2.0, eF: 2.6, wF: 2.8, sB: 1.2, eB: 2.2, blade: 3.3 }, T_IDLE),
};

// ------------------------------------------------------------------ brute (two-handed hammer)

const B_IDLE = pose({ px: 0, py: 47, fx: 11, bx: -12, lean: 0.12, bend: 0.08, sF: 0.6, eF: 1.1, wF: 1.2, sB: 0.4, eB: 0.9, blade: 2.7, twoHand: 1 });
export const BRUTE = {
  idle: B_IDLE,
  wind: pose({ px: -4, py: 46, lean: -0.15, bend: -0.1, head: 0.05, sF: 2.9, eF: 3.4, wF: 3.6, blade: 4.1, twoHand: 1 }, B_IDLE),
  strike: pose({ px: 10, py: 40, fx: 22, bx: -14, tB: -0.5, lean: 0.75, bend: 0.2, sF: 1.0, eF: 0.55, wF: 0.5, blade: 0.6, twoHand: 1 }, B_IDLE),
  hurt: pose({ px: -6, lean: -0.25, head: -0.35, sF: 0.9, eF: 1.7, blade: 2.9, twoHand: 0.5 }, B_IDLE),
};

// ------------------------------------------------------------------ ninja (dual tanto)

const N_IDLE = pose({ px: 0, py: 41, fx: 13, bx: -13, tB: -0.5, lean: 0.4, bend: 0.12, head: -0.15, sF: 1.3, eF: 1.9, wF: 2.0, sB: 0.4, eB: -0.2, wB: -0.4, blade: 1.9 });
export const NINJA = {
  idle: N_IDLE,
  wind: pose({ px: -3, py: 39, sF: 2.4, eF: 3.1, wF: 3.3, sB: -0.6, eB: -1.0, blade: 3.6 }, N_IDLE),
  strike: pose({ px: 12, py: 38, fx: 25, bx: -14, lean: 0.75, sF: 1.6, eF: 1.5, wF: 1.4, sB: 1.2, eB: 1.4, blade: 1.4 }, N_IDLE),
  blink: pose({ px: 0, py: 34, fx: 14, bx: -16, lean: 0.9, head: 0.1, sF: -0.6, eF: -0.8, sB: -0.8, eB: -1.0, blade: -0.9 }, N_IDLE),
};

// ------------------------------------------------------------------ duelist (naginata, feints)

const D_IDLE = pose({ px: 0, py: 47, fx: 12, bx: -12, lean: 0.08, sF: 0.9, eF: 1.5, wF: 1.6, sB: 0.6, eB: 1.3, blade: 1.95, twoHand: 1 });
export const DUELIST = {
  idle: D_IDLE,
  feint: pose({ px: 2, py: 45, lean: 0.15, sF: 1.9, eF: 2.6, wF: 2.7, blade: 2.9, twoHand: 1 }, D_IDLE),
  wind: pose({ px: -3, py: 45, lean: -0.1, sF: 2.6, eF: 3.2, wF: 3.4, blade: 3.8, twoHand: 1 }, D_IDLE),
  strike: pose({ px: 12, py: 41, fx: 24, bx: -14, tB: -0.5, lean: 0.55, sF: 1.4, eF: 1.3, wF: 1.3, blade: 1.25, twoHand: 1 }, D_IDLE),
};

// ------------------------------------------------------------------ leaper (claws, acrobat)

const L_IDLE = pose({ px: 0, py: 36, fx: 13, bx: -12, tF: 0, tB: -0.8, lean: 0.75, bend: 0.25, head: -0.35, sF: 1.6, eF: 1.9, wF: 1.8, sB: 0.6, eB: 1.2, wB: 1.2, blade: 1.8 });
export const LEAPER = {
  idle: L_IDLE,
  crouch: pose({ py: 30, lean: 0.95, head: -0.5, sF: 0.6, eF: 0.5, sB: 0.4, eB: 0.3 }, L_IDLE),
  air: pose({ px: 0, py: 51, fx: 10, fy: 12, bx: -10, by: 14, tF: 0.4, tB: -0.6, lean: 0.4, bend: 0.2, head: -0.2, sF: 2.6, eF: 2.4, wF: 2.4, sB: 2.2, eB: 2.0, blade: 2.4 }, L_IDLE),
  dive: pose({ px: 0, py: 51, fx: 4, fy: 18, bx: -6, by: 20, lean: 0.25, head: 0.4, sF: 0.6, eF: 0.4, wF: 0.3, sB: 0.4, eB: 0.2, blade: 0.3 }, L_IDLE),
};

// ------------------------------------------------------------------ crawler (all fours)

const C_IDLE = pose({ px: 0, py: 22, fx: 12, fy: 0, bx: -10, by: 0, tF: -0.6, tB: -1.0, lean: 1.45, bend: 0.2, head: -0.9, sF: 1.25, eF: 0.4, wF: 0.6, sB: 1.0, eB: 0.2, wB: 0.4, blade: 1.0 });
export const CRAWLER = {
  idle: C_IDLE,
  lunge: pose({ px: 10, py: 26, lean: 1.3, head: -1.1, sF: 1.9, eF: 1.8, wF: 1.8, sB: 1.7, eB: 1.6, blade: 1.8 }, C_IDLE),
};

// ------------------------------------------------------------------ gunner (rifle)

const G_IDLE = pose({ px: 0, py: 49, fx: 9, bx: -10, lean: 0.08, head: 0.05, sF: 1.2, eF: 1.65, wF: 1.6, sB: 0.6, eB: 1.45, blade: 1.57, twoHand: 1 });
export const GUNNER = {
  idle: pose({ sF: 0.6, eF: 1.0, wF: 1.0, blade: 1.0 }, G_IDLE),
  aim: G_IDLE,
  recoil: pose({ px: -3, lean: -0.08, head: -0.1, sF: 1.35, eF: 1.95, wF: 1.9, blade: 1.85, twoHand: 1 }, G_IDLE),
};

// ------------------------------------------------------------------ butcher (chainsaw)

const BU_IDLE = pose({ px: 0, py: 46, fx: 12, bx: -12, lean: 0.06, bend: 0.0, head: 0.0, sF: 0.95, eF: 1.35, wF: 1.4, sB: 0.7, eB: 1.2, blade: 1.75, twoHand: 1 });
export const BUTCHER = {
  idle: BU_IDLE,
  rev: pose({ lean: -0.15, head: -0.35, sF: 2.2, eF: 2.6, wF: 2.7, blade: 2.9 }, BU_IDLE),
  wind: pose({ px: -4, lean: -0.2, sF: 2.8, eF: 3.3, wF: 3.4, blade: 3.9 }, BU_IDLE),
  strike: pose({ px: 12, py: 40, fx: 24, bx: -14, lean: 0.7, sF: 1.1, eF: 0.75, wF: 0.7, blade: 0.8 }, BU_IDLE),
  hurt: pose({ px: -6, lean: -0.3, head: -0.4, sF: 1.6, eF: 2.2, blade: 2.4 }, BU_IDLE),
};

// ------------------------------------------------------------------ VERDICT (cleaver)

const V_IDLE = pose({ px: 0, py: 47, fx: 12, bx: -13, tB: -0.2, lean: 0.12, bend: 0.06, head: 0.08, sF: 2.55, eF: 3.75, wF: 3.85, sB: 0.45, eB: 0.7, wB: 0.7, blade: 3.95, twoHand: 0 });
export const VERDICT = {
  idle: V_IDLE,
  guard: pose({ sF: 1.0, eF: 1.6, wF: 1.7, sB: 0.7, eB: 1.4, blade: 2.4, twoHand: 1 }, V_IDLE),
  windHigh: pose({ px: -4, py: 48, lean: -0.15, bend: -0.12, head: -0.1, sF: 3.05, eF: 3.6, wF: 3.7, blade: 4.3, twoHand: 1 }, V_IDLE),
  strikeHigh: pose({ px: 14, py: 41, fx: 25, bx: -14, tB: -0.5, lean: 0.6, bend: 0.25, head: 0.1, sF: 1.55, eF: 1.35, wF: 1.3, blade: 1.2, twoHand: 1 }, V_IDLE),
  windLow: pose({ px: -4, py: 42, lean: 0.35, sF: -0.4, eF: -0.6, wF: -0.7, sB: -0.2, eB: 0.2, blade: -1.1, twoHand: 0.6 }, V_IDLE),
  strikeLow: pose({ px: 14, py: 33, fx: 26, bx: -14, tB: -0.8, lean: 0.85, bend: 0.25, head: 0.25, sF: 1.05, eF: 1.35, wF: 1.45, blade: 1.6, twoHand: 0.6 }, V_IDLE),
  windThrust: pose({ px: -5, py: 44, lean: -0.05, sF: 0.6, eF: 1.9, wF: 1.75, blade: 1.62, twoHand: 1 }, V_IDLE),
  strikeThrust: pose({ px: 18, py: 41, fx: 28, bx: -15, tB: -0.6, lean: 0.55, sF: 1.55, eF: 1.6, wF: 1.6, blade: 1.6, twoHand: 1 }, V_IDLE),
  feint: pose({ px: 3, py: 46, lean: 0.12, sF: 2.1, eF: 2.4, wF: 2.6, blade: 2.8, twoHand: 1 }, V_IDLE),
  hurt: pose({ px: -8, py: 46, lean: -0.3, head: -0.4, sF: 1.3, eF: 2.2, blade: 3.2, twoHand: 0.5 }, V_IDLE),
  roar: pose({ py: 50, lean: -0.3, bend: -0.2, head: -0.6, sF: 2.4, eF: 2.2, wF: 2.0, sB: 2.4, eB: 2.2, wB: 2.0, blade: 3.0, twoHand: 0 }, V_IDLE),
  broken: pose({ px: -2, py: 27, fx: 12, bx: -12, tB: -1.3, lean: 0.55, bend: 0.3, head: 0.5, sF: 0.6, eF: 0.4, wF: 0.3, sB: 0.2, eB: 0.1, blade: 1.25, twoHand: 0 }, V_IDLE),
};

// ------------------------------------------------------------------ cameos

export const CLEANER = {
  idle: pose({ py: 50, fx: 6, bx: -8, lean: 0.03, head: 0.05, sF: 0.1, eF: 0.15, wF: 0.2, sB: 0.0, eB: 0.1, blade: 0.25 }),
  aim: pose({ py: 49, fx: 9, bx: -10, lean: 0.02, head: 0.02, sF: 1.55, eF: 1.57, wF: 1.57, sB: 1.45, eB: 1.55, wB: 1.55, blade: 1.57 }),
  aimUp: pose({ py: 49, fx: 9, bx: -10, lean: -0.05, head: -0.25, sF: 2.1, eF: 2.15, wF: 2.15, sB: 2.0, eB: 2.1, wB: 2.1, blade: 2.15 }),
  recoil: pose({ py: 49, fx: 9, bx: -10, lean: -0.04, head: -0.02, sF: 1.75, eF: 1.9, wF: 1.95, sB: 1.65, eB: 1.85, wB: 1.85, blade: 1.95 }),
};

export const FOX = {
  idle: pose({ py: 44, fx: 12, bx: -11, tB: -0.3, lean: 0.25, head: -0.05, sF: 1.0, eF: 1.6, wF: 1.7, sB: 0.3, eB: 0.6, blade: 2.1 }),
  throw: pose({ px: 8, py: 43, fx: 20, bx: -12, lean: 0.45, sF: 1.75, eF: 1.7, wF: 1.7, sB: -0.5, eB: -0.2, blade: 1.6 }),
};

export const RONIN = {
  idle: pose({ py: 47, fx: 10, bx: -11, lean: 0.08, head: 0.12, sF: 0.5, eF: 0.9, wF: 1.0, sB: 0.4, eB: 0.8, blade: 0.4, twoHand: 1 }),
  iai: pose({ px: 16, py: 40, fx: 26, bx: -16, tB: -0.7, lean: 0.55, sF: 1.6, eF: 1.55, wF: 1.5, blade: 1.55, twoHand: 0 }),
};

/** Procedural run/walk cycle (feet trace a stride ellipse, arms counter-swing). */
export function runCycle(base: Pose, phase: number, stride: number, lift: number, out: Pose = { ...NEUTRAL }): Pose {
  const a = phase * PI * 2;
  Object.assign(out, base);
  out.fx = base.fx * 0.3 + Math.sin(a) * stride;
  out.fy = Math.max(0, Math.cos(a)) * lift;
  out.bx = base.bx * 0.3 - Math.sin(a) * stride;
  out.by = Math.max(0, -Math.cos(a)) * lift;
  out.tF = out.fy > 0.5 ? 0.35 : -0.1;
  out.tB = out.by > 0.5 ? 0.35 : -0.1;
  out.py = base.py - 1.5 + Math.abs(Math.sin(a)) * 2.5;
  out.sB = base.sB + Math.sin(a) * 0.7;
  if (base.twoHand < 0.5) out.sF = base.sF - Math.sin(a) * 0.35;
  out.head = base.head - Math.sin(a * 2) * 0.03;
  return out;
}
