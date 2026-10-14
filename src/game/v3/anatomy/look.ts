import type Phaser from 'phaser';
import type { Strand } from './physics';
import { chainAt, chainShape, frontNormal, limbShape, localShape, ribbonShape, type Profile } from './shapes';
import { add, mul, norm, sub, type Frame, type Vec } from './skeleton';
import type { CharSpec, ClothId, HeadwearId, WeaponId } from './specs';

/**
 * Noir silhouette renderer. A character is drawn as layered polygons (back limbs → body →
 * front limbs). Each layer gets two rim passes — a cold/warm key rim from the moon and a red
 * bounce rim from below — and then the near-black fill, so silhouettes read like backlit film
 * frames. Masks, scarves and eyes are the only colors.
 */

export interface Part {
  pts: Vec[];
  /** Fill override (masks, scarves). Default: the palette fill. */
  fill?: number;
  /** Excluded from rim passes. */
  noRim?: boolean;
}

export interface Glow {
  kind: 'line' | 'dot' | 'poly';
  pts?: Vec[];
  a?: Vec;
  b?: Vec;
  r?: number;
  w?: number;
  color: number;
  alpha: number;
}

export interface Layers {
  back: Part[];
  mid: Part[];
  body: Part[];
  front: Part[];
  /** Interior strokes drawn over the fills. */
  detail: Vec[][];
  glow: Glow[];
}

export interface Light {
  /** Unit vector toward the key light (screen space). */
  dir: Vec;
  /** Bright key rim (moon). */
  rimA: number;
  /** Soft outer halo of the key rim. */
  rimHalo: number;
  /** Bounce rim from below / the opposite side (blood-red city glow). */
  rimB: number;
  fill: number;
  /** Interior detail strokes (seams, plates, belts). */
  detail: number;
  /** Rim widths in body units. */
  rimAW: number;
  haloW: number;
  rimBW: number;
}

export const DEFAULT_LIGHT: Light = { dir: { x: 0.55, y: -0.83 }, rimA: 0xffe4da, rimHalo: 0x8c4a4a, rimB: 0x8a1222, fill: 0x060608, detail: 0x24232b, rimAW: 0.7, haloW: 1.6, rimBW: 0.55 };

export interface LookState {
  /** Hero blade blood 0..1. */
  blood: number;
  /** Variant overrides (thugs). */
  headwear?: HeadwearId;
  weapon?: WeaponId;
  /** Eyes: color override (feint white / attack red) and intensity. */
  eyeColor?: number;
  eyeGlow: number;
  /** Visible weapon (false when disarmed). */
  armed: boolean;
  /** Chainsaw running / cigarette lit etc. */
  hot: number;
  time: number;
  /** Rim color override and blend 0..1 (attackers flare red on their windup). */
  rimTint?: number;
  rimTintK?: number;
  /** Brighter, wider key rim (the hero pops out of the crowd). */
  hero?: boolean;
}

type P2 = [number, number];

// ------------------------------------------------------------------ helpers

function subProfile(p: Profile, t0: number, t1: number): Profile {
  const at = (t: number): [number, number] => {
    for (let i = 1; i < p.length; i++) {
      if (t <= p[i][0]) {
        const a = p[i - 1];
        const b = p[i];
        const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
        return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      }
    }
    const l = p[p.length - 1];
    return [l[1], l[2]];
  };
  const out: Profile = [];
  const [f0, b0] = at(t0);
  out.push([0, f0, b0]);
  for (const row of p) if (row[0] > t0 && row[0] < t1) out.push([(row[0] - t0) / (t1 - t0), row[1], row[2]]);
  const [f1, b1] = at(t1);
  out.push([1, f1, b1]);
  return out;
}

function widthAt(p: Profile, t: number): [number, number] {
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][0]) {
      const a = p[i - 1];
      const b = p[i];
      const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  const l = p[p.length - 1];
  return [l[1], l[2]];
}

/** A stroke across a trunk/limb at fraction t (seams, belts, plate edges). */
function acrossChain(chain: Vec[], profile: Profile, t: number, facing: number, s: number, inset = 0.9, sag = 0): Vec[] {
  const { p, u } = chainAt(chain, t);
  const n = frontNormal(u, facing);
  const [fw, bw] = widthAt(profile, t);
  const a = { x: p.x + n.x * fw * s * inset, y: p.y + n.y * fw * s * inset };
  const b = { x: p.x - n.x * bw * s * inset, y: p.y - n.y * bw * s * inset };
  const m = { x: (a.x + b.x) / 2 - u.x * sag * s, y: (a.y + b.y) / 2 - u.y * sag * s };
  return [a, m, b];
}

/** A stroke along the front of a trunk from t0 to t1 (coat opening, zipper). */
function alongChain(chain: Vec[], profile: Profile, t0: number, t1: number, facing: number, s: number, k = 0.55): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = t0 + ((t1 - t0) * i) / 6;
    const { p, u } = chainAt(chain, t);
    const n = frontNormal(u, facing);
    const [fw] = widthAt(profile, t);
    out.push({ x: p.x + n.x * fw * s * k, y: p.y + n.y * fw * s * k });
  }
  return out;
}

/** Weapon-local polygon: x along the weapon direction from the grip, y toward its spine side. */
function wshape(grip: Vec, d: Vec, facing: number, s: number, pts: P2[]): Vec[] {
  const n = { x: d.y * facing, y: -d.x * facing };
  return pts.map(([x, y]) => ({ x: grip.x + (d.x * x + n.x * y) * s, y: grip.y + (d.y * x + n.y * y) * s }));
}

function wpoint(grip: Vec, d: Vec, facing: number, s: number, x: number, y: number): Vec {
  const n = { x: d.y * facing, y: -d.x * facing };
  return { x: grip.x + (d.x * x + n.x * y) * s, y: grip.y + (d.y * x + n.y * y) * s };
}

