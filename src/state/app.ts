import { create } from 'zustand';
import type { Checkpoint } from '@/game/core/director';
import type { RunSummary } from '@/cognitive/adaptation';
import { clearCheckpoint, loadCheckpoint, loadRuns, wipeAllData } from '@/cognitive/storage';
import { fetchAiStatus, type AiStatus } from '@/ai/mentorClient';

export type Screen = 'title' | 'hub' | 'mission' | 'results' | 'stats' | 'settings';

interface AppState {
  screen: Screen;
  back: Screen;
  runs: RunSummary[];
  loaded: boolean;
  checkpoint: Checkpoint | null;
  lastRun: RunSummary | null;
  launch: { resume: boolean; nonce: number };
  aiStatus: AiStatus | 'unknown';
  go: (screen: Screen) => void;
  load: () => Promise<void>;
  startMission: (resume: boolean) => void;
  setCheckpoint: (cp: Checkpoint | null) => void;
  finishRun: (run: RunSummary) => void;
  discardCheckpoint: () => Promise<void>;
  wipe: () => Promise<void>;
  refreshAi: () => Promise<void>;
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
}));
