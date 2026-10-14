import { Character, EASE, type Env } from '../anatomy/Character';
import type { Cut } from '../anatomy/physics';
import { BRUTE, BUTCHER, CRAWLER, DUELIST, GUNNER, LEAPER, NINJA, THUG } from '../anatomy/poses';
import type { Pose, Vec } from '../anatomy/skeleton';
import type { CharId } from '../anatomy/specs';
import type { Dir, EnemyKind, EnemySpawn, KillStyle, NoteInfo, Side } from '../core/types';

export interface Stage {
  W: number;
  H: number;
  groundY: number;
  unit: number;
  heroX: number;
  /** Melee striking distance from the hero (px). */
  strike: number;
  beatMs: number;
  /** Mirror anomaly: logical left is drawn on the right. */
  mirrored: boolean;
  /** Free-fall act: no ground, everyone hangs in the air. */
  falling: boolean;
}

const CHAR_OF: Record<EnemyKind, CharId> = {
  grunt: 'thug',
  brute: 'brute',
  dodger: 'ninja',
  feinter: 'duelist',
  leaper: 'leaper',
  crawler: 'crawler',
  gunner: 'gunner',
  butcher: 'butcher',
};

interface PoseSet {
  idle: Pose;
  wind: Pose;
  strike: Pose;
  feint?: Pose;
  hurt?: Pose;
}

const POSES: Record<EnemyKind, PoseSet> = {
  grunt: { idle: THUG.idle, wind: THUG.wind, strike: THUG.strike, feint: THUG.feint, hurt: THUG.hurt },
  brute: { idle: BRUTE.idle, wind: BRUTE.wind, strike: BRUTE.strike, hurt: BRUTE.hurt },
  dodger: { idle: NINJA.idle, wind: NINJA.wind, strike: NINJA.strike },
  feinter: { idle: DUELIST.idle, wind: DUELIST.wind, strike: DUELIST.strike, feint: DUELIST.feint },
  leaper: { idle: LEAPER.idle, wind: LEAPER.air, strike: LEAPER.dive },
  crawler: { idle: CRAWLER.idle, wind: CRAWLER.idle, strike: CRAWLER.lunge },
  gunner: { idle: GUNNER.aim, wind: GUNNER.aim, strike: GUNNER.recoil },
  butcher: { idle: BUTCHER.idle, wind: BUTCHER.wind, strike: BUTCHER.strike, feint: BUTCHER.rev, hurt: BUTCHER.hurt },
};

export const sideSign = (s: Side) => (s === 'left' ? -1 : 1);

/** Approach speed in body units per beat. */
const SPEED: Record<EnemyKind, number> = { grunt: 30, brute: 22, dodger: 46, feinter: 28, leaper: 40, crawler: 34, gunner: 0, butcher: 18 };

const UPPER = ['chest', 'neck', 'head', 'shoulderF', 'shoulderB', 'elbowF', 'elbowB', 'wristF', 'wristB', 'handF', 'handB', 'grip', 'tip', 'pommel', 'spineUpper', 'neckHead'];
const HEAD = ['head', 'neckHead'];

export interface KillPhysics {
  cuts: Cut[];
  /** Base velocity for the whole body (px/s). */
  v: Vec;
  /** Extra velocity for groups of joints (the flying half, the severed head). */
  extra: { joints: string[]; v: Vec }[];
  spin: number;
}

