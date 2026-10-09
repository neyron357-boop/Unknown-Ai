import Phaser from 'phaser';
import { Fighter, HERO, VERDICT, PHANTOM_STYLE } from './Fighter';
import type { Pose } from './rig';

/** Dev-only pose gallery: /?gallery (and /?gallery=verdict). */
export class GalleryScene extends Phaser.Scene {
  private fighters: Fighter[] = [];
  private g!: Phaser.GameObjects.Graphics;

  constructor() {
    super('gallery');
  }

  create(): void {
    const which = new URLSearchParams(location.search).get('gallery') || 'hero';
    const W = this.scale.width;
    const H = this.scale.height;
    this.cameras.main.setBackgroundColor('#1a0d16');
    this.g = this.add.graphics();
    const poses = (which === 'verdict' || which === 'phantom' ? VERDICT : HERO) as Record<string, Pose>;
    let names = Object.keys(poses);
    if (which === 'one') names = ['idle', 'parry', 'aCut', 'jump'];
    const cols = which === 'hero' ? 4 : 2;
    const rows = Math.ceil(names.length / cols);
    const cellW = W / cols;
    const cellH = H / rows;
    const s = Math.min(cellW / 150, cellH / (which === 'hero' || which === 'one' ? 170 : 215));
    names.forEach((name, i) => {
      const isHero = which === 'hero' || which === 'one';
      const f = new Fighter(isHero ? 'hero' : 'verdict', isHero ? 1 : -1, which === 'phantom' ? PHANTOM_STYLE : undefined);
      if (which === 'phantom') f.alpha = 0.5;
      const cx = (i % cols) * cellW + cellW * (isHero ? 0.35 : 0.62);
      const cy = Math.floor(i / cols) * cellH + cellH * 0.86;
      f.anim.play([{ pose: poses[name], dur: 0 }]);
      f.place({ x: cx, y: cy }, s);
      this.fighters.push(f);
      this.add.text((i % cols) * cellW + 6, Math.floor(i / cols) * cellH + 6, name, { fontFamily: 'monospace', fontSize: `${Math.round(11 * (W / 390))}px`, color: '#8b8fa8' });
    });
  }

  update(_t: number, delta: number): void {
    this.g.clear();
    for (const f of this.fighters) {
      f.update(delta, 0);
      this.g.lineStyle(1, 0x333344, 1);
      this.g.lineBetween(f.home.x - 60 * f.s, f.home.y, f.home.x + 60 * f.s, f.home.y);
      f.draw(this.g);
      f.drawHalo(this.g, 0xff2a44, 0.8);
    }
  }
}
