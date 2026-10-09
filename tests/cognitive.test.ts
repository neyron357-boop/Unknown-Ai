import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeAdaptation, computeProfileStats, detectErrorPatterns, SCALE_MAX, type RunSummary } from '@/cognitive/adaptation';
import {
  __resetDbForTests,
  clearCheckpoint,
  loadCheckpoint,
  loadChoices,
  loadRuns,
  logChoice,
  saveCheckpoint,
  saveRun,
  wipeAllData,
} from '@/cognitive/storage';
import { MissionDirector, type Checkpoint } from '@/game/core/director';
import type { MissionResult } from '@/game/core/metrics';
import type { ModeId } from '@/game/core/types';
import { buildDebriefPayload } from '@/ai/mentorClient';
import { debriefSchema } from '../server/ai/schemas';

/** Produces a real MissionResult by simulating an idle run. */
function idleResult(mode: ModeId = 'spark'): MissionResult {
  const d = new MissionDirector({ mode, seed: 5 });
  d.start();
  while (d.getPhase() !== 'complete') d.update(100);
  return d.getResult()!;
}

function run(over: Partial<RunSummary> & { accuracy?: number; reboots?: number; reaction?: number | null; assists?: number }, i = 0): RunSummary {
  const base = idleResult(over.mode ?? 'spark');
  const n = 20;
  const ok = Math.round((over.accuracy ?? 0.75) * n);
  const result: MissionResult = {
    ...base,
    accuracy: (over.accuracy ?? 0.75),
    reboots: over.reboots ?? 0,
    assists: over.assists ?? 0,
    reactionMedianMs: over.reaction === undefined ? 450 : over.reaction,
    byStage: { contact: { n: 10, ok: 10 }, pattern: { n, ok }, ascension: { n: 0, ok: 0 } },
  };
  return {
    id: `r${i}`,
    missionId: 'awakening',
    mode: over.mode ?? 'spark',
    modeChosen: over.modeChosen ?? true,
    startedAt: 1000 * i,
    finishedAt: 1000 * i + 500,
    telegraphScale: over.telegraphScale ?? 1,
    result,
  };
}

describe('Cognitive Engine — adaptation rules', () => {
  it('needs at least 2 runs before adapting', () => {
    expect(computeAdaptation([], 'spark')).toMatchObject({ telegraphScale: 1, reason: 'baseline' });
    expect(computeAdaptation([run({}, 1)], 'spark').reason).toBe('baseline');
  });

  it('gives more time after struggling runs, one small step at a time', () => {
    const a = computeAdaptation([run({ accuracy: 0.4 }, 1), run({ accuracy: 0.5 }, 2)], 'spark');
    expect(a).toMatchObject({ telegraphScale: 1.05, reason: 'struggling' });
  });

  it('tightens timing after mastery', () => {
    const a = computeAdaptation([run({ accuracy: 0.95, reaction: 380 }, 1), run({ accuracy: 1, reaction: 360, telegraphScale: 1 }, 2)], 'spark');
    expect(a).toMatchObject({ telegraphScale: 0.95, reason: 'mastered' });
  });

  it('never exceeds the clamp and ignores other modes', () => {
    const runs = [run({ accuracy: 0.2, telegraphScale: SCALE_MAX }, 1), run({ accuracy: 0.2, telegraphScale: SCALE_MAX }, 2), run({ mode: 'calm', accuracy: 1 }, 3)];
    expect(computeAdaptation(runs, 'spark').telegraphScale).toBe(SCALE_MAX);
    expect(computeAdaptation(runs, 'calm').reason).toBe('baseline');
  });

  it('profile stats aggregate voluntary choices and series', () => {
    const stats = computeProfileStats([run({ mode: 'flow' }, 1), run({ mode: 'flow', modeChosen: false }, 2), run({ mode: 'calm', accuracy: 0.95 }, 3)]);
    expect(stats.runs).toBe(3);
    expect(stats.chosenModes).toEqual({ spark: 0, flow: 1, calm: 1 });
    expect(stats.accuracySeries).toHaveLength(3);
  });

  it('detects repeated error patterns from facts only', () => {
    const r = idleResult();
    const kinds = detectErrorPatterns(r).map((p) => p.kind);
    expect(kinds).toContain('typeWeakness');
    expect(kinds).toContain('latePredictor');
    expect(kinds).toContain('memoryGap');
  });
});

describe('AI contract', () => {
  it('the client debrief payload always passes server validation', () => {
    for (const mode of ['spark', 'flow', 'calm'] as const) {
      const payload = buildDebriefPayload(idleResult(mode), 'ru', [run({}, 1)]);
      const parsed = debriefSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
    }
    expect(debriefSchema.safeParse(buildDebriefPayload(idleResult(), 'en', [])).success).toBe(true);
  });
});

describe('Local storage (IndexedDB)', () => {
  beforeEach(async () => {
    __resetDbForTests();
    await wipeAllData();
  });

  it('saves and loads runs in chronological order', async () => {
    await saveRun(run({}, 2));
    await saveRun(run({}, 1));
    const runs = await loadRuns();
    expect(runs.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('keeps checkpoints and discards stale ones', async () => {
    const d = new MissionDirector({ mode: 'spark', seed: 1 });
    let cp: Checkpoint | null = null;
    d.on((e) => {
      if (e.type === 'stage' && e.loop === 'pattern') cp = d.getCheckpoint();
    });
    d.start();
    while (!cp) d.update(50);
    await saveCheckpoint(cp);
    expect((await loadCheckpoint())?.resumeAt).toBe('pattern');
    await saveCheckpoint({ ...(cp as Checkpoint), savedAt: Date.now() - 8 * 24 * 3600 * 1000 });
    expect(await loadCheckpoint()).toBeNull();
    await saveCheckpoint(cp);
    await clearCheckpoint();
    expect(await loadCheckpoint()).toBeNull();
  });

  it('wipes everything on request', async () => {
    await saveRun(run({}, 1));
    await logChoice({ at: 1, kind: 'modeSelected', mode: 'calm' });
    await wipeAllData();
    expect(await loadRuns()).toEqual([]);
    expect(await loadChoices()).toEqual([]);
  });
});
