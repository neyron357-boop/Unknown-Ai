import Phaser from 'phaser';
import { applyOp, opLabel, type OrbOp } from '@/game/core/types';
import { COLORS } from './textures';
import type { Vec } from './rig';

const OP_COLOR: Record<OrbOp['op'], number> = { '+': COLORS.blue, '×': COLORS.gold, '−': COLORS.red };
const FONT = '"Unbounded Variable", "Arial Black", sans-serif';

interface Orb {
  glow: Phaser.GameObjects.Image;
  text: Phaser.GameObjects.Text;
  op: OrbOp | null;
  x: number;
  y: number;
  appear: number;
  state: 'idle' | 'live' | 'picked' | 'lost';
  fly: number;
}

/**
 * Overcharge: two energy orbs, pick the bigger result. Swipe toward a side or tap it.
 * The current energy sits between them; a ring counts down the decision window.
 */
export class Orbs {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly orbs: [Orb, Orb];
  private readonly energyText: Phaser.GameObjects.Text;
  private readonly energyLabel: Phaser.GameObjects.Text;
  private W = 1;
  private S = 1;
  private at = 0;
  private deadline = 0;
  private visible = false;
  private alpha = 0;
  private target: Vec = { x: 0, y: 0 };
  private hint: { side: 'left' | 'right'; t: number } | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    layer: Phaser.GameObjects.Layer,
  ) {
    this.g = scene.add.graphics();
    const mk = (): Orb => {
      const glow = scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      const text = scene.add.text(0, 0, '', { fontFamily: FONT, fontStyle: '800', color: '#ffffff' }).setOrigin(0.5).setVisible(false);
      return { glow, text, op: null, x: 0, y: 0, appear: 0, state: 'idle', fly: 0 };
    };
    this.orbs = [mk(), mk()];
    this.energyText = scene.add.text(0, 0, '', { fontFamily: FONT, fontStyle: '800', color: '#ffd27a' }).setOrigin(0.5).setVisible(false);
    this.energyLabel = scene.add.text(0, 0, '', { fontFamily: FONT, fontStyle: '600', color: '#c9a65a' }).setOrigin(0.5).setVisible(false);
    layer.add([this.g, ...this.orbs.map((o) => o.glow), ...this.orbs.map((o) => o.text), this.energyText, this.energyLabel]);
  }

  layout(W: number, y: number, S: number): void {
    this.W = W;
    this.S = S;
    this.orbs.forEach((o, i) => {
      o.x = W * (i === 0 ? 0.2 : 0.8);
      o.y = y;
      o.text.setFontSize(Math.round(22 * S));
    });
    this.energyText.setFontSize(Math.round(30 * S)).setPosition(W / 2, y + 2 * S);
    this.energyLabel.setFontSize(Math.round(8 * S)).setPosition(W / 2, y - 24 * S);
  }

  setLabel(label: string): void {
    this.energyLabel.setText(label);
  }

  show(energy: number): void {
    this.visible = true;
    this.energyText.setText(String(energy)).setVisible(true);
    this.energyLabel.setVisible(true);
  }

  hide(): void {
    this.visible = false;
    this.orbs.forEach((o) => (o.state = 'idle'));
  }

  spawn(left: OrbOp, right: OrbOp, energy: number, at: number, deadline: number): void {
    this.show(energy);
    this.at = at;
    this.deadline = deadline;
    [left, right].forEach((op, i) => {
      const o = this.orbs[i];
      o.op = op;
      o.state = 'live';
      o.appear = 0;
      o.fly = 0;
      o.text.setText(opLabel(op)).setColor(op.op === '−' ? '#ff8a99' : op.op === '×' ? '#ffe2a8' : '#dff8ff');
      o.glow.setTint(OP_COLOR[op.op]);
    });
    this.hint = null;
  }

  pick(side: 'left' | 'right' | null, correct: boolean, better: 'left' | 'right', energy: number, target: Vec): void {
    this.target = target;
    this.orbs.forEach((o, i) => {
      const s = i === 0 ? 'left' : 'right';
      o.state = s === side ? 'picked' : 'lost';
      o.fly = 0;
    });
    if (!correct) this.hint = { side: better, t: 900 };
    this.scene.time.delayedCall(260, () => this.energyText.setText(String(energy)));
  }

  /** Which side a tap at x belongs to. */
  sideAt(x: number): 'left' | 'right' {
    return x < this.W / 2 ? 'left' : 'right';
  }

  valueOf(side: 'left' | 'right', energy: number): number {
    const op = this.orbs[side === 'left' ? 0 : 1].op;
    return op ? applyOp(energy, op) : energy;
  }

  update(now: number, dt: number): void {
    this.alpha += ((this.visible ? 1 : 0) - this.alpha) * Math.min(1, dt / 150);
    const g = this.g;
    g.clear();
    const show = this.alpha > 0.02;
    this.energyText.setVisible(show).setAlpha(this.alpha);
    this.energyLabel.setVisible(show).setAlpha(this.alpha * 0.9);
    const S = this.S;
    if (this.hint) this.hint.t -= dt;
    this.orbs.forEach((o, i) => {
      if (o.state === 'idle' || !show) {
        o.glow.setVisible(false);
        o.text.setVisible(false);
        return;
      }
      o.appear = Math.min(1, o.appear + dt / 220);
      const bob = Math.sin(now / 260 + i * 2) * 4 * S;
      let x = o.x;
      let y = o.y + bob;
      let a = this.alpha * o.appear;
      let sc = 0.6 + 0.4 * o.appear;
      if (o.state === 'picked') {
        o.fly = Math.min(1, o.fly + dt / 260);
        x = o.x + (this.target.x - o.x) * o.fly;
        y = o.y + (this.target.y - o.y) * o.fly - Math.sin(o.fly * Math.PI) * 30 * S;
        a *= 1 - o.fly * 0.7;
        sc *= 1 - o.fly * 0.5;
      } else if (o.state === 'lost') {
        o.fly = Math.min(1, o.fly + dt / 300);
        a *= 1 - o.fly;
        sc *= 1 + o.fly * 0.6;
      }
      const col = o.op ? OP_COLOR[o.op.op] : 0xffffff;
      o.glow.setVisible(true).setPosition(x, y).setScale((70 * S * sc) / 128).setAlpha(0.8 * a);
      o.text.setVisible(true).setPosition(x, y).setAlpha(a).setScale(sc);
      g.lineStyle(2 * S, col, 0.9 * a);
      g.strokeCircle(x, y, 30 * S * sc);
      if (o.state === 'live') {
        const p = Math.max(0, Math.min(1, (this.deadline - now) / Math.max(1, this.deadline - this.at)));
        g.lineStyle(3 * S, 0xffffff, 0.8 * a);
        g.beginPath();
        g.arc(x, y, 36 * S, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p, false);
        g.strokePath();
        // arrow toward the side (swipe direction)
        const dir = i === 0 ? -1 : 1;
        g.lineStyle(2 * S, 0xffffff, 0.35 * a);
        const ax = x + dir * 46 * S;
        g.lineBetween(ax - dir * 6 * S, y - 7 * S, ax, y);
        g.lineBetween(ax - dir * 6 * S, y + 7 * S, ax, y);
      }
      if (this.hint && this.hint.t > 0 && (this.hint.side === 'left') === (i === 0)) {
        g.lineStyle(3 * S, COLORS.gold, Math.min(1, this.hint.t / 300));
        g.strokeCircle(o.x, o.y, 42 * S);
      }
    });
  }
}
