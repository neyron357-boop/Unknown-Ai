import { describe, expect, it } from 'vitest';
import { generateBar, isDrumless, type NoteEvent } from '@/audio/v3/patterns';
import { SECTIONS } from '@/audio/v3/styles';
import { keyPitchClasses } from '@/audio/v3/theory';
import { CHANT_IDS, SECTION_IDS, type SectionId } from '@/audio/v3/types';

const SEED = 1234;
const bars = (section: SectionId, n: number, hype = 2, seed = SEED, prev: SectionId | null = null) =>
  Array.from({ length: n }, (_, bar) => generateBar({ section, bar, hype, seed, prev }));
const count = (evs: NoteEvent[], inst: NoteEvent['inst']) => evs.filter((e) => e.inst === inst).length;

describe('v3 pattern generator', () => {
  it('is deterministic for a given seed', () => {
    for (const id of SECTION_IDS) {
      expect(bars(id, 8, 3)).toEqual(bars(id, 8, 3));
    }
  });

  it('varies with the seed somewhere in a phrase', () => {
    const a = JSON.stringify(bars('roofDrop', 8, 3, 1));
    const b = JSON.stringify(bars('roofDrop', 8, 3, 2));
    expect(a).not.toEqual(b);
  });

  it('keeps every event inside its bar, sorted, with sane velocities', () => {
    for (const id of SECTION_IDS) {
      for (let hype = 0; hype <= 4; hype++) {
        for (const evs of bars(id, 8, hype, SEED, 'roof')) {
          let last = -Infinity;
          for (const e of evs) {
            if (e.pickup) {
              expect(e.step).toBeLessThan(0);
              expect(e.step).toBeGreaterThanOrEqual(-16);
              continue;
            }
            expect(e.step).toBeGreaterThanOrEqual(0);
            expect(e.step).toBeLessThan(16);
            expect(e.step).toBeGreaterThanOrEqual(last);
            last = e.step;
            expect(e.vel).toBeGreaterThan(0);
            expect(e.vel).toBeLessThanOrEqual(1.5);
            expect(Number.isFinite(e.step)).toBe(true);
          }
        }
      }
    }
  });

  it('writes melodies, basslines and chords in the section key (natural/harmonic minor + phrygian b2)', () => {
    for (const id of SECTION_IDS) {
      const pcs = keyPitchClasses(SECTIONS[id].key);
      for (const evs of bars(id, 8, 4)) {
        for (const e of evs) {
          const notes = [...(e.notes ?? []), ...(e.note !== undefined ? [e.note] : []), ...(e.slide !== undefined ? [e.slide] : [])];
          for (const n of notes) {
            expect(Number.isInteger(n)).toBe(true);
            expect(pcs.has(((n % 12) + 12) % 12)).toBe(true);
          }
        }
      }
    }
  });

  it('has no hard drums in the menu, the fall transition or the finale ring-out', () => {
    for (const id of SECTION_IDS.filter(isDrumless)) {
      for (const evs of bars(id, 8, 4)) {
        expect(count(evs, 'kick') + count(evs, 'snare') + count(evs, 'clap')).toBe(0);
      }
    }
  });

  it('adds layers with hype (0 minimal → 4 everything)', () => {
    for (const id of ['roof', 'train', 'boss'] as SectionId[]) {
      const lo = bars(id, 8, 0).flat().length;
      const hi = bars(id, 8, 4).flat().length;
      expect(hi).toBeGreaterThan(lo);
      expect(bars(id, 8, 4).flat().some((e) => e.inst === 'chant')).toBe(true);
    }
  });

  it('varies every 4 bars (fills / answer phrases) so loops never feel static', () => {
    for (const id of ['roof', 'roofDrop', 'train', 'trainDrop', 'boss', 'bossRage'] as SectionId[]) {
      const b = bars(id, 8, 3);
      expect(JSON.stringify(b[3])).not.toEqual(JSON.stringify(b[0]));
      expect(JSON.stringify(b[4])).not.toEqual(JSON.stringify(b[0])); // answer phrase
    }
  });

  it('hits drops hard on their first downbeat and prepares them', () => {
    for (const id of ['roofDrop', 'trainDrop', 'bossRage'] as SectionId[]) {
      const first = generateBar({ section: id, bar: 0, hype: 2, seed: SEED, prev: 'roof' });
      expect(first.some((e) => e.inst === 'crash' && e.step === 0)).toBe(true);
      expect(first.some((e) => e.inst === 'impact' && e.step === 0)).toBe(true);
      expect(first.some((e) => e.inst === 'revCrash' && e.endAligned)).toBe(true);
      expect(first.some((e) => e.pickup && e.inst === 'snare')).toBe(true);
      // no extra riser/pickups when a build already rose into it
      const afterBuild = generateBar({ section: id, bar: 0, hype: 2, seed: SEED, prev: 'roofBuild' });
      expect(afterBuild.some((e) => e.pickup)).toBe(false);
      expect(SECTIONS[id].gapSteps).toBeGreaterThan(0);
    }
  });

  it('sizes the build riser to the announced length', () => {
    const b = generateBar({ section: 'roofBuild', bar: 0, hype: 2, seed: SEED, length: 8 });
    expect(b.find((e) => e.inst === 'riser')?.len).toBe(8 * 16);
    const d = generateBar({ section: 'roofBuild', bar: 0, hype: 2, seed: SEED });
    expect(d.find((e) => e.inst === 'riser')?.len).toBe(SECTIONS.roofBuild.defaultBars * 16);
  });

  it('lands a sub drop + impact when the fall ends', () => {
    const b = generateBar({ section: 'train', bar: 0, hype: 2, seed: SEED, prev: 'fall' });
    expect(b.some((e) => e.inst === 'subDrop')).toBe(true);
    expect(b.some((e) => e.inst === 'impact')).toBe(true);
  });

  it('gives the slowed sections a heartbeat and the finale one huge impact then ring-out', () => {
    for (const id of ['bossIntro', 'execution'] as SectionId[]) expect(count(generateBar({ section: id, bar: 0, hype: 1, seed: SEED }), 'heart')).toBeGreaterThan(0);
    const f = bars('finale', 8, 2);
    expect(count(f[0], 'impact')).toBe(1);
    expect(f.slice(1).every((evs) => count(evs, 'impact') === 0)).toBe(true);
    expect(f[7]).toHaveLength(0);
  });

  it('only uses the known chant ids in drops', () => {
    for (const id of ['roofDrop', 'trainDrop', 'bossRage', 'cameo'] as SectionId[]) {
      const chants = bars(id, 8, 4, SEED, 'roof').flat().filter((e) => e.inst === 'chant');
      expect(chants.length).toBeGreaterThan(0);
      for (const c of chants) expect(CHANT_IDS).toContain(c.chant);
    }
  });

  it('writes triplet hat rolls in drift and 32nd rolls in hyperphonk', () => {
    const drift = bars('trainDrop', 4, 3).flat().filter((e) => e.inst === 'hat');
    expect(drift.some((e) => Math.abs((e.step * 3) % 1) > 0.01 || Math.abs(((e.step * 1.5) % 1) - 0) > 0.01)).toBe(true);
    const hyper = bars('bossRage', 2, 4).flat().filter((e) => e.inst === 'hat');
    expect(hyper.some((e) => e.step % 1 === 0.25 || e.step % 1 === 0.75)).toBe(true);
  });
});
