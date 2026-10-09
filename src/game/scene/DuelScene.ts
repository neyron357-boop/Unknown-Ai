import Phaser from 'phaser';
import type { DirectorEvent, DuelDirector } from '@/game/core/director';
import type { Action, AttackKind, Judgement } from '@/game/core/types';
import type { MissionSession } from '@/game/MissionSession';
import { getSettings, levelFactor } from '@/state/settings';
import { Backdrop, type ThemeId } from './backdrop';
import { Codex, drawGlyph } from './codex';
import { EASE, Fighter, HERO, PHANTOM_STYLE, VERDICT, VERDICT_STYLE, type Key } from './Fighter';
import { cutLine, glitchBands, line, Popups, real, shockwave, slashArc, speedLines, type Effect } from './fx';
import { RhythmLane } from './lane';
import { Orbs } from './orbs';
import type { Pose, Vec } from './rig';
import { COLORS, generateBaseTextures, paintReflFade, paintVignette } from './textures';

interface Layout {
  W: number;
  H: number;
  S: number;
  groundY: number;
  floorBottom: number;
  heroX: number;
  enemyX: number;
  laneY: number;
  orbY: number;
}

interface Fig {
  f: Fighter;
  slot: number;
  real: boolean;
  g: Phaser.GameObjects.Graphics;
  core: Phaser.GameObjects.Image;
  visor: Phaser.GameObjects.Image;
}

interface LiveAtk {
  id: number;
  fig: Fig;
  kind: AttackKind;
  phantom: boolean;
  impactAt: number;
  judged: boolean;
  hitShown: boolean;
  clash: boolean;
}

const SLOTS = [
  { x: 0.5, dy: -14, scale: 0.8 },
  { x: 0.71, dy: 0, scale: 1 },
  { x: 0.9, dy: -8, scale: 0.88 },
];

const WIND: Record<AttackKind, Pose> = { mid: VERDICT.windMid, high: VERDICT.windHigh, low: VERDICT.windLow };
const STRIKE: Record<AttackKind, Pose> = { mid: VERDICT.strikeMid, high: VERDICT.strikeHigh, low: VERDICT.strikeLow };
const SECTION_THEME: Partial<Record<string, ThemeId>> = { intro: 'takt', takt: 'takt', phantoms: 'phantoms', overcharge: 'overcharge', ascension: 'ascension', finale: 'ascension', outro: 'finale' };

export interface DuelSceneData {
  session: MissionSession;
  dpr: number;
}

/**
 * The duel on a rain-soaked rooftop. Renders every director event as animation:
 * skeletal silhouettes, beat-synced enemy attacks, parries with impact frames,
 * counter-attack combos, phantoms, energy orbs, rune recall and the finisher.
 */
export class DuelScene extends Phaser.Scene {
  private session!: MissionSession;
  private dir!: DuelDirector;
  private dpr = 1;
  private L!: Layout;

  private bgLayer!: Phaser.GameObjects.Layer;
  private floorLayer!: Phaser.GameObjects.Layer;
  private worldLayer!: Phaser.GameObjects.Layer;
  private fxLayer!: Phaser.GameObjects.Layer;
  private uiLayer!: Phaser.GameObjects.Layer;
  private topLayer!: Phaser.GameObjects.Layer;

  private backdrop!: Backdrop;
  private gRefl!: Phaser.GameObjects.Graphics;
  private gShadow!: Phaser.GameObjects.Graphics;
  private reflRT!: Phaser.GameObjects.RenderTexture;
  private reflFade!: Phaser.GameObjects.Image;
  private gPhantom!: Phaser.GameObjects.Graphics;
  private phantomRT!: Phaser.GameObjects.RenderTexture;
  private gHero!: Phaser.GameObjects.Graphics;
  private gAdd!: Phaser.GameObjects.Graphics;
  private gFx!: Phaser.GameObjects.Graphics;
  private impactBg!: Phaser.GameObjects.Rectangle;
  private dim!: Phaser.GameObjects.Rectangle;
  private flashRect!: Phaser.GameObjects.Rectangle;
  private vignette!: Phaser.GameObjects.Image;
  private grain: Phaser.GameObjects.TileSprite | null = null;

  private hero!: Fighter;
  private heroBlade!: Phaser.GameObjects.Image;
  private heroAura!: Phaser.GameObjects.Image;
  private chargeOrb!: Phaser.GameObjects.Image;
  private figs: Fig[] = [];
  private lane!: RhythmLane;
  private codex!: Codex;
  private orbs!: Orbs;
  private popups!: Popups;

  private emBlue!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emRed!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emGold!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emWhite!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emShards!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emEmbers!: Phaser.GameObjects.Particles.ParticleEmitter;

  private effects: Effect[] = [];
  private live = new Map<number, LiveAtk>();
  private vts = 1;
  private vtsTarget = 1;
  private hitStop = 0;
  private impact: { phase: 'light' | 'dark'; t: number } | null = null;
  private lastFlash = 0;
  private hype = 0;
  private energy = 0;
  private ascending = false;
  private runeFlash = new Array<number>(6).fill(0);
  private heroOffsetY = 0;
  private enemyDead = false;
  private overdrive = false;
  private unsub: (() => void) | null = null;
  private clock = 0;

  constructor() {
    super('duel');
  }

  init(data: DuelSceneData): void {
    this.session = data.session;
    this.dir = data.session.director;
    this.dpr = data.dpr;
  }

