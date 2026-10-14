/**
 * Pattern generator: (section, bar, hype, seed) → list of note events for one
 * bar of 16 sixteenth-steps. Pure and deterministic — the same seed always
 * gives the same music. All riffs are original, written for this project.
 *
 * Phrase logic: 4-bar phrases (chord cycle), call/answer riff variants every
 * other phrase, drum fills on bar 4 of a phrase, bigger fills + reverse cymbal
 * every 8 bars, seeded micro-variation (ghost notes, 808 slides, fills).
 */
import { rngFor, chance, type Rng } from './rng';
import { SECTIONS, sectionLength, type Part, type SectionDef, type StyleId } from './styles';
import { KEYS } from './theory';
import type { SectionId } from './types';

export type Inst =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'rim'
  | 'hat'
  | 'ohat'
  | 'perc'
  | 'crash'
  | 'revCrash'
  | 'impact'
  | 'subDrop'
  | 'swell'
  | 'downlifter'
  | 'heart'
  | 'cowbell'
  | 'bass'
  | 'pad'
  | 'lead'
  | 'chant'
  | 'riser';

export const DRUM_INSTS: ReadonlySet<Inst> = new Set<Inst>(['kick', 'snare', 'clap', 'rim', 'hat', 'ohat', 'perc', 'heart']);

export interface NoteEvent {
  inst: Inst;
  /** Position in 16th steps from the bar's downbeat (fractional = off-grid, e.g. triplets). */
  step: number;
  /** 0..1 */
  vel: number;
  /** MIDI note (melodic instruments). */
  note?: number;
  /** Chord notes (pad). */
  notes?: number[];
  /** Length in steps. */
  len?: number;
  /** MIDI target reached by gliding at the end of the note (808 slides). */
  slide?: number;
  /** Semitone offset at the onset gliding into the note (pitch dive / screech bend). */
  bend?: number;
  /** Sample variant (perc pitch, hat flavour…). */
  variant?: number;
  pan?: number;
  /** Chant id (ch_hey, ch_vai…). */
  chant?: string;
  /** Playback rate (chant pitch). */
  rate?: number;
  /** `step` marks where the sound ENDS (reverse cymbals/swells); `len` = audible length. */
  endAligned?: boolean;
  /** 0 = main layer, 1 = doubling layer (e.g. cowbell an octave down). */
  layer?: number;
  /** Pickup: `step` is negative, relative to this bar's downbeat (plays at the end of the previous bar/section). */
  pickup?: boolean;
}

export interface BarContext {
  section: SectionId;
  /** Bar index within the section. */
  bar: number;
  /** 0..4 */
  hype: number;
  seed: number;
  /** Known (or default) section length in bars. */
  length?: number;
  /** Previous section (entry effects). */
  prev?: SectionId | null;
}

type Riff = readonly (readonly [step: number, semi: number, len?: number, bend?: number])[];
type Riff4 = readonly [Riff, Riff, Riff, Riff];

// ---------------------------------------------------------------- mandelão (F minor)
// Chords: Fm | Fm | Db | C   (bass offsets from F1)
const MAN_BASS_ROOTS = [0, 0, 8, 7] as const;
// Cowbell riff A — 3-3-2 tamborzão accents (semitones from F4)
const MAN_RIFF_A: Riff4 = [
  [[0, 12], [3, 12], [6, 19], [8, 12], [10, 15], [11, 14], [14, 12]],
  [[0, 12], [3, 12], [6, 19], [8, 22], [10, 20], [11, 19], [14, 15]],
  [[0, 8], [3, 8], [6, 15], [8, 8], [10, 12], [11, 10], [14, 8]],
  [[0, 7], [3, 7], [6, 14], [8, 19], [10, 17], [11, 15], [12, 14], [14, 11]],
];
// Riff B — the answer phrase with octave jumps
const MAN_RIFF_B: Riff4 = [
  [[0, 12], [2, 24], [3, 12], [6, 19], [8, 12], [10, 24], [11, 22], [14, 19]],
  [[0, 15], [2, 22], [3, 15], [6, 22], [8, 20], [10, 19], [11, 17], [14, 15]],
  [[0, 8], [2, 20], [3, 8], [6, 15], [8, 20], [10, 17], [11, 15], [14, 12]],
  [[0, 7], [2, 19], [3, 7], [5, 19], [6, 7], [8, 19], [10, 17], [12, 15], [13, 14], [14, 11], [15, 12]],
];