const FIST: P2[] = [
  [-1.2, 2.3],
  [2.4, 2.9],
  [5.4, 2.3],
  [6.4, 0.2],
  [5.6, -2.3],
  [2.2, -2.8],
  [-1.2, -2.2],
];
const CLAW_HAND: P2[] = [
  [-1.0, 2.2],
  [3.0, 2.8],
  [7.5, 1.8],
  [9.6, 0.4],
  [7.0, -1.0],
  [8.6, -2.4],
  [5.0, -2.6],
  [-1.0, -2.2],
];
const BOOT: P2[] = [
  [-3.4, 2.2],
  [-3.8, -1.5],
  [-3.4, -3.7],
  [-1.5, -4.1],
  [7.5, -4.1],
  [10.6, -3.3],
  [11.0, -1.8],
  [9.8, -0.9],
  [5.4, 0.4],
  [2.6, 2.8],
  [0.2, 4.2],
  [-2.6, 4.0],
];
const SNEAKER: P2[] = [
  [-3.6, 2.6],
  [-4.0, -2.0],
  [-3.6, -4.2],
  [8.4, -4.3],
  [11.2, -3.2],
  [10.6, -1.0],
  [5.0, 0.8],
  [1.8, 3.6],
  [-2.4, 4.4],
];

/** Foot-local polygon (x toward the toe, y up), origin at the ankle. */
function footShape(ankle: Vec, toe: Vec, facing: number, s: number, pts: P2[]): Vec[] {
  const d = norm(sub(toe, ankle));
  // up for the foot = d rotated 90° away from the ground
  const up = { x: d.y * facing, y: -d.x * facing };
  const fwd = d;
  return pts.map(([x, y]) => ({ x: ankle.x + (fwd.x * x + up.x * y) * s, y: ankle.y + (fwd.y * x + up.y * y) * s }));
}

function handShape(wrist: Vec, hand: Vec, facing: number, s: number, claws: boolean): Vec[] {
  const d = norm(sub(hand, wrist));
  const n = { x: d.y * facing, y: -d.x * facing };
  return (claws ? CLAW_HAND : FIST).map(([x, y]) => ({ x: wrist.x + (d.x * x + n.x * y) * s, y: wrist.y + (d.y * x + n.y * y) * s }));
}

// ------------------------------------------------------------------ headwear (head-local: x forward, y up)

