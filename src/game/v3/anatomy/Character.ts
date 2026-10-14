import type Phaser from 'phaser';
import { buildLayers, drawLayers, type Layers, type Light, type LookState } from './look';
import { Ragdoll, Strand, type Cut } from './physics';
import { runCycle } from './poses';
import { add, clonePose, lerpPose, mul, NEUTRAL, solve, type Frame, type Pose, type Vec } from './skeleton';
import { SPECS, THUG_VARIANTS, type CharId, type CharSpec, type ClothId } from './specs';

export type Ease = (t: number) => number;

export const EASE = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

export interface Key {
  pose: Pose;
  dur: number;
  ease?: Ease;
}

function mixColor(a: number, b: number, k: number): number {
  const ch = (c: number, sh: number) => (c >> sh) & 0xff;
  const m = (sh: number) => Math.round(ch(a, sh) + (ch(b, sh) - ch(a, sh)) * k);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

/** Keyframe player: blends from the current pose through a queue of keys, then rests on `rest`. */
export class Animator {
  pose: Pose;
  rest: Pose;
  private from: Pose;
  private queue: Key[] = [];
  private t = 0;

  constructor(rest: Pose) {
    this.rest = rest;
    this.pose = clonePose(rest);
    this.from = clonePose(rest);
  }

  play(keys: Key[]): void {
    this.from = clonePose(this.pose);
    this.queue = keys.slice();
    this.t = 0;
  }

  /** Play keys, then return to the rest pose over `back` ms. */
  act(keys: Key[], back = 260): void {
    this.play([...keys, { pose: this.rest, dur: back, ease: EASE.inOutSine }]);
  }

  setRest(p: Pose, blendMs = 0): void {
    this.rest = p;
    if (!this.queue.length) this.play([{ pose: p, dur: Math.max(1, blendMs), ease: EASE.inOutSine }]);
  }

  get busy(): boolean {
    return this.queue.length > 0;
  }

  update(dt: number): void {
    if (!this.queue.length) {
      lerpPose(this.pose, this.rest, Math.min(1, dt / 120), this.pose);
      return;
    }
    this.t += dt;
    while (this.queue.length) {
      const k = this.queue[0];
      if (this.t < k.dur) {
        const e = (k.ease ?? EASE.outCubic)(Math.max(0, Math.min(1, this.t / Math.max(1, k.dur))));
        lerpPose(this.from, k.pose, e, this.pose);
        return;
      }
      this.t -= k.dur;
      this.from = clonePose(k.pose);
      Object.assign(this.pose, k.pose);
      this.queue.shift();
    }
  }
}

export interface Env {
  /** Horizontal wind acceleration (units/s², + = right). */
  wind: number;
  /** Ground line (screen y). */
  floor: number;
  /** Extra vertical air flow (falling act: cloth streams upward). */
  updraft?: number;
}

interface ClothDef {
  id: ClothId;
  count: number;
  seg: number;
  /** Anchor in body terms. */
  at: (f: Frame, s: number) => Vec;
  dirY?: number;
}

const back = (f: Frame) => ({ x: -f.facing, y: 0 });
const fwd = (f: Frame) => ({ x: f.facing, y: 0 });

const CLOTH: Record<ClothId, ClothDef[]> = {
  coatSkirt: [
    { id: 'coatSkirt', count: 7, seg: 5.2, at: (f, s) => add(add(f.j.pelvis, mul(back(f), 5.5 * s)), mul(f.up, 3 * s)) },
    { id: 'coatSkirt', count: 6, seg: 5.0, at: (f, s) => add(f.j.pelvis, mul(back(f), 1.5 * s)) },
    { id: 'coatSkirt', count: 5, seg: 4.6, at: (f, s) => add(add(f.j.pelvis, mul(fwd(f), 4.5 * s)), mul(f.up, 2 * s)) },
  ],
  scarf: [
    { id: 'scarf', count: 10, seg: 5.6, at: (f, s) => add(add(f.j.neck, mul(back(f), 2.5 * s)), mul(f.up, 1 * s)) },
    { id: 'scarf', count: 6, seg: 4.6, at: (f, s) => add(add(f.j.neck, mul(back(f), 1.5 * s)), mul(f.up, -0.5 * s)) },
  ],
  cape: [
    { id: 'cape', count: 8, seg: 8.5, at: (f, s) => add(f.j.shoulderB, mul(back(f), 3 * s)) },
    { id: 'cape', count: 8, seg: 8.0, at: (f, s) => add(f.j.chest, mul(back(f), 7 * s)) },
  ],
  sash: [
    { id: 'sash', count: 5, seg: 4.2, at: (f, s) => add(f.j.pelvis, add(mul(back(f), 7 * s), mul(f.up, 6 * s))) },
    { id: 'sash', count: 4, seg: 4.0, at: (f, s) => add(f.j.pelvis, add(mul(back(f), 6 * s), mul(f.up, 5 * s))) },
  ],
  ponytail: [{ id: 'ponytail', count: 8, seg: 3.6, at: (f, s) => add(f.j.head, add(mul(back(f), 4.5 * s), mul(f.headUp, 5.5 * s))) }],
  ninjaTails: [
    { id: 'ninjaTails', count: 6, seg: 4.2, at: (f, s) => add(f.j.head, mul(back(f), 6 * s)) },
    { id: 'ninjaTails', count: 5, seg: 4.0, at: (f, s) => add(f.j.head, add(mul(back(f), 5.5 * s), mul(f.headUp, -2 * s))) },
  ],
  apronFlap: [{ id: 'apronFlap', count: 5, seg: 5.6, at: (f, s) => add(f.j.spine, mul(fwd(f), 12 * s)) }],
  robe: [],
  tie: [{ id: 'tie', count: 5, seg: 2.8, at: (f, s) => add(f.j.neck, add(mul(fwd(f), 2.6 * s), mul(f.up, -2 * s))) }],
  kimonoSleeve: [
    { id: 'kimonoSleeve', count: 3, seg: 4.2, at: (f) => f.j.elbowF },
    { id: 'kimonoSleeve', count: 3, seg: 4.2, at: (f) => f.j.elbowB },
  ],
  rags: [
    { id: 'rags', count: 4, seg: 4.0, at: (f, s) => add(f.j.pelvis, mul(back(f), 6 * s)) },
    { id: 'rags', count: 4, seg: 3.6, at: (f, s) => add(f.j.pelvis, mul(fwd(f), 5 * s)) },
    { id: 'rags', count: 3, seg: 3.6, at: (f) => f.j.pelvis },
  ],
};

export interface CharacterOptions {
  variant?: number;
  facing?: number;
  /** Pixels per body unit before the spec's own scale. */
  unit: number;
  rest?: Pose;
}

/**
 * One fighter: spec + animation + cloth + (after death) ragdoll pieces, drawn as a noir silhouette.
 */
export class Character {
  readonly spec: CharSpec;
  readonly look: LookState;
  readonly anim: Animator;
  facing: number;
  /** Ground point under the character (screen). */
  root: Vec = { x: 0, y: 0 };
  /** Pixels per unit (unit × spec.scale). */
  s: number;
  frame: Frame;
  ragdoll: Ragdoll | null = null;
  cloth: Partial<Record<ClothId, Strand[]>> = {};
  /** Run cycle blend 0..1 and phase. */
  run = { w: 0, phase: 0, rate: 1.6, stride: 15, lift: 8 };
  /** Additive recoil (decays). */
  recoil = 0;
  flash = 0;
  alpha = 1;
  visible = true;
  /** Extra root offset (jumps, dashes) in pixels. */
  lift = 0;
  private time = Math.random() * 10;
  private work: Pose = clonePose(NEUTRAL);
  private clothReady = false;

  constructor(
    id: CharId,
    opts: CharacterOptions,
  ) {
    const base = SPECS[id];
    const variant = opts.variant ?? 0;
    this.spec = base;
    this.facing = opts.facing ?? 1;
    this.s = opts.unit * base.scale;
    this.anim = new Animator(opts.rest ?? NEUTRAL);
    this.look = { blood: 0, eyeGlow: 1, armed: true, hot: 0, time: 0 };
    if (id === 'thug') {
      const v = THUG_VARIANTS[variant % THUG_VARIANTS.length];
      this.look.headwear = v.headwear;
      this.look.weapon = v.weapon;
    }
    for (const c of base.cloth) {
      const defs = CLOTH[c];
      this.cloth[c] = defs.map((d) => new Strand(d.count, d.seg * this.s));
    }
    this.frame = solve(base.body, this.anim.pose, this.root, this.facing, this.s);
  }

  place(root: Vec, unit?: number): void {
    this.root = { ...root };
    if (unit !== undefined) {
      this.s = unit * this.spec.scale;
      for (const c of this.spec.cloth) this.cloth[c]?.forEach((st, i) => (st.segLen = CLOTH[c][i].seg * this.s));
    }
    this.clothReady = false;
  }

  get alive(): boolean {
    return !this.ragdoll;
  }

  update(dtMs: number, env: Env): void {
    const dt = dtMs / 1000;
    this.time += dt;
    this.look.time = this.time;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs);
    if (this.look.rimTintK) this.look.rimTintK = Math.max(0, this.look.rimTintK - dtMs / 900);
    if (this.ragdoll) {
      this.ragdoll.step(dt, 980 * this.s * 0.55);
      this.frame = this.ragdoll.frame();
      this.stepCloth(dt, env, true);
      return;
    }
    this.anim.update(dtMs);
    let p = this.anim.pose;
    if (this.run.w > 0.01) {
      this.run.phase = (this.run.phase + dt * this.run.rate) % 1;
      const r = runCycle(p, this.run.phase, this.run.stride, this.run.lift);
      p = lerpPose(p, r, this.run.w, this.work);
    } else {
      Object.assign(this.work, p);
      p = this.work;
    }
    // life: breathing, sway, recoil
    const b = Math.sin(this.time * 2.3);
    p.lean += b * 0.012 - this.recoil * 0.4;
    p.head += Math.sin(this.time * 1.4) * 0.02 - this.recoil * 0.5;
    p.sF += Math.sin(this.time * 2.3 + 0.6) * 0.015;
    p.py += b * 0.35;
    this.recoil *= Math.pow(0.004, dt);
    const root = { x: this.root.x, y: this.root.y - this.lift };
    this.frame = solve(this.spec.body, p, root, this.facing, this.s);
    this.stepCloth(dt, env, false);
  }

  private stepCloth(dt: number, env: Env, dead: boolean): void {
    const s = this.s;
    const force = { x: env.wind * s, y: (560 - (env.updraft ?? 0)) * s };
    for (const c of this.spec.cloth) {
      const strands = this.cloth[c];
      if (!strands) continue;
      CLOTH[c].forEach((def, i) => {
        const st = strands[i];
        const anchor = def.at(this.frame, s);
        if (!this.clothReady) st.reset(anchor, { x: -this.facing * 0.3, y: 1 });
        const damping = c === 'scarf' ? 0.93 : c === 'cape' ? 0.92 : 0.88;
        st.step(anchor, dt, force, damping, env.floor - 1, c === 'tie' ? 4 : 3);
      });
    }
    void dead;
    this.clothReady = true;
  }

  layers(): Layers {
    return buildLayers({ frame: this.frame, spec: this.spec, look: this.look, cloth: this.cloth });
  }

  draw(g: Phaser.GameObjects.Graphics, light: Light, opts: { flat?: number | null; noRim?: boolean } = {}): Layers {
    const L = this.layers();
    let lit = light;
    const k = this.look.rimTintK ?? 0;
    if (this.look.hero || k > 0.02) {
      lit = { ...light };
      if (this.look.hero) {
        lit.rimA = 0xffffff;
        lit.rimAW = light.rimAW * 1.25;
        lit.haloW = light.haloW * 1.2;
      }
      if (k > 0.02) {
        lit.rimA = mixColor(light.rimA, this.look.rimTint ?? 0xff2a3a, k);
        lit.rimHalo = mixColor(light.rimHalo, 0xa00010, k);
        lit.rimAW = light.rimAW * (1 + k * 0.6);
      }
    }
    drawLayers(g, L, { light: lit, s: this.s, flash: this.flash > 0, flat: opts.flat, noRim: opts.noRim });
    return L;
  }

  /** Turns into a ragdoll; `cuts` sever pieces; `impulse` in px/s. */
  kill(cuts: Cut[], impulse: Vec, spin = 0): Ragdoll {
    const rd = new Ragdoll(this.frame, impulse, this.root.y);
    for (const c of cuts) rd.cut(c);
    rd.spin = spin;
    this.ragdoll = rd;
    this.look.eyeGlow = 0;
    return rd;
  }

  /** Sets a pose immediately (no blend). */
  snap(p: Pose): void {
    this.anim.rest = p;
    this.anim.play([{ pose: p, dur: 1 }]);
    this.anim.update(2);
  }
}
