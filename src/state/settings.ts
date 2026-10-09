import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ModeId } from '@/game/core/types';

export type Level = 'off' | 'low' | 'full';
export type Lang = 'ru' | 'en';

export interface Settings {
  lang: Lang;
  /** 0..1 */
  musicVolume: number;
  sfxVolume: number;
  /** Hard ceiling applied on the master bus, 0..1. */
  volumeLimit: number;
  musicOn: boolean;
  sfxOn: boolean;
  flashes: Level;
  shake: Level;
  /** Reduces zooms, slow-mo camera moves and parallax. */
  reduceMotion: boolean;
  /** Overall FX density: particles, glow, afterimages. */
  effects: 'low' | 'high';
  haptics: boolean;
  hints: boolean;
  mentor: boolean;
  mode: ModeId;
  /** True once the player has explicitly picked a mode at least once. */
  modeChosen: boolean;
  firstRunDone: boolean;
}

const prefersReducedMotion =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

export const DEFAULT_SETTINGS: Settings = {
  lang: 'ru',
  musicVolume: 0.7,
  sfxVolume: 0.85,
  volumeLimit: 0.9,
  musicOn: true,
  sfxOn: true,
  flashes: prefersReducedMotion ? 'low' : 'full',
  shake: prefersReducedMotion ? 'off' : 'full',
  reduceMotion: prefersReducedMotion,
  effects: 'high',
  haptics: true,
  hints: true,
  mentor: true,
  mode: 'spark',
  modeChosen: false,
  firstRunDone: false,
};

interface SettingsStore extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Partial<Settings>),
      reset: () => set({ ...DEFAULT_SETTINGS, firstRunDone: true }),
    }),
    {
      name: 'unknown-settings-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => {
        const { set: _set, reset: _reset, ...rest } = s;
        return rest;
      },
    },
  ),
);

/** Non-reactive snapshot for game code (Phaser, audio). */
export function getSettings(): Settings {
  return useSettings.getState();
}

export function levelFactor(level: Level): number {
  return level === 'off' ? 0 : level === 'low' ? 0.35 : 1;
}