const HW: Partial<Record<HeadwearId, P2[][]>> = {
  hairSpikes: [
    [
      [-6.9, 0.2],
      [-7.4, 3.3],
      [-5.6, 6.6],
      [-2.0, 8.2],
      [2.2, 8.0],
      [5.0, 6.0],
      [6.3, 3.7],
      [4.7, 4.3],
      [5.6, 2.4],
      [3.0, 3.8],
      [0.5, 5.0],
      [-2.2, 4.2],
      [-4.6, 2.4],
      [-6.4, -0.8],
    ],
    [
      [-3.0, 7.8],
      [-11.0, 10.2],
      [-5.8, 5.6],
    ],
    [
      [-5.4, 6.0],
      [-13.4, 5.6],
      [-6.8, 3.2],
    ],
    [
      [-6.6, 3.0],
      [-12.6, 0.6],
      [-6.8, -0.2],
    ],
    [
      [-0.8, 8.2],
      [-7.0, 12.0],
      [-3.4, 7.2],
    ],
    [
      [2.0, 8.0],
      [-2.2, 11.4],
      [-0.4, 7.6],
    ],
  ],
  hood: [
    [
      [-7.6, -4.0],
      [-9.2, 1.2],
      [-8.4, 6.0],
      [-4.6, 9.4],
      [0.6, 10.0],
      [5.0, 8.2],
      [7.4, 4.6],
      [7.8, 1.0],
      [6.8, -2.6],
      [5.6, -1.0],
      [5.0, 3.2],
      [2.8, 5.0],
      [0.0, 4.4],
      [-2.0, 1.0],
      [-2.4, -4.0],
      [-5.0, -7.0],
    ],
  ],
  cap: [
    [
      [-6.8, 1.0],
      [-6.4, 5.2],
      [-3.4, 7.8],
      [1.0, 8.2],
      [4.4, 6.6],
      [6.0, 4.6],
      [11.6, 3.8],
      [11.6, 2.9],
      [5.6, 2.8],
      [3.0, 4.2],
      [-2.0, 4.4],
      [-6.0, 1.6],
    ],
  ],
  bandana: [
    [
      [-6.9, 2.0],
      [-6.4, 5.6],
      [-3.0, 7.9],
      [1.4, 8.0],
      [4.8, 6.0],
      [5.8, 3.6],
      [-1.0, 4.6],
      [-6.2, 2.8],
    ],
    [
      [-6.6, 3.6],
      [-11.0, 1.2],
      [-10.2, -0.2],
      [-6.6, 2.2],
    ],
    [
      [5.8, 0.4],
      [7.0, -2.2],
      [6.4, -5.4],
      [3.0, -6.6],
      [2.6, -1.0],
    ],
  ],
  gasMask: [
    [
      [4.0, 0.8],
      [7.2, -1.0],
      [9.4, -2.0],
      [9.6, -5.2],
      [7.0, -6.4],
      [3.6, -5.4],
    ],
    [
      [-6.6, 1.0],
      [-6.2, 5.6],
      [-2.8, 7.8],
      [1.6, 7.8],
      [4.6, 5.8],
      [5.4, 3.2],
      [-2.0, 3.6],
    ],
  ],
  helmet: [
    [
      [-7.6, -3.4],
      [-8.2, 3.6],
      [-4.4, 8.6],
      [2.0, 9.0],
      [6.8, 6.0],
      [8.0, 0.4],
      [7.4, -5.2],
      [3.2, -7.0],
      [-3.2, -6.4],
    ],
  ],
  ninjaHood: [
    [
      [-7.0, -2.0],
      [-7.6, 2.6],
      [-5.6, 7.0],
      [-1.0, 8.4],
      [3.6, 7.4],
      [6.2, 4.6],
      [7.0, 0.6],
      [6.6, -2.6],
      [5.4, -5.0],
      [1.6, -6.0],
      [-3.0, -5.0],
    ],
  ],
  dreads: [
    [
      [-6.8, 0.4],
      [-7.2, 4.2],
      [-4.8, 7.4],
      [-0.8, 8.2],
      [3.2, 7.4],
      [5.4, 4.8],
      [1.0, 5.6],
      [-3.6, 3.0],
    ],
    [
      [-5.6, 5.4],
      [-12.0, 0.4],
      [-14.0, -6.0],
      [-12.6, -6.4],
      [-10.4, -1.6],
      [-6.2, 2.4],
    ],
    [
      [-6.8, 2.0],
      [-11.0, -4.0],
      [-11.4, -10.0],
      [-10.0, -10.2],
      [-9.0, -4.6],
      [-6.2, -0.6],
    ],
  ],
  soldier: [
    [
      [-7.4, 0.6],
      [-7.0, 5.6],
      [-3.2, 8.6],
      [1.6, 8.8],
      [5.6, 6.6],
      [7.6, 2.6],
      [7.8, 1.0],
      [3.0, 2.4],
      [-3.0, 1.6],
      [-7.6, -0.6],
    ],
    [
      [3.4, 2.4],
      [7.4, 2.2],
      [7.6, 0.2],
      [3.4, 0.2],
    ],
  ],
  pigMask: [
    [
      [1.0, 6.4],
      [5.0, 5.2],
      [7.2, 1.8],
      [7.4, -2.8],
      [5.6, -6.0],
      [1.4, -6.6],
      [0.4, 0.0],
    ],
    [
      [6.2, 0.6],
      [10.4, 0.2],
      [10.8, -2.8],
      [6.4, -3.4],
    ],
    [
      [-2.0, 6.6],
      [-1.0, 9.6],
      [1.4, 6.8],
    ],
  ],
  kabuto: [
    [
      [-8.6, -1.4],
      [-8.8, 3.4],
      [-6.0, 7.8],
      [-0.6, 9.6],
      [4.8, 8.4],
      [7.6, 4.8],
      [8.0, 2.0],
      [-3.0, 2.6],
      [-8.4, -1.0],
    ],
    [
      [-8.8, 1.0],
      [-13.4, -3.0],
      [-12.0, -4.6],
      [-14.2, -7.4],
      [-9.6, -6.6],
      [-6.0, -3.6],
    ],
    [
      [2.0, 8.6],
      [-1.0, 15.6],
      [1.6, 18.6],
      [3.4, 12.6],
      [7.4, 17.4],
      [10.2, 15.0],
      [5.0, 9.4],
    ],
  ],
  slick: [
    [
      [-6.9, 0.4],
      [-7.0, 4.0],
      [-4.6, 7.2],
      [-0.4, 8.0],
      [3.6, 7.2],
      [5.6, 4.8],
      [5.0, 4.0],
      [0.6, 5.4],
      [-4.4, 3.4],
      [-6.6, -0.4],
    ],
  ],
  foxMask: [
    [
      [1.2, 6.4],
      [4.6, 5.0],
      [6.6, 2.6],
      [10.4, -1.6],
      [9.8, -2.6],
      [6.0, -3.6],
      [4.0, -6.0],
      [1.2, -6.0],
      [0.6, 0.0],
    ],
    [
      [-0.6, 6.2],
      [1.6, 13.0],
      [3.4, 6.6],
    ],
    [
      [-3.6, 6.0],
      [-2.4, 12.4],
      [-0.4, 6.4],
    ],
  ],
  kasa: [
    [
      [-15.0, 2.6],
      [-12.0, 3.8],
      [-1.0, 10.6],
      [1.0, 10.6],
      [13.0, 4.4],
      [15.6, 3.0],
      [13.6, 2.4],
      [0.0, 4.4],
      [-12.6, 2.0],
    ],
  ],
};

/** Colored (non-black) headwear parts: index → fill key. */
const HW_FILL: Partial<Record<HeadwearId, Record<number, 'accent' | 'accent2'>>> = {
  pigMask: { 0: 'accent', 1: 'accent' },
  foxMask: { 0: 'accent' },
};

/** White mask plate for masked characters (head-local). */
const MASK_PLATES: Partial<Record<HeadwearId | 'duelistMask' | 'oni', P2[]>> = {
  duelistMask: [
    [1.0, 6.4],
    [4.4, 5.6],
    [6.2, 2.8],
    [6.8, -0.4],
    [6.2, -3.6],
    [4.2, -6.0],
    [1.4, -6.2],
    [0.6, 0.0],
  ],
  oni: [
    [0.4, 6.6],
    [4.8, 5.8],
    [7.4, 2.6],
    [8.2, -1.0],
    [7.4, -4.6],
    [5.0, -7.0],
    [2.0, -7.6],
    [0.0, -2.0],
  ],
};

// ------------------------------------------------------------------ weapons (x along the weapon, y toward its spine)

