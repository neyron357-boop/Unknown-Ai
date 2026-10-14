import { create } from 'zustand';
import type { Speaker } from '@/voice/lines';
import { MAX_HP, type Dir, type Meters } from '@/game/v3/core/types';

export type HudFlag = 'hudCut' | 'fakeCrash' | 'glitch' | 'bloodlust' | 'panels';

/** Battle HUD state — written by the session on events (never per frame), read by React. */
export interface Hud3State {
  meters: Meters;
  boss: boolean;
  /** Big act title card. */
  act: { id: number; num: string; key: 'roof' | 'fall' | 'train' | 'temple' } | null;
  hint: { id: number; dir: Dir | null; kind: string } | null;
  cutIn: { id: number; who: string; name: string; side: 'left' | 'right' } | null;
  subtitle: { id: number; speaker: Speaker; ru: string; en: string; durMs: number } | null;
  flags: Record<HudFlag, boolean>;
  reboot: { id: number; ms: number } | null;
  hit: { id: number; damage: number } | null;
  saved: { id: number } | null;
  paused: boolean;
  complete: boolean;
}

export const initialHud3: Hud3State = {
  meters: { hp: MAX_HP, score: 0, combo: 0, mult: 1, rage: 0, bloodlust: false, posture: null, bossHp: null, kills: 0 },
  boss: false,
  act: null,
  hint: null,
  cutIn: null,
  subtitle: null,
  flags: { hudCut: false, fakeCrash: false, glitch: false, bloodlust: false, panels: false },
  reboot: null,
  hit: null,
  saved: null,
  paused: false,
  complete: false,
};

export const useHud3 = create<Hud3State>()(() => ({ ...initialHud3 }));

let seq = 1;
export const hudId = () => seq++;