// ---------------------------------------------------------------- drift (C# minor)
// Chords: C#m | A | F#m | G#   (bass offsets from C#2)
const DRIFT_BASS_ROOTS = [0, -4, -7, -5] as const;
const DRIFT_PADS: readonly (readonly number[])[] = [
  [52, 56, 59, 61], // C#m7 (E3 G#3 B3 C#4)
  [52, 56, 57, 61], // Amaj7
  [52, 54, 57, 61], // F#m7
  [51, 54, 56, 60], // G#7
];
// Cowbell lead with octave jumps (semitones from C#4)
const DRIFT_RIFF_A: Riff4 = [
  [[0, 24], [2, 12], [3, 24], [5, 12], [6, 22], [8, 19], [10, 20], [11, 19], [12, 15], [14, 17]],
  [[0, 20], [2, 8], [3, 20], [5, 8], [6, 19], [8, 15], [10, 17], [11, 15], [12, 12], [14, 15]],
  [[0, 17], [2, 5], [3, 17], [5, 5], [6, 15], [8, 12], [10, 15], [11, 12], [12, 8], [14, 12]],
  [[0, 19], [2, 7], [3, 19], [5, 7], [6, 14], [8, 11], [10, 14], [11, 19], [12, 23], [14, 24]],
];
// Answer phrase: rolling 16th pedal tones
const DRIFT_RIFF_B: Riff4 = [
  [[0, 12], [1, 24], [2, 12], [3, 22], [4, 12], [5, 20], [6, 19], [8, 12], [9, 24], [10, 12], [11, 22], [12, 19], [14, 20], [15, 19]],
  [[0, 8], [1, 20], [2, 8], [3, 19], [4, 8], [5, 17], [6, 15], [8, 8], [9, 20], [10, 8], [11, 19], [12, 15], [14, 17], [15, 15]],
  [[0, 5], [1, 17], [2, 5], [3, 15], [4, 5], [5, 12], [6, 13], [8, 5], [9, 17], [10, 5], [11, 15], [12, 12], [14, 15], [15, 12]],
  [[0, 7], [1, 19], [2, 7], [3, 14], [4, 7], [5, 11], [6, 14], [8, 19], [10, 23], [11, 19], [12, 23], [13, 24], [14, 23], [15, 19]],
];

// ---------------------------------------------------------------- hyper (F minor)
// Chords: Fm | Db | Bbm | C
const HYPER_BASS_ROOTS = [0, 8, 5, 7] as const;
const HYPER_PADS: readonly (readonly number[])[] = [
  [53, 56, 60, 63], // Fm7
  [53, 56, 60, 61], // Dbmaj7
  [53, 58, 61, 65], // Bbm
  [52, 55, 60, 64], // C
];
const HYPER_BELL: Riff4 = [
  [[0, 12], [1, 24], [2, 12], [3, 22], [4, 12], [5, 20], [6, 12], [7, 19], [8, 12], [9, 24], [10, 12], [11, 22], [12, 20], [13, 19], [14, 17], [15, 15]],
  [[0, 8], [1, 20], [2, 8], [3, 19], [4, 8], [5, 17], [6, 8], [7, 15], [8, 8], [9, 20], [10, 8], [11, 19], [12, 17], [13, 15], [14, 13], [15, 12]],
  [[0, 5], [1, 17], [2, 5], [3, 15], [4, 5], [5, 13], [6, 5], [7, 12], [8, 5], [9, 17], [10, 5], [11, 15], [12, 13], [13, 12], [14, 10], [15, 8]],
  [[0, 7], [1, 19], [2, 7], [3, 17], [4, 7], [5, 14], [6, 7], [7, 11], [8, 7], [9, 19], [10, 7], [11, 23], [12, 19], [13, 17], [14, 14], [15, 11]],
];
// Screeching saw lead (semitones from F4, len in steps, bend in semitones)
const HYPER_LEAD: Riff4 = [
  [[0, 24, 6, -2], [6, 22, 2], [8, 20, 4], [12, 19, 4]],
  [[0, 20, 6, -1], [6, 19, 2], [8, 17, 4], [12, 15, 4]],
  [[0, 17, 6, -2], [6, 15, 2], [8, 13, 4], [12, 12, 4]],
  [[0, 19, 4], [4, 23, 4, -1], [8, 24, 8, -3]],
];
const HYPER_LEAD_B: Riff4 = [
  [[0, 27, 3, -3], [3, 24, 3], [6, 22, 2], [8, 24, 8, -2]],
  [[0, 25, 3, -2], [3, 24, 3], [6, 20, 2], [8, 19, 8, -1]],
  [[0, 22, 3, -2], [3, 20, 3], [6, 17, 2], [8, 15, 4], [12, 17, 4]],
  [[0, 19, 6, -2], [6, 23, 2], [8, 24, 8, -5]],
];

// ---------------------------------------------------------------- slowed / fall pads
const CSM_DRONE = [37, 44, 49, 56] as const;

const MAN_PADS: readonly (readonly number[])[] = [
  [53, 56, 60, 63],
  [53, 56, 60, 63],
  [53, 56, 61, 65],
  [52, 55, 60, 64],
];

// ---------------------------------------------------------------- helpers

function humanize(rng: Rng, vel: number, amount = 0.05): number {
  return Math.max(0.05, Math.min(1, vel + (rng() * 2 - 1) * amount));
}

/** Parses a 16-char drum string: X accent, x normal, o soft, g ghost. */
function drum(out: NoteEvent[], inst: Inst, pattern: string, vel: number, rng: Rng, extra?: Partial<NoteEvent>): void {
  for (let i = 0; i < 16 && i < pattern.length; i++) {
    const ch = pattern[i];
    let v: number;
    if (ch === 'X') v = 1;
    else if (ch === 'x') v = 0.8;
    else if (ch === 'o') v = 0.55;
    else if (ch === 'g') v = 0.32;
    else continue;
    out.push({ inst, step: i, vel: humanize(rng, v * vel, inst === 'hat' ? 0.12 : 0.03), ...extra });
  }
}

