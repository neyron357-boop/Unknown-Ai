import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeAdaptation, computeProfileStats, detectErrorPatterns, EASE_MAX, type RunSummary } from '@/cognitive/adaptation';
import { __resetDbForTests, clearCheckpoint, loadCheckpoint, loadChoices, loadRuns, logChoice, saveCheckpoint, saveRun, wipeAllData } from '@/cognitive/storage';
import { DuelDirector, type Checkpoint, type DirectorEvent } from '@/game/core/director';
import type { MissionResult } from '@/game/core/metrics';
import type { ModeId } from '@/game/core/types';
import { buildDebriefPayload } from '@/ai/mentorClient';
import { debriefSchema } from '../server/ai/schemas';

/** A real MissionResult from an idle (no input) run. */
function idleResult(mode: ModeId = 'spark'): MissionResult {
  const d = new DuelDirector({ mode, seed: 5, upgradeTimeoutMs: 500 });
  d.start();
  while (d.getPhase() !== 'complete') d.update(100);
  return d.getResult()!;
}

const BASE = idleResult();

function run(over: { mode?: ModeId; rating?: number; reboots?: number; ease?: number; modeChosen?: boolean; accuracy?: number; grade?: MissionResult['grade'] }, i = 0): RunSummary {
  return {
    id: `r${i}`,
    missionId: 'awakening',
    mode: over.mode ?? 'spark',
    modeChosen: over.modeChosen ?? true,
    startedAt: 1000 * i,
    finishedAt: 1000 * i + 500,
    ease: over.ease ?? 1,
    result: { ...BASE, rating: over.rating ?? 0.7, reboots: over.reboots ?? 0, accuracy: over.accuracy ?? 0.7, grade: over.grade ?? 'B' },
  };
}

describe('Cognitive Engine — adaptation rules', () => {
  it('needs at least 2 runs before adapting', () => {
    expect(computeAdaptation([], 'spark')).toMatchObject({ ease: 1, reason: 'baseline' });
    expect(computeAdaptation([run({}, 1)], 'spark').reason).toBe('baseline');
  });

  it('eases off after struggling runs, one small step at a time', () => {
    expect(computeAdaptation([run({ rating: 0.4 }, 1), run({ rating: 0.5 }, 2)], 'spark')).toMatchObject({ ease: 1.05, reason: 'struggling' });
  });

  it('tightens after mastery', () => {
    expect(computeAdaptation([run({ rating: 0.95 }, 1), run({ rating: 0.9 }, 2)], 'spark')).toMatchObject({ ease: 0.95, reason: 'mastered' });
  });

  it('never exceeds the clamp and ignores other modes', () => {
    const runs = [run({ rating: 0.2, ease: EASE_MAX }, 1), run({ rating: 0.2, ease: EASE_MAX }, 2), run({ mode: 'calm', rating: 1 }, 3)];
    expect(computeAdaptation(runs, 'spark').ease).toBe(EASE_MAX);
    expect(computeAdaptation(runs, 'calm').reason).toBe('baseline');
  });

  it('profile stats aggregate grades, choices and series', () => {
    const stats = computeProfileStats([run({ mode: 'flow', grade: 'B' }, 1), run({ mode: 'flow', modeChosen: false, grade: 'S' }, 2), run({ mode: 'calm', grade: 'A' }, 3)]);
    expect(stats.runs).toBe(3);
    expect(stats.bestGrade).toBe('S');
    expect(stats.chosenModes).toEqual({ spark: 0, flow: 1, calm: 1 });
    expect(stats.accuracySeries).toHaveLength(3);
  });

  it('detects repeated error patterns from facts only', () => {
    const kinds = detectErrorPatterns(BASE).map((p) => p.kind);
    expect(kinds).toContain('typeWeakness');
    expect(kinds).toContain('blindStruggle');
    expect(kinds).toContain('memoryGap');
  });
});

describe('AI contract', () => {
  it('the client debrief payload always passes server validation', () => {
    for (const mode of ['spark', 'flow', 'calm'] as const) {
      const payload = buildDebriefPayload(idleResult(mode), 'ru', [run({}, 1)]);
      expect(debriefSchema.safeParse(payload).success).toBe(true);
    }
    expect(debriefSchema.safeParse(buildDebriefPayload(BASE, 'en', [])).success).toBe(true);
  });
});

describe('Local storage (IndexedDB)', () => {
  beforeEach(async () => {
    __resetDbForTests();
    await wipeAllData();
  });

  it('saves and loads runs in chronological order, skipping legacy shapes', async () => {
    await saveRun(run({}, 2));
    await saveRun(run({}, 1));
    await saveRun({ ...run({}, 3), result: { ...BASE, version: 1 } as unknown as MissionResult });
    const runs = await loadRuns();
    expect(runs.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('keeps checkpoints and discards stale ones', async () => {
    const d = new DuelDirector({ mode: 'spark', seed: 1 });
    let cp: Checkpoint | null = null;
    d.on((e: DirectorEvent) => {
      if (e.type === 'round' && e.index === 1) cp = d.getCheckpoint();
      if (e.type === 'upgradeOffer') d.chooseUpgrade(e.cards[0]);
    });
    d.start();
    while (!cp) d.update(50);
    await saveCheckpoint(cp);
    expect((await loadCheckpoint())?.round).toBe(1);
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