  create(): void {
    this.L = this.computeLayout(this.scale.width, this.scale.height);
    const L = this.L;
    generateBaseTextures(this);
    paintVignette(this, L.W, L.H);

    this.bgLayer = this.add.layer();
    this.floorLayer = this.add.layer();
    this.worldLayer = this.add.layer();
    this.fxLayer = this.add.layer();
    this.uiLayer = this.add.layer();
    this.topLayer = this.add.layer();

    this.backdrop = new Backdrop(this, this.bgLayer, L);
    this.dim = this.add.rectangle(0, 0, L.W, L.H, 0x05060c, 1).setOrigin(0).setAlpha(0);
    this.impactBg = this.add.rectangle(0, 0, L.W, L.H, 0xffffff, 1).setOrigin(0).setVisible(false);
    this.bgLayer.add([this.dim, this.impactBg]);

    this.gShadow = this.add.graphics();
    // Reflections are drawn opaque off-screen, then composited once at low alpha,
    // so overlapping limbs don't stack into blotches. A gradient fades them with depth.
    this.gRefl = this.make.graphics({}, false);
    this.reflRT = this.add.renderTexture(0, L.groundY, L.W, Math.max(1, L.floorBottom - L.groundY)).setOrigin(0).setAlpha(0.3);
    paintReflFade(this, Math.max(1, L.floorBottom - L.groundY));
    this.reflFade = this.add.image(0, L.groundY, 'reflFade').setOrigin(0).setDisplaySize(L.W, L.floorBottom - L.groundY);
    this.floorLayer.add([this.reflRT, this.reflFade, this.gShadow]);

    // fighters
    this.hero = new Fighter('hero', 1);
    this.gHero = this.add.graphics();
    this.heroAura = this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(COLORS.blue).setAlpha(0);
    this.heroBlade = this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(COLORS.blue).setAlpha(0.5);
    this.chargeOrb = this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(COLORS.red).setAlpha(0);
    for (let i = 0; i < 3; i++) {
      const f = new Fighter('verdict', -1);
      const fig: Fig = {
        f,
        slot: i,
        real: i === 1,
        g: this.add.graphics(),
        core: this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(COLORS.red),
        visor: this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(COLORS.red),
      };
      f.visible = i === 1;
      this.figs.push(fig);
    }
    // draw order: far phantom, near phantom, main, hero
    const order = [this.figs[0], this.figs[2], this.figs[1]];
    // translucent phantoms are composited as one layer so overlapping limbs stay clean
    this.gPhantom = this.make.graphics({}, false);
    this.phantomRT = this.add.renderTexture(0, 0, L.W, L.H).setOrigin(0);
    this.worldLayer.add(this.phantomRT);
    for (const fig of order) this.worldLayer.add([fig.core, fig.g, fig.visor]);
    this.worldLayer.add([this.chargeOrb, this.heroAura, this.gHero, this.heroBlade]);

    // particles
    const burst = (tint: number | number[], texture = 'spark', speed = 420) =>
      this.add.particles(0, 0, texture, {
        lifespan: { min: 260, max: 620 },
        speed: { min: 80 * L.S, max: speed * L.S },
        scale: { start: 0.5 * L.S, end: 0 },
        alpha: { start: 1, end: 0 },
        tint,
        blendMode: 'ADD',
        emitting: false,
      });
    this.emBlue = burst([COLORS.blue, COLORS.blueHot]);
    this.emRed = burst([COLORS.red, COLORS.redHot]);
    this.emGold = burst([COLORS.gold, 0xffffff], 'spark', 560);
    this.emWhite = burst(0xffffff, 'spark', 520);
    this.emShards = this.add.particles(0, 0, 'shard', {
      lifespan: { min: 900, max: 1900 },
      speed: { min: 120 * L.S, max: 720 * L.S },
      scale: { start: 1.2 * L.S, end: 0.2 * L.S },
      rotate: { min: 0, max: 360 },
      alpha: { start: 1, end: 0 },
      tint: [COLORS.red, COLORS.redHot, 0xffffff, 0x2a0a12],
      gravityY: 260 * L.S,
      blendMode: 'ADD',
      emitting: false,
    });
    this.emEmbers = this.add.particles(0, 0, 'spark', {
      lifespan: 900,
      speedY: { min: -90 * L.S, max: -30 * L.S },
      speedX: { min: -30 * L.S, max: 30 * L.S },
      scale: { start: 0.35 * L.S, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: [COLORS.blue, COLORS.blueHot],
      blendMode: 'ADD',
      frequency: -1,
    });
    this.gAdd = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.gFx = this.add.graphics();
    this.fxLayer.add([this.emEmbers, this.gAdd, this.emBlue, this.emRed, this.emGold, this.emWhite, this.emShards, this.gFx]);

    this.lane = new RhythmLane(this, this.uiLayer);
    this.codex = new Codex(this.uiLayer, this);
    this.orbs = new Orbs(this, this.uiLayer);
    this.popups = new Popups(this, this.uiLayer);

    this.vignette = this.add.image(0, 0, 'vignette').setOrigin(0);
    this.flashRect = this.add.rectangle(0, 0, L.W, L.H, 0xffffff, 1).setOrigin(0).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    this.topLayer.add([this.vignette]);
    if (getSettings().effects === 'high') {
      this.grain = this.add.tileSprite(0, 0, L.W, L.H, 'noise').setOrigin(0).setAlpha(0.04).setBlendMode(Phaser.BlendModes.ADD);
      this.topLayer.add(this.grain);
    }
    this.topLayer.add(this.flashRect);

    this.applyLayout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.session.tapResolver = (x, y) => {
      const p = this.cameras.main.getWorldPoint(x * this.dpr, y * this.dpr);
      return this.codex.resolve(p.x, p.y);
    };
    this.session.sideResolver = (x) => this.orbs.sideAt(x * this.dpr);
    this.unsub = this.session.on((e) => this.onEvent(e));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());
    this.cameras.main.setBackgroundColor(COLORS.void);
    if (import.meta.env.DEV) (window as unknown as { __DUEL__?: DuelScene }).__DUEL__ = this;
    this.session.start();
  }

  // ------------------------------------------------------------------ layout

  private computeLayout(W: number, H: number): Layout {
    const S = Math.min(W / 390, H / 844);
    return { W, H, S, groundY: H * 0.6, floorBottom: H * 0.745, heroX: W * 0.27, enemyX: W * 0.71, laneY: H * 0.808, orbY: H * 0.672 };
  }

  private onResize(size: Phaser.Structs.Size): void {
    this.L = this.computeLayout(size.width, size.height);
    paintVignette(this, this.L.W, this.L.H);
    this.vignette.setTexture('vignette');
    this.applyLayout();
  }

