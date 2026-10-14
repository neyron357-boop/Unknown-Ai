import Phaser from 'phaser';
import type { Env } from '../anatomy/Character';
import { drawGlows, drawLayers, type Layers } from '../anatomy/look';
import type { Vec } from '../anatomy/skeleton';
import type { BattleDirector, BattleEvent } from '../core/battle';
import { BOSS_SIDE } from '../core/chart';
import type { ActId, AnomalyKind, BossMove, CameoId, Dir, NoteInfo } from '../core/types';
import { EnemyActor, sideSign, type Stage } from './actors';
import { COMBO_WORDS, cutLine, execGlyph, ghostSwipe, glitchBands, KILL_WORDS, laser, real, shockwave, slashArc, speedLines, streak, tracer, chain, Words, type Effect } from './fx3';
import { Gore, type GoreLevel } from './gore';
import { BossCtl, CameoCtl, HeroCtl } from './heroes';
import { paintBase, paintVignette } from './paint';
import { World } from './world';

export interface SceneSettings {
  flashes: 'off' | 'low' | 'full';
  shake: 'off' | 'low' | 'full';
  gore: GoreLevel;
  effects: 'low' | 'high';
  reduceMotion: boolean;
}

export interface BattleSceneData {
  director: BattleDirector;
  /** Advances game logic (director, audio pump) — called once per frame before drawing. */
  tick: (dtMs: number) => void;
  paused: () => boolean;
  settings: () => SceneSettings;
  /** HUD hooks (React lives outside Phaser). */
  hud?: {
    hint?: (h: { dir: Dir | null; kind: string } | null) => void;
    flag?: (name: 'hudCut' | 'fakeCrash' | 'glitch' | 'bloodlust' | 'panels', on: boolean, ms?: number) => void;
    cutIn?: (c: { id: string; name: string; side: 'left' | 'right' }) => void;
  };
  /** Voice barks the scene decides (enemy screams). */
  bark?: (cue: 'grunt.charge' | 'grunt.death' | 'grunt.pain') => void;
}

interface Layout {
  W: number;
  H: number;
  groundY: number;
  unit: number;
}

const WIND: Record<ActId, number> = { roof: -170, fall: 0, train: -1500, temple: -60 };
const ACT_HERO_X: Record<ActId, number> = { roof: 0.5, fall: 0.5, train: 0.5, temple: 0.34 };
const CAMEO_NAMES: Record<CameoId, string> = { cleaner: 'ЧИСТИЛЬЩИК', fox: 'ЛИСА', ronin: 'БЕЗЫМЯННЫЙ РОНИН', butcher: 'МЯСНИК' };

/**
 * The v3 battle: noir silhouettes under a blood moon, every hit on the beat.
 * Pure presentation — the BattleDirector owns rules and timing; this scene turns its events into
 * animation, gore, camera work and surprises.
 */
export class BattleScene extends Phaser.Scene {
  private data3!: BattleSceneData;
  private dir!: BattleDirector;
  private L!: Layout;
  private stage!: Stage;
  private act: ActId = 'roof';

  // layers
  private bgLayer!: Phaser.GameObjects.Layer;
  private floorLayer!: Phaser.GameObjects.Layer;
  private backLayer!: Phaser.GameObjects.Layer;
  private actorLayer!: Phaser.GameObjects.Layer;
  private fxLayer!: Phaser.GameObjects.Layer;
  private addLayer!: Phaser.GameObjects.Layer;
  private wordLayer!: Phaser.GameObjects.Layer;
  private topLayer!: Phaser.GameObjects.Layer;
  private screenLayer!: Phaser.GameObjects.Layer;

  private world!: World;
  private gore!: Gore;
  private words!: Words;
  private hero!: HeroCtl;
  private boss!: BossCtl;
  private cameos = new Map<CameoId, CameoCtl>();
  private actors = new Map<number, EnemyActor>();

  private gBack!: Phaser.GameObjects.Graphics;
  private gActors!: Phaser.GameObjects.Graphics;
  private gHero!: Phaser.GameObjects.Graphics;
  private gRefl!: Phaser.GameObjects.Graphics;
  private reflRT!: Phaser.GameObjects.RenderTexture;
  private reflFade!: Phaser.GameObjects.Rectangle;
  private gAdd!: Phaser.GameObjects.Graphics;
  private gFx!: Phaser.GameObjects.Graphics;
  private gTop!: Phaser.GameObjects.Graphics;
  private gScreen!: Phaser.GameObjects.Graphics;
  private impactBg!: Phaser.GameObjects.Rectangle;
  private dim!: Phaser.GameObjects.Rectangle;
  private blackout!: Phaser.GameObjects.Rectangle;
  private redWash!: Phaser.GameObjects.Rectangle;
  private flashRect!: Phaser.GameObjects.Rectangle;
  private vignette!: Phaser.GameObjects.Image;
  private grain!: Phaser.GameObjects.TileSprite;
  private letterTop!: Phaser.GameObjects.Rectangle;
  private letterBot!: Phaser.GameObjects.Rectangle;
  private heroAura!: Phaser.GameObjects.Image;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private panelCams: Phaser.Cameras.Scene2D.Camera[] = [];

  private emSparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emEmbers!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emShards!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emDebris!: Phaser.GameObjects.Particles.ParticleEmitter;

  private effects: Effect[] = [];
  private bossNotes: { note: NoteInfo; move: BossMove; struck: boolean }[] = [];
  private vts = 1;
  private vtsTarget = 1;
  private slowUntil = 0;
  private hitStop = 0;
  private impact = 0;
  private invertUntil = -Infinity;
  private blackoutUntil = -Infinity;
  private timeStopUntil = -Infinity;
  private crashUntil = -Infinity;
  private whisperUntil = -Infinity;
  private panelsUntil = -Infinity;
  private bloodlust = false;
  private lastCombo = 0;
  private comboWordIdx = 0;
  private mirrored = false;
  private hintNote: { until: number } | null = null;
  private bossShown = false;
  private finished = false;
  private killsInBeat: number[] = [];
  private beatCount = 0;
  private intensity = 1;
  private lastKillAt = -Infinity;

  constructor() {
    super('battle3');
  }

  init(data: BattleSceneData): void {
    this.data3 = data;
    this.dir = data.director;
  }

  private computeLayout(W: number, H: number): Layout {
    const groundY = Math.round(H * 0.655);
    const unit = Math.min(H * 0.00205, W * 0.0046);
    return { W, H, groundY, unit };
  }

