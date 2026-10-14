import { Character, EASE, type Env } from '../anatomy/Character';
import { CLEANER, FOX, HERO, RONIN, VERDICT } from '../anatomy/poses';
import type { Vec } from '../anatomy/skeleton';
import type { BossMove, CameoId, Dir, Side } from '../core/types';
import { sideSign, type Stage } from './actors';

/** The player's avatar: stays at the center, snaps toward threats and cuts. */
export class HeroCtl {
  readonly ch: Character;
  private dash = 0;
  private dashTarget = 0;
  private variant = 0;
  facing = 1;
  falling = false;

  constructor(private stage: Stage) {
    this.ch = new Character('hero', { unit: stage.unit, facing: 1, rest: HERO.guard });
    this.ch.look.hero = true;
  }

  setStage(stage: Stage): void {
    this.stage = stage;
  }

  /** Visual side sign for a logical side under the mirror. */
  private vs(side: Side): number {
    return sideSign(side) * (this.stage.mirrored ? -1 : 1);
  }

  face(sign: number): void {
    this.facing = sign;
    this.ch.facing = sign;
  }

  slash(dir: Dir, target: Vec | null): void {
    this.variant++;
    const st = this.stage;
    if (dir === 'left' || dir === 'right') {
      const sign = dir === 'left' ? -1 : 1;
      this.face(sign);
      const reach = target ? Math.max(0, Math.abs(target.x - st.heroX) - st.unit * 34) : st.unit * 6;
      this.dashTarget = sign * Math.min(reach, st.unit * 16);
      if (this.variant % 3 === 2) this.ch.anim.act([{ pose: HERO.kesaWind, dur: 40 }, { pose: HERO.kesaHit, dur: 60, ease: EASE.outCubic }, { pose: HERO.kesaHit, dur: 110 }], 240);
      else this.ch.anim.act([{ pose: HERO.slashWind, dur: 40 }, { pose: HERO.slashHit, dur: 55, ease: EASE.outCubic }, { pose: HERO.slashFollow, dur: 120 }], 240);
    } else if (dir === 'up') {
      this.dashTarget = target ? (target.x - st.heroX) * 0.5 : 0;
      if (target) this.face(target.x < st.heroX ? -1 : 1);
      this.ch.anim.act([{ pose: HERO.upWind, dur: 40 }, { pose: HERO.upHit, dur: 75, ease: EASE.outCubic }, { pose: HERO.upHit, dur: 130 }], 260);
    } else {
      this.dashTarget = target ? (target.x - st.heroX) * 0.55 : 0;
      if (target) this.face(target.x < st.heroX ? -1 : 1);
      this.ch.anim.act([{ pose: HERO.downWind, dur: 40 }, { pose: HERO.downHit, dur: 65, ease: EASE.inQuad }, { pose: HERO.downHit, dur: 150 }], 260);
    }
    this.ch.look.blood = Math.min(1, this.ch.look.blood + 0.08);
  }

  whiff(dir: Dir): void {
    if (dir === 'left' || dir === 'right') this.face(dir === 'left' ? -1 : 1);
    this.dashTarget = 0;
    const p = dir === 'up' ? HERO.upHit : dir === 'down' ? HERO.downHit : HERO.whiff;
    this.ch.anim.act([{ pose: p, dur: 70 }, { pose: p, dur: 90 }], 220);
  }

  parry(move: BossMove, bossSide: Side): void {
    this.face(this.vs(bossSide));
    const p = move === 'high' ? HERO.parryHigh : move === 'low' ? HERO.parryLow : HERO.parryMid;
    this.dashTarget = this.facing * this.stage.unit * 4;
    this.ch.anim.act([{ pose: p, dur: 50, ease: EASE.outCubic }, { pose: p, dur: 140 }], 260);
  }

  execCut(dir: Dir, bossSide: Side): void {
    this.face(this.vs(bossSide));
    this.dashTarget = this.facing * this.stage.unit * 26;
    const map: Record<Dir, [typeof HERO.guard, typeof HERO.guard]> = {
      left: [HERO.slashWind, HERO.slashHit],
      right: [HERO.kesaWind, HERO.kesaHit],
      up: [HERO.upWind, HERO.upHit],
      down: [HERO.downWind, HERO.downHit],
    };
    const [w, h] = map[dir];
    this.ch.anim.act([{ pose: w, dur: 45 }, { pose: h, dur: 70, ease: EASE.outCubic }, { pose: h, dur: 160 }], 280);
  }

