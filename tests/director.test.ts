import { describe, expect, it } from 'vitest';
import { DuelDirector, type Checkpoint, type DirectorEvent } from '@/game/core/director';
import { makeOrbPair, planTakt, buildTuning } from '@/game/core/plan';
import { createRng } from '@/game/core/random';
import { applyOp, RESPONSE, type Action, type AttackKind, type ModeId } from '@/game/core/types';

type Schedule = (at: number, fn: () => void) => void;
type Bot = (e: DirectorEvent, d: DuelDirector, at: Schedule) => void;

function simulate(d: DuelDirector, bot: Bot, maxMs = 20 * 60_000, step = 16) {
  const events: DirectorEvent[] = [];
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

/** Peeks at the hidden kind of an attack (tests only). */
function kindOf(d: DuelDirector, id: number): AttackKind {
  const live = (d as unknown as { live: { id: number; plan: { kind: AttackKind } }[] }).live;
  return live.find((a) => a.id === id)!.plan.kind;
}

function perfectBot(offset = 0): Bot {
  const runes: number[] = [];
  return (e, d, at) => {
    if (e.type === 'windup') {
      if (e.phantom) return;
      const kind = e.kind ?? kindOf(d, e.id);
      at(e.impactAt + offset, () => d.input(RESPONSE[kind], e.impactAt + offset));
    }
    if (e.type === 'open') e.beats.forEach((b) => at(b, () => d.input('tap', b)));
    if (e.type === 'orbs') {
      const better = applyOp(e.energy, e.left) >= applyOp(e.energy, e.right) ? 'left' : 'right';
      at(e.at + 300, () => d.input(better, e.at + 300));
    }
    if (e.type === 'upgradeOffer') at(d.getNow() + 500, () => d.chooseUpgrade(e.cards[0]));
    if (e.type === 'rune' && e.pass === 0) runes.push(e.node);
    if (e.type === 'recall') runes.forEach((n, k) => at(d.getNow() + 400 * (k + 1), () => d.tapNode(n)));
  };
}

const idleBot: Bot = () => {};

const modes: ModeId[] = ['spark', 'flow', 'calm'];

describe('DuelDirector — a run always completes', () => {
  it.each(modes)('idle player still reaches the finisher (%s)', (mode) => {
    const d = new DuelDirector({ mode, seed: 4 });
    const { events, result } = simulate(d, idleBot);
    expect(result).not.toBeNull();
    expect(events.some((e) => e.type === 'finisher')).toBe(true);
    expect(result!.grade).toBe('C');
    expect(result!.reboots).toBeGreaterThan(0);
    // phantoms are ignored automatically → those count as correct
    expect(result!.inhibition.fooled).toBe(0);
    expect(events.filter((e) => e.type === 'upgradePicked' && e.auto)).toHaveLength(3);
  });

  it.each(modes)('perfect player gets S, 100%% and 4 rounds in 1.5–4 minutes (%s)', (mode) => {
    const d = new DuelDirector({ mode, seed: 9 });
    const { events, result } = simulate(d, perfectBot());
    const r = result!;
    expect(r.grade).toBe('S');
    expect(r.accuracy).toBe(1);
    expect(r.perfects).toBe(r.attacks - r.inhibition.phantoms);
    expect(r.calc.correct).toBe(r.calc.choices);
    expect(r.recall.correct).toBe(r.recall.taps);
    expect(r.strikes.onBeat).toBe(r.strikes.total);
    expect(r.hitsTaken).toBe(0);
    expect(events.filter((e) => e.type === 'round')).toHaveLength(4);
    expect(r.durationMs).toBeGreaterThan(90_000);
    expect(r.durationMs).toBeLessThan(240_000);
  });

  it('a mashing player (tap every 150ms) is held back by the impatience lock', () => {
    const d = new DuelDirector({ mode: 'spark', seed: 2 });
    let last = 0;
    const { result } = simulate(d, (e, dd) => {
      if (e.type === 'beat' || e.type === 'windup') {
        const now = dd.getNow();
        if (now - last >= 150) {
          last = now;
          dd.input('tap', now);
        }
      }
      if (e.type === 'upgradeOffer') dd.chooseUpgrade(e.cards[0]);
    });
    expect(result!.impulsive).toBeGreaterThan(10);
    expect(result!.grade).not.toBe('S');
  });
});

describe('DuelDirector — timing and rules', () => {
  function firstAttack(seed = 1) {
    const d = new DuelDirector({ mode: 'spark', seed });
    let first: Extract<DirectorEvent, { type: 'windup' }> | null = null;
    d.on((e) => {
      if (e.type === 'windup' && !first) first = e;
    });
    d.start();
    while (!first) d.update(16);
    return { d, w: first as Extract<DirectorEvent, { type: 'windup' }> };
  }

  const judgeOf = (d: DuelDirector) => {
    const out: string[] = [];
    d.on((e) => e.type === 'judge' && out.push(e.record.judgement));
    return out;
  };

  it('first loop reveals the kind early and shows a hint', () => {
    const { w } = firstAttack();
    expect(w.kind).not.toBeNull();
    expect(w.hint).toBe(true);
  });

  it('the first real low strike (new move) is taught: early reveal + hint, later ones are not', () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 7, 11]) {
      const { events } = simulate(new DuelDirector({ mode: 'spark', seed }), perfectBot());
      let round = '';
      const lows: { hint: boolean; revealed: boolean }[] = [];
      for (const e of events) {
        if (e.type === 'round') round = e.kind;
        if (e.type === 'windup' && round === 'phantoms' && !e.phantom && e.strikeKind === 'low') lows.push({ hint: e.hint, revealed: e.kind !== null });
      }
      if (!lows.length) continue;
      checked++;
      expect(lows[0]).toEqual({ hint: true, revealed: true });
      expect(lows.slice(1).every((l) => !l.hint)).toBe(true);
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it.each([
    [0, 'perfect'],
    [45, 'perfect'],
    [-100, 'good'],
    [110, 'good'],
  ])('input at impact%+dms → %s', (offset, expected) => {
    const { d, w } = firstAttack();
    const j = judgeOf(d);
    while (d.getNow() < w.impactAt + offset) d.update(8);
    d.input(RESPONSE[w.kind!], w.impactAt + offset);
    d.update(400);
    expect(j[0]).toBe(expected);
  });

  it('a too-late or missing input is a miss and costs integrity', () => {
    const { d, w } = firstAttack();
    const j = judgeOf(d);
    while (d.getNow() < w.impactAt + 400) d.update(16);
    expect(j[0]).toBe('miss');
    expect(d.getMeters().integrity).toBe(85);
  });

  it('the wrong action is judged wrong', () => {
    const { d, w } = firstAttack();
    const j = judgeOf(d);
    const wrong: Action = w.kind === 'mid' ? 'down' : 'tap';
    while (d.getNow() < w.impactAt) d.update(8);
    d.input(wrong, w.impactAt);
    expect(j[0]).toBe('wrong');
  });

  it('pressing during the windup locks input briefly (impatience)', () => {
    const { d, w } = firstAttack();
    const j = judgeOf(d);
    const strays: string[] = [];
    d.on((e) => e.type === 'stray' && strays.push(e.action));
    const early = w.impactAt - 300;
    while (d.getNow() < early) d.update(8);
    d.input('tap', early); // too early → lock 220ms
    d.input(RESPONSE[w.kind!], w.impactAt - 100); // inside the lock → ignored
    d.update(600);
    expect(strays.length).toBe(2);
    expect(j[0]).toBe('miss');
  });

  it('inputs carry touch timestamps: a late-arriving tap is judged by when the finger landed', () => {
    const { d, w } = firstAttack();
    const j = judgeOf(d);
    while (d.getNow() < w.impactAt + 100) d.update(16);
    d.input(RESPONSE[w.kind!], w.impactAt + 10); // classified 90ms later
    expect(j[0]).toBe('perfect');
  });

  it('the takt pattern repeats exactly, then goes blind', () => {
    const t = buildTuning('spark');
    const loops = planTakt(5, t);
    const pattern = loops[0].attacks.map((a) => a.kind).join();
    loops.forEach((l) => expect(l.attacks.map((a) => a.kind).join()).toBe(pattern));
    expect(loops.map((l) => l.attacks[0].reveal)).toEqual(['early', 'early', 'late', 'blind']);
    expect(loops[0].attacks.some((a) => a.kind === 'mid')).toBe(true);
    expect(loops[0].attacks.some((a) => a.kind === 'high')).toBe(true);
  });

  it('reacting to a phantom is "fooled"; letting it pass is "ignored"', () => {
    const d = new DuelDirector({ mode: 'spark', seed: 3 });
    const verdicts: { phantom: boolean; j: string }[] = [];
    let flip = false;
    simulate(d, (e, dd, at) => {
      if (e.type === 'upgradeOffer') at(dd.getNow() + 10, () => dd.chooseUpgrade(e.cards[0]));
      if (e.type === 'windup' && e.phantom) {
        flip = !flip;
        if (flip) at(e.impactAt, () => dd.input('tap', e.impactAt));
      }
      if (e.type === 'judge' && e.record.phantom) verdicts.push({ phantom: true, j: e.record.judgement });
    });
    expect(verdicts.some((v) => v.j === 'fooled')).toBe(true);
    expect(verdicts.some((v) => v.j === 'ignored')).toBe(true);
  });

  it('orb pairs always have one clearly better option', () => {
    const rng = createRng(77);
    for (let e = 0; e < 40; e++) {
      for (let i = 0; i < 8; i++) {
        const { left, right } = makeOrbPair(rng, e, i);
        expect(Math.abs(applyOp(e, left) - applyOp(e, right))).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('upgrades change rules only between rounds and are offered 3 at a time', () => {
    const d = new DuelDirector({ mode: 'spark', seed: 12 });
    const offers: string[][] = [];
    simulate(d, (e, dd) => {
      if (e.type === 'upgradeOffer') {
        offers.push(e.cards);
        expect(dd.getPhase()).toBe('upgrade');
        dd.chooseUpgrade(e.cards[0]);
      }
    });
    expect(offers).toHaveLength(3);
    offers.forEach((o) => expect(new Set(o).size).toBe(3));
    expect(offers[0]).toContain('phantomSight');
    expect(d.getUpgrades()).toHaveLength(3);
  });
});

describe('DuelDirector — determinism and checkpoints', () => {
  it('same seed + same inputs → identical results', () => {
    const run = () => simulate(new DuelDirector({ mode: 'flow', seed: 31 }), perfectBot(30)).result!;
    const a = run();
    const b = run();
    expect(a.score).toBe(b.score);
    expect(a.durationMs).toBe(b.durationMs);
    expect(a.records.recall).toEqual(b.records.recall);
  });

  it('large update steps give the same outcome as small ones', () => {
    const timeline = (step: number) => {
      const d = new DuelDirector({ mode: 'calm', seed: 8 });
      const out: string[] = [];
      d.on((e) => e.type !== 'beat' && out.push(`${e.type}`));
      d.start();
      while (d.getPhase() !== 'complete') d.update(step);
      return { out, t: d.getNow() };
    };
    const a = timeline(16);
    const b = timeline(1000);
    expect(b.out).toEqual(a.out);
  });

  it('a checkpoint at a round start resumes into that round with history kept', () => {
    const d = new DuelDirector({ mode: 'spark', seed: 21 });
    let cp: Checkpoint | null = null;
    simulate(d, (e, dd) => {
      if (e.type === 'upgradeOffer') dd.chooseUpgrade(e.cards[1]);
      if (e.type === 'round' && e.kind === 'overcharge' && !cp) cp = dd.getCheckpoint();
    });
    expect(cp).not.toBeNull();
    expect(cp!.round).toBe(2);
    expect(cp!.upgrades).toHaveLength(2);

    const resumed = new DuelDirector({ resume: cp! });
    const rounds: string[] = [];
    const { result } = simulate(resumed, (e, dd) => {
      if (e.type === 'round') rounds.push(e.kind);
      if (e.type === 'upgradeOffer') dd.chooseUpgrade(e.cards[0]);
    });
    expect(rounds).toEqual(['overcharge', 'ascension']);
    expect(result!.byRound.takt.n).toBeGreaterThan(0);
    expect(result!.upgrades).toHaveLength(3);
  });
});