/** Cuts and impulses for a kill style. `away` is the unit direction away from the hero. */
export function killPhysics(style: KillStyle, away: Vec, dir: Dir, unit: number): KillPhysics {
  const k = unit * 60;
  const up = dir === 'up' ? -1 : dir === 'down' ? 0.4 : 0;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  switch (style) {
    case 'decap':
      return { cuts: ['neck'], v: { x: away.x * k * 0.5, y: -k * 0.2 }, extra: [{ joints: HEAD, v: { x: away.x * k * rnd(0.8, 1.6), y: -k * rnd(2.2, 3.2) } }], spin: (Math.random() < 0.5 ? -1 : 1) * rnd(9, 15) };
    case 'bisect':
      return { cuts: ['waist'], v: { x: away.x * k * 0.35, y: 0 }, extra: [{ joints: UPPER, v: { x: away.x * k * rnd(1.4, 2.2), y: -k * rnd(1.0, 1.6) + up * k } }], spin: 0 };
    case 'cleave':
      return {
        cuts: Math.random() < 0.5 ? ['waist', 'armF'] : ['armF', 'neck'],
        v: { x: away.x * k * 0.6, y: -k * 0.3 + up * k },
        extra: [
          { joints: ['shoulderF', 'elbowF', 'wristF', 'handF', 'grip', 'tip', 'pommel'], v: { x: away.x * k * 1.8, y: -k * 1.6 } },
          { joints: HEAD, v: { x: away.x * k * 0.8, y: -k * 1.8 } },
        ],
        spin: 8,
      };
    case 'impale':
      return { cuts: ['waist'], v: { x: away.x * k * 0.3, y: -k * 0.6 }, extra: [{ joints: UPPER, v: { x: away.x * k * 0.5, y: -k * 2.6 } }], spin: 4 };
    case 'burst':
      return {
        cuts: ['neck', 'waist', 'armF', 'armB', 'legF', 'legB'],
        v: { x: away.x * k * 1.0, y: -k * 1.2 },
        extra: [
          { joints: HEAD, v: { x: away.x * k * rnd(0.5, 1.5), y: -k * rnd(2.5, 3.5) } },
          { joints: ['shoulderF', 'elbowF', 'wristF', 'handF', 'grip', 'tip', 'pommel'], v: { x: -away.x * k * 0.8, y: -k * 2.0 } },
          { joints: ['shoulderB', 'elbowB', 'wristB', 'handB'], v: { x: away.x * k * 1.8, y: -k * 1.5 } },
          { joints: ['hipF', 'kneeF', 'ankleF', 'toeF'], v: { x: away.x * k * 0.6, y: -k * 0.8 } },
        ],
        spin: 16,
      };
    case 'shot':
      return { cuts: ['neck'], v: { x: away.x * k * 0.8, y: -k * 0.3 }, extra: [{ joints: HEAD, v: { x: away.x * k * 1.8, y: -k * 1.2 } }], spin: 12 };
    case 'shove':
    default:
      return { cuts: [], v: { x: away.x * k * 2.6, y: -k * 1.1 }, extra: [], spin: 0 };
  }
}

/**
 * One enemy on stage: computes its position from the director clock (so it reaches striking
 * range exactly on the beat), animates windups/strikes on its notes, and dies as a ragdoll.
 */
export class EnemyActor {
  readonly ch: Character;
  readonly spawn: EnemySpawn;
  side: Side;
  dead = false;
  deadAt = 0;
  /** Corpse opacity (fades after a while). */
  fade = 1;
  /** Pushed back after an armor hit (px). */
  private knock = 0;
  private struck = new Set<number>();
  private winding = new Set<number>();
  private shiftAt = -Infinity;
  /** Afterimage ghost positions (dodger blink). */
  ghost: { x: number; until: number } | null = null;
  readonly far: boolean;

  constructor(spawn: EnemySpawn, private stage: Stage) {
    this.spawn = spawn;
    this.side = spawn.side;
    this.far = spawn.kind === 'gunner';
    const unit = stage.unit * (this.far ? 0.62 : 1);
    this.ch = new Character(CHAR_OF[spawn.kind], { unit, variant: spawn.variant, facing: -sideSign(spawn.side), rest: POSES[spawn.kind].idle });
    this.ch.look.eyeGlow = 0.8;
    this.ch.run.rate = spawn.kind === 'brute' || spawn.kind === 'butcher' ? 1.2 : spawn.kind === 'crawler' ? 2.4 : 1.9;
    this.ch.run.stride = spawn.kind === 'crawler' ? 9 : 16;
    this.ch.run.lift = spawn.kind === 'crawler' ? 5 : 9;
  }

  setStage(stage: Stage): void {
    this.stage = stage;
  }

