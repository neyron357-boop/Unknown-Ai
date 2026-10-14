import { create } from 'zustand';
import type { BattleCheckpoint } from '@/game/v3/core/battle';
import type { RunSummary } from '@/cognitive/adaptation';
import { clearCheckpoint, loadCheckpoint, loadRuns, wipeAllData } from '@/cognitive/storage';
import { fetchAiStatus, type AiStatus } from '@/ai/mentorClient';
import { fetchEpisode, type EpisodeProfile, type EpisodeResponse } from '@/voice/dynamic';
import { getSettings } from './settings';

export type Screen = 'title' | 'hub' | 'mission' | 'results' | 'stats' | 'settings';

interface AppState {
  screen: Screen;
  back: Screen;
  runs: RunSummary[];
  loaded: boolean;
  checkpoint: BattleCheckpoint | null;
  lastRun: RunSummary | null;
  launch: { resume: boolean; nonce: number };
  aiStatus: AiStatus | 'unknown';
  /** Personalised lines for the next fight (Gemini via the server; null → the static voice bank). */
  episode: EpisodeResponse | null;
  go: (screen: Screen) => void;
  load: () => Promise<void>;
  startMission: (resume: boolean) => void;
  setCheckpoint: (cp: BattleCheckpoint | null) => void;
  finishRun: (run: RunSummary) => void;
  discardCheckpoint: () => Promise<void>;
  wipe: () => Promise<void>;
  refreshAi: () => Promise<void>;
  loadEpisode: () => Promise<void>;
}

export const useApp = create<AppState>()((set, get) => ({
  screen: 'title',
  back: 'hub',
  runs: [],
  loaded: false,
  checkpoint: null,
  lastRun: null,
  launch: { resume: false, nonce: 0 },
  aiStatus: 'unknown',
  episode: null,
  go: (screen) => set({ back: get().screen, screen }),
  load: async () => {
    try {
      const [runs, checkpoint] = await Promise.all([loadRuns(), loadCheckpoint()]);
      set({ runs, checkpoint, loaded: true, lastRun: runs[runs.length - 1] ?? null });
    } catch {
      // Private mode / storage disabled: the game still runs, progress just isn't kept.
      set({ loaded: true });
    }
  },
  startMission: (resume) => set({ screen: 'mission', back: get().screen, launch: { resume, nonce: get().launch.nonce + 1 } }),
  setCheckpoint: (cp) => set({ checkpoint: cp }),
  finishRun: (run) => set({ runs: [...get().runs, run], lastRun: run, checkpoint: null }),
  discardCheckpoint: async () => {
    set({ checkpoint: null });
    await clearCheckpoint().catch(() => undefined);
  },
  wipe: async () => {
    await wipeAllData().catch(() => undefined);
    set({ runs: [], lastRun: null, checkpoint: null });
  },
  refreshAi: async () => set({ aiStatus: await fetchAiStatus() }),
  loadEpisode: async () => {
    const episode = await fetchEpisode(episodeProfile(get().runs)).catch(() => null);
    if (episode) set({ episode });
  },
}));

const EPISODE_ENEMIES = new Set<string>(['grunt', 'brute', 'dodger', 'feinter', 'leaper', 'crawler', 'gunner']);

/** Numbers and enum values only: what VERDICT may know about the player's last fights. */
export function episodeProfile(runs: RunSummary[]): EpisodeProfile {
  const s = getSettings();
  const mine = runs.filter((r) => r.mode === s.mode);
  const last = (mine.length ? mine : runs)[(mine.length ? mine : runs).length - 1]?.result ?? null;
  const bias = last?.timing.biasMs ?? null;
  return {
    lang: s.lang,
    mode: s.mode,
    runs: runs.length,
    lastGrade: last?.grade ?? null,
    weakestEnemy: last?.weakestKind && EPISODE_ENEMIES.has(last.weakestKind) ? (last.weakestKind as EpisodeProfile['weakestEnemy']) : null,
    timingBias: bias === null ? null : bias <= -25 ? 'early' : bias >= 25 ? 'late' : 'centered',
    fooledByFeints: last?.feints.fooled ?? 0,
    execAccuracy: last && last.exec.cuts ? Math.round((last.exec.correct / last.exec.cuts) * 100) / 100 : null,
    bestCombo: runs.reduce((m, r) => Math.max(m, r.result.maxCombo), 0),
  };
}
