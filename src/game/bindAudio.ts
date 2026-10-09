import { audio } from '@/audio/AudioEngine';
import { haptic } from '@/audio/haptics';
import type { DirectorEvent, MissionDirector } from '@/game/core/director';

/** Maps director events to music intensity, stingers and SFX. */
export function bindAudio(director: MissionDirector): () => void {
  return director.on((e: DirectorEvent) => {
    switch (e.type) {
      case 'cinematic':
        if (e.id === 'awaken') {
          audio.setIntensity('ambient', 2);
          audio.sfx('awaken');
        } else if (e.id === 'enemyIntro') {
          audio.setIntensity('tension', 1.2);
          audio.sfx('enemyIntro');
          haptic([30, 40, 60]);
        } else if (e.id === 'patternIntro') {
          audio.setIntensity('combat', 1);
        } else if (e.id === 'overdriveIntro') {
          audio.setSlowmo(false);
          audio.setIntensity('overdrive', 0.4);
          audio.sfx('enemyIntro');
        }
        break;
      case 'tutorialResult':
        if (e.result === 'ok' || e.result === 'auto') {
          audio.sfx(e.action === 'block' ? 'shield' : e.action === 'dodgeL' ? 'whooshL' : e.action === 'dodgeR' ? 'whooshR' : 'tutorialOk');
          audio.sfx('tutorialOk');
        } else audio.sfx('ignored');
        break;
      case 'predictCommit':
        audio.sfx('predict');
        audio.sfx(e.action === 'block' ? 'shield' : e.action === 'dodgeL' ? 'whooshL' : 'whooshR');
        haptic(8);
        break;
      case 'inputIgnored':
        audio.sfx('ignored');
        break;
      case 'telegraph':
        audio.sfx(
          e.attack === 'slashL'
            ? 'telegraphL'
            : e.attack === 'slashR'
              ? 'telegraphR'
              : e.attack === 'crush'
                ? 'telegraphCrush'
                : 'telegraphPierce',
        );
        break;
      case 'reaction':
        audio.sfx(e.action === 'block' ? 'shield' : e.action === 'dodgeL' ? 'whooshL' : 'whooshR');
        break;
      case 'stagger':
        audio.sfx('stagger');
        haptic([20, 30, 20]);
        break;
      case 'resolve':
        if (e.record.outcome === 'read') {
          audio.sfx('read');
          audio.sfx('counter');
          haptic(18);
        }
        break;
      case 'strike':
        if (e.damage > 0) {
          audio.sfx('impact');
          haptic(60);
        } else if (e.dodged === 'block') {
          audio.sfx('block');
          haptic(14);
        }
        break;
      case 'reboot':
        audio.sfx('reboot');
        break;
      case 'echo':
        audio.sfx('echo');
        break;
      case 'ascendTrigger':
        audio.setSlowmo(true);
        audio.sfx('slowmoIn');
        haptic([10, 60, 10]);
        break;
      case 'ascendNode':
        audio.pluck(e.order, true);
        break;
      case 'ascendRecall':
        audio.sfx('heartbeat');
        break;
      case 'ascendTap':
        audio.pluck(e.order, e.tap.correct);
        if (e.tap.correct) audio.sfx('counter');
        haptic(e.tap.correct ? 15 : 40);
        break;
      case 'ascendStrike':
        audio.sfx('riser');
        window.setTimeout(() => {
          audio.setSlowmo(false);
          audio.sfx('drop');
          haptic([40, 30, 80]);
        }, 900);
        break;
      case 'finisher':
        audio.sfx('finisher');
        window.setTimeout(() => audio.setIntensity('ambient', 2.5), 1800);
        break;
      case 'complete':
        audio.setIntensity('ambient', 1.5);
        break;
    }
  });
}
