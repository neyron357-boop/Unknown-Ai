import Phaser from 'phaser';
import { Character } from '../anatomy/Character';
import { DEFAULT_LIGHT } from '../anatomy/look';
import type { Cut } from '../anatomy/physics';
import { BRUTE, BUTCHER, CLEANER, CRAWLER, DUELIST, FOX, GUNNER, HERO, LEAPER, NINJA, RONIN, THUG, VERDICT } from '../anatomy/poses';
import type { Pose } from '../anatomy/skeleton';
import type { CharId } from '../anatomy/specs';

interface Cell {
  id: CharId;
  pose: Pose;
  label: string;
  variant?: number;
  facing?: number;
  kill?: { cuts: Cut[]; v: [number, number]; spin?: number };
  run?: boolean;
}

const SETS: Record<string, Cell[]> = {
  hero: [
    { id: 'hero', pose: HERO.guard, label: 'guard' },
    { id: 'hero', pose: HERO.slashWind, label: 'slashWind' },
    { id: 'hero', pose: HERO.slashHit, label: 'slashHit' },
    { id: 'hero', pose: HERO.slashFollow, label: 'follow' },
    { id: 'hero', pose: HERO.upWind, label: 'upWind' },
    { id: 'hero', pose: HERO.upHit, label: 'upHit' },
    { id: 'hero', pose: HERO.downWind, label: 'downWind' },
    { id: 'hero', pose: HERO.downHit, label: 'downHit' },
    { id: 'hero', pose: HERO.parryHigh, label: 'parryHigh' },
    { id: 'hero', pose: HERO.parryLow, label: 'parryLow' },
    { id: 'hero', pose: HERO.parryMid, label: 'parryMid' },
    { id: 'hero', pose: HERO.hit, label: 'hit' },
    { id: 'hero', pose: HERO.kneel, label: 'kneel' },
    { id: 'hero', pose: HERO.dash, label: 'dash' },
    { id: 'hero', pose: HERO.land, label: 'land' },
    { id: 'hero', pose: HERO.victory, label: 'victory' },
  ],
  cast: [
    { id: 'hero', pose: HERO.guard, label: 'UNKNOWN' },
    { id: 'thug', pose: THUG.idle, label: 'thug/hood', variant: 0, facing: -1 },
    { id: 'thug', pose: THUG.wind, label: 'thug/cap', variant: 1, facing: -1 },
    { id: 'thug', pose: THUG.strike, label: 'thug/bandana', variant: 2, facing: -1 },
    { id: 'thug', pose: THUG.idle, label: 'thug/gas', variant: 3, facing: -1, run: true },
    { id: 'brute', pose: BRUTE.idle, label: 'brute', facing: -1 },
    { id: 'ninja', pose: NINJA.idle, label: 'ninja', facing: -1 },
    { id: 'duelist', pose: DUELIST.idle, label: 'duelist', facing: -1 },
    { id: 'leaper', pose: LEAPER.idle, label: 'leaper', facing: -1 },
    { id: 'crawler', pose: CRAWLER.idle, label: 'crawler', facing: -1 },
    { id: 'gunner', pose: GUNNER.aim, label: 'gunner', facing: -1 },
    { id: 'butcher', pose: BUTCHER.idle, label: 'butcher', facing: -1 },
    { id: 'verdict', pose: VERDICT.idle, label: 'VERDICT', facing: -1 },
    { id: 'cleaner', pose: CLEANER.aim, label: 'cleaner' },
    { id: 'fox', pose: FOX.idle, label: 'fox' },
    { id: 'ronin', pose: RONIN.idle, label: 'ronin' },
  ],
  boss: [
    { id: 'verdict', pose: VERDICT.idle, label: 'idle', facing: -1 },
    { id: 'verdict', pose: VERDICT.windHigh, label: 'windHigh', facing: -1 },
    { id: 'verdict', pose: VERDICT.strikeHigh, label: 'strikeHigh', facing: -1 },
    { id: 'verdict', pose: VERDICT.windLow, label: 'windLow', facing: -1 },
    { id: 'verdict', pose: VERDICT.strikeLow, label: 'strikeLow', facing: -1 },
    { id: 'verdict', pose: VERDICT.strikeThrust, label: 'thrust', facing: -1 },
    { id: 'verdict', pose: VERDICT.roar, label: 'roar', facing: -1 },
    { id: 'verdict', pose: VERDICT.broken, label: 'broken', facing: -1 },
  ],
  gore: [
    { id: 'thug', pose: THUG.strike, label: 'decap', variant: 0, facing: -1, kill: { cuts: ['neck'], v: [60, -120], spin: 9 } },
    { id: 'thug', pose: THUG.strike, label: 'bisect', variant: 1, facing: -1, kill: { cuts: ['waist'], v: [50, -60] } },
    { id: 'brute', pose: BRUTE.strike, label: 'bisect brute', facing: -1, kill: { cuts: ['waist', 'armF'], v: [40, -50] } },
    { id: 'thug', pose: THUG.wind, label: 'burst', variant: 2, facing: -1, kill: { cuts: ['neck', 'waist', 'armF', 'armB', 'legF'], v: [30, -160], spin: 14 } },
    { id: 'verdict', pose: VERDICT.broken, label: 'boss decap', facing: -1, kill: { cuts: ['neck'], v: [0, -120], spin: 6 } },
    { id: 'thug', pose: THUG.idle, label: 'shove', variant: 3, facing: -1, kill: { cuts: [], v: [140, -60] } },
  ],
};