function weaponShapes(id: WeaponId, grip: Vec, d: Vec, facing: number, s: number, bladeLen: number, handleLen: number, t: number): { parts: Part[]; glows: Glow[]; edge: Vec[] } {
  const W = (pts: P2[]) => wshape(grip, d, facing, s, pts);
  const P = (x: number, y: number) => wpoint(grip, d, facing, s, x, y);
  const parts: Part[] = [];
  const glows: Glow[] = [];
  let edge: Vec[] = [];
  const L = bladeLen;
  const H = handleLen;
  switch (id) {
    case 'katana':
    case 'nodachi': {
      const curve = (x: number) => 0.9 * Math.sin((Math.PI * Math.max(0, x)) / L) * (L / 46);
      const pts: P2[] = [];
      for (let i = 0; i <= 8; i++) {
        const x = 1.6 + ((L - 4 - 1.6) * i) / 8;
        pts.push([x, 1.0 + curve(x)]);
      }
      pts.push([L, 0.4 + curve(L)]);
      for (let i = 8; i >= 0; i--) {
        const x = 1.6 + ((L - 2 - 1.6) * i) / 8;
        pts.push([x, -1.1 + curve(x) + (i === 8 ? 0.4 : 0)]);
      }
      parts.push({ pts: W(pts) });
      parts.push({ pts: W([[-0.4, 2.6], [1.6, 2.8], [1.6, -2.8], [-0.4, -2.6]]) });
      parts.push({ pts: W([[-H, 1.0], [-0.4, 1.2], [-0.4, -1.2], [-H, -1.0], [-H - 0.8, 0]]) });
      edge = [];
      for (let i = 0; i <= 10; i++) {
        const x = 3 + ((L - 3) * i) / 10;
        edge.push(P(x, -1.0 + curve(x) + (i === 10 ? 1.3 : 0)));
      }
      break;
    }
    case 'machete':
      parts.push({ pts: W([[1, 1.4], [L * 0.75, 2.2], [L, 0.6], [L * 0.98, -2.4], [L * 0.5, -2.2], [1, -1.4]]) });
      parts.push({ pts: W([[-H, 1.1], [1, 1.3], [1, -1.3], [-H, -1.1]]) });
      edge = [P(2, -1.4), P(L * 0.5, -2.2), P(L * 0.98, -2.4)];
      break;
    case 'bat':
      parts.push({ pts: W([[-H, 0.9], [0, 1.0], [L * 0.6, 1.9], [L, 2.3], [L + 1.2, 0], [L, -2.3], [L * 0.6, -1.9], [0, -1.0], [-H, -0.9], [-H - 0.8, 0]]) });
      break;
    case 'pipe':
      parts.push({ pts: W([[-H, 1.2], [L, 1.2], [L + 0.4, 2.2], [L + 3, 2.2], [L + 3, -1.6], [L, -1.2], [-H, -1.2]]) });
      break;
    case 'knife':
    case 'tanto':
      parts.push({ pts: W([[0.8, 0.9], [L * 0.9, 0.7], [L, 0], [L * 0.85, -1.0], [0.8, -1.0]]) });
      parts.push({ pts: W([[-H, 0.9], [0.8, 1.5], [0.8, -1.5], [-H, -0.9]]) });
      edge = [P(1, -1.0), P(L * 0.85, -1.0), P(L, 0)];
      break;
    case 'hammer':
      parts.push({ pts: W([[-H, 1.3], [L, 1.3], [L, -1.3], [-H, -1.3], [-H - 1.2, 0]]) });
      parts.push({ pts: W([[L - 3, 6.4], [L + 7, 7.0], [L + 8, 5.0], [L + 8, -5.0], [L + 7, -7.0], [L - 3, -6.4], [L - 4, 0]]) });
      glows.push({ kind: 'line', pts: [P(L - 2.2, 5.2), P(L + 6.4, 5.8)], w: 0.5 * s, color: 0x2a2a30, alpha: 1 });
      break;
    case 'naginata': {
      parts.push({ pts: W([[-H, 0.9], [L * 0.62, 0.9], [L * 0.62, -0.9], [-H, -0.9]]) });
      parts.push({ pts: W([[L * 0.6, 1.4], [L * 0.85, 2.0], [L, 0.2], [L * 0.92, -1.4], [L * 0.6, -1.4]]) });
      edge = [P(L * 0.62, -1.4), P(L * 0.92, -1.4), P(L, 0.2)];
      break;
    }
    case 'claws':
      for (const off of [-1.2, 0, 1.2]) parts.push({ pts: W([[4, off + 0.5], [4 + L * 0.9, off * 2.2 + 0.2], [4, off - 0.5]]) });
      break;
    case 'rifle':
      parts.push({ pts: W([[-H, 2.4], [-H, -2.4], [0, -1.2], [L * 0.45, -1.6], [L * 0.45, -4.6], [L * 0.38, -4.6], [L * 0.36, -1.6], [L, -0.6], [L, 0.8], [L * 0.6, 1.2], [L * 0.2, 2.2], [0, 1.6]]) });
      break;
    case 'chainsaw': {
      parts.push({ pts: W([[-H, 4.2], [8, 4.6], [9, -3.6], [-H, -4.0], [-H - 1.5, 0]]) });
      parts.push({ pts: W([[8, 2.2], [L, 2.0], [L + 2.0, 0], [L, -2.0], [8, -2.2]]) });
      const teeth: Vec[] = [];
      for (let i = 0; i <= 14; i++) teeth.push(P(9 + ((L - 9) * i) / 14, (i % 2 ? 2.8 : 2.0) * (1 + 0.15 * Math.sin(t * 40 + i))));
      edge = teeth;
      break;
    }
    case 'cleaver': {
      // executioner's greatsword: narrow at the guard, a heavy flared belly, hooked squared tip
      parts.push({
        pts: W([
          [1.5, 2.4],
          [L * 0.35, 3.4],
          [L * 0.7, 5.2],
          [L * 0.9, 7.6],
          [L * 0.97, 8.4],
          [L, 6.8],
          [L * 1.02, 2.0],
          [L * 0.98, -3.2],
          [L * 0.88, -5.6],
          [L * 0.6, -4.6],
          [L * 0.3, -3.4],
          [1.5, -2.6],
        ]),
      });
      parts.push({ pts: W([[-1.0, 5.6], [1.6, 5.8], [1.6, -5.8], [-1.0, -5.6]]) });
      parts.push({ pts: W([[-H, 1.5], [-1.0, 1.8], [-1.0, -1.8], [-H, -1.5], [-H - 2.2, 0]]) });
      edge = [P(2, -2.6), P(L * 0.3, -3.4), P(L * 0.6, -4.6), P(L * 0.88, -5.6), P(L * 0.98, -3.2)];
      glows.push({ kind: 'dot', a: P(L * 0.8, 3.4), r: 1.5 * s, color: 0x000000, alpha: 1 });
      glows.push({ kind: 'line', pts: [P(L * 0.12, 0.2), P(L * 0.75, 0.6)], w: 0.4 * s, color: 0x2a2a30, alpha: 1 });
      break;
    }
    case 'pistol':
      parts.push({ pts: W([[-1.2, 1.4], [8.8, 1.6], [8.8, -0.4], [2.6, -0.6], [1.0, -4.8], [-1.8, -4.4], [-0.8, -0.4]]) });
      break;
    case 'sickle':
      parts.push({ pts: W([[-H, 0.9], [L * 0.5, 0.9], [L * 0.5, -0.9], [-H, -0.9]]) });
      parts.push({ pts: W([[L * 0.45, 1.0], [L * 0.9, 4.0], [L * 1.4, 2.0], [L * 1.6, -2.4], [L * 1.3, -0.4], [L * 0.95, 1.4], [L * 0.5, -1.0]]) });
      edge = [P(L * 0.95, 1.4), P(L * 1.3, -0.4), P(L * 1.6, -2.4)];
      break;
    case 'none':
      break;
  }
  return { parts, glows, edge };
}