function riffNotes(
  out: NoteEvent[],
  riff: Riff,
  root: number,
  vel: number,
  rng: Rng,
  opts: { only?: (step: number) => boolean; layer?: number; transpose?: number; inst?: Inst; accent?: boolean } = {},
): void {
  const inst = opts.inst ?? 'cowbell';
  for (const [step, semi, len, bend] of riff) {
    if (opts.only && !opts.only(step)) continue;
    const accent = opts.accent !== false && (step % 4 === 0 || step === 3 || step === 6 || step === 11) ? 1 : 0.86;
    out.push({
      inst,
      step,
      vel: humanize(rng, vel * accent, 0.04),
      note: root + semi + (opts.transpose ?? 0),
      len: len ?? 2,
      bend,
      layer: opts.layer ?? 0,
      pan: inst === 'cowbell' ? (step % 2 === 0 ? -0.22 : 0.22) : 0,
    });
  }
}

function chant(out: NoteEvent[], step: number, id: string, len: number, vel: number, rate = 1): void {
  out.push({ inst: 'chant', step, vel, chant: id, len, rate });
}

/** "va-va-VAI": stuttered chop on consecutive 16ths. */
function stutter(out: NoteEvent[], step: number, id: string, count: number, vel: number, rate = 1, rise = 0.03): void {
  for (let k = 0; k < count; k++) {
    const last = k === count - 1;
    chant(out, step + k, id, last ? 2.5 : 0.6, vel * (last ? 1 : 0.85), rate * (1 + rise * k));
  }
}

function hatRoll(out: NoteEvent[], from: number, toStep: number, div: number, vel: number, rising = true): void {
  const n = Math.round((toStep - from) * div);
  for (let k = 0; k < n; k++) {
    const v = rising ? vel * (0.55 + 0.45 * (k / Math.max(1, n - 1))) : vel;
    out.push({ inst: 'hat', step: from + k / div, vel: v, variant: k % 3 });
  }
}

function snareRoll(out: NoteEvent[], from: number, toStep: number, div: number, v0: number, v1: number, inst: Inst = 'snare'): void {
  const n = Math.round((toStep - from) * div);
  for (let k = 0; k < n; k++) {
    const jitter = 0.9 + 0.1 * (((k * 7919 + 13) % 11) / 10); // deterministic humanize
    out.push({ inst, step: from + k / div, vel: (v0 + (v1 - v0) * (k / Math.max(1, n - 1))) * jitter });
  }
}

// ---------------------------------------------------------------- entry effects

