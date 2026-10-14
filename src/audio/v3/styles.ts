/**
 * Section & style tables: which style/part each director section plays, its
 * key, filter, reverb, sidechain depth, entry effect, beds… Pure data.
 */
import type { KeyName } from './theory';
import type { SectionId } from './types';

export type StyleId = 'mandelao' | 'drift' | 'hyper' | 'slowed' | 'none';
export type Part =
  | 'menu'
  | 'intro'
  | 'verse'
  | 'build'
  | 'drop'
  | 'breakdown'
  | 'fall'
  | 'dark'
  | 'execution'
  | 'finale'
  | 'outro';

/** Effect played on the first downbeat of a section. */
export type Entry = 'none' | 'crash' | 'drop' | 'impact';
export type BedId = 'vinyl' | 'wind';

export interface SectionDef {
  style: StyleId;
  part: Part;
  key: KeyName;
  /** Section lowpass in Hz, or a sweep across the section length. */
  filter: number | { from: number; to: number };
  /** Resonance of the section lowpass (DJ-filter sweeps use 2–4). */
  filterQ: number;
  /** Length assumed when the director gives no `bars` hint (sizes sweeps/risers). */
  defaultBars: number;
  /** Sidechain depth (0..1) applied to the 808 bus and to the melodic bus on kicks. */
  pumpBass: number;
  pumpMel: number;
  /** Send levels into the plate reverb and the huge hall. */
  verb: number;
  hall: number;
  /** Section output gain. */
  level: number;
  /** Swing of odd 16ths, fraction of a step. */
  swing: number;
  entry: Entry;
  /** When THIS section is approached, the previous one goes silent (drums/bass) for this many steps. */
  gapSteps: number;
  /** …and the WHOLE music bus is muted during that gap (hard pre-drop silence). */
  gapMute?: boolean;
  /** High-pass sweep across the section (builds). */
  hpSweep?: { from: number; to: number };
  beds: BedId[];
  /** Bed level multiplier (default 1). */
  bedGain?: number;
}