  hit(fromSign: number): void {
    this.face(fromSign);
    this.dashTarget = -fromSign * this.stage.unit * 10;
    this.ch.flash = 80;
    this.ch.recoil = 1;
    this.ch.anim.act([{ pose: HERO.hit, dur: 70 }, { pose: HERO.hit, dur: 120 }], 300);
  }

  kneel(ms: number): void {
    this.ch.anim.act([{ pose: HERO.kneel, dur: 180 }, { pose: HERO.kneel, dur: Math.max(0, ms - 400) }], 300);
  }

  victory(): void {
    this.ch.anim.rest = HERO.victory;
    this.ch.anim.act([{ pose: HERO.chiburi, dur: 160 }, { pose: HERO.victory, dur: 500, ease: EASE.inOutSine }], 600);
    this.ch.look.blood = 0;
  }

  land(): void {
    this.ch.anim.act([{ pose: HERO.land, dur: 60 }, { pose: HERO.land, dur: 260 }], 360);
  }

  setFalling(on: boolean): void {
    this.falling = on;
    this.ch.anim.rest = on ? HERO.fall : HERO.guard;
  }

  update(now: number, dtMs: number, env: Env): void {
    this.dash += (this.dashTarget - this.dash) * Math.min(1, dtMs / 45);
    this.dashTarget *= Math.pow(0.0004, dtMs / 1000);
    this.ch.root.x = this.stage.heroX + this.dash;
    this.ch.root.y = this.stage.groundY;
    this.ch.lift = this.falling ? this.stage.unit * (6 + Math.sin(now / 420) * 3) : 0;
    this.ch.update(dtMs, env);
  }

  get pos(): Vec {
    return { x: this.ch.root.x, y: this.stage.groundY };
  }

  get chest(): Vec {
    return this.ch.frame.j.chest;
  }
}

/** VERDICT: stands to the hero's right, winds up on the boss track and lunges on the beat. */
export class BossCtl {
  readonly ch: Character;
  visible = false;
  x = 0;
  private lunge = 0;
  private enter = 0;
  dead = false;
  rage = false;

  constructor(private stage: Stage) {
    this.ch = new Character('verdict', { unit: stage.unit, facing: -1, rest: VERDICT.idle });
    this.ch.look.eyeGlow = 1;
  }

  setStage(stage: Stage): void {
    this.stage = stage;
  }

  home(): number {
    return this.stage.W * 0.74;
  }

  appear(): void {
    this.visible = true;
    this.enter = 1;
    this.ch.anim.rest = VERDICT.idle;
    this.ch.anim.act([{ pose: VERDICT.roar, dur: 500, ease: EASE.outCubic }, { pose: VERDICT.roar, dur: 600 }], 600);
  }

  windup(move: BossMove, lead: number): void {
    const p = move === 'high' ? VERDICT.windHigh : move === 'low' ? VERDICT.windLow : move === 'thrust' ? VERDICT.windThrust : VERDICT.feint;
    this.ch.look.eyeColor = move === 'feint' ? 0xffffff : 0xff1a2a;
    this.ch.look.eyeGlow = 1.5;
    this.ch.anim.play([{ pose: p, dur: Math.max(60, lead * 0.85), ease: EASE.outCubic }]);
  }

  strike(move: BossMove): void {
    if (move === 'feint') {
      this.ch.anim.act([{ pose: VERDICT.feint, dur: 90 }, { pose: VERDICT.guard, dur: 220 }], 260);
      return;
    }
    const p = move === 'high' ? VERDICT.strikeHigh : move === 'low' ? VERDICT.strikeLow : VERDICT.strikeThrust;
    this.lunge = -this.stage.unit * 26;
    this.ch.anim.act([{ pose: p, dur: 70, ease: EASE.inQuad }, { pose: p, dur: 150 }], 300);
  }