// ------------------------------------------------------------------ build

export interface BuildInput {
  frame: Frame;
  spec: CharSpec;
  look: LookState;
  cloth: Partial<Record<ClothId, Strand[]>>;
}

/** Builds the layered silhouette of one character. */
export function buildLayers({ frame, spec, look, cloth }: BuildInput): Layers {
  const { j, facing, s } = frame;
  const L: Layers = { back: [], mid: [], body: [], front: [], detail: [], glow: [] };
  const body = spec.body;
  const cut = frame.cut ?? {};
  const headwear = look.headwear ?? spec.headwear;
  const weapon = look.weapon ?? spec.weapon;
  const boot = spec.torsoWear === 'hoodie' || spec.torsoWear === 'tactical' ? SNEAKER : BOOT;

  // --- cloth behind
  const cl = (id: ClothId) => cloth[id] ?? [];
  if (spec.cloth.includes('cape')) for (const st of cl('cape')) L.back.push({ pts: ribbonShape(st.pts, 16 * s, 24 * s, 0.25, 3) });
  if (spec.cloth.includes('coatSkirt')) {
    const [back, mid] = cl('coatSkirt');
    if (back) L.back.push({ pts: ribbonShape(back.pts, 8 * s, 15 * s, 0.14, 1) });
    if (mid) L.back.push({ pts: ribbonShape(mid.pts, 6 * s, 12 * s, 0.1, 2) });
  }
  if (spec.cloth.includes('rags')) for (const [i, st] of cl('rags').entries()) L.back.push({ pts: ribbonShape(st.pts, 5 * s, 2 * s, 0.4, i) });
  if (spec.cloth.includes('ninjaTails')) for (const st of cl('ninjaTails')) L.back.push({ pts: ribbonShape(st.pts, 3.2 * s, 1.8 * s, 0.2, 4) });
  if (spec.cloth.includes('ponytail')) for (const st of cl('ponytail')) L.back.push({ pts: ribbonShape(st.pts, 4.2 * s, 1.0 * s, 0.1, 5) });
  if (spec.cloth.includes('sash')) for (const st of cl('sash')) L.back.push({ pts: ribbonShape(st.pts, 3.4 * s, 2.4 * s, 0.3, 6) });
  if (spec.cloth.includes('kimonoSleeve')) for (const st of cl('kimonoSleeve')) L.back.push({ pts: ribbonShape(st.pts, 9 * s, 7 * s, 0.1, 7) });
  if (spec.cloth.includes('scarf')) for (const [i, st] of cl('scarf').entries()) L.mid.push({ pts: ribbonShape(st.pts, (i ? 3.6 : 4.6) * s, (i ? 2.4 : 3.2) * s, 0.25, 8 + i), fill: spec.accent });

  // saya on the back hip (hero)
  if (spec.id === 'hero') {
    const d = norm({ x: -0.62 * facing, y: 0.78 });
    const start = add(j.pelvis, add(mul({ x: -facing, y: 0 }, 4 * s), { x: 0, y: -3 * s }));
    L.back.push({ pts: wshape(start, d, facing, s, [[-2, 1.2], [40, 1.0], [42, 0], [40, -1.2], [-2, -1.4]]) });
  }

  // --- back limbs
  pushLeg(L.back, j.hipB, j.kneeB, j.ankleB, j.toeB, spec, facing, s, boot);
  pushArm(L.back, j.shoulderB, j.elbowB, j.wristB, j.handB, spec, facing, s);
  if (spec.offhand && spec.offhand !== 'none' && look.armed) {
    const d = norm(sub(j.handB, j.wristB));
    const og = add(j.wristB, mul(d, body.hand * 0.45 * s));
    const ow = weaponShapes(spec.offhand, og, spec.offhand === 'pistol' ? d : norm(add(d, { x: 0, y: -0.2 })), facing, s, spec.offhand === 'claws' ? body.bladeLen : body.bladeLen * 0.9, body.handleLen, look.time);
    L.back.push(...ow.parts);
  }

  // --- torso, neck, head
  const chain = cut.spineUpper ? null : [j.pelvis, j.spine, j.chest, j.neck];
  if (chain) L.body.push({ pts: chainShape(chain, spec.torso, facing, s) });
  else {
    L.body.push({ pts: chainShape([j.pelvis, j.spine], subProfile(spec.torso, 0, 0.42), facing, s) });
    L.body.push({ pts: chainShape([cut.spineUpper!, j.chest, j.neck], subProfile(spec.torso, 0.42, 1), facing, s) });
  }
  pushTorsoWear(L, frame, spec, s, look);

  const headBase = cut.neckHead ?? j.neck;
  const neckTop = add(j.head, mul(frame.headUp, -spec.headR * 0.55 * s));
  if (!cut.neckHead) L.body.push({ pts: limbShape(j.neck, neckTop, spec.neck, facing, s) });
  else {
    // stumps: a short neck on the body, a short neck on the head
    L.body.push({ pts: limbShape(j.neck, add(j.neck, mul(frame.up, 2.2 * s)), spec.neck, facing, s) });
    L.body.push({ pts: limbShape(headBase, neckTop, spec.neck, facing, s) });
  }
  const hscale = s * (spec.headR / 6.4);
  L.body.push({ pts: localShape(j.head, frame.headUp, facing, hscale, spec.head, 2) });
  const hw = HW[headwear];
  if (hw) {
    hw.forEach((poly, i) => {
      const key = HW_FILL[headwear]?.[i];
      L.body.push({ pts: localShape(j.head, frame.headUp, facing, hscale, poly, 2), fill: key ? (key === 'accent' ? spec.accent : spec.accent2 ?? spec.accent) : undefined });
    });
  }
  if (headwear === 'mask') L.body.push({ pts: localShape(j.head, frame.headUp, facing, hscale, MASK_PLATES.duelistMask!, 2), fill: spec.accent });
  if (headwear === 'kabuto') L.body.push({ pts: localShape(j.head, frame.headUp, facing, hscale, MASK_PLATES.oni!, 2), fill: spec.accent });

  // --- front leg
  pushLeg(L.body, j.hipF, j.kneeF, j.ankleF, j.toeF, spec, facing, s, boot);
  if (spec.cloth.includes('coatSkirt')) {
    const front = cl('coatSkirt')[2];
    if (front) L.body.push({ pts: ribbonShape(front.pts, 6 * s, 10 * s, 0.12, 9) });
  }
  if (spec.cloth.includes('apronFlap')) for (const st of cl('apronFlap')) L.body.push({ pts: ribbonShape(st.pts, 18 * s, 20 * s, 0.05, 2), fill: spec.accent2 });
  if (spec.cloth.includes('tie')) for (const st of cl('tie')) L.front.push({ pts: ribbonShape(st.pts, 2.0 * s, 2.6 * s, 0, 1) });

  // --- front arm + weapon
  const bladeDir = norm(sub(j.tip, j.grip));
  if (weapon !== 'none' && look.armed) {
    const w = weaponShapes(weapon, j.grip, bladeDir, facing, s, weapon === 'claws' ? body.bladeLen : body.bladeLen, body.handleLen, look.time);
    L.front.push(...w.parts);
    L.glow.push(...w.glows);
    if (w.edge.length) {
      L.glow.push({ kind: 'line', pts: w.edge, w: Math.max(1, 0.5 * s), color: 0xffffff, alpha: weapon === 'chainsaw' ? 0.5 + look.hot * 0.4 : 0.85 });
      if (look.blood > 0.02) {
        const n = Math.max(2, Math.round(w.edge.length * Math.min(1, look.blood)));
        L.glow.push({ kind: 'line', pts: w.edge.slice(0, n), w: Math.max(1.5, 0.95 * s), color: 0xb0101c, alpha: 0.95 });
      }
    }
  }
  pushArm(L.front, j.shoulderF, j.elbowF, j.wristF, j.handF, spec, facing, s);

  // --- wet cut surfaces (stumps)
  const stump = (c: Vec, axis: Vec, half: number) => {
    const u = norm(axis);
    const n = { x: -u.y, y: u.x };
    const ell = (k: number, flat: number) => {
      const pts: Vec[] = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        pts.push({ x: c.x + n.x * Math.cos(a) * half * k + u.x * Math.sin(a) * half * flat * k, y: c.y + n.y * Math.cos(a) * half * k + u.y * Math.sin(a) * half * flat * k });
      }
      return pts;
    };
    L.glow.push({ kind: 'poly', pts: ell(0.82, 0.24), color: 0x4a030a, alpha: 1 });
    L.glow.push({ kind: 'poly', pts: ell(0.58, 0.2), color: 0x8a0a16, alpha: 1 });
    L.glow.push({ kind: 'dot', a: { x: c.x + n.x * half * 0.18, y: c.y + n.y * half * 0.18 }, r: half * 0.1, color: 0xc8b8a4, alpha: 0.7 });
  };
  if (cut.neckHead) {
    const nw = spec.neck[0][1] * s;
    stump(j.neck, sub(j.neck, j.chest), nw);
    stump(cut.neckHead, sub(cut.neckHead, j.head), nw);
  }
  if (cut.spineUpper) {
    const [fw, bw] = widthAt(spec.torso, 0.42);
    const half = ((fw + bw) / 2) * s;
    stump(j.spine, sub(j.spine, j.pelvis), half);
    stump(cut.spineUpper, sub(cut.spineUpper, j.chest), half);
  }
  if (cut.armF) stump(j.shoulderF, sub(j.shoulderF, j.elbowF), spec.upperArm[0][1] * s);
  if (cut.armB) stump(j.shoulderB, sub(j.shoulderB, j.elbowB), spec.upperArm[0][1] * s);
  if (cut.legF) stump(j.hipF, sub(j.hipF, j.kneeF), spec.thigh[0][1] * s);
  if (cut.legB) stump(j.hipB, sub(j.hipB, j.kneeB), spec.thigh[0][1] * s);

  // --- eyes & small lights
  if (!(cut.neckHead && look.eyeGlow <= 0)) pushEyes(L.glow, frame, spec, look, hscale);
  if (spec.id === 'cleaner') {
    const ember = localShape(j.head, frame.headUp, facing, hscale, [[7.4, -3.0]])[0];
    L.glow.push({ kind: 'dot', a: ember, r: 0.7 * s, color: 0xff6a1a, alpha: 0.7 + 0.3 * Math.sin(look.time * 3) });
  }
  return L;
}

