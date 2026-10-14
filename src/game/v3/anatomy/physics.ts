import type { Frame, JointName, Joints, Vec } from './skeleton';

/**
 * Verlet physics for cloth (coats, scarves, capes, hair) and for ragdolls with dismemberment.
 * Units are screen pixels and seconds.
 */

export interface Particle {
  x: number;
  y: number;
  px: number;
  py: number;
  /** Body radius (px) so corpses rest with their thickness, not on their bones. */
  r?: number;
}

const RADIUS: Record<string, number> = {
  head: 6.2,
  neck: 3,
  chest: 8,
  spine: 7,
  pelvis: 8,
  shoulderF: 4.5,
  shoulderB: 4.5,
  elbowF: 3.2,
  elbowB: 3.2,
  wristF: 2.6,
  wristB: 2.6,
  handF: 2.4,
  handB: 2.4,
  hipF: 6,
  hipB: 6,
  kneeF: 4.2,
  kneeB: 4.2,
  ankleF: 2.8,
  ankleB: 2.8,
  toeF: 1.5,
  toeB: 1.5,
  grip: 1,
  tip: 1,
  pommel: 1,
};

/** A chain pinned at its first point (cloth strip, scarf, hair lock, chain weapon). */
export class Strand {
  readonly pts: Particle[] = [];

  constructor(
    count: number,
    public segLen: number,
  ) {
    for (let i = 0; i < count; i++) this.pts.push({ x: 0, y: i * segLen, px: 0, py: i * segLen });
  }

  reset(anchor: Vec, dir: Vec = { x: 0, y: 1 }): void {
    this.pts.forEach((p, i) => {
      p.x = p.px = anchor.x + dir.x * i * this.segLen;
      p.y = p.py = anchor.y + dir.y * i * this.segLen;
    });
  }

  /**
   * Pins the first point to `anchor` and integrates. `force` is an acceleration (px/s²) that
   * includes gravity and wind. `floor` keeps points above the ground.
   */
  step(anchor: Vec, dt: number, force: Vec, damping = 0.9, floor = Infinity, stiffness = 3): void {
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
      p.x += vx + force.x * d * d;
      p.y += vy + force.y * d * d;
    }
    for (let it = 0; it < stiffness; it++) {
      for (let i = 1; i < this.pts.length; i++) {
        const a = this.pts[i - 1];
        const b = this.pts[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1e-4;
        const diff = (dist - this.segLen) / dist;
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
      p0.x = anchor.x;
      p0.y = anchor.y;
      for (let i = 1; i < this.pts.length; i++) if (this.pts[i].y > floor) this.pts[i].y = floor;
    }
  }

  /** Free fall (the whole strip is no longer attached — e.g. a severed scarf). */
  fall(dt: number, force: Vec, floor: number): void {
    const p0 = this.pts[0];
    const anchor = { x: p0.x + (p0.x - p0.px) * 0.96, y: p0.y + (p0.y - p0.py) * 0.96 + force.y * dt * dt };
    this.step({ x: anchor.x, y: Math.min(anchor.y, floor) }, dt, force, 0.94, floor);
  }
}

// ------------------------------------------------------------------ ragdoll

export type BodyPiece = 'torso' | 'upper' | 'lower' | 'head' | 'armF' | 'armB' | 'legF' | 'legB' | 'weapon';

const BONES: [JointName, JointName][] = [
  ['pelvis', 'spine'],
  ['spine', 'chest'],
  ['chest', 'neck'],
  ['neck', 'head'],
  ['chest', 'shoulderF'],
  ['chest', 'shoulderB'],
  ['shoulderF', 'elbowF'],
  ['elbowF', 'wristF'],
  ['wristF', 'handF'],
  ['shoulderB', 'elbowB'],
  ['elbowB', 'wristB'],
  ['wristB', 'handB'],
  ['pelvis', 'hipF'],
  ['pelvis', 'hipB'],
  ['hipF', 'kneeF'],
  ['kneeF', 'ankleF'],
  ['ankleF', 'toeF'],
  ['hipB', 'kneeB'],
  ['kneeB', 'ankleB'],
  ['ankleB', 'toeB'],
  ['wristF', 'grip'],
  ['grip', 'tip'],
  ['grip', 'pommel'],
  // braces keep the trunk and head rigid
  ['pelvis', 'chest'],
  ['spine', 'neck'],
  ['shoulderF', 'shoulderB'],
  ['hipF', 'hipB'],
  ['spine', 'shoulderF'],
  ['spine', 'shoulderB'],
  ['chest', 'head'],
  ['ankleF', 'kneeF'],
  ['wristF', 'tip'],
];

/** Which bones a cut removes, and which joint gets duplicated as the cut surface. */
export type Cut = 'neck' | 'waist' | 'armF' | 'armB' | 'legF' | 'legB' | 'weapon';
const CUT_BONES: Record<Cut, string[]> = {
  neck: ['neck-head', 'chest-head', 'spine-neck'],
  waist: ['spine-chest', 'pelvis-chest', 'spine-neck', 'spine-shoulderF', 'spine-shoulderB'],
  armF: ['chest-shoulderF', 'shoulderF-shoulderB', 'spine-shoulderF'],
  armB: ['chest-shoulderB', 'shoulderF-shoulderB', 'spine-shoulderB'],
  legF: ['pelvis-hipF', 'hipF-hipB'],
  legB: ['pelvis-hipB', 'hipF-hipB'],
  weapon: ['wristF-grip', 'wristF-tip'],
};

interface Link {
  a: string;
  b: string;
  rest: number;
  key: string;
}

/**
 * Verlet ragdoll seeded from a living frame. Joints become particles; bones become distance links.
 * Cuts remove links and duplicate the joint at the cut so both pieces keep their own surface.
 */
export class Ragdoll {
  readonly p = new Map<string, Particle>();
  private links: Link[] = [];
  readonly cuts = new Set<Cut>();
  readonly facing: number;
  readonly s: number;
  /** Head spin for a severed head (rad/s). */
  spin = 0;
  headAngle = 0;
  rest = 0;

