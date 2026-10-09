import type { DirectorEvent, DuelDirector } from '@/game/core/director';
import { RESPONSE } from '@/game/core/types';
import { useHud, initialHud, nextId, type CallKind } from '@/state/hud';

/** Mirrors director events into the React HUD store (event-driven, never per frame). */
export function bindHud(director: DuelDirector): () => void {
  useHud.setState({ ...initialHud });
  const set = useHud.setState;
  const get = useHud.getState;
  const call = (kind: CallKind, value?: number) => set({ call: { id: nextId(), kind, value } });

  return director.on((e: DirectorEvent) => {
    switch (e.type) {
      case 'intro':
        set({ phase: 'intro', intro: { id: nextId() } });
        break;
      case 'round':
        set({ phase: 'round', round: { index: e.index, kind: e.kind, total: e.total }, directive: { id: nextId(), kind: e.kind }, prompt: null, offer: null, recall: null, loop: null });
        break;
      case 'loop':
        set({ loop: { index: e.loop, loops: e.loops } });
        break;
      case 'windup':
        if (e.hint && e.kind) set({ hint: { id: nextId(), action: RESPONSE[e.kind] } });
        break;
      case 'judge': {
        const j = e.record.judgement;
        if (j === 'ignored') break;
        if (e.shielded && (j === 'miss' || j === 'wrong')) call('shielded');
        else call(j);
        set({ hint: null });
        break;
      }
      case 'stray':
        call('early');
        break;
      case 'meters':
        set({ meters: e.meters });
        break;
      case 'open':
        set({ prompt: 'strike' });
        break;
      case 'openEnd':
        if (get().prompt === 'strike') set({ prompt: null });
        break;
      case 'strike':
        call(e.onBeat ? 'onBeat' : 'offBeat', e.damage);
        break;
      case 'orbs':
        set({ prompt: 'orbs' });
        break;
      case 'orbPick':
        call(e.correct ? 'orbGood' : 'orbBad');
        break;
      case 'clashResult':
        set({ prompt: null });
        call(e.success ? 'clash' : 'miss', e.damage);
        break;
      case 'ascend':
        set({ phase: 'ascend', prompt: 'watch' });
        break;
      case 'recall':
        set({ phase: 'recall', prompt: 'recall', recall: { points: e.points, tapped: 0 } });
        break;
      case 'recallTap': {
        const r = get().recall;
        if (r) set({ recall: { ...r, tapped: e.order + 1 } });
        call(e.correct ? 'runeGood' : 'runeBad');
        break;
      }
      case 'finisher':
        set({ phase: 'finisher', prompt: null, recall: null });
        break;
      case 'upgradeOffer':
        set({ phase: 'upgrade', offer: e.cards, prompt: null, hint: null });
        break;
      case 'upgradePicked':
        set({ phase: 'round', offer: null, upgrades: [...get().upgrades, e.id] });
        break;
      case 'reboot':
        set({ rebooting: true });
        window.setTimeout(() => set({ rebooting: false }), e.durationMs);
        break;
      case 'echo':
        set({ echo: { id: nextId(), line: e.line } });
        break;
      case 'complete':
        set({ phase: 'complete', complete: true, prompt: null });
        break;
      default:
        break;
    }
  });
}