function pushLeg(out: Part[], hip: Vec, knee: Vec, ankle: Vec, toe: Vec, spec: CharSpec, facing: number, s: number, boot: P2[]): void {
  out.push({ pts: limbShape(hip, knee, spec.thigh, facing, s) });
  out.push({ pts: limbShape(knee, ankle, spec.shin, facing, s) });
  out.push({ pts: footShape(ankle, toe, facing, s * (spec.body.foot / 10.5), boot) });
}

function pushArm(out: Part[], shoulder: Vec, elbow: Vec, wrist: Vec, hand: Vec, spec: CharSpec, facing: number, s: number): void {
  out.push({ pts: limbShape(shoulder, elbow, spec.upperArm, facing, s) });
  out.push({ pts: limbShape(elbow, wrist, spec.forearm, facing, s) });
  out.push({ pts: handShape(wrist, hand, facing, s * (spec.body.hand / 7), !spec.fist) });
}

function pushTorsoWear(L: Layers, frame: Frame, spec: CharSpec, s: number, look: LookState): void {
  const { j, facing } = frame;
  const up = frame.up;
  const local = (origin: Vec, pts: P2[], k = s) => localShape(origin, up, facing, k, pts, 2);
  void look;
  const cut = frame.cut ?? {};
  if (!cut.spineUpper) {
    const chain = [j.pelvis, j.spine, j.chest, j.neck];
    const T = spec.torso;
    switch (spec.torsoWear) {
      case 'coat':
        L.detail.push(acrossChain(chain, T, 0.2, facing, s, 0.92, 0.6));
        L.detail.push(alongChain(chain, T, 0.22, 0.92, facing, s, 0.45));
        break;
      case 'hoodie':
        L.detail.push(acrossChain(chain, T, 0.3, facing, s, 0.6, -0.8));
        L.detail.push(alongChain(chain, T, 0.62, 0.95, facing, s, 0.3));
        break;
      case 'armor':
      case 'plate':
        for (const t of [0.3, 0.46, 0.62]) L.detail.push(acrossChain(chain, T, t, facing, s, 0.95, 1.2));
        L.detail.push(alongChain(chain, T, 0.3, 0.86, facing, s, 0.1));
        break;
      case 'gi':
      case 'kimono':
        L.detail.push(acrossChain(chain, T, 0.24, facing, s, 0.95, 0.3));
        L.detail.push(acrossChain(chain, T, 0.3, facing, s, 0.95, 0.3));
        break;
      case 'tactical':
        L.detail.push(acrossChain(chain, T, 0.22, facing, s, 0.95, 0.4));
        L.detail.push(acrossChain(chain, T, 0.55, facing, s, 0.95, 0.4));
        break;
      case 'suit':
        L.detail.push(alongChain(chain, T, 0.15, 0.85, facing, s, 0.5));
        break;
      default:
        break;
    }
  }
  // boot tops / pants creases
  if (spec.torsoWear === 'coat' || spec.torsoWear === 'plate' || spec.torsoWear === 'armor') {
    for (const [k, a] of [
      [j.kneeF, j.ankleF],
      [j.kneeB, j.ankleB],
    ] as [Vec, Vec][]) {
      const m = { x: k.x + (a.x - k.x) * 0.56, y: k.y + (a.y - k.y) * 0.56 };
      const u = norm(sub(a, k));
      const n = frontNormal(u, facing);
      L.detail.push([
        { x: m.x + n.x * 4.4 * s, y: m.y + n.y * 4.4 * s },
        { x: m.x - n.x * 4.8 * s, y: m.y - n.y * 4.8 * s },
      ]);
    }
  }
  switch (spec.torsoWear) {
    case 'coat':
      // high collar rising behind the neck
      L.body.push({ pts: local(j.neck, [[-5.8, -2.4], [-6.6, 4.2], [-3.6, 7.4], [0.0, 5.8], [2.8, 1.6], [4.6, -1.4]]) });
      break;
    case 'hoodie':
      L.body.push({ pts: local(j.neck, [[-7.4, -3.0], [-8.4, 2.4], [-5.0, 4.4], [-0.8, 2.0], [1.0, -2.0]]) });
      break;
    case 'armor':
    case 'plate': {
      const big = spec.torsoWear === 'plate' ? 1.25 : 1;
      for (const [sh, sign] of [
        [j.shoulderB, -1],
        [j.shoulderF, 1],
      ] as [Vec, number][]) {
        const pts: P2[] = [
          [-9 * big, 4 * big],
          [-3 * big, 9 * big],
          [6 * big, 9.5 * big],
          [11 * big, 3 * big],
          [9 * big, -6 * big],
          [1 * big, -8 * big],
          [-8 * big, -4 * big],
        ];
        const part = { pts: local(add(sh, mul(up, 1.5 * s)), pts) };
        if (sign < 0) L.back.push(part);
        else L.front.push(part);
      }
      if (spec.torsoWear === 'plate') {
        // spikes on the pauldron
        L.front.push({ pts: local(add(j.shoulderF, mul(up, 9 * s)), [[-2, 0], [-1, 9], [1.4, 0]]) });
        L.front.push({ pts: local(add(j.shoulderF, mul(up, 8 * s)), [[3, 0], [7, 7], [5.6, -1]]) });
      }
      break;
    }
    case 'tactical':
      L.back.push({ pts: local(j.chest, [[-14, 4], [-14, -14], [-8, -16], [-7, 6]]) });
      L.body.push({ pts: local(j.chest, [[8, -2], [12, -2], [12, -9], [8, -9]]) });
      break;
    case 'apron':
      break;
    case 'suit':
      // white shirt V and the tie knot
      L.body.push({ pts: local(j.neck, [[1.2, 0.6], [4.2, -0.8], [3.2, -8.0], [1.4, -6.0]]), fill: spec.accent, noRim: true });
      break;
    case 'kimono':
      L.body.push({ pts: local(j.neck, [[-5, -1], [-4, 4], [2, 2], [5, -2]]) });
      break;
    default:
      break;
  }
}