  constructor(
    frame: Frame,
    velocity: Vec,
    private readonly floor: number,
  ) {
    this.facing = frame.facing;
    this.s = frame.s;
    for (const [k, v] of Object.entries(frame.j) as [JointName, Vec][]) {
      if (k === 'root') continue;
      this.p.set(k, { x: v.x, y: v.y, px: v.x - velocity.x / 60, py: v.y - velocity.y / 60, r: (RADIUS[k] ?? 2) * frame.s });
    }
    for (const [a, b] of BONES) {
      const pa = this.p.get(a)!;
      const pb = this.p.get(b)!;
      this.links.push({ a, b, rest: Math.hypot(pa.x - pb.x, pa.y - pb.y), key: `${a}-${b}` });
    }
    this.headAngle = Math.atan2(frame.headUp.y, frame.headUp.x);
  }

  /** Adds velocity (px/s) to a set of joints (or all). */
  push(v: Vec, joints?: string[]): void {
    for (const [k, p] of this.p) {
      if (joints && !joints.includes(k)) continue;
      p.px -= v.x / 60;
      p.py -= v.y / 60;
    }
  }

  cut(kind: Cut): void {
    if (this.cuts.has(kind)) return;
    this.cuts.add(kind);
    const remove = new Set(CUT_BONES[kind]);
    this.links = this.links.filter((l) => !remove.has(l.key));
    const dup = (from: string, to: string) => {
      const o = this.p.get(from)!;
      this.p.set(to, { ...o });
    };
    if (kind === 'neck') {
      dup('neck', 'neckHead');
      this.links.push({ a: 'neckHead', b: 'head', rest: Math.hypot(this.p.get('neck')!.x - this.p.get('head')!.x, this.p.get('neck')!.y - this.p.get('head')!.y), key: 'neckHead-head' });
    }
    if (kind === 'waist') {
      dup('spine', 'spineUpper');
      const sp = this.p.get('spineUpper')!;
      const ch = this.p.get('chest')!;
      this.links.push({ a: 'spineUpper', b: 'chest', rest: Math.hypot(sp.x - ch.x, sp.y - ch.y), key: 'spineUpper-chest' });
      for (const sh of ['shoulderF', 'shoulderB']) {
        const q = this.p.get(sh)!;
        this.links.push({ a: 'spineUpper', b: sh, rest: Math.hypot(sp.x - q.x, sp.y - q.y), key: `spineUpper-${sh}` });
      }
      const nk = this.p.get('neck')!;
      this.links.push({ a: 'spineUpper', b: 'neck', rest: Math.hypot(sp.x - nk.x, sp.y - nk.y), key: 'spineUpper-neck' });
    }
  }

  step(dt: number, gravity: number): void {
    const d = Math.min(dt, 0.033);
    for (const p of this.p.values()) {
      const vx = (p.x - p.px) * 0.995;
      const vy = (p.y - p.py) * 0.995;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy + gravity * d * d;
    }
    for (let it = 0; it < 4; it++) {
      for (const l of this.links) {
        const a = this.p.get(l.a)!;
        const b = this.p.get(l.b)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1e-4;
        const diff = ((dist - l.rest) / dist) * 0.5;
        a.x += dx * diff;
        a.y += dy * diff;
        b.x -= dx * diff;
        b.y -= dy * diff;
      }
      for (const p of this.p.values()) {
        const fl = this.floor - (p.r ?? 0) * 0.85;
        if (p.y > fl) {
          p.y = fl;
          // ground friction
          p.px = p.x - (p.x - p.px) * 0.6;
        }
      }
    }
    if (this.cuts.has('neck')) this.headAngle += this.spin * d;
    this.spin *= 0.985;
    let moving = 0;
    for (const p of this.p.values()) moving = Math.max(moving, Math.abs(p.x - p.px) + Math.abs(p.y - p.py));
    this.rest = moving < 0.15 ? this.rest + d : 0;
  }

  /** Current joints (for the silhouette renderer) plus cut surfaces. */
  frame(): Frame {
    const g = (k: string) => {
      const p = this.p.get(k)!;
      return { x: p.x, y: p.y };
    };
    const j = {} as Joints;
    for (const k of this.p.keys()) if (!k.includes('Upper') && k !== 'neckHead') (j as Record<string, Vec>)[k] = g(k);
    const pel = g('pelvis');
    j.root = { x: pel.x, y: this.floor };
    const chest = g('chest');
    const neck = g('neck');
    const up = norm2(chest.x - g('spine').x, chest.y - g('spine').y);
    const headBase = this.cuts.has('neck') ? g('neckHead') : neck;
    const head = g('head');
    const headUp = this.cuts.has('neck') ? { x: Math.cos(this.headAngle), y: Math.sin(this.headAngle) } : norm2(head.x - headBase.x, head.y - headBase.y);
    return {
      j,
      up: this.cuts.has('waist') ? norm2(chest.x - g('spineUpper').x, chest.y - g('spineUpper').y) : up,
      headUp,
      facing: this.facing,
      s: this.s,
      cut: {
        spineUpper: this.cuts.has('waist') ? g('spineUpper') : undefined,
        neckHead: this.cuts.has('neck') ? g('neckHead') : undefined,
        armF: this.cuts.has('armF'),
        armB: this.cuts.has('armB'),
        legF: this.cuts.has('legF'),
        legB: this.cuts.has('legB'),
      },
    };
  }
}

function norm2(x: number, y: number): Vec {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}
