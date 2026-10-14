import { onSubtitle } from '@/audio/bus';
import { getSettings } from '@/state/settings';
import { hudId, initialHud3, useHud3, type HudFlag } from '@/state/hud3';
import type { BattleDirector, BattleEvent } from '../core/battle';
import type { Dir } from '../core/types';

const ACT_CARD: Partial<Record<string, { num: string; key: 'roof' | 'fall' | 'train' | 'temple' }>> = {
  roofA: { num: 'I', key: 'roof' },
  fall: { num: 'II', key: 'fall' },
  trainA: { num: 'III', key: 'train' },
  bossIntro: { num: 'IV', key: 'temple' },
};

/** The HUD hooks the Phaser scene calls (hints, 4th-wall flags, cameo cut-ins). */
export interface SceneHudHooks {
  hint: (h: { dir: Dir | null; kind: string } | null) => void;
  flag: (name: HudFlag, on: boolean, ms?: number) => void;
  cutIn: (c: { id: string; name: string; side: 'left' | 'right' }) => void;
}

/**
 * Mirrors director events into the React HUD store — event-driven, never per frame — and
 * returns the hooks the scene uses for what only it knows (hint timing, glitches, cut-ins).
 */
export function bindHud3(director: BattleDirector): { hooks: SceneHudHooks; say: (text: { ru: string; en: string }, durMs: number) => void; dispose: () => void } {
  useHud3.setState({ ...initialHud3, flags: { ...initialHud3.flags } });
  const set = useHud3.setState;
  const timers = new Map<string, number>();
  const timer = (key: string, ms: number, fn: () => void) => {
    const old = timers.get(key);
    if (old !== undefined) window.clearTimeout(old);
    timers.set(
      key,
      window.setTimeout(() => {
        timers.delete(key);
        fn();
      }, ms),
    );
  };
  const setFlag = (name: HudFlag, on: boolean) => set((s) => ({ flags: { ...s.flags, [name]: on } }));

  const off = director.on((e: BattleEvent) => {
    switch (e.type) {
      case 'meters':
        set({ meters: e.meters });
        break;
      case 'segment': {
        const card = ACT_CARD[e.id];
        if (card) set({ act: { id: hudId(), ...card } });
        break;
      }
      case 'boss':
        if (e.phase === 'intro' || e.phase === 'duel') set({ boss: true });
        if (e.phase === 'dead') timer('boss', 1600, () => set({ boss: false }));
        break;
      case 'heroHit':
        set({ hit: { id: hudId(), damage: e.damage } });
        break;
      case 'reboot':
        set({ reboot: { id: hudId(), ms: e.durationMs } });
        timer('reboot', e.durationMs, () => set({ reboot: null }));
        break;
      case 'complete':
        set({ complete: true, hint: null });
        break;
      default:
        break;
    }
  });

  const offSub = onSubtitle((s) => {
    if (!getSettings().subtitles) return;
    set({ subtitle: { id: hudId(), speaker: s.speaker, ru: s.ru, en: s.en, durMs: s.durMs } });
  });

  const hooks: SceneHudHooks = {
    hint: (h) => set({ hint: h ? { id: hudId(), ...h } : null }),
    flag: (name, on, ms) => {
      setFlag(name, on);
      if (on && ms) timer(`flag:${name}`, ms, () => setFlag(name, false));
    },
    cutIn: (c) => {
      set({ cutIn: { id: hudId(), who: c.id, name: c.name, side: c.side } });
      timer('cutIn', 1700, () => set({ cutIn: null }));
    },
  };

  const say = (text: { ru: string; en: string }, durMs: number) => {
    if (!getSettings().subtitles) return;
    set({ subtitle: { id: hudId(), speaker: 'verdict', ru: text.ru, en: text.en, durMs } });
  };

  return {
    hooks,
    say,
    dispose: () => {
      off();
      offSub();
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
    },
  };
}
