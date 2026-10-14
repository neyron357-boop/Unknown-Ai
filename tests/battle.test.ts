import { describe, expect, it } from 'vitest';
import { BattleDirector, type BattleCheckpoint, type BattleEvent } from '@/game/v3/core/battle';
import { buildChart, EXEC_PERFORM_AT } from '@/game/v3/core/chart';
import { OPPOSITE, type Dir, type ModeId, type NoteInfo } from '@/game/v3/core/types';

type Schedule = (at: number, fn: () => void) => void;
type Bot = (e: BattleEvent, d: BattleDirector, at: Schedule) => void;

function simulate(d: BattleDirector, bot: Bot, step = 16, maxMs = 15 * 60_000) {
  const events: BattleEvent[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  const schedule: Schedule = (at, fn) => timers.push({ at, fn });
  d.on((e) => {
    events.push(e);
    bot(e, d, schedule);
  });
  d.start();
  while (d.getPhase() !== 'complete' && d.getNow() < maxMs) {
    d.update(step);
    timers.sort((a, b) => a.at - b.at);
    while (timers.length && timers[0].at <= d.getNow()) timers.shift()!.fn();
  }
  return { events, result: d.getResult() };
}

/** Slash as the player would see it: toward the enemy on screen (the mirror flips the screen). */
const seen = (d: BattleDirector, dir: Dir, at: number): Dir => (d.isMirrored(at) && (dir === 'left' || dir === 'right') ? OPPOSITE[dir] : dir);

function perfectBot(offset = 0): Bot {
  const exec: Dir[] = [];
  const answer = (n: NoteInfo, d: BattleDirector, at: Schedule) => {
    if (n.feint || n.assist) return;
    at(n.at + offset, () => d.input(seen(d, n.dir, n.at + offset), n.at + offset));
  };
  return (e, d, at) => {
    if (e.type === 'spawn') e.enemy.notes.forEach((n) => answer(n, d, at));
    if (e.type === 'bossMove') answer(e.note, d, at);
    if (e.type === 'execShow') exec[e.index] = e.dir;
    if (e.type === 'execPerform') exec.forEach((dir, i) => at(e.at + i * d.beatMs + offset, () => d.input(dir, e.at + i * d.beatMs + offset)));
  };
}

const idleBot: Bot = () => {};

function masherBot(seed = 3): Bot {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const dirs: Dir[] = ['left', 'right', 'up', 'down'];
  let next = 0;
  return (e, d, at) => {
    if (e.type === 'beat' && d.getNow() >= next) {
      next = d.getNow() + 600;
      for (let k = 0; k < 5; k++) at(d.getNow() + k * 120, () => d.input(dirs[Math.floor(rnd() * 4)]));
    }
  };
}

const MODES: ModeId[] = ['spark', 'flow', 'calm'];

describe('BattleDirector — a run always completes', () => {
  it.each(MODES)('idle player still reaches the finale (%s)', (mode) => {
    const { result, events } = simulate(new BattleDirector({ mode, seed: 4 }), idleBot);
    expect(result).not.toBeNull();
    expect(result!.grade).toBe('C');
    expect(events.some((e) => e.type === 'finisher')).toBe(true);
    expect(events.filter((e) => e.type === 'reboot').length).toBeGreaterThan(0);
    // 2–3.5 minutes of music
    expect(result!.durationMs).toBeGreaterThan(110_000);
    expect(result!.durationMs).toBeLessThan(210_000);
  });

  it.each(MODES)('a flawless player gets S, no hits, a flawless execution (%s)', (mode) => {
    const { result, events } = simulate(new BattleDirector({ mode, seed: 7 }), perfectBot());
    expect(result!.grade).toBe('S');
    expect(result!.accuracy).toBe(1);
    expect(result!.hitsTaken).toBe(0);
    expect(result!.exec.correct).toBe(result!.exec.cuts);
    expect(result!.feints.fooled).toBe(0);
    expect(events.some((e) => e.type === 'bloodlust' && e.on)).toBe(true);
    expect(events.find((e) => e.type === 'finisher')).toMatchObject({ flawless: true });
  });

  it('slightly late slashes are GOOD, not PERFECT', () => {
    const { result } = simulate(new BattleDirector({ mode: 'spark', seed: 7 }), perfectBot(95));
    expect(result!.notes.perfect).toBe(0);
    expect(result!.notes.good).toBeGreaterThan(50);
    expect(result!.timing.biasMs).toBeGreaterThan(80);
  });

  it('mashing is worse than playing and is counted as impulsive', () => {
    const mash = simulate(new BattleDirector({ mode: 'spark', seed: 9 }), masherBot()).result!;
    const play = simulate(new BattleDirector({ mode: 'spark', seed: 9 }), perfectBot()).result!;
    expect(mash.rating).toBeLessThan(0.55);
    expect(play.rating).toBeGreaterThan(mash.rating + 0.3);
    expect(mash.impulsive).toBeGreaterThan(0);
  });
});

describe('BattleDirector — rules', () => {
  it('slashing at a feint is punished; waiting is rewarded', () => {
    // fooled bot: answers feints too
    const fooledBot: Bot = (e, d, at) => {
      if (e.type === 'spawn') for (const n of e.enemy.notes) if (!n.assist) at(n.at, () => d.input(seen(d, n.dir, n.at), n.at));
      if (e.type === 'bossMove') at(e.note.at, () => d.input(e.note.dir, e.note.at));
    };
    const r = simulate(new BattleDirector({ mode: 'spark', seed: 12 }), fooledBot).result!;
    expect(r.feints.total).toBeGreaterThan(0);
    expect(r.feints.fooled).toBeGreaterThan(0);
    const good = simulate(new BattleDirector({ mode: 'spark', seed: 12 }), perfectBot()).result!;
    expect(good.feints.ignored).toBe(good.feints.total);
  });

  it('the mirror flips left and right for its whole window', () => {
    const d = new BattleDirector({ mode: 'spark', seed: 21 });
    d.start();
    const mirror = d.chart.anomalies.find((a) => a.kind === 'mirror')!;
    expect(mirror).toBeTruthy();
    const from = d.beatTime(mirror.beat);
    const to = from + mirror.beats * d.beatMs;
    expect(d.isMirrored(from + 1)).toBe(true);
    expect(d.isMirrored(to + 1)).toBe(false);
    // nothing straddles the flip
    for (const e of d.chart.enemies) {
      const s = d.beatTime(e.spawnBeat);
      const last = d.beatTime(e.notes[e.notes.length - 1].beat);
      const inside = s >= from && last < to;
      const outside = last < from || s >= to;
      expect(inside || outside).toBe(true);
    }
  });

  it('answering the logical side inside the mirror whiffs; answering what you see hits', () => {
    const run = (flip: boolean) => {
      const bot: Bot = (e, d, at) => {
        if (e.type !== 'spawn') return;
        for (const n of e.enemy.notes) {
          if (n.feint || n.assist) continue;
          at(n.at, () => d.input(flip ? seen(d, n.dir, n.at) : n.dir, n.at));
        }
      };
      return simulate(new BattleDirector({ mode: 'spark', seed: 21 }), bot).events.filter((e) => e.type === 'judge' && e.note.kind !== 'boss' && e.note.kind !== 'exec');
    };
    const ok = run(true).filter((e) => e.type === 'judge' && e.judgement === 'miss').length;
    const naive = run(false).filter((e) => e.type === 'judge' && e.judgement === 'miss').length;
    expect(ok).toBe(0);
    expect(naive).toBeGreaterThan(0);
  });

  it('cameo assists kill on their own and never ask the player', () => {
    const { events } = simulate(new BattleDirector({ mode: 'spark', seed: 5 }), idleBot);
    const assistKills = events.filter((e) => e.type === 'kill' && e.by !== 'hero');
    expect(assistKills.length).toBeGreaterThan(0);
    const judgedAssist = events.filter((e) => e.type === 'judge' && e.note.assist);
    expect(judgedAssist).toHaveLength(0);
  });

  it('missing a note costs HP and at zero the hero reboots instead of dying', () => {
    const { events } = simulate(new BattleDirector({ mode: 'spark', seed: 4 }), idleBot);
    const hits = events.filter((e) => e.type === 'heroHit');
    expect(hits.length).toBeGreaterThan(10);
    expect(events.some((e) => e.type === 'reboot')).toBe(true);
  });

  it('a perfect duel breaks the boss before the rage phase ends', () => {
    const { events } = simulate(new BattleDirector({ mode: 'spark', seed: 7 }), perfectBot());
    const broken = events.find((e) => e.type === 'boss' && e.phase === 'broken') as Extract<BattleEvent, { type: 'boss' }>;
    const rage = events.find((e) => e.type === 'boss' && e.phase === 'rage') as Extract<BattleEvent, { type: 'boss' }>;
    const d = new BattleDirector({ mode: 'spark', seed: 7 });
    const rageSeg = d.chart.segments.find((s) => s.id === 'rage')!;
    expect(broken.at).toBeGreaterThan(rage.at);
    expect(broken.at).toBeLessThan(d.beatTime(rageSeg.startBeat + rageSeg.bars * 4));
  });

  it('the execution is call-and-response: shown first, cut on later beats', () => {
    const { events } = simulate(new BattleDirector({ mode: 'spark', seed: 7 }), perfectBot());
    const shows = events.filter((e) => e.type === 'execShow') as Extract<BattleEvent, { type: 'execShow' }>[];
    const perform = events.find((e) => e.type === 'execPerform') as Extract<BattleEvent, { type: 'execPerform' }>;
    const cuts = events.filter((e) => e.type === 'execCut') as Extract<BattleEvent, { type: 'execCut' }>[];
    expect(shows).toHaveLength(4);
    expect(perform.at - shows[0].at).toBeCloseTo(EXEC_PERFORM_AT * (60000 / 128), 0);
    expect(cuts.every((c) => c.ok)).toBe(true);
    expect(cuts.map((c) => c.dir)).toEqual(shows.map((s) => s.dir));
  });

  it('voice cues are emitted for the story beats and the boss reacts to mistakes', () => {
    const { events } = simulate(new BattleDirector({ mode: 'spark', seed: 4 }), idleBot);
    const cues = events.filter((e) => e.type === 'voice').map((e) => (e as Extract<BattleEvent, { type: 'voice' }>).cue);
    for (const c of ['narr.episode', 'echo.swipe', 'narr.fall', 'narr.train', 'narr.boss', 'boss.intro', 'boss.rage', 'boss.miss', 'boss.death', 'narr.victory'] as const) expect(cues).toContain(c);
  });

  it('hints and teaching blocks can be switched off', () => {
    const { events } = simulate(new BattleDirector({ mode: 'spark', seed: 4, hints: false }), idleBot);
    expect(events.filter((e) => e.type === 'hint')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'voice' && e.cue === 'echo.swipe')).toHaveLength(0);
  });
});