export const SECTIONS: Record<SectionId, SectionDef> = {
  menu: {
    style: 'drift',
    part: 'menu',
    key: 'C#m',
    filter: 3800,
    defaultBars: 8,
    pumpBass: 0,
    pumpMel: 0,
    verb: 0.42,
    hall: 0.15,
    level: 0.62,
    swing: 0.08,
    entry: 'none',
    gapSteps: 0,
    beds: ['vinyl'],
    filterQ: 0.8,
  },
  intro: {
    style: 'mandelao',
    part: 'intro',
    key: 'Fm',
    filter: { from: 300, to: 6000 },
    defaultBars: 4,
    pumpBass: 0.2,
    pumpMel: 0.25,
    verb: 0.38,
    hall: 0.2,
    level: 0.72,
    swing: 0.04,
    entry: 'none',
    gapSteps: 0,
    beds: [],
    filterQ: 3,
  },
  roof: {
    style: 'mandelao',
    part: 'verse',
    key: 'Fm',
    filter: 20000,
    defaultBars: 8,
    pumpBass: 0.6,
    pumpMel: 0.55,
    verb: 0.22,
    hall: 0,
    level: 0.86,
    swing: 0.04,
    entry: 'crash',
    gapSteps: 2,
    beds: [],
    filterQ: 0.8,
  },
  roofBuild: {
    style: 'mandelao',
    part: 'build',
    key: 'Fm',
    filter: 20000,
    defaultBars: 4,
    pumpBass: 0.3,
    pumpMel: 0.4,
    verb: 0.3,
    hall: 0.1,
    level: 0.88,
    swing: 0.04,
    entry: 'none',
    gapSteps: 0,
    beds: [],
    filterQ: 0.8,
    hpSweep: { from: 40, to: 900 },
  },
  roofDrop: {
    style: 'mandelao',
    part: 'drop',
    key: 'Fm',
    filter: 20000,
    defaultBars: 8,
    pumpBass: 0.85,
    pumpMel: 0.75,
    verb: 0.2,
    hall: 0,
    level: 1,
    swing: 0.04,
    entry: 'drop',
    gapSteps: 4,
    beds: [],
    filterQ: 0.8,
    gapMute: true,
  },
  fall: {
    style: 'none',
    part: 'fall',
    key: 'C#m',
    filter: 20000,
    defaultBars: 4,
    pumpBass: 0,
    pumpMel: 0,
    verb: 0.5,
    hall: 0.55,
    level: 0.72,
    swing: 0,
    entry: 'none',
    gapSteps: 2,
    beds: ['wind'],
    filterQ: 0.8,
  },
  train: {
    style: 'drift',
    part: 'verse',
    key: 'C#m',
    filter: 20000,
    defaultBars: 8,
    pumpBass: 0.6,
    pumpMel: 0.5,
    verb: 0.26,
    hall: 0,
    level: 0.86,
    swing: 0.1,
    entry: 'crash',
    gapSteps: 2,
    beds: ['vinyl'],
    filterQ: 0.8,
    bedGain: 0.5,
  },
  trainDrop: {
    style: 'drift',
    part: 'drop',
    key: 'C#m',
    filter: 20000,
    defaultBars: 8,
    pumpBass: 0.8,
    pumpMel: 0.7,
    verb: 0.22,
    hall: 0,
    level: 1,
    swing: 0.1,
    entry: 'drop',
    gapSteps: 4,
    beds: ['vinyl'],
    filterQ: 0.8,
    bedGain: 0.4,
    gapMute: true,
  },
  cameo: {
    style: 'mandelao',
    part: 'breakdown',
    key: 'Fm',
    filter: 9000,
    defaultBars: 8,
    pumpBass: 0.45,
    pumpMel: 0.5,
    verb: 0.34,
    hall: 0.15,
    level: 0.84,
    swing: 0.04,
    entry: 'impact',
    gapSteps: 2,
    beds: [],
    filterQ: 0.8,
  },
  bossIntro: {
    style: 'slowed',
    part: 'dark',
    key: 'C#m',
    filter: { from: 900, to: 3200 },
    defaultBars: 4,
    pumpBass: 0,
    pumpMel: 0.1,
    verb: 0.3,
    hall: 0.85,
    level: 0.6,
    swing: 0.1,
    entry: 'impact',
    gapSteps: 2,
    beds: ['vinyl'],
    filterQ: 1.2,
    bedGain: 0.7,
  },
  boss: {
    style: 'hyper',
    part: 'verse',
    key: 'Fm',
    filter: 20000,
    defaultBars: 8,
    pumpBass: 0.7,
    pumpMel: 0.55,
    verb: 0.2,
    hall: 0,
    level: 0.9,
    swing: 0,
    entry: 'drop',
    gapSteps: 2,
    beds: [],
    filterQ: 0.8,
    gapMute: true,
  },
  bossRage: {
    style: 'hyper',
    part: 'drop',
    key: 'Fm',
    filter: 20000,
    defaultBars: 8,
    pumpBass: 0.85,
    pumpMel: 0.7,
    verb: 0.18,
    hall: 0,
    level: 1,
    swing: 0,
    entry: 'drop',
    gapSteps: 4,
    beds: [],
    filterQ: 0.8,
    gapMute: true,
  },
  execution: {
    style: 'slowed',
    part: 'execution',
    key: 'C#m',
    filter: 520,
    defaultBars: 4,
    pumpBass: 0,
    pumpMel: 0,
    verb: 0.3,
    hall: 1,
    level: 0.62,
    swing: 0.1,
    entry: 'impact',
    gapSteps: 0,
    beds: [],
    filterQ: 1.4,
  },
  finale: {
    style: 'hyper',
    part: 'finale',
    key: 'Fm',
    filter: 20000,
    defaultBars: 8,
    pumpBass: 0,
    pumpMel: 0,
    verb: 0.35,
    hall: 1,
    level: 0.92,
    swing: 0,
    entry: 'none',
    gapSteps: 2,
    beds: [],
    filterQ: 0.8,
  },
  outro: {
    style: 'drift',
    part: 'outro',
    key: 'C#m',
    filter: 3000,
    defaultBars: 8,
    pumpBass: 0.2,
    pumpMel: 0.3,
    verb: 0.32,
    hall: 0.1,
    level: 0.66,
    swing: 0.1,
    entry: 'none',
    gapSteps: 0,
    beds: ['vinyl'],
    filterQ: 0.8,
  },
};

export type KickKind = 'kick' | 'kickTight' | 'kickDist' | 'kickSoft';
export type ShaperKind = 'tanh' | 'hard' | 'asym';

