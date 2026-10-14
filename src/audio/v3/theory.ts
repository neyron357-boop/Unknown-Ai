/** Minimal music theory for the pattern generator. Pure. */

export type KeyName = 'Fm' | 'C#m';

export interface KeyDef {
  /** MIDI note of the tonic around octave 4 (melodic reference). */
  root: number;
  /** MIDI note of the tonic for the 808 (low register). */
  bass: number;
  /** Natural-minor scale steps (semitones from the tonic). */
  scale: readonly number[];
}

export const KEYS: Record<KeyName, KeyDef> = {
  // F4 = 65, F1 = 29 (43.7 Hz)
  Fm: { root: 65, bass: 29, scale: [0, 2, 3, 5, 7, 8, 10] },
  // C#4 = 61, C#2 = 37 (69.3 Hz)
  'C#m': { root: 61, bass: 37, scale: [0, 2, 3, 5, 7, 8, 10] },
};

export function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function semis(ratio: number): number {
  return 12 * Math.log2(ratio);
}

export function rateFor(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/** Pitch classes (0..11) that belong to a key, including the harmonic-minor leading tone. */
export function keyPitchClasses(key: KeyName): Set<number> {
  const k = KEYS[key];
  const tonic = k.root % 12;
  const set = new Set<number>();
  for (const s of k.scale) set.add((tonic + s) % 12);
  set.add((tonic + 11) % 12); // leading tone (V major in harmonic minor)
  set.add((tonic + 1) % 12); // phrygian b2 — the "dark phonk" note
  return set;
}