function pushEyes(out: Glow[], frame: Frame, spec: CharSpec, look: LookState, hs: number): void {
  const { j, facing } = frame;
  const P = (x: number, y: number) => localShape(j.head, frame.headUp, facing, hs, [[x, y]])[0];
  const color = look.eyeColor ?? spec.eyes.color;
  const a = Math.max(0, Math.min(1, look.eyeGlow));
  if (a <= 0.01) return;
  switch (spec.eyes.kind) {
    case 'slit':
      out.push({ kind: 'line', pts: [P(3.6, 1.9), P(5.5, 1.5)], w: 0.85 * hs, color, alpha: a });
      break;
    case 'dots':
      out.push({ kind: 'dot', a: P(4.5, 1.6), r: 0.8 * hs, color, alpha: a });
      break;
    case 'visor':
      out.push({ kind: 'line', pts: [P(1.6, 1.8), P(7.6, 1.6)], w: 1.0 * hs, color, alpha: a });
      break;
    case 'mask':
      out.push({ kind: 'line', pts: [P(3.4, 2.2), P(5.6, 1.6)], w: 1.1 * hs, color, alpha: a });
      break;
    case 'glasses':
      out.push({ kind: 'line', pts: [P(2.6, 2.1), P(6.4, 2.0)], w: 1.4 * hs, color: 0x0a0a0c, alpha: 1 });
      out.push({ kind: 'line', pts: [P(3.4, 2.4), P(5.0, 2.3)], w: 0.4 * hs, color, alpha: 0.8 * a });
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------ draw

export interface DrawOpts {
  light: Light;
  s: number;
  /** White hit flash. */
  flash?: boolean;
  /** Manga impact frame: flat silhouette in this color (no rims, no glows). */
  flat?: number | null;
  /** Skip the rim passes (reflections, cheap distant figures). */
  noRim?: boolean;
  /** Offset everything (shake / reflections drawn elsewhere). */
  dx?: number;
  dy?: number;
}

/** Only the emissive parts (eyes, blade edges) — drawn above darkness overlays. */
export function drawGlows(g: Phaser.GameObjects.Graphics, L: Layers): void {
  for (const gl of L.glow) {
    if (gl.color === 0x000000 || gl.color === 0x0a0a0c) continue;
    if (gl.kind === 'dot' && gl.a) {
      g.fillStyle(gl.color, gl.alpha);
      g.fillCircle(gl.a.x, gl.a.y, gl.r ?? 2);
    } else if (gl.kind === 'line' && gl.pts && gl.pts.length > 1) {
      g.lineStyle(gl.w ?? 1, gl.color, gl.alpha);
      g.beginPath();
      g.moveTo(gl.pts[0].x, gl.pts[0].y);
      for (let i = 1; i < gl.pts.length; i++) g.lineTo(gl.pts[i].x, gl.pts[i].y);
      g.strokePath();
    }
  }
}

export function drawLayers(g: Phaser.GameObjects.Graphics, L: Layers, o: DrawOpts): void {
  const order: Part[][] = [L.back, L.mid, L.body, L.front];
  if (o.flat !== undefined && o.flat !== null) {
    g.fillStyle(o.flat, 1);
    for (const layer of order) for (const p of layer) if (p.pts.length > 2) g.fillPoints(p.pts, true);
    return;
  }
  const { light } = o;
  const passes: [number, number][] = [
    [light.haloW, light.rimHalo],
    [light.rimAW, light.rimA],
    [-light.rimBW, light.rimB],
  ];
  for (const layer of order) {
    if (!layer.length) continue;
    if (!o.noRim) {
      for (const [w, color] of passes) {
        const k = w * o.s;
        g.save();
        g.translateCanvas(light.dir.x * k, light.dir.y * k);
        g.fillStyle(color, 1);
        for (const p of layer) if (!p.noRim && p.pts.length > 2) g.fillPoints(p.pts, true);
        g.restore();
      }
    }
    for (const p of layer) {
      if (p.pts.length < 3) continue;
      g.fillStyle(o.flash ? 0xffffff : p.fill ?? light.fill, 1);
      g.fillPoints(p.pts, true);
    }
  }
  if (o.flash) return;
  if (L.detail.length) {
    g.lineStyle(Math.max(1, 0.45 * o.s), light.detail, 1);
    for (const line of L.detail) {
      if (line.length < 2) continue;
      g.beginPath();
      g.moveTo(line[0].x, line[0].y);
      for (let i = 1; i < line.length; i++) g.lineTo(line[i].x, line[i].y);
      g.strokePath();
    }
  }
  for (const gl of L.glow) {
    if (gl.kind === 'dot' && gl.a) {
      g.fillStyle(gl.color, gl.alpha);
      g.fillCircle(gl.a.x, gl.a.y, gl.r ?? 2);
    } else if (gl.kind === 'line' && gl.pts && gl.pts.length > 1) {
      g.lineStyle(gl.w ?? 1, gl.color, gl.alpha);
      g.beginPath();
      g.moveTo(gl.pts[0].x, gl.pts[0].y);
      for (let i = 1; i < gl.pts.length; i++) g.lineTo(gl.pts[i].x, gl.pts[i].y);
      g.strokePath();
    } else if (gl.kind === 'poly' && gl.pts) {
      g.fillStyle(gl.color, gl.alpha);
      g.fillPoints(gl.pts, true);
    }
  }
}