function entryEffects(out: NoteEvent[], c: BarContext, def: SectionDef): void {
  if (c.bar !== 0) return;
  const afterFall = c.prev === 'fall';
  if (afterFall) {
    out.push({ inst: 'impact', step: 0, vel: 1 });
    out.push({ inst: 'subDrop', step: 0, vel: 0.9 });
    out.push({ inst: 'crash', step: 0, vel: 0.9 });
    return;
  }
  switch (def.entry) {
    case 'drop':
      out.push({ inst: 'crash', step: 0, vel: 1.35 });
      out.push({ inst: 'impact', step: 0, vel: 0.9 });
      out.push({ inst: 'subDrop', step: 0, vel: 0.85 });
      out.push({ inst: 'revCrash', step: 0, vel: 0.75, len: 8, endAligned: true });
      if (c.prev && SECTIONS[c.prev].part !== 'build') {
        // a riser + a pitch-rising snare roll on beat 3, then the hard silent beat 4, then BOOM
        out.push({ inst: 'riser', step: 0, vel: 0.7, len: 16, endAligned: true });
        for (let k = 0; k < 8; k++) out.push({ inst: 'snare', step: -8 + k * 0.5, vel: 0.35 + 0.07 * k, rate: Math.pow(2, (k * 1) / 12), pickup: true });
      }
      if (def.style === 'mandelao' || def.style === 'drift') chant(out, 0, 'ch_hey', 3, 0.9);
      if (def.style === 'hyper') chant(out, 0, 'ch_go', 3, 0.85, 0.94);
      break;
    case 'crash':
      if (c.prev) out.push({ inst: 'crash', step: 0, vel: 0.72 });
      break;
    case 'impact':
      out.push({ inst: 'impact', step: 0, vel: 0.8 });
      out.push({ inst: 'revCrash', step: 0, vel: 0.6, len: 8, endAligned: true });
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- mandelão

function mandelaoBar(c: BarContext, def: SectionDef, rng: Rng, out: NoteEvent[]): void {
  const key = KEYS[def.key];
  const pos = c.bar % 4;
  const phrase = Math.floor(c.bar / 4);
  const part = def.part;
  const drop = part === 'drop';
  const h = Math.min(4, c.hype + (drop ? 2 : 0));
  const bassRoot = key.bass + MAN_BASS_ROOTS[pos];
  const nextRoot = key.bass + MAN_BASS_ROOTS[(pos + 1) % 4];
  const riff = (phrase % 2 === 0 ? MAN_RIFF_A : MAN_RIFF_B)[pos];
  const len = c.length ?? def.defaultBars;
  const fill = pos === 3;
  const bigFill = c.bar % 8 === 7;

  if (part === 'intro') {
    // Filtered teaser: muffled quarter kicks, the cowbell riff creeping in, riser into bar 1.
    const last = c.bar % len === len - 1;
    drum(out, 'kick', last ? 'X...X...X...X...' : 'X.......X.......', 0.75, rng);
    if (c.bar % len === 0) out.push({ inst: 'riser', step: 0, vel: 0.85, len: len * 16 });
    const strong = (s: number) => s === 0 || s === 3 || s === 6;
    riffNotes(out, riff, key.root, 0.62, rng, { only: c.bar % len < Math.max(1, len - 2) ? strong : undefined });
    if (c.bar % len >= len - 2) drum(out, 'hat', '..x...x...x...x.', 0.45, rng);
    if (last) {
      snareRoll(out, 8, 16, 2, 0.25, 0.85, 'clap');
      chant(out, 14, 'ch_vai', 2, 0.7);
    }
    if (c.bar % 2 === 0) out.push({ inst: 'pad', step: 0, vel: 0.5, notes: [...MAN_PADS[pos]], len: 32 });
    return;
  }

  if (part === 'breakdown') {
    // Half-time menace: long sliding 808s, chops, sparse bells.
    drum(out, 'kick', c.bar % 2 === 0 ? 'X.........x.....' : 'X.....x...x.....', 1, rng);
    drum(out, 'clap', '........X.......', 0.95, rng);
    if (h >= 1) drum(out, 'hat', 'o...o...o...o.o.', 0.5, rng);
    if (h >= 2) drum(out, 'perc', '..o..o.....o..o.', 0.6, rng, { variant: 1 });
    const slides = [bassRoot, bassRoot + 3, bassRoot + 1, bassRoot];
    out.push({ inst: 'bass', step: 0, vel: 1, note: bassRoot, len: 7, slide: slides[(c.bar + 1) % 4], bend: 5 });
    out.push({ inst: 'bass', step: 10, vel: 0.9, note: bassRoot + 12, len: 6, slide: nextRoot });
    chant(out, 0, 'ch_ha', 3, 0.85, 0.84);
    chant(out, 6, 'ch_rvi', 3, 0.7, 0.9);
    if (c.bar % 2 === 1) stutter(out, 12, 'ch_vai', 3, 0.8, 0.86);
    if (c.bar % 2 === 0) riffNotes(out, riff, key.root, 0.5, rng, { only: (s) => s === 0 || s === 6 });
    if (h >= 1 && c.bar % 2 === 0) out.push({ inst: 'pad', step: 0, vel: 0.6, notes: [...MAN_PADS[pos]], len: 32 });
    if (fill) snareRoll(out, 12, 16, 2, 0.3, 0.7);
    return;
  }

  if (part === 'build') {
    // Snare roll accelerating, kick on quarters fading out, riser over the build.
    const k = c.bar % len;
    const progress = (k + 1) / len;
    if (k === 0) out.push({ inst: 'riser', step: 0, vel: 1, len: len * 16 });
    const div = progress <= 0.25 ? 0.25 : progress <= 0.5 ? 0.5 : progress <= 0.75 ? 1 : 2;
    const before = out.length;
    snareRoll(out, 0, 16, div, 0.25 + 0.4 * Math.pow(progress, 2), 0.3 + 0.65 * Math.pow(progress, 1.5), 'snare');
    if (progress > 0.5) snareRoll(out, 0, 16, div, 0.2 + 0.3 * progress, 0.3 + 0.5 * progress, 'clap');
    // the roll climbs up to +7 semitones across the build
    for (let i = before; i < out.length; i++) {
      const u = (k + out[i].step / 16) / len;
      out[i].rate = Math.pow(2, (7 * u) / 12);
    }
    if (k < len - 1) {
      drum(out, 'kick', 'X...X...X...X...', 0.9, rng);
      out.push({ inst: 'bass', step: 0, vel: 0.85, note: bassRoot, len: 8 });
      out.push({ inst: 'bass', step: 8, vel: 0.8, note: bassRoot, len: 8, slide: bassRoot + (k === len - 2 ? 12 : 0) });
    } else {
      drum(out, 'kick', 'X.......X.......', 0.8, rng);
      chant(out, 12, 'ch_go', 3, 0.9);
    }
    riffNotes(out, riff, key.root, 0.6 + 0.3 * progress, rng);
    drum(out, 'hat', 'x.x.x.x.x.x.x.x.', 0.35 + 0.35 * progress, rng);
    return;
  }

  // ---- verse / drop: the tamborzão groove — kick on 1, 2-and, 3-and; claps on 2 and 4
  let kicks = 'X.....X...X.....';
  if (h >= 2) kicks = 'X.....X...X...x.';
  if (drop && h >= 3) kicks = 'X..o..X...X...x.';
  drum(out, 'kick', kicks, 1, rng);
  drum(out, 'clap', '....X.......X...', 1, rng);
  if (drop) drum(out, 'snare', '....x.......x...', 0.75, rng);
  if (h >= 1) drum(out, 'hat', h >= 3 ? 'gxgxgxgxgxgxgxgx' : '..x...x...x...x.', drop ? 0.8 : 0.7, rng);
  if (h >= 2) drum(out, 'perc', drop ? '.xx..x.x.xx..x.x' : '..x..x.x..x..x.x', 0.62, rng, { variant: 0 });
  if (h >= 2) {
    // give the tamborzão toms their pitch contour (hi-mid-lo)
    const toms = out.filter((e) => e.inst === 'perc');
    toms.forEach((e, i) => (e.variant = [2, 1, 0][i % 3]));
  }
  if (drop && h >= 3) drum(out, 'ohat', '......o.......o.', 0.6, rng);

  // 808 "Brazilian bass": locked to the kicks, octave dives on the 1, pops and slides
  const pops = h >= 2 || drop;
  const firstDrop = drop && c.bar === 0;
  const bassHits: [number, number, number, number?, number?][] = [
    [0, bassRoot, 6, undefined, firstDrop ? 19 : drop ? 12 : 7],
    [6, pops ? bassRoot + 12 : bassRoot, 4, pops ? bassRoot : undefined],
    [10, bassRoot, 4, undefined, drop ? 5 : undefined],
    [14, nextRoot === bassRoot ? bassRoot + 12 : bassRoot, 2, nextRoot],
  ];
  if (drop && h >= 3) bassHits.splice(1, 0, [3, bassRoot, 3]);
  if (chance(rng, drop ? 0.5 : 0.3)) bassHits[bassHits.length - 2] = [10, bassRoot + 7, 4, bassRoot];
  for (const [step, note, l, slide, bend] of bassHits) out.push({ inst: 'bass', step, vel: step === 0 ? 1 : 0.9, note, len: l, slide, bend });

  // Cowbell riff (reduced to the 3-3-2 accents at low hype)
  const strong = (s: number) => s === 0 || s === 3 || s === 6 || s === 8 || s === 11 || s === 14;
  riffNotes(out, riff, key.root, drop ? 0.95 : 0.85, rng, { only: h >= 1 ? undefined : strong });
  if (drop && h >= 3) riffNotes(out, riff, key.root, 0.45, rng, { transpose: -12, layer: 1, only: strong });

  if (h >= 3 && c.bar % 2 === 0) out.push({ inst: 'pad', step: 0, vel: drop ? 0.55 : 0.45, notes: [...MAN_PADS[pos]], len: 32 });

  // Chants
  if (drop) {
    if (c.bar % 2 === 0 && c.bar > 0) chant(out, 0, 'ch_hey', 3, 0.85);
    if (pos === 1) stutter(out, 12, 'ch_vai', 3, 0.85);
    if (pos === 3) {
      chant(out, 6, 'ch_toma', 4, 0.8);
      chant(out, 14, 'ch_ha', 2, 0.75, 1.06);
    }
    if (h >= 4 && pos === 2) chant(out, 8, 'ch_rvi', 4, 0.75, 0.9);
  } else if (h >= 3 && pos === 3) chant(out, 12, 'ch_hey', 3, 0.75);
  if (h >= 4 && !drop && pos === 1) stutter(out, 13, 'ch_vai', 3, 0.7);

  // Fills & phrase markers
  if (fill && drop) {
    // cowbell 32nd-note roll with an octave jump into the next phrase
    const last = riff[riff.length - 1];
    const n0 = key.root + (last ? last[1] : 12);
    [14, 14.5, 15, 15.5].forEach((st, k) => out.push({ inst: 'cowbell', step: st, vel: 0.55 + 0.1 * k, note: n0 + (k >= 2 ? 12 : 0), len: 0.5, pan: k % 2 ? 0.3 : -0.3 }));
  }
  if (fill) {
    const kind = Math.floor(rng() * 3);
    if (bigFill) {
      snareRoll(out, 12, 16, 4, 0.35, 0.95);
      if (drop || h >= 2) drum(out, 'perc', '............xxxx', 0.8, rng, { variant: 2 });
    } else if (kind === 0) snareRoll(out, 12, 16, 1, 0.4, 0.85);
    else if (kind === 1) drum(out, 'perc', '............x.xx', 0.75, rng, { variant: 1 });
    else drum(out, 'clap', '..............xx', 0.7, rng);
  }
  if (c.bar % 8 === 0 && c.bar > 0) {
    out.push({ inst: 'crash', step: 0, vel: drop ? 0.85 : 0.6 });
    out.push({ inst: 'revCrash', step: 0, vel: 0.5, len: 8, endAligned: true });
  } else if (drop && pos === 0 && c.bar > 0) out.push({ inst: 'crash', step: 0, vel: 0.55 });
}

// ---------------------------------------------------------------- drift

function driftBar(c: BarContext, def: SectionDef, rng: Rng, out: NoteEvent[]): void {
  const key = KEYS[def.key];
  const pos = c.bar % 4;
  const phrase = Math.floor(c.bar / 4);
  const part = def.part;
  const drop = part === 'drop';
  const h = Math.min(4, c.hype + (drop ? 2 : 0));
  const root = key.bass + DRIFT_BASS_ROOTS[pos];
  const nextRoot = key.bass + DRIFT_BASS_ROOTS[(pos + 1) % 4];
  const riff = (phrase % 2 === 0 || part === 'menu' || part === 'outro' ? DRIFT_RIFF_A : DRIFT_RIFF_B)[pos];
  const fill = pos === 3;
  const pad = DRIFT_PADS[pos];

  if (part === 'menu') {
    out.push({ inst: 'pad', step: 0, vel: 0.8, notes: [...pad], len: 16 });
    out.push({ inst: 'bass', step: 0, vel: 0.55, note: root, len: 12, slide: c.bar % 2 === 1 ? nextRoot : undefined });
    riffNotes(out, riff, key.root, 0.55, rng, { only: (s) => s === 0 || s === 3 || s === 6 || (pos === 3 && s >= 12) });
    drum(out, 'hat', '..o...o...o...o.', 0.35, rng);
    if (c.bar % 2 === 1) drum(out, 'rim', '........o.......', 0.6, rng);
    return;
  }

  if (part === 'outro') {
    // lo-fi results loop
    drum(out, 'kick', c.bar % 2 === 0 ? 'x.....o...x.....' : 'x..o......x.....', 0.75, rng);
    drum(out, 'snare', '........x.......', 0.7, rng);
    drum(out, 'hat', 'o.g.o.g.o.g.o.g.', 0.45, rng);
    out.push({ inst: 'pad', step: 0, vel: 0.5, notes: [...pad], len: 16 });
    out.push({ inst: 'bass', step: 0, vel: 0.65, note: root, len: 6 });
    out.push({ inst: 'bass', step: 10, vel: 0.55, note: root, len: 6, slide: nextRoot });
    riffNotes(out, riff, key.root, 0.5, rng);
    if (fill) drum(out, 'rim', '............o.o.', 0.6, rng);
    return;
  }

  // ---- verse / drop
  const kickA = drop ? 'X.....X.X.X..x..' : 'X.....X...X.....';
  const kickB = drop ? 'X..X..X...X..xx.' : 'X..X......X..x..';
  drum(out, 'kick', c.bar % 2 === 0 ? kickA : kickB, 1, rng);
  drum(out, 'snare', '........X.......', 1, rng);
  drum(out, 'clap', '........X.......', drop ? 0.85 : 0.6, rng);
  if (h >= 2 && chance(rng, 0.35)) drum(out, 'snare', '...............g', 1, rng);

  // rolling hats: 8ths/16ths + triplet rolls at the end of the bar (accent shape varies per bar)
  const hatShapes = h >= 3 ? ['xgxgxgxgxgxgxgxg', 'xgogxgxgxgogxgxg', 'xgxgogxgxgxgogxg'] : ['x.x.x.x.x.x.x.x.', 'x.o.x.x.x.o.x.x.', 'x.x.o.x.x.x.o.x.'];
  const hats = hatShapes[Math.floor(rng() * hatShapes.length)];
  const rollHere = drop || c.bar % 2 === 1 || h >= 4;
  const hatStr = rollHere ? hats.slice(0, 12) + '....' : hats;
  drum(out, 'hat', hatStr, h >= 1 ? 0.75 : 0.55, rng);
  if (rollHere) {
    if (chance(rng, 0.5)) hatRoll(out, 12, 16, 1.5, 0.7); // 16th triplets
    else {
      hatRoll(out, 12, 14, 1, 0.65, false);
      hatRoll(out, 14, 16, 3, 0.7); // 32nd triplets
    }
  }
  if (h >= 3 && c.bar % 2 === 0) drum(out, 'ohat', '..............o.', 0.6, rng);

  // sliding 808
  if (c.bar % 2 === 0) {
    out.push({ inst: 'bass', step: 0, vel: 1, note: root, len: 6, bend: drop && c.bar === 0 ? 19 : drop ? 12 : 7 });
    out.push({ inst: 'bass', step: 6, vel: 0.85, note: root, len: 2 });
    out.push({ inst: 'bass', step: 8, vel: 0.9, note: root + 12, len: 2, slide: root });
    out.push({ inst: 'bass', step: 10, vel: 0.9, note: root, len: 4 });
    out.push({ inst: 'bass', step: 14, vel: 0.85, note: root + 7, len: 2, slide: nextRoot });
  } else {
    out.push({ inst: 'bass', step: 0, vel: 1, note: root, len: 7, bend: drop ? 12 : 0 });
    out.push({ inst: 'bass', step: 7, vel: 0.85, note: root, len: 3 });
    out.push({ inst: 'bass', step: 10, vel: 0.9, note: root + 12, len: 3, slide: root + 7 });
    out.push({ inst: 'bass', step: 13, vel: 0.85, note: root + 7, len: 3, slide: nextRoot });
  }

  // the iconic cowbell lead
  riffNotes(out, riff, key.root, drop ? 0.95 : 0.85, rng, { only: h >= 1 ? undefined : (s) => s % 2 === 0 || s === 3 });
  if (drop) riffNotes(out, riff, key.root, 0.42, rng, { transpose: -12, layer: 1 });

  if (h >= 1) out.push({ inst: 'pad', step: 0, vel: drop ? 0.55 : 0.5, notes: [...pad], len: 16 });

  if (drop) {
    if (pos === 0 && c.bar > 0) chant(out, 0, 'ch_go', 3, 0.85);
    if (pos === 2) chant(out, 8, 'ch_hey', 3, 0.8, 0.92);
    if (pos === 3) stutter(out, 12, 'ch_ha', 4, 0.8, 1, 0.04);
  } else if (h >= 3 && pos === 3) chant(out, 12, 'ch_hey', 3, 0.7);
  if (h >= 4 && !drop && pos === 1) chant(out, 8, 'ch_go', 3, 0.7);

  if (fill) {
    if (c.bar % 8 === 7) snareRoll(out, 12, 16, 3, 0.3, 0.9);
    else if (chance(rng, 0.5)) drum(out, 'snare', '............o.xo', 1, rng);
    else drum(out, 'kick', '.............xx.', 0.8, rng);
  }
  if (c.bar % 8 === 0 && c.bar > 0) {
    out.push({ inst: 'crash', step: 0, vel: drop ? 0.8 : 0.6 });
    out.push({ inst: 'revCrash', step: 0, vel: 0.45, len: 8, endAligned: true });
  } else if (drop && pos === 0 && c.bar > 0) out.push({ inst: 'crash', step: 0, vel: 0.5 });
}

// ---------------------------------------------------------------- hyper

function hyperBar(c: BarContext, def: SectionDef, rng: Rng, out: NoteEvent[]): void {
  const key = KEYS[def.key];
  const pos = c.bar % 4;
  const phrase = Math.floor(c.bar / 4);
  const drop = def.part === 'drop';
  const h = Math.min(4, c.hype + (drop ? 2 : 0));
  const root = key.bass + HYPER_BASS_ROOTS[pos];
  const nextRoot = key.bass + HYPER_BASS_ROOTS[(pos + 1) % 4];
  const fill = pos === 3;

  if (def.part === 'finale') {
    finaleBar(c, def, out);
    return;
  }

  // distorted kick
  let kick = 'X...X...X...X...';
  if (h >= 1) kick = 'X...X...X.x.X...';
  if (h >= 3) kick = 'X..xX...X.x.X..x';
  if (drop && h >= 4) kick = 'X..xX..xX.x.X.xx';
  drum(out, 'kick', kick, 1, rng);
  drum(out, 'clap', '....X.......X...', 1, rng);
  drum(out, 'snare', '....x.......x...', drop ? 0.9 : 0.7, rng);

  // double-time hats + 32nd rolls
  const rolls = drop || c.bar % 2 === 1;
  drum(out, 'hat', rolls ? 'XoxoXoxoXoxoXo..' : 'XoxoXoxoXoxoXoxo', 0.8, rng);
  if (rolls) {
    const from = out.length;
    hatRoll(out, 14, 16, h >= 3 ? 4 : 2, 0.8);
    for (let i = from; i < out.length; i++) out[i].rate = 1.25 - 0.35 * ((i - from) / Math.max(1, out.length - from - 1));
  }
  if (h >= 2) drum(out, 'ohat', '..o...o...o...o.', 0.45, rng);
  if (h >= 3) drum(out, 'perc', '.x...x.x.x...x.x', 0.5, rng, { variant: 2 });

  // 808 with dives
  out.push({ inst: 'bass', step: 0, vel: 1, note: root, len: 3, bend: drop && c.bar === 0 ? 19 : 12 });
  out.push({ inst: 'bass', step: 3, vel: 0.85, note: root, len: 3 });
  out.push({ inst: 'bass', step: 6, vel: 0.9, note: root + 12, len: 2, slide: root });
  out.push({ inst: 'bass', step: 8, vel: 0.95, note: root, len: 3, bend: 7 });
  out.push({ inst: 'bass', step: 11, vel: 0.85, note: root, len: 3 });
  out.push({ inst: 'bass', step: 14, vel: 0.9, note: root + 7, len: 2, slide: nextRoot });

  // fast cowbell ostinato
  if (h >= 1 || drop) riffNotes(out, HYPER_BELL[pos], key.root, drop ? 0.8 : 0.7, rng, { accent: true });
  else riffNotes(out, HYPER_BELL[pos], key.root, 0.65, rng, { only: (s) => s % 2 === 0 });

  // screeching lead
  if (h >= 2 || drop) {
    const lead = (phrase % 2 === 0 ? HYPER_LEAD : HYPER_LEAD_B)[pos];
    riffNotes(out, lead, key.root, drop ? 0.9 : 0.75, rng, { inst: 'lead', accent: false });
  }
  if (h >= 3) out.push({ inst: 'pad', step: 0, vel: 0.45, notes: [...HYPER_PADS[pos]], len: 16 });

  if (drop) {
    if (pos === 0 && c.bar > 0) chant(out, 0, 'ch_kill', 4, 0.9, 0.95);
    if (pos === 2) chant(out, 0, 'ch_blood', 4, 0.85, 0.92);
    if (pos === 3) stutter(out, 12, 'ch_go', 4, 0.85, 0.95, 0.05);
  } else if (h >= 3 && pos === 3) stutter(out, 13, 'ch_go', 3, 0.7, 0.95);

  if (h >= 3 && c.bar % 8 === 0) out.push({ inst: 'subDrop', step: 0, vel: 0.7 });
  if (fill) {
    if (c.bar % 8 === 7) snareRoll(out, 8, 16, 4, 0.3, 1);
    else snareRoll(out, 12, 16, 2, 0.4, 0.9);
  }
  if (c.bar % 8 === 0 && c.bar > 0) {
    out.push({ inst: 'crash', step: 0, vel: 0.85 });
    out.push({ inst: 'revCrash', step: 0, vel: 0.5, len: 8, endAligned: true });
  } else if (drop && pos === 0 && c.bar > 0) out.push({ inst: 'crash', step: 0, vel: 0.5 });
}

function finaleBar(c: BarContext, def: SectionDef, out: NoteEvent[]): void {
  const key = KEYS[def.key];
  if (c.bar === 0) {
    out.push({ inst: 'impact', step: 0, vel: 1 });
    out.push({ inst: 'crash', step: 0, vel: 1 });
    out.push({ inst: 'subDrop', step: 0, vel: 1 });
    out.push({ inst: 'revCrash', step: 0, vel: 0.8, len: 12, endAligned: true });
    out.push({ inst: 'pad', step: 0, vel: 0.65, notes: [53, 56, 60, 65], len: 64 });
    out.push({ inst: 'bass', step: 0, vel: 0.9, note: key.bass, len: 24 });
  }
  const echoes: Record<number, [number, number, number][]> = {
    0: [
      [4, 24, 0.55],
      [10, 19, 0.45],
    ],
    1: [
      [2, 22, 0.36],
      [8, 19, 0.3],
    ],
    2: [[6, 17, 0.22]],
    3: [[0, 12, 0.16]],
  };
  for (const [step, semi, vel] of echoes[c.bar] ?? []) out.push({ inst: 'cowbell', step, vel, note: key.root + semi, len: 2, pan: step % 4 === 0 ? -0.5 : 0.5 });
}

// ---------------------------------------------------------------- slowed + reverb

function slowedBar(c: BarContext, def: SectionDef, rng: Rng, out: NoteEvent[]): void {
  const key = KEYS[def.key];
  const exec = def.part === 'execution';
  // "slowed + reverb": the boss riff at half speed, a major third down (≈0.8× — F minor → C# minor), drowned in the hall
  const shift = key.root - KEYS.Fm.root;
  const half = Math.floor(c.bar / 2); // one riff bar spans two bars
  const pos = half % 4;
  const second = c.bar % 2 === 1;
  const root = key.bass + HYPER_BASS_ROOTS[pos];
  // heartbeat kick on the half-time 1 (and 3 when tense)
  out.push({ inst: 'heart', step: 0, vel: 1 });
  out.push({ inst: 'heart', step: 1.5, vel: 0.62 });
  if (exec || c.hype >= 2) {
    out.push({ inst: 'heart', step: 8, vel: 0.9 });
    out.push({ inst: 'heart', step: 9.5, vel: 0.55 });
  }
  // half-time clap on the second bar's 1 (= beat 3 of the slowed bar), huge reverb
  if (!exec && second) out.push({ inst: 'clap', step: 0, vel: 0.75 });
  if (!exec && c.hype >= 2 && second) out.push({ inst: 'snare', step: 0, vel: 0.5 });
  // 808: long, decaying, pitched down, sliding to the next root
  if (!second) {
    const nextRoot = key.bass + HYPER_BASS_ROOTS[(pos + 1) % 4];
    out.push({ inst: 'bass', step: 0, vel: 0.8, note: root, len: 20, slide: nextRoot });
    out.push({ inst: 'pad', step: 0, vel: exec ? 0.7 : 0.6, notes: HYPER_PADS[pos].map((n) => n + shift), len: 32 });
  }
  // the riff, half speed: riff steps 0-7 on the first bar, 8-15 on the second, each 16th → an 8th
  const riff = HYPER_BELL[pos];
  for (const [step, semi] of riff) {
    if (second ? step < 8 : step >= 8) continue;
    const local = (step - (second ? 8 : 0)) * 2;
    if (exec && step % 2 === 1) continue; // execution: sparser, muffled by the section filter
    if (step % 2 === 1 && c.hype < 1) continue;
    out.push({ inst: 'cowbell', step: local, vel: (step % 4 === 0 ? 0.75 : 0.55) * (exec ? 1.1 : 1), note: key.root + semi, len: 2, pan: local % 4 === 0 ? -0.4 : 0.4 });
  }
  if (c.bar > 0 && c.bar % 4 === 0) out.push({ inst: 'swell', step: 0, vel: 0.55, len: 20, endAligned: true });
  if (!exec && c.hype >= 3 && c.bar % 4 === 3) chant(out, 8, 'ch_blood', 6, 0.55, 0.8);
  if (chance(rng, 0.25) && !exec) out.push({ inst: 'rim', step: 12, vel: 0.25 });
}

// ---------------------------------------------------------------- fall (transition)

function fallBar(c: BarContext, def: SectionDef, out: NoteEvent[]): void {
  const len = c.length ?? def.defaultBars;
  const k = c.bar % len;
  if (k === 0) {
    out.push({ inst: 'riser', step: 0, vel: 1, len: len * 16 });
    out.push({ inst: 'downlifter', step: 0, vel: 0.8 });
  }
  if (c.bar % 2 === 0) out.push({ inst: 'pad', step: 0, vel: 0.5, notes: [...CSM_DRONE], len: 32 });
  if (c.bar > 0 && c.bar % 2 === 0) out.push({ inst: 'swell', step: 0, vel: 0.6, len: 16, endAligned: true });
}

// ---------------------------------------------------------------- entry point

const STYLE_FN: Record<StyleId, (c: BarContext, def: SectionDef, rng: Rng, out: NoteEvent[]) => void> = {
  mandelao: mandelaoBar,
  drift: driftBar,
  hyper: hyperBar,
  slowed: slowedBar,
  none: (c, def, _rng, out) => fallBar(c, def, out),
};

/** Generates one bar. Events are sorted by step; all steps are in [0, 16). */
export function generateBar(c: BarContext): NoteEvent[] {
  const def = SECTIONS[c.section];
  const hype = Math.max(0, Math.min(4, Math.round(c.hype)));
  const ctx: BarContext = { ...c, hype, length: sectionLength(c.section, c.length) };
  const rng = rngFor(c.seed, c.section, c.bar, hype);
  const out: NoteEvent[] = [];
  entryEffects(out, ctx, def);
  STYLE_FN[def.style](ctx, def, rng, out);
  for (const e of out) if (!e.pickup) e.step = Math.max(0, Math.min(15.999, e.step));
  out.sort((a, b) => a.step - b.step);
  return out;
}

/** Part of a section (exposed for the engine & tests). */
export function partOf(id: SectionId): Part {
  return SECTIONS[id].part;
}

/** For tests: true when the section never has hard drums (kick/snare/clap). */
export function isDrumless(id: SectionId): boolean {
  const p = SECTIONS[id].part;
  return p === 'menu' || p === 'fall' || p === 'finale';
}

