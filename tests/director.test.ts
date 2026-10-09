import { describe, expect, it } from 'vitest';
import { MissionDirector, type DirectorEvent } from '@/game/core/director';
import { buildMissionConfig } from '@/game/core/missionConfig';
import { hintActions, isCorrect } from '@/game/core/rules';
import type { Action, AttackType, ModeId } from '@/game/core/types';

type Bot = (e: DirectorEvent, d: MissionDirector, schedule: (inMs: number, fn: () => void) => void) => void;

/** Runs a director to completion with a bot, using a fixed 16ms frame step. */
function simulate(director: MissionDirector, bot: Bot, maxMs = 15 * 60_000) {
  const events: DirectorEvent[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  const schedule = (inMs: number, fn: () => void) => timers.push({ at: director.getNow() + inMs, fn });
  director.on((e) => {
    events.push(e);
    bot(e, director, schedule);
  });
  director.start();
  let elapsed = 0;
  while (director.getPhase() !== 'complete' && elapsed < maxMs) {
    director.update(16);
    elapsed += 16;
    for (let k = timers.length - 1; k >= 0; k--) {
      if (timers[k].at <= director.getNow()) {
        const [t] = timers.splice(k, 1);
        t.fn();
      }
    }
  }
  return { events, result: director.getResult() };
}

const idleBot: Bot = () => {};

const firstCorrect = (attack: AttackType): Action => hintActions(attack)[0];

/** Reacts correctly 250ms into every telegraph and taps every weak point correctly. */
const reactiveBot: Bot = (e, d, schedule) => {
  if (e.type === 'tutorialStep') schedule(400, () => d.input(e.expect));
  if (e.type === 'telegraph') schedule(250, () => d.input(firstCorrect(e.attack)));
  if (e.type === 'ascendRecall') {
    // replay the sequence the director showed
    sequenceTaps(d, schedule);
  }
};

let shownNodes: number[] = [];
function sequenceTaps(d: MissionDirector, schedule: (inMs: number, fn: () => void) => void) {
  const nodes = [...shownNodes];
  shownNodes = [];
  nodes.forEach((n, k) => schedule(300 * (k + 1), () => d.tapNode(n)));
}

/** Learns the loop from observation and predicts during the gap once it has seen one full cycle. */
function makePredictorBot(): Bot {
  let history: AttackType[] = [];
  return (e, d, schedule) => {
    if (e.type === 'stage') history = [];
    if (e.type === 'ascendNode') shownNodes.push(e.node);
    if (e.type === 'tutorialStep') schedule(300, () => d.input(e.expect));
    if (e.type === 'gap' && e.predictable) {
      const period = findPeriod(history);
      if (period) {
        const next = history[history.length - period];
        schedule(200, () => d.input(firstCorrect(next)));
      }
    }
    if (e.type === 'telegraph') {
      history.push(e.attack);
      schedule(260, () => d.input(firstCorrect(e.attack)));
    }
    if (e.type === 'ascendRecall') sequenceTaps(d, schedule);
  };
}

function findPeriod(h: AttackType[]): number | null {
  for (let p = 2; p <= 6; p++) {
    if (h.length < p * 2) continue;
    let ok = true;
    for (let k = p; k < h.length; k++) if (h[k] !== h[k - p]) ok = false;
    if (ok) return p;
  }
  return null;
}

describe('rules', () => {
  it('maps every attack to a fixed correct response', () => {
    expect(isCorrect('slashL', 'dodgeR')).toBe(true);
    expect(isCorrect('slashL', 'dodgeL')).toBe(false);
    expect(isCorrect('slashR', 'dodgeL')).toBe(true);
    expect(isCorrect('crush', 'block')).toBe(true);
    expect(isCorrect('crush', 'dodgeL')).toBe(false);
    expect(isCorrect('pierce', 'block')).toBe(false);
    expect(isCorrect('pierce', 'dodgeL')).toBe(true);
    expect(isCorrect('pierce', 'dodgeR')).toBe(true);
  });
});

describe('MissionDirector — completability', () => {
  const modes: ModeId[] = ['spark', 'flow', 'calm'];

  it.each(modes)('an idle player still reaches the end (%s)', (mode) => {
    const d = new MissionDirector({ mode, seed: 42 });
    const { events, result } = simulate(d, idleBot);
    expect(result).not.toBeNull();
    expect(events.some((e) => e.type === 'finisher')).toBe(true);
    expect(result!.assists).toBe(2);
    expect(result!.reboots).toBeGreaterThan(0);
    expect(result!.accuracy).toBe(0);
  });

  it.each(modes)('a reactive player finishes in ~2.5–5 minutes without being hit (%s)', (mode) => {
    shownNodes = [];
    const d = new MissionDirector({ mode, seed: 7 });
    const bot: Bot = (e, dd, s) => {
      if (e.type === 'ascendNode') shownNodes.push(e.node);
      reactiveBot(e, dd, s);
    };
    const { result } = simulate(d, bot);
    expect(result).not.toBeNull();
    expect(result!.accuracy).toBe(1);
    expect(result!.reboots).toBe(0);
    expect(result!.ascension.correct).toBe(result!.ascension.taps);
    expect(result!.reactionMedianMs).toBeGreaterThanOrEqual(250);
    expect(result!.durationMs).toBeGreaterThan(120_000);
    expect(result!.durationMs).toBeLessThan(300_000);
  });

  it.each(modes)('a predicting player reads the loop and finishes faster (%s)', (mode) => {
    shownNodes = [];
    const reactive = simulate(new MissionDirector({ mode, seed: 11 }), (e, dd, s) => {
      if (e.type === 'ascendNode') shownNodes.push(e.node);
      reactiveBot(e, dd, s);
    }).result!;
    shownNodes = [];
    const d = new MissionDirector({ mode, seed: 11 });
    const { result } = simulate(d, makePredictorBot());
    expect(result).not.toBeNull();
    expect(result!.durationMs).toBeLessThan(reactive.durationMs - 15_000);
    expect(result!.reads).toBeGreaterThanOrEqual(4);
    expect(result!.predictions.correct).toBe(result!.predictions.attempts);
    expect(result!.assists).toBe(0);
    expect(result!.accuracy).toBe(1);
    expect(result!.bestDecision.kind).toBe('perfectAscension');
    expect(result!.durationMs).toBeGreaterThan(90_000);
    expect(result!.durationMs).toBeLessThan(300_000);
  });
});

describe('MissionDirector — rules are honest and deterministic', () => {
  it('the pattern stage repeats the configured loop exactly', () => {
    const cfg = buildMissionConfig({ mode: 'flow', seed: 1 });
    const d = new MissionDirector({ config: cfg });
    const seen: AttackType[] = [];
    let stage = '';
    simulate(d, (e) => {
      if (e.type === 'stage') stage = e.loop ?? '';
      if (e.type === 'telegraph' && stage === 'pattern') seen.push(e.attack);
    });
    expect(seen.length).toBeGreaterThan(cfg.pattern.loop.length);
    seen.forEach((t, k) => expect(t).toBe(cfg.pattern.loop[k % cfg.pattern.loop.length]));
  });

  it('same seed + same inputs → identical weak-point sequences and results', () => {
    const run = () => {
      shownNodes = [];
      const d = new MissionDirector({ mode: 'spark', seed: 99 });
      const nodes: number[] = [];
      const { result } = simulate(d, (e, dd, s) => {
        if (e.type === 'ascendNode') nodes.push(e.node);
        makePredictorBotSingleton(e, dd, s);
      });
      return { nodes, result };
    };
    const predictor = makePredictorBot();
    const makePredictorBotSingleton: Bot = (e, d, s) => predictor(e, d, s);
    const a = run();
    const b = run();
    expect(a.nodes).toEqual(b.nodes);
    expect(a.result!.accuracy).toBe(b.result!.accuracy);
    expect(a.result!.durationMs).toBe(b.result!.durationMs);
  });

  it('a wrong prediction staggers, then a correct reaction counts as recovered', () => {
    const d = new MissionDirector({ mode: 'spark', seed: 3 });
    let inPattern = false;
    let done = false;
    const outcomes: string[] = [];
    simulate(d, (e, dd, s) => {
      if (e.type === 'tutorialStep') s(200, () => dd.input(e.expect));
      if (e.type === 'stage') inPattern = e.loop === 'pattern';
      if (e.type === 'gap' && inPattern && !done) {
        done = true;
        // first pattern attack is slashL → predicting "dodgeL" is wrong
        s(100, () => dd.input('dodgeL'));
      }
      if (e.type === 'stagger') s(e.durationMs + 40, () => dd.input('dodgeR'));
      if (e.type === 'resolve' && e.record.stage === 'pattern') outcomes.push(e.record.outcome);
    });
    expect(outcomes[0]).toBe('recovered');
  });

  it('inputs during the stagger are ignored', () => {
    const d = new MissionDirector({ mode: 'spark', seed: 3 });
    let inPattern = false;
    let done = false;
    const ignored: Action[] = [];
    const outcomes: string[] = [];
    simulate(d, (e, dd, s) => {
      if (e.type === 'tutorialStep') s(200, () => dd.input(e.expect));
      if (e.type === 'stage') inPattern = e.loop === 'pattern';
      if (e.type === 'gap' && inPattern && !done) {
        done = true;
        s(100, () => dd.input('dodgeL'));
      }
      if (e.type === 'stagger') s(100, () => dd.input('dodgeR'));
      if (e.type === 'inputIgnored') ignored.push(e.action);
      if (e.type === 'resolve' && e.record.stage === 'pattern') outcomes.push(e.record.outcome);
    });
    expect(ignored).toContain('dodgeR');
    expect(outcomes[0]).toBe('misread');
  });

  it('first reaction is final: a wrong reaction cannot be corrected', () => {
    const d = new MissionDirector({ mode: 'spark', seed: 5 });
    const outcomes: string[] = [];
    let first = true;
    simulate(d, (e, dd, s) => {
      if (e.type === 'tutorialStep') s(200, () => dd.input(e.expect));
      if (e.type === 'telegraph' && first) {
        first = false;
        s(100, () => dd.input('block')); // slashL needs dodgeR
        s(200, () => dd.input('dodgeR'));
      }
      if (e.type === 'resolve') outcomes.push(e.record.outcome);
    });
    expect(outcomes[0]).toBe('wrong');
  });

  it('shows adaptive hints after two failures on the same attack type', () => {
    const d = new MissionDirector({ mode: 'spark', seed: 5, hints: true });
    const hinted: boolean[] = [];
    simulate(d, (e) => {
      if (e.type === 'telegraph' && e.attack === 'slashL') hinted.push(e.hint !== null);
    });
    // contact: #1 is demo (hinted), #2 not yet (1 failure), from #3 onward hinted (≥2 failures)
    expect(hinted[0]).toBe(true);
    expect(hinted[1]).toBe(false);
    expect(hinted[2]).toBe(true);
  });

  it('hints can be disabled (demo hints remain)', () => {
    const d = new MissionDirector({ mode: 'spark', seed: 5, hints: false });
    const hinted: boolean[] = [];
    simulate(d, (e) => {
      if (e.type === 'telegraph' && e.attack === 'slashL') hinted.push(e.hint !== null);
    });
    expect(hinted[0]).toBe(true);
    expect(hinted.slice(1).every((h) => !h)).toBe(true);
  });

  it('large update steps produce the same timeline as small ones', () => {
    const timeline = (step: number) => {
      const d = new MissionDirector({ mode: 'calm', seed: 8 });
      const out: string[] = [];
      d.on((e) => out.push(`${e.type}@${Math.round(d.getNow())}`));
      d.start();
      while (d.getPhase() !== 'complete') d.update(step);
      return out;
    };
    expect(timeline(1000)).toEqual(timeline(16));
  });
});

describe('MissionDirector — checkpoints', () => {
  it('offers a checkpoint at the pattern stage and resumes from it', () => {
    const d = new MissionDirector({ mode: 'spark', seed: 21 });
    let cp: ReturnType<MissionDirector['getCheckpoint']> = null;
    d.on((e) => {
      if (e.type === 'stage' && e.loop === 'pattern') cp = d.getCheckpoint();
    });
    d.start();
    while (!cp && d.getPhase() !== 'complete') d.update(16);
    expect(cp).not.toBeNull();
    expect(cp!.resumeAt).toBe('pattern');

    const resumed = new MissionDirector({ resume: cp! });
    const stages: string[] = [];
    resumed.on((e) => {
      if (e.type === 'stage') stages.push(e.loop ?? e.stage);
    });
    resumed.start();
    while (resumed.getPhase() !== 'complete') resumed.update(50);
    expect(stages[0]).toBe('pattern');
    const result = resumed.getResult()!;
    // records from before the checkpoint are kept
    expect(result.byStage.contact.n).toBe(10);
  });

  it('resumed run reveals the same weak points as an uninterrupted one', () => {
    const collect = (dir: MissionDirector) => {
      const nodes: number[] = [];
      dir.on((e) => {
        if (e.type === 'ascendNode') nodes.push(e.node);
      });
      return nodes;
    };
    const full = new MissionDirector({ mode: 'spark', seed: 77 });
    const fullNodes = collect(full);
    let cp: ReturnType<MissionDirector['getCheckpoint']> = null;
    full.on((e) => {
      if (e.type === 'stage' && e.loop === 'overdrive') cp = full.getCheckpoint();
    });
    full.start();
    while (full.getPhase() !== 'complete') full.update(16);
    expect(cp).not.toBeNull();

    const resumed = new MissionDirector({ resume: cp! });
    const resumedNodes = collect(resumed);
    resumed.start();
    while (resumed.getPhase() !== 'complete') resumed.update(16);
    expect(resumedNodes).toEqual(fullNodes.slice(fullNodes.length - resumedNodes.length));
    expect(resumedNodes.length).toBeGreaterThan(0);
  });
});