  parried(): void {
    this.lunge = this.stage.unit * 6;
    this.ch.flash = 50;
    this.ch.anim.act([{ pose: VERDICT.hurt, dur: 80 }], 240);
  }

  broken(): void {
    this.ch.anim.rest = VERDICT.broken;
    this.ch.anim.act([{ pose: VERDICT.hurt, dur: 120 }, { pose: VERDICT.broken, dur: 500, ease: EASE.outCubic }], 300);
    this.ch.look.eyeColor = 0xffffff;
  }

  flinch(): void {
    this.ch.flash = 60;
    this.ch.recoil = 0.8;
  }

  update(now: number, dtMs: number, env: Env): void {
    if (!this.visible) return;
    this.enter *= Math.pow(0.02, dtMs / 1000);
    this.lunge *= Math.pow(0.004, dtMs / 1000);
    this.x = this.home() + this.lunge + this.enter * this.stage.W * 0.4;
    this.ch.root.x = this.x;
    this.ch.root.y = this.stage.groundY;
    if (this.rage) this.ch.look.eyeGlow = 1.2 + Math.sin(now / 90) * 0.3;
    this.ch.update(dtMs, env);
  }

  get chest(): Vec {
    return this.ch.frame.j.chest;
  }
}

/** A cameo fighter that helps on one flank (or, for the butcher, is an enemy — handled elsewhere). */
export class CameoCtl {
  readonly ch: Character;
  visible = false;
  private appearT = 0;
  private leaving = false;
  private kick = 0;

  constructor(
    readonly id: Exclude<CameoId, 'butcher'>,
    readonly side: Side,
    private stage: Stage,
  ) {
    const rest = id === 'cleaner' ? CLEANER.aim : id === 'fox' ? FOX.idle : RONIN.idle;
    const far = id === 'cleaner';
    this.ch = new Character(id, { unit: stage.unit * (far ? 0.78 : 1), facing: 1, rest });
    this.ch.look.eyeGlow = 1;
  }

  setStage(stage: Stage): void {
    this.stage = stage;
  }

  private sign(): number {
    return sideSign(this.side) * (this.stage.mirrored ? -1 : 1);
  }

  /** Where the cameo stands. */
  spot(): Vec {
    const st = this.stage;
    if (this.id === 'cleaner') return { x: st.heroX + this.sign() * st.W * 0.33, y: st.groundY - st.H * 0.06 };
    return { x: st.heroX + this.sign() * st.W * 0.24, y: st.groundY };
  }

  enter(): void {
    this.visible = true;
    this.leaving = false;
    this.appearT = 0;
  }

  exit(): void {
    this.leaving = true;
  }

  /** Assist attack toward a target. */
  attack(target: Vec): void {
    this.ch.facing = target.x < this.ch.root.x ? -1 : 1;
    if (this.id === 'cleaner') this.ch.anim.act([{ pose: CLEANER.recoil, dur: 40 }, { pose: CLEANER.aim, dur: 120 }], 120);
    else if (this.id === 'fox') this.ch.anim.act([{ pose: FOX.throw, dur: 70 }, { pose: FOX.throw, dur: 160 }], 240);
    else {
      this.kick = (target.x - this.ch.root.x) * 0.7;
      this.ch.anim.act([{ pose: RONIN.iai, dur: 60 }, { pose: RONIN.iai, dur: 200 }], 300);
    }
  }

  get hand(): Vec {
    return this.ch.frame.j.handF;
  }

  get muzzle(): Vec {
    return this.ch.frame.j.tip;
  }

  update(dtMs: number, env: Env): void {
    if (!this.visible) return;
    this.appearT = this.leaving ? Math.max(0, this.appearT - dtMs / 350) : Math.min(1, this.appearT + dtMs / 350);
    const s = this.spot();
    const off = this.appearT;
    if (this.leaving && off <= 0.01) this.visible = false;
    this.kick *= Math.pow(0.01, dtMs / 1000);
    this.ch.root.x = s.x + this.kick + this.sign() * (1 - off) * this.stage.W * 0.35;
    this.ch.root.y = this.stage.groundY;
    this.ch.lift = this.stage.groundY - s.y + (1 - off) * this.stage.H * 0.15;
    this.ch.update(dtMs, env);
  }
}