export interface StyleDef {
  /** Pre-gain into the 808 waveshaper (saturation amount). */
  bassDrive: number;
  bassCurve: ShaperKind;
  /** Post-shaper lowpass (Hz). */
  bassTone: number;
  /** Level of the clean sub reinforcement. */
  bassSub: number;
  /** Level of the driven (harmonic) path. */
  bassDirty: number;
  /** Mid-harmonic boost on the driven path [Hz, dB] — makes the 808 audible on phones. */
  bassMid: [number, number];
  /** Waveform of the octave layer mixed into the shaper (richer harmonics). */
  bassLayer: OscillatorType;
  /** Seconds — exponential decay time constant of the 808 body. */
  bassDecay: number;
  /** Start-pitch ratio of the 808 punch. */
  bassPunch: number;
  cowbell: 'dirty' | 'clean' | 'unison';
  /** Cowbell level (the lead element of phonk). */
  cowbellGain: number;
  /** Pad level (slowed sections live on the pad). */
  padGain: number;
  kick: KickKind;
  /** Drum balance per style. */
  kickGain: number;
  hatGain: number;
  padCutoff: number;
  /** Ping-pong delay in beats. */
  delayBeats: number;
  delayFeedback: number;
}

export const STYLES: Record<StyleId, StyleDef> = {
  mandelao: {
    bassDrive: 9,
    bassCurve: 'hard',
    bassTone: 5000,
    bassSub: 0.48,
    bassDirty: 0.5,
    bassDecay: 0.55,
    bassPunch: 2.2,
    cowbell: 'dirty',
    cowbellGain: 1.35,
    padGain: 1,
    kick: 'kickTight',
    kickGain: 1,
    hatGain: 1,
    padCutoff: 1400,
    delayBeats: 0.75,
    delayFeedback: 0.32,
    bassMid: [900, 7],
    bassLayer: 'square',
  },
  drift: {
    bassDrive: 6,
    bassCurve: 'tanh',
    bassTone: 4200,
    bassSub: 0.62,
    bassDirty: 0.58,
    bassDecay: 1.1,
    bassPunch: 1.6,
    cowbell: 'dirty',
    cowbellGain: 1.7,
    padGain: 1,
    kick: 'kick',
    kickGain: 1,
    hatGain: 1,
    padCutoff: 1100,
    delayBeats: 0.75,
    delayFeedback: 0.36,
    bassMid: [600, 6],
    bassLayer: 'triangle',
  },
  hyper: {
    bassDrive: 7,
    bassCurve: 'asym',
    bassTone: 4500,
    bassSub: 0.55,
    bassDirty: 0.85,
    bassDecay: 0.7,
    bassPunch: 2.6,
    cowbell: 'unison',
    cowbellGain: 1.35,
    padGain: 1,
    kick: 'kickDist',
    kickGain: 0.5,
    hatGain: 0.7,
    padCutoff: 1600,
    delayBeats: 0.5,
    delayFeedback: 0.3,
    bassMid: [300, 5],
    bassLayer: 'sawtooth',
  },
  slowed: {
    bassDrive: 1.6,
    bassCurve: 'tanh',
    bassTone: 900,
    bassSub: 0.55,
    bassDirty: 0.25,
    bassDecay: 0.9,
    bassPunch: 1.3,
    cowbell: 'clean',
    cowbellGain: 1.5,
    padGain: 4,
    kick: 'kickSoft',
    kickGain: 1,
    hatGain: 1,
    padCutoff: 800,
    delayBeats: 1.5,
    delayFeedback: 0.45,
    bassMid: [400, 3],
    bassLayer: 'triangle',
  },
  none: {
    bassDrive: 2,
    bassCurve: 'tanh',
    bassTone: 1200,
    bassSub: 0.8,
    bassDirty: 0.2,
    bassDecay: 1.5,
    bassPunch: 1.3,
    cowbell: 'clean',
    cowbellGain: 1.3,
    padGain: 1.8,
    kick: 'kickSoft',
    kickGain: 1,
    hatGain: 1,
    padCutoff: 900,
    delayBeats: 1,
    delayFeedback: 0.4,
    bassMid: [400, 2],
    bassLayer: 'triangle',
  },
};

/** Bars the section lasts for sweeps/risers (director hint wins). */
export function sectionLength(id: SectionId, hint?: number): number {
  return hint && hint > 0 ? hint : SECTIONS[id].defaultBars;
}
