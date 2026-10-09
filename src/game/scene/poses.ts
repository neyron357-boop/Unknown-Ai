import type { Pose } from './rig';

/** Hand-authored keyframes. See rig.ts for the angle convention. */
const P = (p: Partial<Pose>, base: Pose): Pose => ({ ...base, ...p });

const HERO_BASE: Pose = {
  x: 0,
  y: 0,
  lean: 0.12,
  head: -0.05,
  sF: 0.75,
  eF: 1.75,
  sB: 0.55,
  eB: 1.6,
  hF: 0.55,
  kF: -0.1,
  hB: -0.5,
  kB: -0.2,
  blade: 2.1,
};

export const HERO = {
  idle: HERO_BASE,
  ready: P({ lean: 0.2, sF: 0.95, eF: 1.9, blade: 2.25, hF: 0.7, kF: -0.25, hB: -0.6, kB: -0.3 }, HERO_BASE),
  parry: P({ x: 4, lean: 0.28, head: -0.1, sF: 1.25, eF: 2.55, sB: 0.95, eB: 2.35, blade: 3.05, hF: 0.85, kF: -0.25, hB: -0.7, kB: -0.35 }, HERO_BASE),
  counter: P({ x: 36, lean: 0.55, head: 0, sF: 1.95, eF: 1.7, sB: 1.2, eB: 1.5, blade: 1.15, hF: 1.15, kF: 0.1, hB: -0.95, kB: -0.4 }, HERO_BASE),
  duck: P({ x: -4, lean: 0.62, head: 0.28, sF: 2.25, eF: 2.55, sB: 1.85, eB: 2.6, blade: 1.75, hF: 1.45, kF: 0.05, hB: 0.42, kB: -1.45 }, HERO_BASE),
  jump: P({ y: -62, lean: 0.15, head: -0.1, sF: 2.4, eF: 2.9, sB: 1.9, eB: 2.6, blade: 2.95, hF: 1.75, kF: 0.25, hB: 1.2, kB: -0.55 }, HERO_BASE),
  land: P({ lean: 0.35, sF: 1.0, eF: 1.9, blade: 2.0, hF: 1.0, kF: -0.35, hB: -0.6, kB: -0.6 }, HERO_BASE),
  // three-hit combo: windup / cut pairs
  aWind: P({ x: 30, lean: 0.2, sF: 2.65, eF: 3.4, sB: 2.3, eB: 3.1, blade: 3.95, hF: 0.8, kF: -0.2, hB: -0.6, kB: -0.3 }, HERO_BASE),
  aCut: P({ x: 84, lean: 0.58, head: 0.05, sF: 1.4, eF: 1.15, sB: 1.0, eB: 1.0, blade: 0.55, hF: 1.05, kF: -0.1, hB: -0.95, kB: -0.3 }, HERO_BASE),
  bWind: P({ x: 70, lean: 0.45, sF: 0.15, eF: -0.35, sB: 0.2, eB: -0.2, blade: -1.1, hF: 1.1, kF: -0.3, hB: -0.8, kB: -0.5 }, HERO_BASE),
  bCut: P({ x: 88, y: -8, lean: 0.15, head: -0.15, sF: 2.55, eF: 2.85, sB: 2.2, eB: 2.7, blade: 3.05, hF: 0.6, kF: 0.0, hB: -0.6, kB: -0.15 }, HERO_BASE),
  cWind: P({ x: 70, y: -46, lean: 0.05, head: -0.2, sF: 3.0, eF: 3.6, sB: 2.8, eB: 3.4, blade: 4.25, hF: 1.5, kF: 0.4, hB: 0.9, kB: -0.4 }, HERO_BASE),
  cCut: P({ x: 92, lean: 0.75, head: 0.15, sF: 1.25, eF: 0.9, sB: 1.0, eB: 0.8, blade: 0.9, hF: 1.35, kF: 0.1, hB: -1.0, kB: -0.55 }, HERO_BASE),
  hit: P({ x: -16, lean: -0.38, head: -0.45, sF: 0.55, eF: 0.9, sB: -0.7, eB: -0.25, blade: 1.25, hF: 0.25, kF: 0.2, hB: -0.3, kB: -0.1 }, HERO_BASE),
  stagger: P({ x: -5, lean: -0.08, head: 0.3, sF: 0.4, eF: 0.75, sB: 0.2, eB: 0.4, blade: 0.95, hF: 0.35, kF: -0.05, hB: -0.35, kB: 0 }, HERO_BASE),
  whiffTap: P({ x: 12, lean: 0.35, sF: 1.75, eF: 1.55, blade: 1.3, hF: 0.75, kF: -0.15 }, HERO_BASE),
  charge: P({ lean: 0.28, head: -0.05, sF: -0.3, eF: 0.15, sB: 0.95, eB: 1.6, blade: -1.0, hF: 0.75, kF: -0.25, hB: -0.75, kB: -0.4 }, HERO_BASE),
  victory: P({ lean: 0.02, head: 0.28, sF: 0.15, eF: 0.22, sB: -0.1, eB: 0.05, blade: -0.8, hF: 0.18, kF: 0.0, hB: -0.18, kB: -0.05 }, HERO_BASE),
  kneel: P({ lean: 0.45, head: 0.35, sF: 0.6, eF: 0.2, sB: 0.3, eB: 0.4, blade: 1.2, hF: 1.4, kF: 0.05, hB: 0.35, kB: -1.45 }, HERO_BASE),
};

