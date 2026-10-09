import { create } from 'zustand';
import type { EchoLineId, Meters } from '@/game/core/director';
import type { Action, RoundKind, UpgradeId } from '@/game/core/types';

export type CallKind = 'perfect' | 'good' | 'miss' | 'wrong' | 'fooled' | 'ignored' | 'early' | 'onBeat' | 'offBeat' | 'orbGood' | 'orbBad' | 'runeGood' | 'runeBad' | 'clash' | 'shielded';

export interface HudState {
  phase: 'intro' | 'round' | 'upgrade' | 'ascend' | 'recall' | 'finisher' | 'complete';
  round: { index: number; kind: RoundKind; total: number } | null;
  loop: { index: number; loops: number } | null;
  meters: Meters;
  call: { id: number; kind: CallKind; value?: number } | null;
  directive: { id: number; kind: RoundKind } | null;
  hint: { id: number; action: Action } | null;
  prompt: 'strike' | 'orbs' | 'recall' | 'watch' | null;
  offer: UpgradeId[] | null;
  upgrades: UpgradeId[];
  echo: { id: number; line: EchoLineId } | null;
  recall: { points: number; tapped: number } | null;
  rebooting: boolean;
  paused: boolean;
  complete: boolean;
  intro: { id: number } | null;
}

export const initialHud: HudState = {
  phase: 'intro',
  round: null,
  loop: null,
  meters: { integrity: 100, combo: 0, hype: 0, score: 0, enemyHp: 1000, energy: 0 },
  call: null,
  directive: null,
  hint: null,
  prompt: null,
  offer: null,
  upgrades: [],
  echo: null,
  recall: null,
  rebooting: false,
  paused: false,
  complete: false,
  intro: null,
};

export const useHud = create<HudState>()(() => ({ ...initialHud }));

let seq = 1;
export const nextId = () => seq++;