  get kind(): EnemyKind {
    return this.spawn.kind;
  }

  private visualSign(): number {
    return sideSign(this.side) * (this.stage.mirrored ? -1 : 1);
  }

  /** Where the enemy stands when it strikes. */
  strikePoint(): Vec {
    const st = this.stage;
    const sg = this.visualSign();
    switch (this.kind) {
      case 'leaper':
        return { x: st.heroX + sg * st.unit * 14, y: st.groundY - st.unit * 58 };
      case 'crawler':
        return { x: st.heroX + sg * st.unit * 26, y: st.groundY };
      case 'gunner':
        return { x: st.heroX + sg * st.W * 0.36, y: st.groundY - st.H * 0.075 };
      case 'brute':
      case 'butcher':
        return { x: st.heroX + sg * (st.strike + st.unit * 10), y: st.groundY };
      default:
        return { x: st.heroX + sg * st.strike, y: st.groundY };
    }
  }

  private startPoint(): Vec {
    const st = this.stage;
    const sg = this.visualSign();
    if (this.kind === 'leaper') return { x: st.heroX + sg * st.W * 0.62, y: st.groundY - st.H * 0.3 };
    if (this.kind === 'gunner') return this.strikePoint();
    return { x: st.heroX + sg * (st.W * 0.5 + st.unit * 40), y: st.groundY };
  }

  nextNote(now: number): NoteInfo | null {
    for (const n of this.spawn.notes) if (n.at >= now - 80) return n;
    return null;
  }

  /** Per-frame placement from the director clock. */
  place(now: number, dtMs: number, env: Env): void {
    if (this.dead) {
      this.ch.update(dtMs, env);
      return;
    }
    const st = this.stage;
    const first = this.spawn.notes[0];
    const a = this.startPoint();
    const b = this.strikePoint();
    let x: number;
    let y: number;
    // ground enemies walk in at a constant pace keyed to their next strike, so a queue of
    // enemies arriving on consecutive beats stays spaced out (one beat = one body length)
    const next = this.spawn.notes.find((n) => n.at > now - 60) ?? this.spawn.notes[this.spawn.notes.length - 1];
    const beatsLeft = (next.at - now) / st.beatMs;
    const dist = Math.max(0, beatsLeft - 0.22) * SPEED[this.kind] * st.unit;
    if (st.falling && this.kind !== 'leaper' && this.kind !== 'gunner') {
      const sg = this.visualSign();
      if (this.kind === 'crawler') {
        // rising from below while everyone falls
        x = st.heroX + sg * st.unit * 12;
        y = st.groundY + st.unit * 40 + dist;
      } else {
        x = b.x + sg * dist;
        y = st.groundY + Math.sin(now / 300 + this.spawn.id) * st.unit * 3;
      }
      this.ch.run.w = 0;
      this.ch.facing = -sg;
      this.ch.root.x = x;
      this.ch.root.y = st.groundY;
      this.ch.lift = st.groundY - y;
      this.ch.update(dtMs, env);
      return;
    }
    if (this.kind === 'leaper' && st.falling) {
      // dropping from above
      const sg = this.visualSign();
      x = st.heroX + sg * st.unit * 10;
      y = b.y - dist * 1.4;
      this.ch.anim.rest = beatsLeft < 0.8 ? LEAPER.dive : LEAPER.air;
      this.ch.facing = -sg;
      this.ch.root.x = x;
      this.ch.root.y = st.groundY;
      this.ch.lift = st.groundY - y;
      this.ch.update(dtMs, env);
      return;
    }
    if (this.kind === 'leaper') {
      // crouch on the edge, then leap in an arc that peaks above the hero's head
      const leapStart = first.at - st.beatMs * 1.4;
      void a;
      const q = Math.max(0, Math.min(1, (now - leapStart) / (first.at - leapStart)));
      if (q <= 0) {
        x = a.x;
        y = a.y;
        this.ch.anim.rest = LEAPER.crouch;
      } else {
        x = a.x + (b.x - a.x) * EASE.outQuad(q);
        y = a.y + (b.y - a.y) * q - Math.sin(q * Math.PI) * st.H * 0.08;
        this.ch.anim.rest = q > 0.75 ? LEAPER.dive : LEAPER.air;
      }
      this.ch.run.w = 0;
    } else if (this.kind === 'gunner') {
      x = b.x;
      y = b.y;
      this.ch.run.w = 0;
    } else {
      x = b.x + this.visualSign() * dist;
      y = b.y;
      const moving = dist > st.unit * 2;
      this.ch.run.w += ((moving ? 1 : 0) - this.ch.run.w) * Math.min(1, dtMs / 120);
    }
    x += this.knock * this.visualSign();
    this.knock *= Math.pow(0.02, dtMs / 1000);
    this.ch.facing = -this.visualSign();
    this.ch.root.x = x;
    this.ch.root.y = this.kind === 'leaper' || this.kind === 'gunner' ? st.groundY : y;
    this.ch.lift = this.kind === 'leaper' ? st.groundY - y : this.kind === 'gunner' ? st.groundY - y : 0;
    this.ch.update(dtMs, env);
  }