  private applyLayout(): void {
    const L = this.L;
    this.cameras.main.setSize(L.W, L.H);
    this.backdrop.layout(L);
    this.dim.setSize(L.W, L.H);
    this.impactBg.setSize(L.W, L.H);
    this.flashRect.setSize(L.W, L.H);
    this.vignette.setDisplaySize(L.W, L.H);
    this.grain?.setSize(L.W, L.H);
    const reflH = Math.max(1, L.floorBottom - L.groundY);
    this.reflRT.setPosition(0, L.groundY).resize(L.W, reflH);
    this.phantomRT.resize(L.W, L.H);
    paintReflFade(this, reflH);
    this.reflFade.setTexture('reflFade').setPosition(0, L.groundY).setDisplaySize(L.W, reflH);
    this.hero.place({ x: L.heroX, y: L.groundY }, L.S * 1.12);
    this.figs.forEach((fig) => this.placeFig(fig));
    this.lane.layout(L.W, L.laneY, L.S);
    this.codex.layout(L.W / 2, L.H * 0.82, Math.min(L.W * 0.2, 86 * L.S), L.S);
    this.orbs.layout(L.W, L.orbY, L.S);
  }

  private placeFig(fig: Fig): void {
    const L = this.L;
    const slot = SLOTS[fig.slot];
    const single = !this.figs.some((f) => f.f.visible && f !== this.figs[1]);
    const x = single && fig.slot === 1 ? L.enemyX : L.W * slot.x;
    fig.f.place({ x, y: L.groundY + slot.dy * L.S }, L.S * 1.04 * (single ? 1 : slot.scale));
  }

  // ------------------------------------------------------------------ frame loop

  update(_time: number, delta: number): void {
    if (this.session.isPaused()) return;
    this.session.tick(delta);
    const now = this.dir.getNow();

    this.vts += (this.vtsTarget - this.vts) * Math.min(1, delta / 150);
    let vdt = delta * this.vts;
    if (this.hitStop > 0) {
      this.hitStop -= delta;
      vdt = delta * 0.04;
    }
    this.clock += vdt;
    this.tweens.timeScale = this.hitStop > 0 ? 0.08 : 1;
    for (const em of [this.emBlue, this.emRed, this.emGold, this.emWhite, this.emShards, this.emEmbers]) em.timeScale = this.hitStop > 0 ? 0.05 : this.vts;
    this.backdrop.setTimeScale(this.vts);

    // pre-empt hits so the blow lands on the beat even before the miss is confirmed
    for (const a of this.live.values()) {
      if (!a.judged && !a.hitShown && !a.phantom && now >= a.impactAt + this.dir.tuning.lateMs) {
        a.hitShown = true;
        this.showHit(a.kind);
      }
    }

    const wind = Math.sin(this.clock / 900) * 0.4 + 0.3;
    this.hero.update(vdt, wind);
    this.hero.home.y = this.L.groundY + this.heroOffsetY;
    for (const fig of this.figs) {
      fig.f.haloAngle += (vdt / 1000) * (this.overdrive ? 2.2 : 0.9);
      fig.f.update(vdt, wind);
    }
    this.backdrop.update(vdt);
    this.updateImpact(delta);
    this.drawFighters();
    this.drawAdditive();

    this.gFx.clear();
    this.effects = this.effects.filter((e) => e.update(e.real ? delta : vdt, e.real ? this.gFx : this.gAdd));
    this.lane.update(now, delta, this.dir.getGrid());
    this.codex.update(delta);
    this.orbs.update(now, delta);
    if (this.grain) this.grain.setTilePosition(Math.random() * 128, Math.random() * 128);
    this.runeFlash = this.runeFlash.map((v) => Math.max(0, v - delta / 700));
  }

  private drawFighters(): void {
    const imp = this.impact ? this.impact.phase : null;
    const mirror = (v: Vec): Vec => ({ x: v.x, y: 2 * this.L.groundY - v.y });
    const reflOk = !imp;
    this.gRefl.clear();
    this.gShadow.clear();
    this.gPhantom.clear();
    let ghostAlpha = 0;
    // enemies
    for (const fig of this.figs) {
      const f = fig.f;
      fig.g.clear();
      if (!f.visible || f.alpha <= 0.01) {
        fig.core.setVisible(false);
        fig.visor.setVisible(false);
        continue;
      }
      if (!fig.real && f.alpha < 0.999) {
        f.draw(this.gPhantom, { impact: imp, alphaMul: 1 / f.alpha });
        ghostAlpha = Math.max(ghostAlpha, f.alpha);
      } else f.draw(fig.g, { impact: imp });
      if (fig.real && reflOk) {
        f.draw(this.gRefl, { map: mirror, glow: false });
        const fx = f.joints.pelvis.x;
        this.gShadow.fillStyle(0x000000, 0.55 * f.alpha);
        this.gShadow.fillEllipse(fx, f.home.y + 1, 90 * f.s, 9 * f.s);
      }
      const c = f.core;
      fig.core.setVisible(!imp).setPosition(c.x, c.y).setScale((44 * f.s) / 128).setAlpha((this.overdrive ? 0.9 : 0.6) * f.alpha);
      const h = f.joints.head;
      fig.visor.setVisible(!imp).setPosition(h.x - 2 * f.s * f.facing, h.y).setScale((26 * f.s) / 128, (12 * f.s) / 128).setAlpha(0.9 * f.alpha);
      fig.visor.setTint(f.style.eye);
      fig.core.setTint(f.style === PHANTOM_STYLE ? 0xbfd2ff : COLORS.red);
    }
    // hero
    this.gHero.clear();
    this.hero.draw(this.gHero, { impact: imp });
    if (reflOk) this.hero.draw(this.gRefl, { map: mirror, glow: false });
    this.gShadow.fillStyle(0x000000, 0.6);
    this.gShadow.fillEllipse(this.hero.joints.pelvis.x, this.L.groundY + 1, 70 * this.hero.s, 7 * this.hero.s);
    const j = this.hero.joints;
    const bm = this.hero.bladeMid;
    const len = Math.hypot(j.bladeTip.x - j.handF.x, j.bladeTip.y - j.handF.y);
    this.heroBlade
      .setVisible(!imp)
      .setPosition(bm.x, bm.y)
      .setRotation(Math.atan2(j.bladeTip.y - j.handF.y, j.bladeTip.x - j.handF.x))
      .setScale((len * 1.25) / 128, (16 * this.hero.s * (1 + this.energy * 1.5)) / 128)
      .setTint(this.energy > 0.05 ? COLORS.gold : COLORS.blue)
      .setAlpha(0.35 + this.hype * 0.1 + this.energy * 0.4);
    this.heroAura.setVisible(!imp).setPosition(this.hero.core.x, this.hero.core.y).setScale((150 * this.hero.s) / 128).setAlpha(this.hype * 0.07);
    this.reflRT.clear();
    if (reflOk) this.reflRT.draw(this.gRefl, 0, -this.L.groundY);
    this.phantomRT.clear();
    if (ghostAlpha > 0) this.phantomRT.draw(this.gPhantom, 0, 0);
    this.phantomRT.setAlpha(ghostAlpha);
  }