/** Dev-only character gallery: /?gallery3=cast|hero|boss|gore */
export class GalleryScene3 extends Phaser.Scene {
  private chars: Character[] = [];
  private g!: Phaser.GameObjects.Graphics;
  private cells: Cell[] = [];
  private grounds: number[] = [];

  constructor() {
    super('gallery3');
  }

  create(): void {
    const which = new URLSearchParams(location.search).get('gallery3') || 'cast';
    this.cells = SETS[which] ?? SETS.cast;
    const W = this.scale.width;
    const H = this.scale.height;
    this.cameras.main.setBackgroundColor('#2a0a10');
    // moonlit backdrop
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x14060a, 0x14060a, 0x4a0d18, 0x4a0d18, 1);
    bg.fillRect(0, 0, W, H);
    bg.fillStyle(0xe0b8b0, 0.85);
    bg.fillCircle(W * 0.78, H * 0.22, Math.min(W, H) * 0.16);
    this.g = this.add.graphics();
    const cols = 4;
    const rows = Math.ceil(this.cells.length / cols);
    const cellW = W / cols;
    const cellH = H / rows;
    const unit = Math.min(cellW / 95, cellH / 150);
    this.cells.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ch = new Character(c.id, { unit, variant: c.variant, facing: c.facing ?? 1, rest: c.pose });
      const ground = (row + 1) * cellH - cellH * 0.12;
      ch.place({ x: (col + 0.5) * cellW, y: ground }, unit);
      ch.snap(c.pose);
      if (c.run) ch.run.w = 1;
      ch.look.blood = c.id === 'hero' ? 0.6 : 0;
      this.chars.push(ch);
      this.grounds.push(ground);
      this.add.text(col * cellW + 10, row * cellH + 8, c.label, { fontFamily: 'monospace', fontSize: `${Math.round(unit * 7)}px`, color: '#ffffff' }).setAlpha(0.6);
    });
    // warm up cloth, then kill the gore cells
    for (let k = 0; k < 40; k++) this.chars.forEach((ch, i) => ch.update(16, { wind: -260, floor: this.grounds[i] }));
    this.chars.forEach((ch, i) => {
      const k = this.cells[i].kill;
      if (k) ch.kill(k.cuts, { x: k.v[0] * unit, y: k.v[1] * unit }, k.spin);
    });
    const steps = Number(new URLSearchParams(location.search).get('steps') ?? 14);
    if (this.cells.some((c) => c.kill)) for (let k = 0; k < steps; k++) this.chars.forEach((ch, i) => ch.update(16, { wind: -260, floor: this.grounds[i] }));
    (window as unknown as { __G3__: unknown }).__G3__ = this;
  }

  update(_t: number, delta: number): void {
    this.g.clear();
    this.chars.forEach((ch, i) => {
      ch.update(new URLSearchParams(location.search).has('freeze') ? 0 : delta, { wind: -260, floor: this.grounds[i] });
      this.g.fillStyle(0x000000, 0.5);
      this.g.fillEllipse(ch.root.x, this.grounds[i] + 2, 60 * ch.s, 5 * ch.s);
      ch.draw(this.g, DEFAULT_LIGHT);
    });
  }
}
