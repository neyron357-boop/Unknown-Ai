import Phaser from 'phaser';
import { BattleDirector, type BattleCheckpoint } from '../core/battle';
import { OPPOSITE, type Dir, type ModeId, type SegmentId } from '../core/types';
import { BattleScene, type SceneSettings } from '../scene/BattleScene';

/**
 * Dev-only: /?battle3[&seg=trainA][&mode=spark][&seed=7][&miss=0.1][&speed=1]
 * Runs the real director with an autoplay bot so scenes can be watched and screenshotted.
 */
export function startHarness(root: HTMLElement): void {
  const q = new URLSearchParams(location.search);
  const mode = (q.get('mode') ?? 'spark') as ModeId;
  const seed = Number(q.get('seed') ?? 7);
  const miss = Number(q.get('miss') ?? 0.08);
  const speed = Number(q.get('speed') ?? 1);
  const seg = q.get('seg') as SegmentId | null;
  const resume: BattleCheckpoint | null = seg
    ? { version: 3, mode, seed, ease: 1, hints: true, segment: seg, hp: 100, score: 0, maxCombo: 0, kills: 0, assists: 0, decaps: 0, bloodlusts: 0, hitsTaken: 0, reboots: 0, impulsive: 0, records: [], savedAt: Date.now() }
    : null;
  const director = new BattleDirector({ mode, seed, resume });
  const pending: { at: number; dir: Dir }[] = [];
  const answer = (at: number, dir: Dir) => {
    if (Math.random() < miss) return;
    pending.push({ at: at + (Math.random() - 0.5) * 70, dir });
  };
  const exec: Dir[] = [];
  director.on((e) => {
    if (e.type === 'spawn') for (const n of e.enemy.notes) if (!n.feint && !n.assist) answer(n.at, n.dir);
    if (e.type === 'bossMove' && !e.note.feint) answer(e.note.at, e.note.dir);
    if (e.type === 'execShow') exec[e.index] = e.dir;
    if (e.type === 'execPerform') exec.forEach((d, i) => answer(e.at + i * director.beatMs, d));
  });
  let started = false;
  const settings: SceneSettings = { flashes: 'full', shake: 'full', gore: 'high', effects: 'high', reduceMotion: false };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  document.body.style.background = '#000';
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: root,
    width: Math.round(window.innerWidth * dpr),
    height: Math.round(window.innerHeight * dpr),
    zoom: 1 / dpr,
    backgroundColor: '#000000',
    banner: false,
    scene: [],
  });
  game.scene.add('battle3', BattleScene, true, {
    director,
    tick: (dt: number) => {
      if (!started) {
        started = true;
        director.start();
      }
      director.update(Math.min(dt, 100) * speed);
      const now = director.getNow();
      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i];
        if (p.at <= now) {
          pending.splice(i, 1);
          const visual = director.isMirrored(p.at) && (p.dir === 'left' || p.dir === 'right') ? OPPOSITE[p.dir] : p.dir;
          director.input(visual, p.at);
        }
      }
    },
    paused: () => false,
    settings: () => settings,
    hud: {
      hint: (h: unknown) => h && console.log('[hint]', JSON.stringify(h)),
      flag: (name: string, on: boolean) => console.log('[flag]', name, on),
      cutIn: (c: unknown) => console.log('[cutIn]', JSON.stringify(c)),
    },
  });
  (window as unknown as { __HARNESS__: unknown }).__HARNESS__ = { director, game, settings };
}
