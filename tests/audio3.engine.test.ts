import { describe, expect, it } from 'vitest';
import { AudioEngineV3, LOOKAHEAD_MS, WARM_SFX, audio3 } from '@/audio/v3/Engine';
import { SECTIONS, STYLES } from '@/audio/v3/styles';
import { SECTION_IDS, SFX_NAMES } from '@/audio/v3/types';

describe('v3 engine (Node, no AudioContext)', () => {
  it('creates no AudioContext before unlock and every call is a safe no-op', () => {
    const e = new AudioEngineV3();
    expect(e.state).toBe('none');
    expect(e.ctx).toBeNull();
    expect(e.voiceInput).toBeNull();
    expect(() => {
      e.setPrefs({ musicOn: true, sfxOn: true, voiceOn: true, musicVolume: 0.7, sfxVolume: 0.8, voiceVolume: 0.9, volumeLimit: 0.9 });
      e.attachConductor();
      e.setSection('roof', 130, 0);
      e.setHype(3);
      e.pump(16);
      e.sfx('slashFlesh', { pan: 0.3, at: 20 });
      e.setAmbience('rain');
      e.slowmo(true, 300);
      e.duck(0.5, 1000);
      e.setChants({});
      e.detachConductor();
      e.suspend();
      e.resume();
      e.unlock(); // no window in Node → stays silent, never throws
    }).not.toThrow();
    expect(e.state).toBe('none');
  });

  it('exports a ready singleton', () => {
    expect(audio3).toBeInstanceOf(AudioEngineV3);
    expect(audio3.state).toBe('none');
  });

  it('schedules ahead no further than ~150 ms', () => {
    expect(LOOKAHEAD_MS).toBeGreaterThanOrEqual(80);
    expect(LOOKAHEAD_MS).toBeLessThanOrEqual(150);
  });

  it('warms every SFX and defines every section/style', () => {
    expect([...WARM_SFX].sort()).toEqual([...SFX_NAMES].sort());
    for (const id of SECTION_IDS) {
      const d = SECTIONS[id];
      expect(d, id).toBeDefined();
      expect(STYLES[d.style], id).toBeDefined();
      expect(d.level).toBeGreaterThan(0);
      expect(d.level).toBeLessThanOrEqual(1);
    }
  });
});