  private drawAdditive(): void {
    const g = this.gAdd;
    g.clear();
    if (this.impact) return;
    this.hero.drawTrail(g, this.energy > 0.05 ? COLORS.gold : COLORS.blue);
    for (const fig of this.figs) {
      if (!fig.f.visible) continue;
      fig.f.drawTrail(g, fig.f.style.rim);
      fig.f.drawHalo(g, fig.f.style.rim, fig.real ? 0.9 : 0.5);
    }
    if (!this.enemyDead && (this.ascending || this.runeFlash.some((v) => v > 0))) {
      const f = this.figs[1].f;
      const pts = this.runeAnchors(f);
      pts.forEach((p, i) => {
        const fl = this.runeFlash[i];
        drawGlyph(g, i, p.x, p.y, (7 + fl * 5) * f.s, fl > 0.05 ? 0xffffff : COLORS.red, 0.35 + fl * 0.65, 1.6 * f.s);
      });
    }
  }

  private runeAnchors(f: Fighter): Vec[] {
    const j = f.joints;
    const mid = (a: Vec, b: Vec, t = 0.5): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    return [j.head, mid(j.chest, j.pelvis, 0.2), f.core, j.shoulderF, j.kneeF, mid(j.pelvis, j.kneeB, 0.5)];
  }

  // ------------------------------------------------------------------ events

  private onEvent(e: DirectorEvent): void {
    switch (e.type) {
      case 'section': {
        const theme = SECTION_THEME[e.id];
        if (theme && theme !== this.backdrop.themeId) this.backdrop.setTheme(theme, 900);
        if (e.id === 'breakdown') this.tweens.add({ targets: this.dim, alpha: 0.45, duration: 400 });
        else if (e.id !== 'halftime') this.tweens.add({ targets: this.dim, alpha: 0, duration: 300 });
        break;
      }
      case 'beat':
        this.lane.beat();
        this.backdrop.beat(e.n, this.hype);
        if (e.bar === 0 && this.hype >= 3 && !getSettings().reduceMotion) this.zoomPunch(1.012, e.beatMs * 0.5);
        if (this.hype >= 4) this.emEmbers.explode(3, this.hero.core.x, this.hero.core.y);
        break;
      case 'intro':
        this.playIntro(e.durationMs);
        break;
      case 'round':
        this.onRound(e.kind);
        break;
      case 'figures':
        this.setFigures(e.real, e.tell);
        break;
      case 'windup': {
        const fig = this.figs[this.figs[1].f.visible && !this.figs[0].f.visible && !this.figs[2].f.visible ? 1 : e.source] ?? this.figs[1];
        const atk: LiveAtk = { id: e.id, fig, kind: e.strikeKind, phantom: e.phantom, impactAt: e.impactAt, judged: false, hitShown: false, clash: e.clash };
        this.live.set(e.id, atk);
        this.enemyAttack(atk, e.kind);
        this.lane.addNote(e.id, e.at, e.impactAt, e.kind, e.hint);
        if (e.clash) this.tweens.add({ targets: this.chargeOrb, alpha: 0.9, duration: e.impactAt - this.dir.getNow() });
        break;
      }
      case 'reveal': {
        const a = this.live.get(e.id);
        if (a) this.enemyAttack(a, e.kind);
        this.lane.reveal(e.id, e.kind);
        break;
      }
      case 'judge':
        this.onJudge(e.id, e.record.judgement, e.record.kind, e.record.action, e.shielded);
        break;
      case 'stray':
        this.hero.act([{ pose: HERO.stagger, dur: 70 }, { pose: HERO.stagger, dur: 120 }], 220);
        this.emRed.explode(5, this.hero.core.x, this.hero.core.y);
        break;
      case 'whiff':
        this.heroWhiff(e.action);
        break;
      case 'meters':
        this.hype = e.meters.hype;
        this.energy = this.dir.getRound().kind === 'overcharge' ? Math.min(1, e.meters.energy / 40) : 0;
        this.hero.energy = this.energy;
        if (this.dir.getRound().kind === 'overcharge') this.orbs.show(e.meters.energy);
        break;
      case 'open':
        this.mainFig().f.act([{ pose: VERDICT.hurt, dur: 90 }, { pose: VERDICT.broken, dur: 260, ease: EASE.outBack }, { pose: VERDICT.broken, dur: e.endAt - this.dir.getNow() }], 360);
        this.hero.act([{ pose: HERO.ready, dur: 200 }, { pose: HERO.ready, dur: 3000 }], 300);
        this.lane.setStrikes(e.beats);
        break;
      case 'openEnd':
        this.hero.act([{ pose: HERO.land, dur: 180 }], 260);
        break;
      case 'strike':
        this.onStrike(e.n, e.onBeat, e.damage, e.finisher);
        break;
      case 'orbs':
        this.orbs.setLabel(getSettings().lang === 'ru' ? 'ЭНЕРГИЯ' : 'ENERGY');
        this.orbs.spawn(e.left, e.right, e.energy, e.at, e.deadline);
        this.hero.act([{ pose: HERO.charge, dur: 250 }, { pose: HERO.charge, dur: 1800 }], 300);
        break;
      case 'orbPick':
        this.orbs.pick(e.side, e.correct, e.better, e.energy, this.hero.bladeMid);
        if (e.correct) this.emGold.explode(18, this.hero.bladeMid.x, this.hero.bladeMid.y);
        break;
      case 'clashResult':
        this.onClash(e.success, e.damage);
        break;
      case 'ascend':
        this.onAscend();
        break;
      case 'rune': {
        this.runeFlash[e.node] = 1;
        this.codex.light(e.node);
        const f = this.figs[1].f;
        const p = this.runeAnchors(f)[e.node];
        this.effects.push(real(line(p, this.codex.nodePos(e.node), this.L.S, COLORS.red, 650)));
        this.emRed.explode(8, p.x, p.y);
        break;
      }
      case 'recall':
        this.codex.arm();
        break;
      case 'recallTap':
        this.onRecallTap(e.node, e.expected, e.correct);
        break;
      case 'finisher':
        this.onFinisher(e.durationMs);
        break;
      case 'reboot':
        this.hero.act([{ pose: HERO.kneel, dur: 200 }, { pose: HERO.kneel, dur: e.durationMs - 400 }], 300);
        this.hero.jitter = 6 * this.L.S;
        this.time.delayedCall(e.durationMs, () => (this.hero.jitter = 0));
        this.effects.push(real(glitchBands(this.L.W, this.L.H, this.L.S, 600, [COLORS.blue, COLORS.red])));
        break;
      case 'upgradeOffer':
        this.lane.setVisible(false);
        this.orbs.hide();
        break;
      case 'upgradePicked':
        this.lane.setVisible(true);
        break;
      case 'complete':
        this.lane.setVisible(false);
        break;
      default:
        break;
    }
  }