  private makeStage(): Stage {
    const { W, H, groundY, unit } = this.L;
    return {
      W,
      H,
      groundY,
      unit,
      heroX: W * ACT_HERO_X[this.act],
      strike: unit * 52,
      beatMs: this.dir.beatMs,
      mirrored: this.mirrored,
      falling: this.act === 'fall',
    };
  }

  create(): void {
    this.L = this.computeLayout(this.scale.width, this.scale.height);
    const L = this.L;
    paintBase(this);
    paintVignette(this, L.W, L.H);
    this.stage = this.makeStage();

    this.bgLayer = this.add.layer();
    this.floorLayer = this.add.layer();
    this.backLayer = this.add.layer();
    this.actorLayer = this.add.layer();
    this.fxLayer = this.add.layer();
    this.addLayer = this.add.layer();
    this.wordLayer = this.add.layer();
    this.topLayer = this.add.layer();
    this.screenLayer = this.add.layer();

    this.world = new World(this, this.bgLayer, L);
    this.impactBg = this.add.rectangle(0, 0, L.W, L.H, 0xffffff, 1).setOrigin(0).setVisible(false);
    this.dim = this.add.rectangle(0, 0, L.W, L.H, 0x000000, 1).setOrigin(0).setAlpha(0);
    this.bgLayer.add([this.impactBg, this.dim]);

    // reflections on wet roofs / polished stone
    this.gRefl = this.make.graphics({}, false);
    this.reflRT = this.add.renderTexture(0, L.groundY, L.W, L.H - L.groundY).setOrigin(0).setAlpha(0.22);
    this.reflFade = this.add.rectangle(0, L.groundY, L.W, L.H - L.groundY, 0x020203, 1).setOrigin(0);
    this.reflFade.setAlpha(0);
    this.floorLayer.add([this.reflRT]);

    this.gore = new Gore(this, this.fxLayer, this.floorLayer, this.screenLayer, L);
    this.gBack = this.add.graphics();
    this.backLayer.add(this.gBack);
    this.heroAura = this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xff1a2a).setAlpha(0);
    this.gActors = this.add.graphics();
    this.gHero = this.add.graphics();
    this.actorLayer.add([this.heroAura, this.gActors, this.gHero]);
    this.gFx = this.add.graphics();
    this.fxLayer.add(this.gFx);
    this.gAdd = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.addLayer.add(this.gAdd);
    this.blackout = this.add.rectangle(0, 0, L.W, L.H, 0x000000, 1).setOrigin(0).setAlpha(0);
    this.gTop = this.add.graphics();
    this.topLayer.add([this.blackout, this.gTop]);
    this.words = new Words(this, this.wordLayer, L.unit);

    this.hero = new HeroCtl(this.stage);
    this.boss = new BossCtl(this.stage);

    const burst = (tint: number | number[], texture = 'spark', speed = 0.25) =>
      this.add.particles(0, 0, texture, {
        lifespan: { min: 220, max: 560 },
        speed: { min: L.H * 0.03, max: L.H * speed },
        scale: { start: L.unit * 0.18, end: 0 },
        alpha: { start: 1, end: 0 },
        tint,
        blendMode: 'ADD',
        emitting: false,
      });
    this.emSparks = burst([0xffffff, 0xffe0a0, 0xffb060], 'spark', 0.32);
    this.emEmbers = burst([0xff2a3a, 0xff6a3a], 'spark', 0.12);
    this.emSmoke = this.add.particles(0, 0, 'glow', { lifespan: 420, speed: { min: 10, max: L.H * 0.03 }, scale: { start: L.unit * 0.25, end: L.unit * 0.6 }, alpha: { start: 0.35, end: 0 }, tint: 0x30303a, emitting: false });
    this.emShards = this.add.particles(0, 0, 'shard', { lifespan: { min: 700, max: 1500 }, speed: { min: L.H * 0.05, max: L.H * 0.4 }, gravityY: L.H * 0.9, rotate: { min: 0, max: 360 }, scale: { start: L.unit * 0.25, end: 0 }, tint: [0x0a0a0a, 0x7a0a12], emitting: false });
    this.emDebris = this.add.particles(0, 0, 'shard', { lifespan: { min: 900, max: 1800 }, speedX: { min: -L.W * 0.4, max: L.W * 0.4 }, speedY: { min: -L.H * 0.5, max: -L.H * 0.1 }, gravityY: L.H * 1.2, rotate: { min: 0, max: 360 }, scale: { start: L.unit * 0.5, end: L.unit * 0.2 }, tint: 0x0b0a0c, emitting: false });
    this.fxLayer.add([this.emShards, this.emDebris, this.emSmoke]);
    this.addLayer.add([this.emSparks, this.emEmbers]);

    // screen-space overlay (its own camera: unaffected by zoom/shake/tilt)
    this.redWash = this.add.rectangle(0, 0, L.W, L.H, 0x8a0010, 1).setOrigin(0).setAlpha(0).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.vignette = this.add.image(0, 0, 'vignette').setOrigin(0).setDisplaySize(L.W, L.H);
    this.grain = this.add.tileSprite(0, 0, L.W, L.H, 'noise').setOrigin(0).setAlpha(0.05).setBlendMode(Phaser.BlendModes.OVERLAY);
    this.flashRect = this.add.rectangle(0, 0, L.W, L.H, 0xffffff, 1).setOrigin(0).setAlpha(0);
    this.letterTop = this.add.rectangle(0, 0, L.W, L.H * 0.09, 0x000000, 1).setOrigin(0, 1).setY(0);
    this.letterBot = this.add.rectangle(0, L.H, L.W, L.H * 0.09, 0x000000, 1).setOrigin(0, 0);
    this.gScreen = this.add.graphics();
    this.screenLayer.add([this.redWash, this.vignette, this.grain, this.gScreen, this.flashRect, this.letterTop, this.letterBot]);

    this.uiCam = this.cameras.add(0, 0, L.W, L.H);
    this.uiCam.ignore([this.bgLayer, this.floorLayer, this.backLayer, this.actorLayer, this.fxLayer, this.addLayer, this.wordLayer, this.topLayer]);
    this.cameras.main.ignore(this.screenLayer);

