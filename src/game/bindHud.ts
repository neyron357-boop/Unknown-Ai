import type { DirectorEvent, MissionDirector } from '@/game/core/director';
import { useHud, initialHud, nextId, type FeedbackKind } from '@/state/hud';

/** Mirrors director events into the React HUD store (event-driven, never per frame). */
export function bindHud(director: MissionDirector): () => void {
  useHud.setState({ ...initialHud });
  const set = useHud.setState;
  const get = useHud.getState;

  return director.on((e: DirectorEvent) => {
    switch (e.type) {
      case 'stage':
        set({
          stage: e.stage,
          loop: e.loop,
          traceDepth: e.traceDepth,
          trace: e.loop !== get().loop ? [] : get().trace,
          banner: { id: nextId(), stage: e.stage, loop: e.loop },
          tutorial: e.stage === 'awakening' ? get().tutorial : null,
          complete: e.stage === 'evolution',
        });
        break;
      case 'cinematic':
        set({ cinematic: { id: nextId(), kind: e.id } });
        break;
      case 'tutorialStep':
        set({ tutorial: { step: e.step, total: e.total, expect: e.expect, done: false } });
        break;
      case 'tutorialResult': {
        const tut = get().tutorial;
        if (e.result === 'wrong') set({ feedback: { id: nextId(), kind: 'wrong' } });
        else if (tut) set({ tutorial: { ...tut, done: true } });
        break;
      }
      case 'gap':
        set({ predictWindow: e.predictable, committed: null, hint: null });
        break;
      case 'predictCommit':
        set({ committed: e.action, predictWindow: false });
        break;
      case 'inputIgnored':
        set({ feedback: { id: nextId(), kind: 'early' } });
        break;
      case 'telegraph': {
        const depth = get().traceDepth;
        const trace = depth > 0 ? [...get().trace, { id: nextId(), type: e.attack }].slice(-depth) : [];
        set({ hint: e.hint, predictWindow: false, trace });
        break;
      }
      case 'resolve': {
        const r = e.record;
        let kind: FeedbackKind;
        switch (r.outcome) {
          case 'read':
            kind = 'read';
            break;
          case 'react':
            kind = r.response === 'block' ? 'block' : 'react';
            break;
          case 'recovered':
            kind = 'recovered';
            break;
          case 'wrong':
            kind = 'wrong';
            break;
          case 'misread':
            kind = 'misread';
            break;
          default:
            kind = 'hit';
        }
        // Failures are announced at the strike moment instead (when the hit lands).
        if (kind !== 'hit' && kind !== 'misread' && kind !== 'wrong') set({ feedback: { id: nextId(), kind } });
        set({ readStreak: r.outcome === 'read' ? get().readStreak + 1 : 0, hint: null });
        break;
      }
      case 'strike':
        if (e.damage > 0) set({ feedback: { id: nextId(), kind: e.outcome === 'wrong' ? 'wrong' : e.outcome === 'misread' ? 'misread' : 'hit' } });
        break;
      case 'meters':
        set({ aura: e.aura, integrity: e.integrity, barrier: e.barrier });
        break;
      case 'reboot':
        set({ rebooting: true });
        setTimeout(() => set({ rebooting: false }), e.durationMs);
        break;
      case 'echo':
        set({ echo: { id: nextId(), line: e.line } });
        break;
      case 'ascendTrigger':
        set({ ascension: { phase: 'trigger', points: 0, shown: 0, tapped: 0, correct: 0, recallMs: 0, recallStartedAt: 0 }, hint: null, predictWindow: false });
        break;
      case 'ascendNode': {
        const a = get().ascension;
        if (a) set({ ascension: { ...a, phase: 'show', shown: e.order + 1 } });
        break;
      }
      case 'ascendRecall': {
        const a = get().ascension;
        if (a) set({ ascension: { ...a, phase: 'recall', points: e.points, recallMs: e.durationMs, recallStartedAt: performance.now() } });
        break;
      }
      case 'ascendTap': {
        const a = get().ascension;
        if (a) set({ ascension: { ...a, tapped: e.order + 1, correct: a.correct + (e.tap.correct ? 1 : 0) } });
        break;
      }
      case 'ascendStrike': {
        const a = get().ascension;
        if (a) set({ ascension: { ...a, phase: 'strike' } });
        if (e.hits === e.total) set({ feedback: { id: nextId(), kind: 'perfect' } });
        break;
      }
      case 'finisher':
        set({ ascension: { phase: 'finisher', points: 0, shown: 0, tapped: 0, correct: 0, recallMs: 0, recallStartedAt: 0 } });
        break;
      case 'complete':
        set({ complete: true, ascension: null });
        break;
    }
    // Leaving the ascension: clear its HUD once a new stage intro starts.
    if (e.type === 'cinematic' && e.id === 'overdriveIntro') set({ ascension: null });
  });
}