  private mainFig(): Fig {
    return this.figs.find((f) => f.real && f.f.visible) ?? this.figs[1];
  }

  private playIntro(ms: number): void {
    const L = this.L;
    this.cameras.main.fadeIn(Math.min(1200, ms * 0.35), 0, 0, 0);
    this.heroOffsetY = -L.H * 0.7;
    this.hero.anim.play([{ pose: HERO.jump, dur: 0 }]);
    this.hero.resetCloth();
    const enemy = this.figs[1].f;
    enemy.alpha = 0;
    this.time.delayedCall(ms * 0.12, () => {
      this.backdrop.lightning(1);
      enemy.alpha = 1;
      this.flash(0xffffff, 0.25, 200);
    });
    this.time.delayedCall(ms * 0.3, () => this.backdrop.lightning(0.6));
    this.time.delayedCall(ms * 0.45, () => {
      this.tweens.addCounter({
        from: this.heroOffsetY,
        to: 0,
        duration: 300,
        ease: 'Quad.easeIn',
        onUpdate: (tw) => (this.heroOffsetY = tw.getValue() ?? 0),
        onComplete: () => {
          this.heroOffsetY = 0;
          this.hero.act([{ pose: HERO.land, dur: 90 }, { pose: HERO.land, dur: 220 }], 320);
          this.effects.push(shockwave(this.hero.home.x, L.groundY, L.W * 0.5, L.S, COLORS.blue, 500, 0.12));
          this.emBlue.explode(26, this.hero.home.x, L.groundY);
          this.shake(260, 0.006);
        },
      });
    });
    this.time.delayedCall(ms * 0.7, () => enemy.act([{ pose: VERDICT.roar, dur: 260 }, { pose: VERDICT.roar, dur: 500 }], 420));
  }

  private onRound(kind: string): void {
    const L = this.L;
    this.lane.clear();
    this.lane.setVisible(true);
    this.effects.push(real(speedLines(L.W / 2, L.H * 0.42, L.W, L.H, L.S, 520)));
    this.flash(0xffffff, 0.18, 260);
    this.orbs.hide();
    this.codex.hide();
    this.ascending = false;
    this.vtsTarget = 1;
    if (kind === 'phantoms') {
      this.figs.forEach((f) => (f.f.visible = true));
      this.setFigures(1, 'strong');
    } else {
      this.figs.forEach((f, i) => {
        f.f.visible = i === 1;
        f.real = i === 1;
        f.f.style = VERDICT_STYLE;
        f.f.alpha = 1;
        f.f.jitter = 0;
      });
      this.figs.forEach((f) => this.placeFig(f));
    }
    if (kind === 'overcharge') {
      const f = this.figs[1].f;
      this.chargeOrb.setPosition(f.home.x, f.home.y - 230 * f.s).setScale((90 * f.s) / 128).setAlpha(0.25);
    } else {
      this.chargeOrb.setAlpha(0);
    }
    if (kind === 'ascension') {
      this.overdrive = true;
      this.figs[1].f.style = { ...VERDICT_STYLE, rim: 0xff4a5e, emissive: 0xffd0d6 };
      this.figs[1].f.act([{ pose: VERDICT.roar, dur: 240 }, { pose: VERDICT.roar, dur: 700 }], 420);
      this.shake(600, 0.008);
      this.backdrop.lightning(1);
    }
  }

  private setFigures(realIdx: number, tell: 'strong' | 'subtle'): void {
    this.figs.forEach((fig, i) => {
      fig.f.visible = true;
      fig.real = i === realIdx;
      if (fig.real) {
        fig.f.style = VERDICT_STYLE;
        fig.f.alpha = 1;
        fig.f.jitter = 0;
      } else if (tell === 'strong') {
        fig.f.style = PHANTOM_STYLE;
        fig.f.alpha = 0.55;
        fig.f.jitter = 1.5 * this.L.S;
      } else {
        fig.f.style = VERDICT_STYLE;
        fig.f.alpha = 0.92;
        fig.f.jitter = 0;
      }
      this.placeFig(fig);
    });
    this.effects.push(real(glitchBands(this.L.W, this.L.H, this.L.S, 260, [0x8fb0ff, COLORS.red])));
  }

  private enemyAttack(a: LiveAtk, revealed: AttackKind | null): void {
    const now = this.dir.getNow();
    const lead = Math.max(140, a.impactAt - now);
    const strikeDur = 70;
    let wind: Pose;
    let strike: Pose;
    if (a.clash) {
      wind = VERDICT.windClash;
      strike = VERDICT.strikeClash;
    } else if (revealed) {
      wind = WIND[revealed];
      strike = STRIKE[a.kind];
    } else {
      wind = VERDICT.gather;
      strike = STRIKE[a.kind];
    }
    const keys: Key[] = [
      { pose: wind, dur: (lead - strikeDur) * 0.65, ease: EASE.outCubic },
      { pose: wind, dur: (lead - strikeDur) * 0.35, ease: EASE.linear },
      { pose: strike, dur: strikeDur, ease: EASE.inQuad },
      { pose: strike, dur: 170 },
    ];
    a.fig.f.act(keys, 420);
  }

  private contactPoint(kind: AttackKind): Vec {
    const j = this.hero.joints;
    const x = this.hero.home.x + 40 * this.hero.s;
    if (kind === 'high') return { x, y: j.head.y - 6 * this.hero.s };
    if (kind === 'low') return { x, y: this.L.groundY - 14 * this.hero.s };
    return { x: (j.handF.x + j.bladeTip.x) / 2 + 6 * this.hero.s, y: (j.handF.y + j.bladeTip.y) / 2 };
  }

