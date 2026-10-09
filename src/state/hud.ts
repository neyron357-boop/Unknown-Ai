import { create } from 'zustand';
import type { CinematicId, EchoLineId, LoopKey } from '@/game/core/director';
import type { Action, AttackType, StageId } from '@/game/core/types';

export type FeedbackKind = 'read' | 'react' | 'block' | 'recovered' | 'hit' | 'wrong' | 'misread' | 'early' | 'perfect';

export interface HudState {
  stage: StageId;
  loop: LoopKey | null;
  traceDepth: number;
  aura: number;
  integrity: number;
  barrier: number;
  trace: { id: number; type: AttackType }[];
  feedback: { id: number; kind: FeedbackKind } | null;
  tutorial: { step: number; total: number; expect: Action; done: boolean } | null;
  echo: { id: number; line: EchoLineId } | null;
  banner: { id: number; stage: StageId; loop: LoopKey | null } | null;
  cinematic: { id: number; kind: CinematicId } | null;
  ascension: {
    phase: 'trigger' | 'show' | 'recall' | 'strike' | 'finisher';
    points: number;
    shown: number;
    tapped: number;
    correct: number;
    recallMs: number;
    recallStartedAt: number;
  } | null;
  hint: Action[] | null;
  predictWindow: boolean;
  committed: Action | null;
  readStreak: number;
  rebooting: boolean;
  paused: boolean;
  complete: boolean;
}

export const initialHud: HudState = {
  stage: 'awakening',
  loop: null,
  traceDepth: 0,
  aura: 0,
  integrity: 100,
  barrier: 100,
  trace: [],
  feedback: null,
  tutorial: null,
  echo: null,
  banner: null,
  cinematic: null,
  ascension: null,
  hint: null,
  predictWindow: false,
  committed: null,
  readStreak: 0,
  rebooting: false,
  paused: false,
  complete: false,
};

export const useHud = create<HudState>()(() => ({ ...initialHud }));

let seq = 1;
export const nextId = () => seq++;