  /** One beat before a note: wind up (white eyes for a feint). */
  telegraph(n: NoteInfo, now: number): void {
    if (this.dead || this.winding.has(n.id)) return;
    this.winding.add(n.id);
    const set = POSES[this.kind];
    const lead = Math.max(80, n.at - now);
    this.ch.look.eyeColor = n.feint ? 0xffffff : this.kind === 'feinter' ? 0xff1a2a : undefined;
    this.ch.look.eyeGlow = 1.4;
    // the attacker's rim flares (red for a real strike, cold white for a feint)
    this.ch.look.rimTint = n.feint ? 0xdde6ff : 0xff2030;
    this.ch.look.rimTintK = 1;
    if (this.kind === 'leaper' || this.kind === 'gunner') return;
    this.ch.anim.play([{ pose: n.feint && set.feint ? set.feint : set.wind, dur: lead * 0.85, ease: EASE.outCubic }]);
  }

  /** On the beat: strike (or the fake for a feint). */
  strike(n: NoteInfo): void {
    if (this.dead || this.struck.has(n.id)) return;
    this.struck.add(n.id);
    const set = POSES[this.kind];
    if (n.feint) {
      this.ch.anim.act([{ pose: set.feint ?? set.wind, dur: 90 }, { pose: set.idle, dur: 220 }], 200);
      this.ch.look.eyeGlow = 0.8;
      return;
    }
    this.ch.anim.act([{ pose: set.strike, dur: 70, ease: EASE.inQuad }, { pose: set.strike, dur: 140 }], 260);
  }

  hurt(): void {
    const set = POSES[this.kind];
    this.knock = this.stage.unit * 10;
    this.ch.flash = 70;
    this.ch.recoil = 0.6;
    this.ch.anim.act([{ pose: set.hurt ?? set.idle, dur: 90 }], 260);
  }

  shift(to: Side, now: number): void {
    const before = this.ch.root.x;
    this.side = to;
    this.shiftAt = now;
    this.ghost = { x: before, until: now + 220 };
    this.ch.anim.act([{ pose: NINJA.blink, dur: 60 }], 200);
  }

  get justShifted(): boolean {
    return this.shiftAt > -Infinity;
  }

  die(style: KillStyle, dir: Dir, now: number): { cuts: Cut[] } {
    this.dead = true;
    this.deadAt = now;
    const away = { x: this.visualSign(), y: 0 };
    const phys = killPhysics(style, away, dir, this.stage.unit * (this.far ? 0.62 : 1));
    const rd = this.ch.kill(phys.cuts, phys.v, phys.spin);
    for (const e of phys.extra) rd.push(e.v, e.joints);
    return { cuts: phys.cuts };
  }

  /** Key points for effects. */
  get chest(): Vec {
    return this.ch.frame.j.chest;
  }

  get head(): Vec {
    return this.ch.frame.j.head;
  }

  get muzzle(): Vec {
    return this.ch.frame.j.tip;
  }
}