  private onJudge(id: number, j: Judgement, kind: AttackKind, action: Action | null, shielded: boolean): void {
    const a = this.live.get(id);
    this.live.delete(id);
    this.lane.judge(id, j, kind, this.dir.getNow());
    if (a) a.judged = true;
    const L = this.L;
    if (j === 'perfect' || j === 'good') {
      this.heroResponse(kind, j === 'perfect');
      const p = this.contactPoint(kind);
      if (kind === 'mid') {
        (j === 'perfect' ? this.emWhite : this.emBlue).explode(j === 'perfect' ? 26 : 14, p.x, p.y);
        this.emBlue.explode(12, p.x, p.y);
        this.effects.push(shockwave(p.x, p.y, 70 * L.S, L.S, COLORS.blue, 300, 1));
        if (j === 'perfect') {
          this.impactFrame();
          this.hitStop = 70;
          this.shake(140, 0.006);
        } else {
          this.hitStop = 40;
          this.shake(90, 0.003);
        }
        a?.fig.f.act([{ pose: VERDICT.hurt, dur: 90 }, { pose: VERDICT.hurt, dur: 120 }], 360);
      } else {
        // the blade sweeps past: a streak where it went through
        const y = p.y;
        this.effects.push(slashArc({ x: L.enemyX - 30 * L.S, y }, { x: L.heroX - 80 * L.S, y: y + 6 * L.S }, 0.08, COLORS.red, 8 * L.S, 320));
        if (j === 'perfect') this.emWhite.explode(10, p.x, p.y);
      }
    } else if (j === 'ignored') {
      if (a) {
        a.fig.f.alpha = 0.2;
        this.time.delayedCall(220, () => (a.fig.f.alpha = this.figs.indexOf(a.fig) >= 0 && a.fig.real ? 1 : 0.55));
        this.effects.push(slashArc({ x: L.enemyX, y: this.hero.core.y }, { x: L.heroX - 70 * L.S, y: this.hero.core.y }, 0.05, 0xbfd2ff, 6 * L.S, 300));
      }
    } else if (j === 'fooled') {
      if (action) this.heroWhiff(action);
      if (a) {
        const c = a.fig.f.core;
        this.emWhite.explode(30, c.x, c.y);
        this.emShards.explode(16, c.x, c.y);
        a.fig.f.alpha = 0;
        this.time.delayedCall(500, () => (a.fig.f.alpha = a.fig.real ? 1 : 0.55));
      }
      this.effects.push(real(glitchBands(L.W, L.H, L.S, 300, [COLORS.red, 0xffffff])));
      this.shake(160, 0.005);
    } else {
      // miss / wrong
      if (action) this.heroWhiff(action);
      if (!a?.hitShown) {
        const delay = a ? Math.max(0, a.impactAt - this.dir.getNow()) : 0;
        this.time.delayedCall(delay, () => this.showHit(kind, shielded));
      }
    }
  }

  private heroResponse(kind: AttackKind, perfect: boolean): void {
    if (kind === 'mid') {
      this.hero.act(perfect ? [{ pose: HERO.parry, dur: 55 }, { pose: HERO.parry, dur: 150 }, { pose: HERO.counter, dur: 110, ease: EASE.outExpo }, { pose: HERO.counter, dur: 120 }] : [{ pose: HERO.parry, dur: 60 }, { pose: HERO.parry, dur: 220 }], 320);
    } else if (kind === 'high') {
      this.hero.act([{ pose: HERO.duck, dur: 70 }, { pose: HERO.duck, dur: 260 }], 260);
    } else {
      this.hero.act([{ pose: HERO.jump, dur: 90, ease: EASE.outCubic }, { pose: HERO.jump, dur: 200 }, { pose: HERO.land, dur: 120, ease: EASE.inQuad }], 240);
    }
  }

  private heroWhiff(action: Action): void {
    if (action === 'tap') this.hero.act([{ pose: HERO.whiffTap, dur: 70 }, { pose: HERO.whiffTap, dur: 90 }], 240);
    else if (action === 'up') this.hero.act([{ pose: { ...HERO.jump, y: -30 }, dur: 90 }, { pose: HERO.land, dur: 140 }], 220);
    else if (action === 'down') this.hero.act([{ pose: HERO.duck, dur: 70 }, { pose: HERO.duck, dur: 120 }], 220);
    else this.hero.act([{ pose: { ...HERO.ready, x: action === 'right' ? 14 : -14 }, dur: 90 }], 200);
  }

  private showHit(kind: AttackKind, shielded = false): void {
    const L = this.L;
    const p = this.contactPoint(kind);
    if (shielded) {
      this.emBlue.explode(16, p.x, p.y);
      this.effects.push(shockwave(this.hero.core.x, this.hero.core.y, 80 * L.S, L.S, COLORS.blue, 300, 1));
      return;
    }
    this.hero.act([{ pose: HERO.hit, dur: 60 }, { pose: HERO.hit, dur: 220 }], 380);
    this.hero.flash = 90;
    this.emRed.explode(26, this.hero.core.x, this.hero.core.y);
    this.effects.push(slashArc({ x: this.hero.core.x + 60 * L.S, y: this.hero.core.y - 40 * L.S }, { x: this.hero.core.x - 50 * L.S, y: this.hero.core.y + 30 * L.S }, 0.15, COLORS.red, 10 * L.S, 340));
    this.hitStop = 90;
    this.shake(260, 0.012);
    this.flash(COLORS.red, 0.3, 220);
  }