const V_BASE: Pose = {
  x: 0,
  y: 0,
  lean: 0.06,
  head: 0.05,
  sF: 0.9,
  eF: 2.6,
  sB: -0.3,
  eB: 0.3,
  hF: 0.4,
  kF: 0.05,
  hB: -0.4,
  kB: -0.05,
  blade: 3.9,
};

export const VERDICT = {
  idle: V_BASE,
  windHigh: P({ x: -6, lean: -0.15, head: -0.1, sF: 2.9, eF: 3.5, sB: 2.4, eB: 3.2, blade: 4.6, hF: 0.5, kF: -0.1, hB: -0.5, kB: -0.2 }, V_BASE),
  strikeHigh: P({ x: 48, lean: 0.35, head: 0.05, sF: 1.75, eF: 1.65, sB: 1.2, eB: 1.5, blade: 1.55, hF: 0.95, kF: 0.05, hB: -0.75, kB: -0.3 }, V_BASE),
  windLow: P({ x: -6, lean: 0.3, sF: -0.5, eF: -0.7, sB: -0.2, eB: 0.2, blade: -1.2, hF: 0.9, kF: -0.3, hB: -0.7, kB: -0.4 }, V_BASE),
  strikeLow: P({ x: 50, lean: 0.75, head: 0.2, sF: 0.95, eF: 1.25, sB: 0.4, eB: 0.9, blade: 1.75, hF: 1.3, kF: 0.2, hB: -0.9, kB: -0.5 }, V_BASE),
  windMid: P({ x: -10, lean: -0.1, sF: -0.6, eF: 1.2, sB: 0.4, eB: 1.4, blade: 1.57, hF: 0.6, kF: -0.1, hB: -0.55, kB: -0.3 }, V_BASE),
  strikeMid: P({ x: 66, lean: 0.5, head: 0.05, sF: 1.55, eF: 1.57, sB: 1.0, eB: 1.4, blade: 1.57, hF: 1.15, kF: 0.1, hB: -0.95, kB: -0.45 }, V_BASE),
  hurt: P({ x: -18, lean: -0.35, head: -0.4, sF: 0.5, eF: 1.5, sB: -0.6, eB: -0.2, blade: 2.9, hF: 0.25, kF: 0.15, hB: -0.3, kB: -0.1 }, V_BASE),
  broken: P({ x: -6, lean: 0.55, head: 0.4, sF: 0.2, eF: 0.1, sB: 0.3, eB: 0.6, blade: 1.32, hF: 1.35, kF: 0.05, hB: 0.3, kB: -1.45 }, V_BASE),
  roar: P({ lean: -0.25, head: -0.6, sF: 2.2, eF: 2.9, sB: 2.2, eB: 2.9, blade: 3.4, hF: 0.55, kF: -0.05, hB: -0.55, kB: -0.1 }, V_BASE),
  gather: P({ x: -4, lean: 0.02, head: -0.05, sF: 1.25, eF: 2.45, sB: 1.0, eB: 2.25, blade: 3.1, hF: 0.6, kF: -0.15, hB: -0.55, kB: -0.25 }, V_BASE),
  windClash: P({ x: -8, lean: -0.22, head: -0.2, sF: 3.0, eF: 3.4, sB: 2.9, eB: 3.3, blade: 4.0, hF: 0.6, kF: -0.15, hB: -0.6, kB: -0.25 }, V_BASE),
  strikeClash: P({ x: 52, lean: 0.62, head: 0.2, sF: 1.3, eF: 1.0, sB: 1.2, eB: 0.95, blade: 0.95, hF: 1.2, kF: 0.1, hB: -0.9, kB: -0.5 }, V_BASE),
};

export type HeroPose = keyof typeof HERO;
export type VerdictPose = keyof typeof VERDICT;
