import Phaser from 'phaser';
import type { AttackKind, Judgement } from '@/game/core/types';
import { COLORS } from './textures';

interface Note {
  id: number;
  windupAt: number;
  impactAt: number;
  kind: AttackKind | null;
  judged: Judgement | null;
  judgedAt: number;
  hint: boolean;
}

interface StrikeNote {
  at: number;
  state: 'pending' | 'onBeat' | 'off' | 'missed';
}

export const KIND_COLOR: Record<AttackKind, number> = { mid: COLORS.blue, high: 0xffc65a, low: 0xc58bff };

/**
 * Rhythm lane: attacks slide from the enemy side (right) to the hit marker (left)
 * and arrive exactly on the impact beat. ◆ = tap, ▼ = swipe down, ▲ = swipe up,
 * ? = not revealed yet. Strike circles mark the beats of the counter-attack.
 */
export class RhythmLane {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly qs: Phaser.GameObjects.Text[] = [];
  private notes: Note[] = [];
  private strikes: StrikeNote[] = [];
  private y = 0;
  private x0 = 0;
  private x1 = 0;
  private S = 1;
  private markerPulse = 0;
  private markerFlash: { color: number; t: number } | null = null;
  visible = true;
  private alpha = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    layer: Phaser.GameObjects.Layer,
  ) {
    this.g = scene.add.graphics();
    layer.add(this.g);
    for (let i = 0; i < 8; i++) {
      const t = scene.add.text(0, 0, '?', { fontFamily: '"Unbounded Variable", "Arial Black", sans-serif', fontStyle: '800', color: '#eef0f7' }).setOrigin(0.5).setVisible(false);
      this.qs.push(t);
      layer.add(t);
    }
  }

  layout(W: number, y: number, S: number): void {
    this.y = y;
    this.x0 = W * 0.17;
    this.x1 = W * 0.97;
    this.S = S;
    for (const t of this.qs) t.setFontSize(Math.round(11 * S));
  }

  setVisible(v: boolean): void {
    this.visible = v;
  }

  addNote(id: number, windupAt: number, impactAt: number, kind: AttackKind | null, hint: boolean): void {
    this.notes.push({ id, windupAt, impactAt, kind, judged: null, judgedAt: 0, hint });
  }

  reveal(id: number, kind: AttackKind): void {
    const n = this.notes.find((x) => x.id === id);
    if (n) n.kind = kind;
  }

  judge(id: number, j: Judgement, kind: AttackKind, now: number): void {
    const n = this.notes.find((x) => x.id === id);
    if (!n) return;
    n.judged = j;
    n.kind = kind;
    n.judgedAt = now;
    this.markerFlash = { color: j === 'perfect' ? COLORS.blue : j === 'good' || j === 'ignored' ? 0xffffff : COLORS.red, t: 260 };
  }

  setStrikes(beats: number[]): void {
    this.strikes = beats.map((at) => ({ at, state: 'pending' }));
  }

  strikeResult(onBeat: boolean, now: number): void {
    let best: StrikeNote | null = null;
    for (const s of this.strikes) if (s.state === 'pending' && (!best || Math.abs(s.at - now) < Math.abs(best.at - now))) best = s;
    if (best) best.state = onBeat ? 'onBeat' : 'off';
    this.markerFlash = { color: onBeat ? COLORS.gold : 0xffffff, t: 200 };
  }

  beat(): void {
    this.markerPulse = 1;
  }

  clear(): void {
    this.notes = [];
    this.strikes = [];
  }

  update(now: number, dt: number, grid: { at: number; beatMs: number }): void {
    this.alpha += ((this.visible ? 1 : 0) - this.alpha) * Math.min(1, dt / 120);
    this.markerPulse = Math.max(0, this.markerPulse - dt / 260);
    if (this.markerFlash) {
      this.markerFlash.t -= dt;
      if (this.markerFlash.t <= 0) this.markerFlash = null;
    }
    this.notes = this.notes.filter((n) => !(n.judged && now - n.judgedAt > 450) && now - n.impactAt < 900);
    this.strikes = this.strikes.filter((s) => now - s.at < 400);
    this.draw(now, grid);
  }

  private xAt(time: number, now: number, travel: number): number {
    return this.x0 + ((time - now) / travel) * (this.x1 - this.x0);
  }

  private draw(now: number, grid: { at: number; beatMs: number }): void {
    const g = this.g;
    g.clear();
    this.qs.forEach((t) => t.setVisible(false));
    const a = this.alpha;
    if (a < 0.02) return;
    const { y, x0, x1, S } = this;
    const travel = grid.beatMs * 2;
    // track
    g.fillStyle(0x000000, 0.45 * a);
    g.fillRoundedRect(x0 - 26 * S, y - 15 * S, x1 - x0 + 34 * S, 30 * S, 15 * S);
    g.lineStyle(1 * S, 0xffffff, 0.12 * a);
    g.lineBetween(x0, y, x1, y);
    // beat ticks scrolling toward the marker
    if (grid.beatMs > 0) {
      const first = Math.ceil((now - grid.at) / grid.beatMs);
      for (let k = first; ; k++) {
        const bt = grid.at + k * grid.beatMs;
        const x = this.xAt(bt, now, travel);
        if (x > x1) break;
        if (x < x0) continue;
        const bar = k % 4 === 0;
        g.lineStyle((bar ? 1.6 : 1) * S, 0xffffff, (bar ? 0.35 : 0.18) * a);
        g.lineBetween(x, y - (bar ? 9 : 5) * S, x, y + (bar ? 9 : 5) * S);
      }
    }
    // strike beats (counter-attack): gold circles
    for (const s of this.strikes) {
      const x = this.xAt(s.at, now, travel);
      if (x > x1 || x < x0 - 30 * S) continue;
      const done = s.state !== 'pending';
      const col = s.state === 'onBeat' ? COLORS.gold : s.state === 'off' ? 0xffffff : COLORS.gold;
      g.lineStyle(2 * S, col, (done ? 0.4 : 0.95) * a);
      g.strokeCircle(done ? x0 : x, y, (done ? 13 : 8) * S);
      if (!done) {
        g.fillStyle(col, 0.25 * a);
        g.fillCircle(x, y, 8 * S);
      }
    }
    // attack notes
    let qi = 0;
    for (const n of this.notes) {
      const tr = Math.max(1, n.impactAt - n.windupAt);
      let x = x0 + ((n.impactAt - now) / tr) * (x1 - x0);
      if (x > x1 + 10 * S) continue;
      let alpha = a;
      let scale = 1;
      if (n.judged) {
        const k = Math.min(1, (now - n.judgedAt) / 420);
        x = Math.min(x, x0);
        alpha *= 1 - k;
        scale = 1 + k * 0.8;
      } else if (x < x0) {
        alpha *= Math.max(0, 1 - (x0 - x) / (40 * S));
      }
      const r = 9 * S * scale;
      const col = n.kind ? KIND_COLOR[n.kind] : 0xb8bccc;
      const bad = n.judged === 'miss' || n.judged === 'wrong' || n.judged === 'fooled';
      if (bad) {
        g.lineStyle(2.4 * S, COLORS.red, alpha);
        g.lineBetween(x - r, y - r, x + r, y + r);
        g.lineBetween(x - r, y + r, x + r, y - r);
        continue;
      }
      g.fillStyle(col, (n.kind ? 0.95 : 0.25) * alpha);
      g.lineStyle(1.6 * S, col, alpha);
      if (n.kind === 'high') {
        g.fillTriangle(x - r, y - r * 0.6, x + r, y - r * 0.6, x, y + r);
      } else if (n.kind === 'low') {
        g.fillTriangle(x - r, y + r * 0.6, x + r, y + r * 0.6, x, y - r);
      } else {
        g.fillPoints([new Phaser.Math.Vector2(x, y - r), new Phaser.Math.Vector2(x + r, y), new Phaser.Math.Vector2(x, y + r), new Phaser.Math.Vector2(x - r, y)], true);
        if (!n.kind) {
          g.strokePoints([new Phaser.Math.Vector2(x, y - r), new Phaser.Math.Vector2(x + r, y), new Phaser.Math.Vector2(x, y + r), new Phaser.Math.Vector2(x - r, y)], true);
          const t = this.qs[qi++];
          if (t) t.setPosition(x, y).setAlpha(alpha).setVisible(true);
        }
      }
    }
    // hit marker
    const pulse = 1 + this.markerPulse * 0.22;
    const mr = 13 * S * pulse;
    const mcol = this.markerFlash ? this.markerFlash.color : 0xffffff;
    g.lineStyle(2.2 * S, mcol, (this.markerFlash ? 1 : 0.75) * a);
    g.strokePoints([new Phaser.Math.Vector2(x0, y - mr), new Phaser.Math.Vector2(x0 + mr, y), new Phaser.Math.Vector2(x0, y + mr), new Phaser.Math.Vector2(x0 - mr, y)], true);
    if (this.markerFlash) {
      g.fillStyle(mcol, 0.35 * (this.markerFlash.t / 260) * a);
      g.fillCircle(x0, y, mr * 1.4);
    }
    void this.scene;
  }
}
