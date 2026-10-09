import { audio, type SfxName } from '@/audio/AudioEngine';
import { haptic } from '@/audio/haptics';
import type { DirectorEvent, DuelDirector } from '@/game/core/director';
import type { AttackKind } from '@/game/core/types';

const TICK: Record<AttackKind, SfxName> = { high: 'tickHigh', mid: 'tickMid', low: 'tickLow' };
const REVEAL: Record<AttackKind, SfxName> = { high: 'revealHigh', mid: 'revealMid', low: 'revealLow' };

/** Maps director events to the music conductor, beat-locked cues and SFX. */
export function bindAudio(director: DuelDirector): () => void {
  const pending = new Map<number, { impactAt: number; kind: AttackKind | null }>();
  const later = (at: number, fn: () => void) => {
    const delay = Math.max(0, at - director.getNow());
    if (delay < 5) fn();
    else window.setTimeout(fn, delay);
  };
  return director.on((e: DirectorEvent) => {
    switch (e.type) {
      case 'section':
        audio.setSection(e.id, e.bpm, e.at);
        break;
      case 'meters':
        audio.setHype(e.meters.hype);
        break;
      case 'beat':
        // countdown ticks on the beats between windup and impact
        for (const [id, p] of pending) {
          const beatsLeft = Math.round((p.impactAt - e.at) / e.beatMs);
          if (beatsLeft === 1) audio.sfx(p.kind ? TICK[p.kind] : 'tick', 0.3);
          if (beatsLeft <= 0) {
            audio.sfx('enemySwing', 0.2);
            pending.delete(id);
          }
        }
        break;
      case 'windup':
        pending.set(e.id, { impactAt: e.impactAt, kind: e.kind });
        audio.sfx(e.kind ? TICK[e.kind] : 'tick', 0.3);
        if (e.clash) audio.sfx('revealMid', 0.2);
        break;
      case 'reveal': {
        const p = pending.get(e.id);
        if (p) p.kind = e.kind;
        audio.sfx(REVEAL[e.kind], 0.3);
        break;
      }
      case 'judge': {
        pending.delete(e.id);
        const r = e.record;
        if (r.judgement === 'perfect' || r.judgement === 'good') {
          if (r.kind === 'mid') audio.sfx(r.judgement === 'perfect' ? 'parryPerfect' : 'parryGood', -0.1);
          else audio.sfx(r.kind === 'high' ? 'duck' : 'jump', -0.2);
          haptic(r.judgement === 'perfect' ? 18 : 10);
        } else if (r.judgement === 'ignored') {
          audio.sfx('phantomShift', 0.3);
        } else if (r.judgement === 'fooled') {
          audio.sfx('fooled');
          haptic([20, 30, 20]);
        } else if (!e.shielded) {
          later(r.impactMs, () => audio.sfx('hit', -0.2));
          haptic(60);
        }
        break;
      }
      case 'stray':
        audio.sfx('stray');
        break;
      case 'whiff':
        audio.sfx('whiff', -0.2);
        break;
      case 'strike':
        audio.sfx(e.onBeat ? (e.finisher ? 'strikeFinal' : 'strike') : 'strikeOff', 0.2);
        haptic(e.finisher ? 30 : 12);
        break;
      case 'orbs':
        audio.sfx('orbSpawn');
        break;
      case 'orbPick':
        if (e.correct) {
          audio.sfx('orbGood');
          audio.orbValue(e.energy);
        } else audio.sfx('orbBad');
        break;
      case 'clashResult':
        audio.sfx(e.success ? 'clash' : 'hit');
        haptic(e.success ? [30, 40, 80] : 60);
        break;
      case 'ascend':
        audio.sfx('ascend');
        break;
      case 'rune':
        audio.rune(e.order, true);
        break;
      case 'recallTap':
        audio.rune(e.order, e.correct);
        if (e.correct) audio.sfx('strike', 0.2);
        haptic(e.correct ? 15 : 40);
        break;
      case 'finisher':
        audio.sfx('drop');
        window.setTimeout(() => audio.sfx('finisher'), e.durationMs / 2);
        haptic([40, 30, 80]);
        break;
      case 'round':
        audio.sfx('round');
        break;
      case 'intro':
        window.setTimeout(() => audio.sfx('lightning', 0.3), e.durationMs * 0.12);
        break;
      case 'upgradeOffer':
        audio.sfx('card');
        break;
      case 'upgradePicked':
        audio.sfx('cardPick');
        break;
      case 'reboot':
        audio.sfx('reboot');
        break;
      case 'echo':
        audio.sfx('echo');
        break;
      default:
        break;
    }
  });
}