describe('Chart', () => {
  it('is deterministic per seed and varies between seeds', () => {
    const a = buildChart(42, 'spark');
    const b = buildChart(42, 'spark');
    const c = buildChart(43, 'spark');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.enemies.map((e) => [e.kind, e.side]))).not.toBe(JSON.stringify(c.enemies.map((e) => [e.kind, e.side])));
  });

  it.each(MODES)('one finger can play it: notes never collide (%s)', (mode) => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const chart = buildChart(seed, mode);
      const beats = [
        ...chart.enemies.flatMap((e) => (e.assist ? [] : e.notes.map((n) => n.beat))),
        ...chart.summons.flatMap((e) => e.notes.map((n) => n.beat)),
        ...chart.strings.flatMap((s) => s.moves.map((m) => m.beat)),
      ].sort((x, y) => x - y);
      const gap = mode === 'calm' ? 1 : 0.5;
      for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(gap - 1e-6);
    }
  });

  it('teaches each enemy type before mixing it in', () => {
    const chart = buildChart(8, 'spark');
    const firstSeen = new Map<string, { beat: number; teach: boolean }>();
    for (const e of chart.enemies) if (!firstSeen.has(e.kind) && e.kind !== 'butcher') firstSeen.set(e.kind, { beat: e.notes[0].beat, teach: e.teach });
    for (const [kind, f] of firstSeen) expect(f.teach, kind).toBe(true);
    expect([...firstSeen.keys()].sort()).toEqual(['brute', 'crawler', 'dodger', 'feinter', 'grunt', 'gunner', 'leaper']);
  });
});

describe('Checkpoints', () => {
  it('a resumed run continues from the act with its score and completes', () => {
    const d = new BattleDirector({ mode: 'spark', seed: 6 });
    let cp: BattleCheckpoint | null = null;
    simulate(d, (e, dd, at) => {
      perfectBot()(e, dd, at);
      if (e.type === 'segment' && e.id === 'trainA') cp = dd.getCheckpoint();
    });
    expect(cp).not.toBeNull();
    const saved = cp as unknown as BattleCheckpoint;
    expect(saved.segment).toBe('trainA');
    const r = new BattleDirector({ resume: saved });
    const { result, events } = simulate(r, perfectBot());
    expect(result!.score).toBeGreaterThan(saved.score);
    expect(events.some((e) => e.type === 'segment' && e.id === 'roofA')).toBe(false);
    expect(result!.grade).toBe('S');
  });
});