  private onStrike(n: number, onBeat: boolean, damage: number, finisher: boolean): void {
    const L = this.L;
    const keys: Key[][] = [
      [{ pose: HERO.aWind, dur: 50 }, { pose: HERO.aCut, dur: 70, ease: EASE.outExpo }, { pose: HERO.aCut, dur: 140 }],
      [{ pose: HERO.bWind, dur: 50 }, { pose: HERO.bCut, dur: 70, ease: EASE.outExpo }, { pose: HERO.bCut, dur: 140 }],
      [{ pose: HERO.cWind, dur: 70 }, { pose: HERO.cCut, dur: 80, ease: EASE.outExpo }, { pose: HERO.cCut, dur: 260 }],
    ];
    this.hero.act(keys[Math.min(n - 1, 2)], 380);
    const fig = this.mainFig();
    const c = fig.f.core;
    const r = 70 * L.S;
    const dirs = [
      [-1, -0.7, 1, 0.6],
      [-0.8, 0.8, 0.9, -0.9],
      [0, -1.2, 0.1, 1],
    ][Math.min(n - 1, 2)];
    const col = onBeat ? (finisher ? COLORS.gold : COLORS.blue) : 0xffffff;
    this.time.delayedCall(60, () => {
      this.effects.push(slashArc({ x: c.x + dirs[0] * r, y: c.y + dirs[1] * r }, { x: c.x + dirs[2] * r, y: c.y + dirs[3] * r }, 0.18, col, (finisher ? 13 : 9) * L.S, finisher ? 520 : 360));
      (onBeat ? this.emGold : this.emWhite).explode(onBeat ? 22 : 10, c.x, c.y);
      fig.f.flash = 70;
      this.popups.spawn(c.x, c.y - 40 * L.S, `${damage}`, onBeat ? '#ffd27a' : '#eef0f7', (onBeat ? 26 : 18) * L.S);
      this.hitStop = finisher ? 110 : 50;
      this.shake(finisher ? 300 : 120, finisher ? 0.012 : 0.004);
      if (finisher) {
        this.impactFrame();
        this.effects.push(shockwave(c.x, c.y, 160 * L.S, L.S, COLORS.gold, 450, 1));
        fig.f.act([{ pose: VERDICT.hurt, dur: 80 }, { pose: VERDICT.hurt, dur: 200 }], 420);
      }
      this.zoomPunch(finisher ? 1.06 : 1.025, 180);
    });
    this.lane.strikeResult(onBeat, this.dir.getNow());
  }

  private onClash(success: boolean, damage: number): void {
    const L = this.L;
    const fig = this.mainFig();
    const p = { x: (this.hero.bladeMid.x + fig.f.bladeMid.x) / 2, y: (this.hero.bladeMid.y + fig.f.bladeMid.y) / 2 };
    this.tweens.add({ targets: this.chargeOrb, alpha: 0, duration: 300 });
    if (success) {
      this.impactFrame(true);
      this.hitStop = 140;
      this.emGold.explode(60, p.x, p.y);
      this.emWhite.explode(30, p.x, p.y);
      this.effects.push(shockwave(p.x, p.y, L.W * 0.9, L.S, COLORS.gold, 700, 0.6));
      this.effects.push(real(speedLines(p.x, p.y, L.W, L.H, L.S, 500, COLORS.gold)));
      this.backdrop.lightning(1);
      this.shake(500, 0.016);
      fig.f.act([{ pose: VERDICT.hurt, dur: 90 }, { pose: { ...VERDICT.hurt, x: -40 }, dur: 260 }], 520);
      this.popups.spawn(fig.f.core.x, fig.f.core.y - 50 * L.S, `${damage}`, '#ffd27a', 40 * L.S);
    } else {
      this.showHit('mid');
      this.popups.spawn(fig.f.core.x, fig.f.core.y - 40 * L.S, `${damage}`, '#eef0f7', 20 * L.S);
    }
    this.energy = 0;
    this.hero.energy = 0;
    this.orbs.hide();
  }

  private onAscend(): void {
    const L = this.L;
    this.ascending = true;
    this.vtsTarget = 0.28;
    this.lane.setVisible(false);
    this.tweens.add({ targets: this.dim, alpha: 0.5, duration: 600 });
    this.codex.show();
    this.flash(COLORS.blue, 0.25, 400);
    this.effects.push(real(shockwave(this.hero.core.x, this.hero.core.y, L.W, L.S, COLORS.blue, 800, 0.5)));
    this.hero.act([{ pose: HERO.charge, dur: 300 }, { pose: HERO.charge, dur: 60000 }], 300);
    this.mainFig().f.act([{ pose: VERDICT.roar, dur: 400 }, { pose: VERDICT.roar, dur: 60000 }], 300);
    this.zoomTo(1.06, 900);
  }

  private onRecallTap(node: number | null, expected: number, correct: boolean): void {
    const L = this.L;
    const target = node ?? expected;
    this.codex.mark(target, correct);
    const fig = this.mainFig();
    const p = this.runeAnchors(fig.f)[expected];
    if (correct) {
      this.runeFlash[expected] = 1;
      // teleport-slash through the rune
      const side = expected % 2 === 0 ? -1 : 1;
      const from = { x: p.x - side * 90 * L.S, y: p.y - 40 * L.S };
      const to = { x: p.x + side * 90 * L.S, y: p.y + 40 * L.S };
      this.effects.push(real(slashArc(from, to, 0.12, COLORS.blue, 11 * L.S, 600)));
      this.emBlue.explode(24, p.x, p.y);
      this.emWhite.explode(14, p.x, p.y);
      this.impactFrame();
      this.hitStop = 60;
      this.hero.act([{ pose: HERO.aWind, dur: 40 }, { pose: HERO.aCut, dur: 60 }, { pose: HERO.charge, dur: 200 }, { pose: HERO.charge, dur: 60000 }], 300);
      fig.f.flash = 90;
      this.popups.spawn(p.x, p.y - 30 * L.S, '80', '#bff3ff', 24 * L.S);
      this.shake(140, 0.006);
    } else {
      this.emRed.explode(14, p.x, p.y);
      this.shake(90, 0.004);
    }
  }