    const off = this.dir.on((e) => this.onEvent(e));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => off());
    this.scale.on('resize', (size: Phaser.Structs.Size) => this.relayout(size.width, size.height));
    this.gore.level = this.data3.settings().gore;
    if (import.meta.env.DEV) (window as unknown as { __BATTLE__?: BattleScene }).__BATTLE__ = this;
    // the hero drops onto the roof during the intro
    this.hero.ch.lift = L.H;
  }

  private relayout(W: number, H: number): void {
    this.L = this.computeLayout(W, H);
    const L = this.L;
    this.world.layout(L);
    this.gore.layout(L);
    this.words.setUnit(L.unit);
    this.syncStage();
    this.impactBg.setSize(W, H);
    this.dim.setSize(W, H);
    this.blackout.setSize(W, H);
    this.redWash.setSize(W, H);
    this.flashRect.setSize(W, H);
    this.vignette.setDisplaySize(W, H);
    this.grain.setSize(W, H);
    this.reflRT.setPosition(0, L.groundY).resize(W, H - L.groundY);
    this.uiCam.setSize(W, H);
    this.hero.ch.place(this.hero.ch.root, L.unit);
    this.boss.ch.place(this.boss.ch.root, L.unit);
  }

  private syncStage(): void {
    this.stage = this.makeStage();
    this.hero.setStage(this.stage);
    this.boss.setStage(this.stage);
    for (const a of this.actors.values()) a.setStage(this.stage);
    for (const c of this.cameos.values()) c.setStage(this.stage);
  }

  // ------------------------------------------------------------------ frame

  update(_time: number, delta: number): void {
    if (this.data3.paused()) return;
    this.data3.tick(delta);
    const now = this.dir.getNow();
    const set = this.data3.settings();
    this.gore.level = set.gore;

    // mirror anomaly: the whole stage flips (inputs are flipped by the director)
    const mirrored = this.dir.isMirrored(now);
    if (mirrored !== this.mirrored) {
      this.mirrored = mirrored;
      this.world.setMirror(mirrored);
      this.syncStage();
      this.effects.push(glitchBands(this.L.W, this.L.H, this.L.unit, 260, [0xff2a3a, 0x8fb0ff, 0xffffff]));
      this.flash(0xffffff, 0.35, 160);
      this.data3.hud?.flag?.('glitch', true, 300);
    }

    // visual time: slow motion, hit-stop, time stop
    if (now < this.timeStopUntil || now < this.crashUntil) this.vtsTarget = 0.02;
    else if (performance.now() < this.slowUntil) this.vtsTarget = 0.28;
    else this.vtsTarget = 1;
    this.vts += (this.vtsTarget - this.vts) * Math.min(1, delta / 90);
    let vdt = delta * this.vts;
    if (this.hitStop > 0) {
      this.hitStop -= delta;
      vdt = delta * 0.04;
    }
    this.tweens.timeScale = this.hitStop > 0 ? 0.1 : 1;

    const env: Env = { wind: WIND[this.act], floor: this.act === 'fall' ? this.L.H * 3 : this.L.groundY, updraft: this.act === 'fall' ? 1500 : 0 };

    // boss strikes land on the beat
    for (const b of this.bossNotes) {
      if (!b.struck && now >= b.note.at) {
        b.struck = true;
        this.boss.strike(b.move);
      }
    }
    this.bossNotes = this.bossNotes.filter((b) => now - b.note.at < 1000);

    // enemies
    for (const a of this.actors.values()) {
      if (!a.dead) for (const n of a.spawn.notes) if (now >= n.at && now - n.at < 400) a.strike(n);
      a.place(now, vdt, env);
      if (a.dead && now - a.deadAt > 4500) a.fade = Math.max(0, a.fade - delta / 700);
    }
    for (const [id, a] of this.actors) if (a.dead && a.fade <= 0) this.actors.delete(id);

    this.hero.update(now, vdt, env);
    this.boss.update(now, vdt, env);
    for (const c of this.cameos.values()) c.update(vdt, env);
    this.world.update(delta, this.vts, this.hero.pos.x);
    this.gore.update(delta, this.vts);

    this.draw(now, set);

    this.gFx.clear();
    this.gAdd.clear();
    this.gScreen.clear();
    this.effects = this.effects.filter((e) => e.update(e.real ? delta : vdt, e.real ? this.gAdd : this.gAdd));
    this.grain.setTilePosition(Math.random() * 128, Math.random() * 128);
    this.updateOverlays(now, delta, set);
  }

  private draw(now: number, set: SceneSettings): void {
    const light = this.world.light;
    const flat = this.impact > 0 || now < this.invertUntil ? 0x000000 : null;
    const invert = flat !== null;
    this.impactBg.setVisible(invert);
    this.gBack.clear();
    this.gActors.clear();
    this.gHero.clear();
    this.gTop.clear();
    const reflect = !invert && (this.act === 'roof' || this.act === 'temple') && set.effects === 'high';
    this.gRefl.clear();
    const glows: Layers[] = [];
    const mirror = (L: Layers, alpha: number) => {
      if (!reflect) return;
      this.gRefl.save();
      this.gRefl.translateCanvas(0, this.L.groundY * 2);
      this.gRefl.scaleCanvas(1, -1);
      drawLayers(this.gRefl, L, { light, s: this.L.unit, noRim: true });
      this.gRefl.restore();
      void alpha;
    };

    // far actors (gunners, the cleaner on his ledge)
    for (const a of this.actors.values()) {
      if (!a.far) continue;
      const L = a.ch.draw(this.gBack, light, { flat });
      glows.push(L);
    }
    const cleaner = this.cameos.get('cleaner');
    if (cleaner?.visible) glows.push(cleaner.ch.draw(this.gBack, light, { flat }));

    // corpses first, then the living, the boss and the hero on top
    const list = [...this.actors.values()].filter((a) => !a.far).sort((x, y) => Number(!x.dead) - Number(!y.dead));
    for (const a of list) {
      if (a.dead && a.fade < 1) {
        // fading corpses are skipped in reflections
        a.ch.draw(this.gActors, light, { flat, noRim: true });
        continue;
      }
      const L = a.ch.draw(this.gActors, light, { flat });
      if (!a.dead) glows.push(L);
      mirror(L, 1);
      if (a.ghost && now < a.ghost.until) {
        // dodger afterimage
        this.gActors.save();
        this.gActors.translateCanvas(a.ghost.x - a.ch.root.x, 0);
        drawLayers(this.gActors, L, { light, s: this.L.unit, flat: 0x15151c });
        this.gActors.restore();
      }
    }
    for (const c of this.cameos.values()) {
      if (c.id === 'cleaner' || !c.visible) continue;
      const L = c.ch.draw(this.gActors, light, { flat });
      glows.push(L);
      mirror(L, 1);
    }
    if (this.boss.visible) {
      const L = this.boss.ch.draw(this.gActors, light, { flat });
      glows.push(L);
      mirror(L, 1);
    }
    const HL = this.hero.ch.draw(this.gHero, light, { flat });
    glows.push(HL);
    mirror(HL, 1);

    this.reflRT.clear();
    if (reflect) this.reflRT.draw(this.gRefl, 0, -this.L.groundY);
    this.reflRT.setVisible(reflect);

    // in the dark only eyes and blades remain
    if (now < this.blackoutUntil) for (const L of glows) drawGlows(this.gTop, L);

    // hero aura during Bloodlust
    const hc = this.hero.chest;
    this.heroAura.setPosition(hc.x, hc.y).setScale((this.L.unit * 90) / 128).setAlpha(this.bloodlust ? 0.28 + Math.sin(now / 80) * 0.06 : 0);
    if (this.bloodlust && Math.random() < 0.3) this.emEmbers.explode(1, hc.x + (Math.random() - 0.5) * this.L.unit * 30, hc.y + this.L.unit * 20);
  }

  private updateOverlays(now: number, delta: number, set: SceneSettings): void {
    if (this.impact > 0) this.impact -= delta;
    // blackout flickers on every beat (lightning in the tunnel)
    const inBlackout = now < this.blackoutUntil;
    const target = inBlackout ? 0.93 : 0;
    this.blackout.setAlpha(this.blackout.alpha + (target - this.blackout.alpha) * Math.min(1, delta / 120));
    const whisper = now < this.whisperUntil;
    this.dim.setAlpha(this.dim.alpha + ((whisper ? 0.5 : this.execDim ? 0.45 : 0) - this.dim.alpha) * Math.min(1, delta / 200));
    this.redWash.setAlpha(this.redWash.alpha + ((this.bloodlust ? 0.22 : 0) - this.redWash.alpha) * Math.min(1, delta / 200));
    const letter = this.cinematic ? 1 : 0;
    this.letterK += (letter - this.letterK) * Math.min(1, delta / 220);
    this.letterTop.setY(this.L.H * 0.09 * this.letterK);
    this.letterBot.setY(this.L.H - this.L.H * 0.09 * this.letterK);
    if (now > this.panelsUntil && this.panelCams.length) this.closePanels();
    this.updatePanels();
    void set;
  }

  private execDim = false;
  private cinematic = false;
  private letterK = 0;

  // ------------------------------------------------------------------ helpers

  private flash(color: number, alpha: number, ms: number): void {
    const f = this.data3.settings().flashes;
    if (f === 'off') return;
    const a = f === 'low' ? alpha * 0.35 : alpha;
    this.flashRect.setFillStyle(color, 1).setAlpha(a);
    this.tweens.killTweensOf(this.flashRect);
    this.tweens.add({ targets: this.flashRect, alpha: 0, duration: ms });
  }

  private impactFrame(ms = 60): void {
    if (this.data3.settings().flashes !== 'full') return;
    this.impact = ms;
  }

  private shake(ms: number, k: number): void {
    const s = this.data3.settings().shake;
    if (s === 'off') return;
    this.cameras.main.shake(ms, k * (s === 'low' ? 0.4 : 1), true);
  }

  private punch(zoom: number, ms: number): void {
    if (this.data3.settings().reduceMotion) return;
    const cam = this.cameras.main;
    this.tweens.killTweensOf(cam);
    cam.setZoom(zoom);
    this.tweens.add({ targets: cam, zoom: 1, duration: ms, ease: 'Quad.easeOut' });
  }

  private slowmo(ms: number): void {
    if (this.data3.settings().reduceMotion) return;
    this.slowUntil = performance.now() + ms;
  }

  private visualSign(side: 'left' | 'right'): number {
    return sideSign(side) * (this.mirrored ? -1 : 1);
  }

  private bossContact(move: BossMove): Vec {
    const hx = this.hero.pos.x;
    const bx = this.boss.x;
    const x = hx + (bx - hx) * 0.32;
    const u = this.L.unit;
    const y = move === 'high' ? this.L.groundY - u * 95 : move === 'low' ? this.L.groundY - u * 18 : this.L.groundY - u * 62;
    return { x, y };
  }

  // ------------------------------------------------------------------ events

  private onEvent(e: BattleEvent): void {
    const u = this.L.unit;
    switch (e.type) {
      case 'beat':
        this.beatCount = e.n;
        this.world.beat(e.n, e.bar, this.intensity);
        this.gore.beat();
        if (e.bar === 0 && this.intensity >= 3 && !this.data3.settings().reduceMotion) this.punch(1.018, e.beatMs * 0.45);
        if (this.dir.getNow() < this.blackoutUntil) this.blackout.setAlpha(0.35);
        break;
      case 'section':
        this.intensity = e.id === 'roofDrop' || e.id === 'trainDrop' || e.id === 'bossRage' ? 4 : e.id === 'roofBuild' || e.id === 'boss' ? 3 : e.id === 'fall' || e.id === 'cameo' ? 3 : 2;
        break;
      case 'segment':
        this.onSegment(e.id, e.act, e.at);
        break;
      case 'spawn': {
        const a = new EnemyActor(e.enemy, this.stage);
        this.actors.set(e.enemy.id, a);
        if (e.enemy.kind === 'gunner') {
          const until = () => a.dead || this.dir.getNow() > e.enemy.notes[0].at - this.dir.beatMs * 0.45;
          this.effects.push(laser(() => (a.dead ? null : a.muzzle), () => this.hero.chest, Math.max(1, u * 0.35), until));
          const fireAt = e.enemy.notes[0].at - this.dir.beatMs * 0.45;
          this.time.delayedCall(Math.max(0, fireAt - this.dir.getNow()), () => {
            if (a.dead) return;
            this.emSparks.explode(8, a.muzzle.x, a.muzzle.y);
            this.effects.push(real(tracer(a.muzzle, this.hero.chest, u * 0.8, 0xffd070, this.dir.beatMs * 0.45)));
          });
        }
        if (Math.random() < 0.18 && e.enemy.kind === 'grunt' && !e.enemy.assist) this.data3.bark?.('grunt.charge');
        break;
      }
      case 'telegraph': {
        const a = this.actors.get(e.note.enemy);
        a?.telegraph(e.note, this.dir.getNow());
        break;
      }
      case 'hint': {
        const target = () => {
          if (e.kind === 'duel' || e.kind === 'exec') return this.boss.chest;
          const a = [...this.actors.values()].find((x) => !x.dead && x.spawn.notes.some((n) => Math.abs(n.at - e.noteAt) < 5));
          return a ? a.chest : this.hero.chest;
        };
        const until = e.noteAt + 260;
        this.hintNote = { until };
        if (e.dir) {
          const c = target();
          const anchor = { x: (c.x + this.hero.chest.x) / 2, y: c.y - u * 30 };
          this.effects.push(ghostSwipe(anchor, this.mirrored && (e.dir === 'left' || e.dir === 'right') ? (e.dir === 'left' ? 'right' : 'left') : e.dir, u * 26, () => this.dir.getNow() > until));
        }
        this.data3.hud?.hint?.({ dir: e.dir, kind: e.kind });
        this.time.delayedCall(Math.max(500, until - this.dir.getNow() + 300), () => this.data3.hud?.hint?.(null));
        break;
      }
      case 'judge':
        this.onJudge(e.note, e.judgement, e.action);
        break;
      case 'kill':
        this.onKill(e);
        break;
      case 'enemyHurt': {
        const a = this.actors.get(e.enemy);
        if (!a) break;
        a.hurt();
        this.emSparks.explode(16, a.chest.x, a.chest.y);
        this.gore.burst(a.chest.x, a.chest.y, { x: this.visualSign(a.side), y: -0.3 }, 0.6);
        this.words.pop(e.step === 0 && a.kind === 'brute' ? 'КРАК!' : 'ХРЯСЬ!', a.head.x, a.head.y - u * 18, 'impact');
        this.shake(120, 0.006);
        break;
      }
      case 'shift': {
        const a = this.actors.get(e.enemy);
        if (!a) break;
        this.emSmoke.explode(12, a.ch.root.x, this.L.groundY - u * 50);
        a.shift(e.to, this.dir.getNow());
        break;
      }
      case 'heroHit': {
        const from = e.source === 'boss' || e.source === 'exec' ? this.visualSign(BOSS_SIDE) : this.visualSign(e.dir === 'left' ? 'left' : e.dir === 'right' ? 'right' : this.hero.facing > 0 ? 'right' : 'left');
        this.hero.hit(from);
        const c = this.hero.chest;
        this.gore.burst(c.x, c.y, { x: -from, y: -0.4 }, 0.9);
        this.gore.screenSplat(e.damage >= 14 ? 0.8 : 0.45);
        this.flash(0xc00010, 0.35, 220);
        this.shake(220, 0.012);
        this.words.pop(KILL_WORDS.miss[Math.floor(Math.random() * 2)], c.x, c.y - u * 40, 'small', { color: '#ff3040' });
        break;
      }
      case 'whiff':
        this.hero.whiff(e.dir);
        this.effects.push(slashArc(...this.airArc(e.dir), 0.12, 0x8a8a9a, u * 3, 220));
        if (e.stray) this.words.pop('РАНО', this.hero.chest.x, this.hero.chest.y - u * 60, 'small', { color: '#9aa0b0' });
        break;
      case 'meters':
        if (e.meters.combo > this.lastCombo) {
          const next = COMBO_WORDS[this.comboWordIdx];
          if (next && e.meters.combo >= next[0]) {
            this.comboWordIdx++;
            this.words.pop(next[1], this.L.W / 2, this.L.H * 0.3, 'combo', { rot: -0.08 });
          }
        }
        if (e.meters.combo === 0) this.comboWordIdx = 0;
        this.lastCombo = e.meters.combo;
        break;
      case 'bloodlust':
        this.bloodlust = e.on;
        this.data3.hud?.flag?.('bloodlust', e.on);
        if (e.on) {
          this.flash(0xff0018, 0.5, 400);
          this.words.pop('ЖАЖДА КРОВИ', this.L.W / 2, this.L.H * 0.26, 'combo', { size: 22 });
          this.effects.push(real(speedLines(this.hero.chest.x, this.hero.chest.y, this.L.W, this.L.H, u * 0.5, 500, 0xff2a3a)));
          this.punch(1.05, 600);
        }
        break;
      case 'reboot':
        this.hero.kneel(e.durationMs);
        this.effects.push(glitchBands(this.L.W, this.L.H, u, 500, [0xff2a3a, 0xffffff]));
        this.data3.hud?.flag?.('glitch', true, 600);
        this.words.pop('ПЕРЕЗАГРУЗКА', this.L.W / 2, this.L.H * 0.3, 'impact');
        break;
      case 'cameo':
        this.onCameo(e.id, e.phase, e.side, e.role);
        break;
      case 'boss':
        this.onBoss(e.phase);
        break;
      case 'bossMove': {
        if (!this.boss.visible) this.showBoss();
        this.boss.windup(e.move, e.note.at - this.dir.getNow());
        this.bossNotes.push({ note: e.note, move: e.move, struck: false });
        break;
      }
      case 'execShow': {
        const c = this.boss.chest;
        this.effects.push(execGlyph({ x: c.x, y: c.y - u * 6 }, this.mirrored ? mirrorDir(e.dir) : e.dir, u * 34, this.dir.beatMs * 0.95));
        this.words.pop(String(e.index + 1), c.x + u * 50, c.y - u * 60, 'small', { color: '#ff3040', size: 12 });
        break;
      }
      case 'execPerform':
        this.words.pop('ПОВТОРИ', this.L.W / 2, this.L.H * 0.24, 'impact');
        break;
      case 'execCut': {
        const c = this.boss.chest;
        if (e.ok && e.dir) {
          this.hero.execCut(e.dir, BOSS_SIDE);
          this.boss.flinch();
          const dv = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[this.mirrored ? mirrorDir(e.dir) : e.dir];
          const a = { x: c.x - dv[0] * u * 50, y: c.y - dv[1] * u * 50 };
          const b = { x: c.x + dv[0] * u * 50, y: c.y + dv[1] * u * 50 };
          this.effects.push(slashArc(a, b, 0.1, 0xff1a2a, u * 4, 380));
          this.gore.burst(c.x, c.y, { x: dv[0] || 0.3, y: dv[1] || -0.5 }, 1.5);
          this.impactFrame(50);
          this.hitStop = 70;
          this.shake(180, 0.01);
          // the count climbs in a zig-zag so consecutive words never stack on each other
          const side = e.index % 2 === 0 ? -1 : 1;
          this.words.pop(['РАЗ', 'ДВА', 'ТРИ', 'ЧЕТЫРЕ', 'ПЯТЬ'][e.index] ?? '!', c.x + side * u * 34, c.y - u * (58 + e.index * 20), 'impact', { hold: Math.min(320, this.dir.beatMs * 0.5) });
        } else {
          this.words.pop('ПРОМАХ', c.x, c.y - u * 70, 'small', { color: '#9aa0b0' });
        }
        break;
      }
      case 'finisher':
        this.onFinisher(e.flawless);
        break;
      case 'anomaly':
        this.onAnomaly(e.kind, e.at, e.durationMs);
        break;
      case 'voice':
        if (e.cue === 'boss.intro') this.showBoss();
        break;
      case 'complete':
        this.finished = true;
        break;
      default:
        break;
    }
  }

  private airArc(dir: Dir): [Vec, Vec] {
    const c = this.hero.chest;
    const u = this.L.unit;
    const d = this.mirrored && (dir === 'left' || dir === 'right') ? mirrorDir(dir) : dir;
    if (d === 'left') return [{ x: c.x + u * 10, y: c.y - u * 30 }, { x: c.x - u * 55, y: c.y + u * 10 }];
    if (d === 'right') return [{ x: c.x - u * 10, y: c.y - u * 30 }, { x: c.x + u * 55, y: c.y + u * 10 }];
    if (d === 'up') return [{ x: c.x + u * 25, y: c.y + u * 20 }, { x: c.x - u * 10, y: c.y - u * 80 }];
    return [{ x: c.x - u * 20, y: c.y - u * 60 }, { x: c.x + u * 25, y: c.y + u * 40 }];
  }

  private onJudge(note: NoteInfo, j: string, action: Dir | null): void {
    const u = this.L.unit;
    if (j === 'perfect' || j === 'good') {
      if (note.kind === 'boss') {
        this.hero.parry(note.move ?? 'thrust', BOSS_SIDE);
        this.boss.parried();
        const p = this.bossContact(note.move ?? 'thrust');
        this.emSparks.explode(j === 'perfect' ? 30 : 16, p.x, p.y);
        this.effects.push(shockwave(p.x, p.y, u * (j === 'perfect' ? 40 : 24), u * 0.8, 0xffe0b0, 260, 1));
        if (j === 'perfect') {
          this.words.pop(KILL_WORDS.parry[Math.floor(Math.random() * 3)], p.x, p.y - u * 30, 'impact');
          this.impactFrame(45);
          this.hitStop = 50;
        }
        this.shake(100, 0.005);
        return;
      }
      if (note.kind === 'exec') return;
      const a = this.actors.get(note.enemy);
      const target = a ? (note.dir === 'up' ? a.head : note.dir === 'down' ? { x: a.ch.root.x, y: this.L.groundY - u * 12 } : a.chest) : null;
      if (action) this.hero.slash(action, target);
      if (target && action) {
        const [p0, p1] = this.slashThrough(action, target);
        this.effects.push(slashArc(p0, p1, 0.16, j === 'perfect' ? 0xff1a2a : 0xd0d0e0, u * (j === 'perfect' ? 4.2 : 3.2), j === 'perfect' ? 360 : 280));
      }
      if (j === 'perfect' && !note.final && a) this.hitStop = 35;
    } else if (j === 'fooled') {
      if (action) this.hero.whiff(action);
      this.words.pop('ОБМАН', this.hero.chest.x, this.hero.chest.y - u * 60, 'impact');
      this.shake(120, 0.006);
    } else if (j === 'ignored') {
      if (note.kind === 'boss' || (this.actors.get(note.enemy)?.kind === 'feinter' && Math.random() < 0.6)) this.words.pop('ВЫДЕРЖКА', this.hero.chest.x, this.hero.chest.y - u * 62, 'small', { color: '#c8d4ff' });
    }
  }

  /** Slash arc endpoints that cut through `target` in the slash direction. */
  private slashThrough(dir: Dir, t: Vec): [Vec, Vec] {
    const u = this.L.unit;
    const d = this.mirrored && (dir === 'left' || dir === 'right') ? mirrorDir(dir) : dir;
    const r = u * 34;
    if (d === 'left') return [{ x: t.x + r, y: t.y - r * 0.6 }, { x: t.x - r, y: t.y + r * 0.5 }];
    if (d === 'right') return [{ x: t.x - r, y: t.y - r * 0.6 }, { x: t.x + r, y: t.y + r * 0.5 }];
    if (d === 'up') return [{ x: t.x + r * 0.4, y: t.y + r }, { x: t.x - r * 0.3, y: t.y - r }];
    return [{ x: t.x - r * 0.4, y: t.y - r }, { x: t.x + r * 0.3, y: t.y + r * 0.8 }];
  }

  private onKill(e: Extract<BattleEvent, { type: 'kill' }>): void {
    const a = this.actors.get(e.enemy);
    if (!a || a.dead) return;
    const u = this.L.unit;
    const now = this.dir.getNow();
    const chest = { ...a.chest };
    const head = { ...a.head };
    // cameo effects for assist kills
    if (e.by !== 'hero') {
      const c = this.cameos.get(e.by);
      if (c) {
        c.attack(head);
        if (e.by === 'cleaner') {
          this.emSparks.explode(6, c.muzzle.x, c.muzzle.y);
          this.effects.push(real(streak(c.muzzle, head, u * 0.6, 0xffe0a0, 140)));
        } else if (e.by === 'fox') this.effects.push(chain(() => c.hand, head, Math.max(1.5, u * 0.5), 300));
        else this.effects.push(slashArc({ x: chest.x - u * 30, y: chest.y - u * 25 }, { x: chest.x + u * 30, y: chest.y + u * 20 }, 0.14, 0xe8e8ff, u * 3.5, 320));
      }
    }
    const { cuts } = a.die(e.style, e.dir, now);
    const away = { x: this.visualSign(a.side), y: -0.25 };
    const power = e.bloodlust ? 2.4 : e.style === 'burst' ? 2.2 : e.perfect ? 1.4 : 1;
    this.gore.burst(chest.x, chest.y, away, power);
    const rd = a.ch.ragdoll;
    const at = (k: string) => () => {
      const p = rd?.p.get(k);
      return p ? { x: p.x, y: p.y } : null;
    };
    const dirOf = (from: string, to: string) => () => {
      const p = rd?.p.get(from);
      const q = rd?.p.get(to);
      if (!p || !q) return { x: 0, y: -1 };
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const l = Math.hypot(dx, dy) || 1;
      return { x: dx / l, y: dy / l };
    };
    if (cuts.includes('neck')) {
      this.gore.spray(at('neck'), dirOf('neck', 'chest'), 1300, 1.2);
      this.gore.spray(at('neckHead'), dirOf('neckHead', 'head'), 600, 0.5);
    }
    if (cuts.includes('waist')) {
      this.gore.spray(at('spine'), dirOf('spine', 'pelvis'), 900, 1);
      this.gore.spray(at('spineUpper'), dirOf('spineUpper', 'chest'), 900, 1);
    }
    if (cuts.includes('armF')) this.gore.spray(at('shoulderF'), dirOf('shoulderF', 'elbowF'), 700, 0.6);
    if (e.style === 'shot') this.gore.mist(head.x, head.y, u * 18);
    for (let i = 0; i < 3; i++) this.gore.splatFloor(chest.x + (Math.random() - 0.5) * u * 40, u * (14 + Math.random() * 14), 1.2);

    if (e.by === 'hero' && e.scored) {
      this.lastKillAt = performance.now();
      this.killsInBeat = this.killsInBeat.filter((t) => now - t < this.dir.beatMs * 1.5);
      this.killsInBeat.push(now);
      const words = KILL_WORDS[e.style] ?? KILL_WORDS.bisect;
      if (e.perfect || e.bloodlust || Math.random() < 0.35) this.words.pop(words[Math.floor(Math.random() * words.length)], head.x, head.y - u * 22, e.bloodlust ? 'blood' : 'impact');
      this.punch(e.bloodlust ? 1.045 : 1.025, 220);
      this.shake(90, e.style === 'burst' ? 0.012 : 0.005);
      if (e.perfect) this.hitStop = Math.max(this.hitStop, 45);
      if (this.killsInBeat.length >= 3 || e.style === 'burst') {
        this.slowmo(180);
        this.impactFrame(55);
      }
      if (Math.random() < 0.3) this.data3.bark?.('grunt.death');
    } else if (e.style === 'shove') {
      this.data3.bark?.('grunt.death');
    }
    if (a.kind === 'butcher') {
      this.slowmo(500);
      this.impactFrame(80);
      this.flash(0xffffff, 0.6, 400);
      this.emShards.explode(40, chest.x, chest.y);
      this.words.pop('МЯСНИК — ВСЁ', this.L.W / 2, this.L.H * 0.28, 'combo');
    }
    // corpses: keep the stage readable
    const corpses = [...this.actors.values()].filter((x) => x.dead && x.fade >= 1);
    if (corpses.length > 7) corpses.slice(0, corpses.length - 7).forEach((x) => (x.deadAt = now - 4500));
  }

  private onSegment(id: string, act: ActId, at: number): void {
    const u = this.L.unit;
    void at;
    if (act !== this.act) {
      const prev = this.act;
      this.act = act;
      this.syncStage();
      this.world.setAct(act);
      this.gore.clearDecals();
      this.gore.hasFloor = act !== 'fall';
      this.gore.gravity = act === 'fall' ? -this.L.H * 1.2 : this.L.H * 1.5;
      this.gore.floorY = this.L.groundY;
      // corpses don't follow us to the next scene
      for (const [k, a] of this.actors) if (a.dead) this.actors.delete(k);
      this.hero.setFalling(act === 'fall');
      if (prev === 'roof' && act === 'fall') {
        // the roof gives way
        this.emDebris.explode(60, this.L.W / 2, this.L.groundY);
        this.flash(0xffffff, 0.5, 300);
        this.shake(600, 0.02);
        this.effects.push(real(speedLines(this.L.W / 2, this.L.H / 2, this.L.W, this.L.H, u * 0.5, 600)));
        this.words.pop('ВНИЗ', this.L.W / 2, this.L.H * 0.25, 'combo');
      } else if (act === 'train') {
        this.hero.land();
        this.effects.push(shockwave(this.L.W / 2, this.L.groundY, u * 70, u, 0xd6e6ff, 500));
        this.shake(260, 0.012);
        this.words.pop('ПОЕЗД', this.L.W / 2, this.L.H * 0.25, 'combo');
      } else if (act === 'temple') {
        this.flash(0x000000, 0.9, 900);
        this.cinematic = true;
      }
    }
    if (id === 'roofA') {
      // hero lands on the roof
      this.hero.ch.lift = 0;
      this.hero.land();
      this.effects.push(shockwave(this.L.W / 2, this.L.groundY, u * 70, u, 0xffd9cf, 500));
      this.gore.splatFloor(this.L.W / 2, u * 6, 1, 0);
      this.shake(200, 0.01);
    }
    if (id === 'duel') this.cinematic = false;
    if (id === 'exec') {
      this.execDim = true;
      this.cinematic = true;
    }
    if (id === 'finale') {
      this.execDim = false;
    }
  }

  private onCameo(id: CameoId, phase: 'enter' | 'exit', side: 'left' | 'right', role: 'assist' | 'miniboss'): void {
    if (role === 'miniboss') {
      if (phase === 'enter') {
        this.data3.hud?.cutIn?.({ id, name: CAMEO_NAMES[id], side });
        this.flash(0xff0018, 0.35, 300);
      }
      return;
    }
    if (id === 'butcher') return;
    let c = this.cameos.get(id);
    if (phase === 'enter') {
      if (!c) {
        c = new CameoCtl(id as Exclude<CameoId, 'butcher'>, side, this.stage);
        this.cameos.set(id, c);
      }
      c.enter();
      this.data3.hud?.cutIn?.({ id, name: CAMEO_NAMES[id], side });
      this.flash(0xffffff, 0.3, 250);
      this.emSmoke.explode(16, c.spot().x, c.spot().y - this.L.unit * 40);
    } else c?.exit();
  }

  private showBoss(): void {
    if (this.bossShown) return;
    this.bossShown = true;
    this.boss.appear();
    const u = this.L.unit;
    this.effects.push(real(slashArc({ x: -u * 10, y: this.L.H * 0.2 }, { x: this.L.W + u * 10, y: this.L.H * 0.55 }, 0.05, 0xff0018, u * 6, 700)));
    this.flash(0xffffff, 0.6, 500);
    this.shake(500, 0.016);
    this.data3.hud?.cutIn?.({ id: 'verdict', name: 'ВЕРДИКТ', side: 'right' });
  }

  private onBoss(phase: string): void {
    const u = this.L.unit;
    switch (phase) {
      case 'rage':
        if (!this.bossShown) this.showBoss();
        this.boss.rage = true;
        this.world.setRageMoon(true);
        this.effects.push(shockwave(this.boss.chest.x, this.boss.chest.y, this.L.W * 0.9, u * 1.2, 0xff1a2a, 900, 0.6));
        this.shake(700, 0.02);
        this.flash(0xff0018, 0.5, 500);
        break;
      case 'broken':
        this.boss.broken();
        this.slowmo(700);
        this.impactFrame(90);
        this.emSparks.explode(40, this.boss.chest.x, this.boss.chest.y);
        this.words.pop('СЛОМЛЕН', this.L.W / 2, this.L.H * 0.27, 'combo');
        break;
      case 'execution':
        this.punch(1.0, 10);
        break;
      default:
        break;
    }
  }

  private onFinisher(flawless: boolean): void {
    const u = this.L.unit;
    const head = { ...this.boss.ch.frame.j.head };
    this.hero.execCut('right', BOSS_SIDE);
    this.effects.push(slashArc({ x: head.x - u * 70, y: head.y + u * 30 }, { x: head.x + u * 70, y: head.y - u * 10 }, 0.06, 0xff0018, u * 7, 900));
    this.boss.ch.kill(['neck'], { x: u * 40, y: -u * 420 }, 7);
    this.boss.dead = true;
    const rd = this.boss.ch.ragdoll;
    const at = (k: string) => () => {
      const p = rd?.p.get(k);
      return p ? { x: p.x, y: p.y } : null;
    };
    this.gore.spray(at('neck'), () => ({ x: 0.1, y: -1 }), 2600, 2.4);
    this.gore.burst(head.x, head.y, { x: 0.3, y: -1 }, 3, 1.4);
    this.gore.screenSplat(1);
    this.slowmo(1300);
    this.impactFrame(120);
    this.flash(0xffffff, 0.8, 900);
    this.shake(800, 0.025);
    this.world.setRageMoon(false);
    this.words.pop(flawless ? 'КАЗНЬ · БЕЗУПРЕЧНО' : 'КАЗНЬ', this.L.W / 2, this.L.H * 0.24, 'combo', { size: 24, hold: 1600 });
    this.cinematic = true;
    this.time.delayedCall(1400, () => this.hero.victory());
  }

  private onAnomaly(kind: AnomalyKind, at: number, ms: number): void {
    const u = this.L.unit;
    const until = at + ms;
    switch (kind) {
      case 'lightning':
        this.world.lightning(1);
        this.time.delayedCall(ms * 0.5, () => this.world.lightning(0.7));
        break;
      case 'invert':
        this.invertUntil = until;
        break;
      case 'moonEye':
        this.world.setMoonEye(true);
        this.time.delayedCall(ms, () => this.world.setMoonEye(false));
        break;
      case 'bloodRain':
        this.world.setBloodRain(true);
        this.time.delayedCall(ms, () => this.world.setBloodRain(false));
        break;
      case 'glitch':
        this.effects.push(glitchBands(this.L.W, this.L.H, u, Math.min(ms, 600), [0xff2a3a, 0x39d5ff, 0xffffff]));
        this.data3.hud?.flag?.('glitch', true, Math.min(ms, 600));
        this.shake(200, 0.008);
        break;
      case 'whisper':
        this.whisperUntil = until;
        this.words.pop('Я ВИЖУ ТЕБЯ', this.L.W / 2, this.L.H * 0.4, 'whisper', { hold: ms * 0.7, rot: -0.04 });
        break;
      case 'hudCut':
        this.data3.hud?.flag?.('hudCut', true, ms);
        this.effects.push(real(slashArc({ x: -u * 10, y: this.L.H * 0.08 }, { x: this.L.W + u * 10, y: this.L.H * 0.12 }, 0.03, 0xff0018, u * 4, 600)));
        this.shake(300, 0.012);
        break;
      case 'fakeCrash':
        this.crashUntil = until;
        this.data3.hud?.flag?.('fakeCrash', true, ms);
        break;
      case 'timeStop':
        this.timeStopUntil = until;
        this.flash(0xffffff, 0.25, 200);
        break;
      case 'panels':
        this.openPanels(until);
        break;
      case 'blackout':
        this.blackoutUntil = until;
        break;
      case 'mirror':
        // handled per frame from director.isMirrored()
        break;
    }
  }

  // ------------------------------------------------------------------ manga panels (inset cameras)

  private openPanels(until: number): void {
    if (this.data3.settings().reduceMotion) return;
    this.panelsUntil = until;
    const { W, H } = this.L;
    const mk = (x: number, y: number, w: number, h: number) => {
      const cam = this.cameras.add(x, y, w, h);
      cam.ignore(this.screenLayer);
      cam.setBackgroundColor('#000000');
      return cam;
    };
    this.panelCams = [mk(W * 0.04, H * 0.11, W * 0.44, H * 0.16), mk(W * 0.52, H * 0.11, W * 0.44, H * 0.16)];
    this.data3.hud?.flag?.('panels', true, until - this.dir.getNow());
  }

  private updatePanels(): void {
    if (!this.panelCams.length) return;
    const [a, b] = this.panelCams;
    const h = this.hero.ch.frame.j.head;
    a.setZoom(3.2).centerOn(h.x, h.y);
    const target = [...this.actors.values()].filter((x) => !x.dead).sort((x, y) => Math.abs(x.ch.root.x - this.hero.pos.x) - Math.abs(y.ch.root.x - this.hero.pos.x))[0];
    const t = target ? target.head : this.hero.ch.frame.j.tip;
    b.setZoom(2.6).centerOn(t.x, t.y);
    // white gutters
    for (const cam of this.panelCams) {
      this.gScreen.lineStyle(this.L.unit * 1.2, 0xffffff, 1);
      this.gScreen.strokeRect(cam.x, cam.y, cam.width, cam.height);
    }
  }

  private closePanels(): void {
    for (const c of this.panelCams) this.cameras.remove(c);
    this.panelCams = [];
  }

  /** For tests / dev tools. */
  get debug() {
    return { actors: this.actors.size, effects: this.effects.length, drops: this.gore.count, act: this.act, finished: this.finished, killsInBeat: this.killsInBeat.length, hint: this.hintNote, lastKill: this.lastKillAt, beat: this.beatCount, cut: cutLine };
  }
}

function mirrorDir(d: Dir): Dir {
  return d === 'left' ? 'right' : d === 'right' ? 'left' : d;
}
