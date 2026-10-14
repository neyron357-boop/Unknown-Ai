import { audio3 } from '@/audio/bus';
import { haptic } from '@/audio/haptics';
import type { AmbienceId, Sfx } from '@/audio/v3/types';
import type { BattleDirector, BattleEvent } from '../core/battle';
import type { ActId, Dir, KillStyle } from '../core/types';

const AMBIENCE: Record<ActId, AmbienceId> = { roof: 'rain', fall: 'wind', train: 'train', temple: 'wind' };

/** Gore layers per kill style: the cut, then what the body does. */
const KILL_SFX: Record<KillStyle, Sfx[]> = {
  bisect: ['slashFlesh', 'bloodGush'],
  decap: ['decap', 'bloodSplash'],
  cleave: ['slashFlesh', 'boneCrack'],
  impale: ['slashCrit', 'bloodSplash'],
  burst: ['slashCrit', 'boneCrack', 'bloodGush'],
  shot: ['gunshot', 'bloodSplash'],
  shove: ['impact'],
};

/**
 * Director events → the procedural phonk conductor and the gore SFX. Everything that has a
 * beat time is scheduled on it (`at`), so hits land exactly on the music.
 */
export function bindAudio3(director: BattleDirector): () => void {
  let act: ActId | null = null;
  let hype = -1;
  const timers = new Set<number>();
  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  /** Visual pan of a logical direction (the stage flips under the mirror anomaly). */
  const pan = (dir: Dir, at: number) => {
    const s = dir === 'left' ? -0.45 : dir === 'right' ? 0.45 : 0;
    return director.isMirrored(at) ? -s : s;
  };
  const slowmo = (ms: number) => {
    audio3.sfx('slowmoIn');
    audio3.slowmo(true, 200);
    later(ms, () => {
      audio3.slowmo(false, 300);
      audio3.sfx('slowmoOut');
    });
  };

  const off = director.on((e: BattleEvent) => {
    switch (e.type) {
      case 'section':
        audio3.setSection(e.id, e.bpm, e.at);
        break;
      case 'segment':
        if (e.act !== act) {
          const prev = act;
          act = e.act;
          audio3.setAmbience(AMBIENCE[e.act]);
          if (prev === 'roof' && e.act === 'fall') {
            audio3.sfx('collapse');
            audio3.sfx('glassCrack', { gain: 0.8 });
          } else if (e.act === 'train') {
            audio3.sfx('land', { at: e.at });
            audio3.sfx('trainHorn', { at: e.at + director.beatMs * 2, gain: 0.8 });
          } else if (e.act === 'temple') audio3.sfx('thunder');
        }
        break;
      case 'meters': {
        const m = e.meters;
        const h = m.bloodlust ? 4 : m.combo >= 30 ? 3 : m.combo >= 16 ? 2 : m.combo >= 8 ? 1 : 0;
        if (h !== hype) {
          hype = h;
          audio3.setHype(h);
        }
        break;
      }
      case 'spawn':
        if (e.enemy.kind === 'butcher') audio3.sfx('chainsaw', { pan: e.enemy.side === 'left' ? -0.6 : 0.6 });
        break;
      case 'judge': {
        const n = e.note;
        if (n.kind === 'boss' && (e.judgement === 'perfect' || e.judgement === 'good')) {
          audio3.sfx(e.judgement === 'perfect' ? 'parryPerfect' : 'parry', { at: n.at });
          haptic(e.judgement === 'perfect' ? 20 : 12);
        } else if (e.judgement === 'fooled') {
          audio3.sfx('glitch', { gain: 0.7 });
          haptic([20, 30, 20]);
        }
        break;
      }
      case 'kill': {
        const p = pan(e.dir, e.at);
        if (e.by === 'cleaner') audio3.sfx('gunshot', { pan: p * 0.6 });
        else if (e.by === 'fox') audio3.sfx('swing', { pan: p, pitch: 1.15 });
        else if (e.by === 'ronin') audio3.sfx('swingHeavy', { pan: p });
        const pitch = e.perfect ? 1.06 : 1;
        const gain = e.bloodlust ? 1.15 : 1;
        // a gunner dies by his own bullet, knocked back by the blade
        const layers: Sfx[] = e.kind === 'gunner' && e.by === 'hero' ? ['bulletDeflect', 'bloodSplash'] : KILL_SFX[e.style];
        for (const s of layers) audio3.sfx(s, { pan: p, pitch, gain, at: e.at });
        if (e.style !== 'shot' && e.style !== 'shove') audio3.sfx('bodyFall', { pan: p, at: e.at + 380, gain: 0.8 });
        if (e.by === 'hero') haptic(e.perfect ? 14 : 8);
        break;
      }
      case 'enemyHurt':
        audio3.sfx('armorBreak');
        break;
      case 'shift':
        audio3.sfx('blink', { at: e.at, pan: e.to === 'left' ? -0.4 : 0.4 });
        break;
      case 'heroHit':
        audio3.sfx(e.damage >= 14 ? 'heroHitHeavy' : 'heroHit', { pan: pan(e.dir, director.getNow()) });
        haptic(e.damage >= 14 ? [40, 30, 60] : 50);
        break;
      case 'whiff':
        audio3.sfx('whiff', { gain: e.stray ? 0.5 : 0.8, pan: pan(e.dir, director.getNow()) * 0.5 });
        break;
      case 'bloodlust':
        if (e.on) {
          audio3.sfx('bloodlust');
          haptic([30, 40, 30]);
        }
        break;
      case 'reboot':
        audio3.sfx('tapeStop');
        audio3.sfx('heartbeat', { gain: 0.9 });
        break;
      case 'cameo':
        if (e.phase === 'enter') {
          if (e.role === 'miniboss') audio3.sfx('chainsaw');
          else {
            audio3.sfx('blink', { pan: e.side === 'left' ? -0.5 : 0.5 });
            audio3.sfx('impact', { gain: 0.7 });
          }
        }
        break;
      case 'boss':
        if (e.phase === 'intro') {
          audio3.sfx('thunder');
          audio3.sfx('subDrop', { at: e.at });
        } else if (e.phase === 'rage') {
          audio3.sfx('impact', { at: e.at });
          audio3.sfx('thunder', { gain: 0.8 });
        } else if (e.phase === 'broken') {
          audio3.sfx('armorBreak', { gain: 1.2 });
          slowmo(700);
        }
        break;
      case 'bossMove':
        // the whoosh of his blade arrives just before the impact
        audio3.sfx(e.move === 'feint' ? 'swing' : 'swingHeavy', { at: e.note.at - 70, pan: 0.35, gain: e.move === 'feint' ? 0.5 : 0.9 });
        break;
      case 'execShow':
        audio3.sfx('swing', { at: e.at, pitch: 1 + e.index * 0.08, gain: 0.7 });
        break;
      case 'execCut':
        if (e.ok) {
          audio3.sfx('execCut', { at: e.at });
          audio3.sfx('bloodSplash', { at: e.at, gain: 0.8 });
          haptic(18);
        } else audio3.sfx('execFail');
        break;
      case 'finisher':
        audio3.sfx('decap', { at: e.at, gain: 1.2 });
        audio3.sfx('bloodGush', { at: e.at + 60 });
        audio3.sfx('subDrop', { at: e.at });
        slowmo(1300);
        haptic([40, 30, 90]);
        break;
      case 'anomaly':
        switch (e.kind) {
          case 'lightning':
            audio3.sfx('thunder');
            break;
          case 'glitch':
          case 'invert':
            audio3.sfx('glitch');
            break;
          case 'mirror':
            audio3.sfx('glassCrack');
            break;
          case 'hudCut':
            audio3.sfx('swingHeavy');
            break;
          case 'fakeCrash':
            audio3.sfx('tapeStop');
            audio3.duck(1, e.durationMs);
            break;
          case 'timeStop':
            slowmo(e.durationMs);
            break;
          case 'blackout':
            audio3.duck(0.6, e.durationMs);
            audio3.sfx('heartbeat');
            break;
          case 'moonEye':
            audio3.sfx('heartbeat', { gain: 0.7 });
            break;
          case 'panels':
            audio3.sfx('impact', { gain: 0.6 });
            break;
          default:
            break;
        }
        break;
      default:
        break;
    }
  });
  return () => {
    off();
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
    audio3.slowmo(false, 100);
    audio3.setAmbience(null);
  };
}