  /**
   * Finisher: three blink-slashes around VERDICT (front, airborne, back home), then a frozen
   * beat with the cuts hanging in the air, and the split lands on the drop (audio fires at ms / 2).
   */
  private onFinisher(ms: number): void {
    const L = this.L;
    const S = L.S;
    const fig = this.mainFig();
    const beat = ms / 8;
    const splitAt = ms / 2;
    this.vts = 1;
    this.vtsTarget = 1;
    this.zoomTo(1, 300);
    this.codex.hide();
    this.tweens.add({ targets: this.dim, alpha: 0, duration: 200 });
    fig.f.act([{ pose: VERDICT.hurt, dur: 90 }, { pose: VERDICT.hurt, dur: splitAt * 2 }], 400);

    const blink = (x: number) => {
      const before = this.hero.core;
      this.hero.home.x = x;
      this.hero.trail.length = 0;
      this.hero.resetCloth();
      this.effects.push(real(line(before, { x: x, y: before.y }, S * 2.2, COLORS.blueHot, 260)));
      this.emBlue.explode(14, before.x, before.y);
    };
    const cut = (a: Vec, b: Vec, color: number) => {
      this.effects.push(slashArc(a, b, 0.12, color, 13 * S, 520));
      const cc = fig.f.core;
      this.emWhite.explode(18, cc.x, cc.y);
      this.emRed.explode(16, cc.x, cc.y);
      fig.f.flash = 90;
      this.impactFrame();
      this.hitStop = 60;
      this.shake(200, 0.012);
    };

    // 1 — in front, horizontal cut
    blink(fig.f.home.x - 62 * S - HERO.aCut.x * this.hero.s);
    this.hero.act([{ pose: HERO.aWind, dur: 40 }, { pose: HERO.aCut, dur: 70, ease: EASE.outCubic }, { pose: HERO.aCut, dur: beat }], 200);
    this.time.delayedCall(90, () => {
      const cc = fig.f.core;
      cut({ x: cc.x - 110 * S, y: cc.y + 10 * S }, { x: cc.x + 110 * S, y: cc.y - 24 * S }, 0xffffff);
    });
    // 2 — airborne, falling cut
    this.time.delayedCall(beat * 0.5, () => {
      blink(fig.f.home.x - 48 * S - HERO.cCut.x * this.hero.s);
      this.hero.act([{ pose: HERO.cWind, dur: 50 }, { pose: HERO.cCut, dur: 90, ease: EASE.inQuad }, { pose: HERO.cCut, dur: beat }], 200);
      this.time.delayedCall(120, () => {
        const cc = fig.f.core;
        cut({ x: cc.x - 30 * S, y: cc.y - 120 * S }, { x: cc.x + 40 * S, y: cc.y + 90 * S }, COLORS.blueHot);
      });
    });
    // 3 — back home, blade lowered: the cuts hang in the air, time almost stops
    this.time.delayedCall(beat * 1.1, () => {
      blink(L.heroX);
      this.hero.act([{ pose: HERO.land, dur: 90, ease: EASE.outCubic }, { pose: HERO.victory, dur: 380, ease: EASE.inOutSine }, { pose: HERO.victory, dur: 60000 }], 300);
      const cc = fig.f.core;
      const hang = splitAt - beat * 1.1;
      this.effects.push(real(cutLine({ x: cc.x - 80 * S, y: cc.y + 14 * S }, { x: cc.x + 80 * S, y: cc.y - 20 * S }, S, hang)));
      this.effects.push(real(cutLine({ x: cc.x - 22 * S, y: cc.y - 92 * S }, { x: cc.x + 30 * S, y: cc.y + 70 * S }, S, hang)));
      this.vtsTarget = 0.18;
      this.tweens.add({ targets: this.dim, alpha: 0.42, duration: 220 });
    });
    this.time.delayedCall(splitAt, () => {
      const cc = fig.f.core;
      this.enemyDead = true;
      this.vtsTarget = 1;
      this.tweens.add({ targets: this.dim, alpha: 0, duration: 500 });
      this.flash(0xffffff, 0.85, 900);
      this.emShards.explode(getSettings().effects === 'high' ? 110 : 50, cc.x, cc.y - 20 * S);
      this.emWhite.explode(60, cc.x, cc.y);
      this.emRed.explode(40, cc.x, cc.y);
      this.effects.push(shockwave(cc.x, cc.y, L.W * 1.6, S, COLORS.red, 1200, 0.5));
      this.impactFrame(true);
      this.shake(700, 0.025);
      for (const f of this.figs) f.f.visible = false;
      this.backdrop.setTheme('finale', 1600);
    });
  }

  // ------------------------------------------------------------------ helpers

  private updateImpact(delta: number): void {
    if (!this.impact) {
      this.impactBg.setVisible(false);
      return;
    }
    this.impact.t -= delta;
    if (this.impact.t <= 0) {
      if (this.impact.phase === 'light') this.impact = { phase: 'dark', t: 50 };
      else this.impact = null;
    }
    if (this.impact) {
      const low = getSettings().flashes === 'low';
      this.impactBg.setVisible(true).setFillStyle(this.impact.phase === 'light' ? (low ? 0x3a0a14 : 0xf4f6ff) : 0x000000, 1);
    } else {
      this.impactBg.setVisible(false);
    }
  }

  /** Manga impact frame: two flat frames (light, then dark). Off when flashes are off. */
  private impactFrame(big = false): void {
    if (getSettings().flashes === 'off') return;
    const now = performance.now();
    if (now - this.lastFlash < 300 && !big) return;
    this.lastFlash = now;
    this.impact = { phase: 'light', t: big ? 70 : 45 };
  }

  private shake(ms: number, intensity: number): void {
    const f = levelFactor(getSettings().shake);
    if (f > 0) this.cameras.main.shake(ms, intensity * f, true);
  }

  private flash(color: number, alpha: number, ms: number): void {
    const f = levelFactor(getSettings().flashes);
    if (f <= 0) return;
    this.backdrop.flashScale = f;
    this.tweens.killTweensOf(this.flashRect);
    this.flashRect.setFillStyle(color, 1).setAlpha(Math.min(0.6, alpha * 0.8 * f));
    this.tweens.add({ targets: this.flashRect, alpha: 0, duration: ms, ease: 'Quad.easeOut' });
  }

  private zoomPunch(z: number, ms: number): void {
    if (getSettings().reduceMotion) return;
    const cam = this.cameras.main;
    this.tweens.killTweensOf(cam);
    this.tweens.add({ targets: cam, zoom: z, duration: ms / 2, yoyo: true, ease: 'Sine.easeOut', onComplete: () => cam.setZoom(1) });
  }

  private zoomTo(z: number, ms: number): void {
    if (getSettings().reduceMotion) return;
    const cam = this.cameras.main;
    this.tweens.killTweensOf(cam);
    this.tweens.add({ targets: cam, zoom: z, duration: ms, ease: 'Sine.easeInOut' });
  }

  private cleanup(): void {
    this.unsub?.();
    this.unsub = null;
    this.session.tapResolver = null;
    this.session.sideResolver = null;
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
  }
}

