import type { Profile } from './shapes';
import type { Body } from './skeleton';

/**
 * Character designs: proportions, muscle/clothing profiles, outfit pieces and weapons.
 * All original designs. Units: an adult is ~100 tall.
 */

export type CharId = 'hero' | 'thug' | 'brute' | 'ninja' | 'duelist' | 'leaper' | 'crawler' | 'gunner' | 'butcher' | 'verdict' | 'cleaner' | 'fox' | 'ronin';

export type WeaponId = 'katana' | 'machete' | 'bat' | 'pipe' | 'knife' | 'hammer' | 'tanto' | 'naginata' | 'claws' | 'rifle' | 'chainsaw' | 'cleaver' | 'pistol' | 'sickle' | 'nodachi' | 'none';

export type HeadwearId = 'hairSpikes' | 'hood' | 'cap' | 'bandana' | 'gasMask' | 'helmet' | 'ninjaHood' | 'mask' | 'dreads' | 'bald' | 'soldier' | 'pigMask' | 'kabuto' | 'slick' | 'foxMask' | 'kasa';

export type TorsoWear = 'coat' | 'hoodie' | 'vest' | 'armor' | 'gi' | 'rags' | 'tactical' | 'apron' | 'plate' | 'suit' | 'kimono';

export type ClothId = 'coatSkirt' | 'scarf' | 'cape' | 'sash' | 'ponytail' | 'ninjaTails' | 'apronFlap' | 'robe' | 'tie' | 'kimonoSleeve' | 'rags';

export interface CharSpec {
  id: CharId;
  body: Body;
  /** Overall size (1 = hero). */
  scale: number;
  torso: Profile;
  neck: Profile;
  upperArm: Profile;
  forearm: Profile;
  thigh: Profile;
  shin: Profile;
  headR: number;
  /** Head silhouette in head-local units (x forward, y up). */
  head: [number, number][];
  headwear: HeadwearId;
  torsoWear: TorsoWear;
  cloth: ClothId[];
  weapon: WeaponId;
  /** Off-hand weapon (dual wield). */
  offhand?: WeaponId;
  eyes: { color: number; kind: 'slit' | 'dots' | 'visor' | 'mask' | 'glasses' | 'none' };
  /** Accent color for scarves, masks, ties. */
  accent: number;
  /** Second accent (mask paint, shirt). */
  accent2?: number;
  fist: boolean;
}

// ------------------------------------------------------------------ bodies

const HERO_BODY: Body = {
  spineLow: 12,
  spineHigh: 13,
  chestToNeck: 5,
  neck: 4.5,
  headR: 6.4,
  upperArm: 16,
  forearm: 14.5,
  hand: 7,
  thigh: 24,
  shin: 23.5,
  ankle: 4,
  foot: 10.5,
  shoulderFwd: 1.5,
  shoulderDown: 3,
  hipOff: 2,
  bladeLen: 46,
  handleLen: 10,
};

const scaleBody = (b: Body, k: Partial<Record<keyof Body, number>>): Body => {
  const out = { ...b };
  for (const [key, f] of Object.entries(k) as [keyof Body, number][]) out[key] = b[key] * f;
  return out;
};

// head silhouettes (x forward, y up), centered on the head joint
const FACE: [number, number][] = [
  [-6.6, 0.4],
  [-6.1, 3.8],
  [-3.9, 6.3],
  [-0.4, 7.3],
  [3.0, 6.5],
  [5.2, 4.3],
  [5.9, 2.5],
  [5.4, 1.6],
  [6.7, -0.6],
  [5.7, -1.4],
  [5.9, -2.6],
  [5.2, -3.4],
  [5.1, -4.6],
  [3.6, -5.7],
  [1.0, -5.3],
  [-1.6, -3.4],
  [-3.4, -3.6],
  [-5.4, -2.2],
];

const HEAVY_FACE: [number, number][] = [
  [-6.8, 0.6],
  [-6.4, 4.0],
  [-4.0, 6.6],
  [-0.2, 7.0],
  [3.4, 6.2],
  [5.6, 3.8],
  [6.2, 2.0],
  [6.8, -0.4],
  [6.2, -2.0],
  [6.4, -3.6],
  [5.6, -5.4],
  [2.6, -6.6],
  [-1.2, -5.6],
  [-3.6, -4.4],
  [-5.8, -2.6],
];

// ------------------------------------------------------------------ profiles

const HERO_TORSO: Profile = [
  [0, 9.0, 10.2],
  [0.12, 9.4, 10.8],
  [0.3, 8.0, 8.8],
  [0.5, 8.6, 8.4],
  [0.7, 9.8, 9.2],
  [0.86, 8.8, 9.2],
  [1, 4.6, 5.8],
];
const NECK: Profile = [
  [0, 3.1, 3.5],
  [1, 2.8, 3.0],
];
const HERO_UPPER: Profile = [
  [0, 4.9, 4.9],
  [0.2, 5.3, 4.9],
  [0.55, 4.4, 4.5],
  [1, 3.5, 3.5],
];
const HERO_FORE: Profile = [
  [0, 3.5, 3.6],
  [0.3, 3.9, 3.8],
  [0.85, 3.0, 3.1],
  [1, 2.7, 2.7],
];
const HERO_THIGH: Profile = [
  [0, 7.0, 7.4],
  [0.25, 7.5, 7.1],
  [0.65, 6.0, 5.8],
  [1, 4.4, 4.4],
];
const HERO_SHIN: Profile = [
  [0, 4.4, 4.5],
  [0.28, 4.1, 5.3],
  [0.52, 4.1, 4.7],
  [0.58, 4.5, 5.0],
  [1, 3.4, 3.7],
];

const THUG_TORSO: Profile = [
  [0, 9.8, 10.4],
  [0.25, 9.6, 9.8],
  [0.55, 10.2, 10.2],
  [0.8, 9.8, 10.6],
  [0.92, 8.4, 10.4],
  [1, 5.6, 7.6],
];
const BAGGY_THIGH: Profile = [
  [0, 7.8, 8.0],
  [0.5, 7.2, 7.2],
  [1, 6.0, 6.0],
];
const BAGGY_SHIN: Profile = [
  [0, 5.8, 5.8],
  [0.7, 5.2, 5.2],
  [1, 4.8, 4.8],
];
const THUG_UPPER: Profile = [
  [0, 5.4, 5.4],
  [0.5, 5.0, 5.0],
  [1, 4.0, 4.0],
];
const THUG_FORE: Profile = [
  [0, 4.0, 4.0],
  [0.8, 3.4, 3.4],
  [1, 2.8, 2.8],
];

const BIG_TORSO: Profile = [
  [0, 11.5, 12.5],
  [0.2, 12.5, 12.0],
  [0.45, 13.5, 12.0],
  [0.7, 13.0, 12.4],
  [0.88, 11.5, 13.0],
  [1, 7.0, 8.5],
];
const BIG_UPPER: Profile = [
  [0, 7.0, 7.0],
  [0.25, 7.6, 7.0],
  [0.6, 6.4, 6.6],
  [1, 5.0, 5.0],
];
const BIG_FORE: Profile = [
  [0, 5.2, 5.2],
  [0.3, 5.8, 5.6],
  [1, 3.8, 3.8],
];
const BIG_THIGH: Profile = [
  [0, 9.0, 9.4],
  [0.3, 9.4, 9.0],
  [1, 6.0, 6.0],
];
const BIG_SHIN: Profile = [
  [0, 6.0, 6.2],
  [0.3, 5.8, 7.0],
  [1, 4.6, 4.8],
];

const LEAN_TORSO: Profile = [
  [0, 8.0, 9.0],
  [0.3, 7.0, 7.6],
  [0.55, 7.6, 7.4],
  [0.75, 8.4, 8.0],
  [0.9, 7.6, 8.0],
  [1, 4.2, 5.0],
];
const LEAN_UPPER: Profile = [
  [0, 4.2, 4.2],
  [0.25, 4.5, 4.2],
  [1, 3.0, 3.0],
];
const LEAN_FORE: Profile = [
  [0, 3.0, 3.0],
  [0.3, 3.3, 3.2],
  [1, 2.3, 2.3],
];
const LEAN_THIGH: Profile = [
  [0, 6.2, 6.6],
  [0.3, 6.6, 6.2],
  [1, 4.0, 4.0],
];
const LEAN_SHIN: Profile = [
  [0, 4.0, 4.0],
  [0.3, 3.8, 4.8],
  [1, 2.8, 3.0],
];

const BELLY_TORSO: Profile = [
  [0, 12.0, 12.5],
  [0.25, 15.0, 12.0],
  [0.5, 16.0, 12.0],
  [0.72, 14.0, 12.5],
  [0.9, 11.5, 13.0],
  [1, 7.5, 8.5],
];

const ARMOR_TORSO: Profile = [
  [0, 12.0, 13.0],
  [0.15, 13.0, 13.5],
  [0.35, 12.0, 12.0],
  [0.6, 14.0, 12.5],
  [0.8, 14.5, 13.5],
  [0.92, 12.0, 13.5],
  [1, 7.5, 9.0],
];

const SUIT_TORSO: Profile = [
  [0, 8.8, 9.8],
  [0.3, 8.0, 8.4],
  [0.55, 8.6, 8.4],
  [0.75, 9.6, 9.2],
  [0.9, 9.0, 9.6],
  [1, 4.6, 5.6],
];

const ROBE_TORSO: Profile = [
  [0, 10.5, 11.0],
  [0.3, 9.4, 9.8],
  [0.6, 10.0, 9.8],
  [0.85, 9.8, 10.2],
  [1, 5.0, 6.0],
];
const WIDE_THIGH: Profile = [
  [0, 9.0, 9.0],
  [0.5, 9.5, 9.5],
  [1, 8.5, 8.5],
];
const WIDE_SHIN: Profile = [
  [0, 8.5, 8.5],
  [0.6, 8.0, 8.0],
  [1, 5.0, 5.0],
];

// ------------------------------------------------------------------ specs

export const SPECS: Record<CharId, CharSpec> = {
  hero: {
    id: 'hero',
    body: HERO_BODY,
    scale: 1,
    torso: HERO_TORSO,
    neck: NECK,
    upperArm: HERO_UPPER,
    forearm: HERO_FORE,
    thigh: HERO_THIGH,
    shin: HERO_SHIN,
    headR: 6.4,
    head: FACE,
    headwear: 'hairSpikes',
    torsoWear: 'coat',
    cloth: ['coatSkirt', 'scarf'],
    weapon: 'katana',
    eyes: { color: 0xeaf6ff, kind: 'slit' },
    accent: 0xb3121f,
    fist: true,
  },
  thug: {
    id: 'thug',
    body: scaleBody(HERO_BODY, { thigh: 0.98, shin: 0.98, headR: 1.03, bladeLen: 0.62 }),
    scale: 1,
    torso: THUG_TORSO,
    neck: NECK,
    upperArm: THUG_UPPER,
    forearm: THUG_FORE,
    thigh: BAGGY_THIGH,
    shin: BAGGY_SHIN,
    headR: 6.6,
    head: FACE,
    headwear: 'hood',
    torsoWear: 'hoodie',
    cloth: [],
    weapon: 'machete',
    eyes: { color: 0xff2a3a, kind: 'dots' },
    accent: 0x6a0d14,
    fist: true,
  },
  brute: {
    id: 'brute',
    body: scaleBody(HERO_BODY, { upperArm: 1.05, forearm: 1.05, headR: 1.1, bladeLen: 0.72, handleLen: 0.9 }),
    scale: 1.28,
    torso: BIG_TORSO,
    neck: [
      [0, 5.0, 5.4],
      [1, 4.6, 4.8],
    ],
    upperArm: BIG_UPPER,
    forearm: BIG_FORE,
    thigh: BIG_THIGH,
    shin: BIG_SHIN,
    headR: 7,
    head: HEAVY_FACE,
    headwear: 'helmet',
    torsoWear: 'armor',
    cloth: ['rags'],
    weapon: 'hammer',
    eyes: { color: 0xff3b2a, kind: 'visor' },
    accent: 0x5a0c10,
    fist: true,
  },
  ninja: {
    id: 'ninja',
    body: scaleBody(HERO_BODY, { bladeLen: 0.42, handleLen: 0.6 }),
    scale: 0.96,
    torso: LEAN_TORSO,
    neck: NECK,
    upperArm: LEAN_UPPER,
    forearm: LEAN_FORE,
    thigh: LEAN_THIGH,
    shin: LEAN_SHIN,
    headR: 6.2,
    head: FACE,
    headwear: 'ninjaHood',
    torsoWear: 'gi',
    cloth: ['ninjaTails'],
    weapon: 'tanto',
    offhand: 'tanto',
    eyes: { color: 0xf2f6ff, kind: 'slit' },
    accent: 0x1a1a22,
    fist: true,
  },
  duelist: {
    id: 'duelist',
    body: scaleBody(HERO_BODY, { bladeLen: 1.25, handleLen: 4.2 }),
    scale: 1.04,
    torso: SUIT_TORSO,
    neck: NECK,
    upperArm: HERO_UPPER,
    forearm: HERO_FORE,
    thigh: HERO_THIGH,
    shin: HERO_SHIN,
    headR: 6.4,
    head: FACE,
    headwear: 'mask',
    torsoWear: 'coat',
    cloth: ['coatSkirt'],
    weapon: 'naginata',
    eyes: { color: 0xffffff, kind: 'mask' },
    accent: 0xe8e4dc,
    fist: true,
  },
  leaper: {
    id: 'leaper',
    body: scaleBody(HERO_BODY, { upperArm: 1.08, forearm: 1.1, bladeLen: 0.3, handleLen: 0.2 }),
    scale: 0.95,
    torso: LEAN_TORSO,
    neck: NECK,
    upperArm: LEAN_UPPER,
    forearm: LEAN_FORE,
    thigh: LEAN_THIGH,
    shin: LEAN_SHIN,
    headR: 6.2,
    head: FACE,
    headwear: 'dreads',
    torsoWear: 'rags',
    cloth: ['rags'],
    weapon: 'claws',
    offhand: 'claws',
    eyes: { color: 0xff2a3a, kind: 'slit' },
    accent: 0x3a0a0e,
    fist: false,
  },
  crawler: {
    id: 'crawler',
    body: scaleBody(HERO_BODY, { upperArm: 1.25, forearm: 1.3, hand: 1.4, spineHigh: 1.05, bladeLen: 0.2, handleLen: 0.1 }),
    scale: 0.92,
    torso: LEAN_TORSO,
    neck: NECK,
    upperArm: LEAN_UPPER,
    forearm: LEAN_FORE,
    thigh: LEAN_THIGH,
    shin: LEAN_SHIN,
    headR: 6.0,
    head: HEAVY_FACE,
    headwear: 'bald',
    torsoWear: 'rags',
    cloth: [],
    weapon: 'none',
    eyes: { color: 0xff1a2a, kind: 'dots' },
    accent: 0x2a0508,
    fist: false,
  },
  gunner: {
    id: 'gunner',
    body: scaleBody(HERO_BODY, { bladeLen: 0.95, handleLen: 1.4 }),
    scale: 1,
    torso: [
      [0, 10.0, 10.6],
      [0.3, 10.4, 9.8],
      [0.6, 11.2, 10.4],
      [0.85, 10.6, 11.0],
      [1, 5.6, 6.6],
    ],
    neck: NECK,
    upperArm: THUG_UPPER,
    forearm: THUG_FORE,
    thigh: BAGGY_THIGH,
    shin: BAGGY_SHIN,
    headR: 6.6,
    head: FACE,
    headwear: 'soldier',
    torsoWear: 'tactical',
    cloth: [],
    weapon: 'rifle',
    eyes: { color: 0xff2020, kind: 'visor' },
    accent: 0xff1010,
    fist: true,
  },
  butcher: {
    id: 'butcher',
    body: scaleBody(HERO_BODY, { headR: 1.12, bladeLen: 1.05, handleLen: 1.2, upperArm: 1.04, forearm: 1.04 }),
    scale: 1.34,
    torso: BELLY_TORSO,
    neck: [
      [0, 5.6, 6.0],
      [1, 5.2, 5.4],
    ],
    upperArm: BIG_UPPER,
    forearm: BIG_FORE,
    thigh: BIG_THIGH,
    shin: BIG_SHIN,
    headR: 7.2,
    head: HEAVY_FACE,
    headwear: 'pigMask',
    torsoWear: 'apron',
    cloth: ['apronFlap'],
    weapon: 'chainsaw',
    eyes: { color: 0xffd0d0, kind: 'dots' },
    accent: 0xd9a0a0,
    accent2: 0x3a0a0a,
    fist: true,
  },
  verdict: {
    id: 'verdict',
    body: scaleBody(HERO_BODY, { headR: 1.05, bladeLen: 1.25, handleLen: 1.3, upperArm: 1.06, forearm: 1.06, spineHigh: 1.06 }),
    scale: 1.5,
    torso: ARMOR_TORSO,
    neck: [
      [0, 5.0, 5.6],
      [1, 4.6, 5.0],
    ],
    upperArm: BIG_UPPER,
    forearm: BIG_FORE,
    thigh: BIG_THIGH,
    shin: BIG_SHIN,
    headR: 6.8,
    head: HEAVY_FACE,
    headwear: 'kabuto',
    torsoWear: 'plate',
    cloth: ['cape'],
    weapon: 'cleaver',
    eyes: { color: 0xff1a2a, kind: 'mask' },
    accent: 0xece6da,
    accent2: 0x8a0a14,
    fist: true,
  },
  cleaner: {
    id: 'cleaner',
    body: scaleBody(HERO_BODY, { bladeLen: 0.22, handleLen: 0.5 }),
    scale: 1.03,
    torso: SUIT_TORSO,
    neck: NECK,
    upperArm: HERO_UPPER,
    forearm: HERO_FORE,
    thigh: HERO_THIGH,
    shin: [
      [0, 4.6, 4.6],
      [1, 3.8, 3.8],
    ],
    headR: 6.4,
    head: FACE,
    headwear: 'slick',
    torsoWear: 'suit',
    cloth: ['coatSkirt', 'tie'],
    weapon: 'pistol',
    offhand: 'pistol',
    eyes: { color: 0xffffff, kind: 'glasses' },
    accent: 0xf2f2f2,
    accent2: 0xff5a1a,
    fist: true,
  },
  fox: {
    id: 'fox',
    body: scaleBody(HERO_BODY, { spineLow: 0.95, spineHigh: 0.94, upperArm: 0.94, forearm: 0.94, thigh: 1.02, headR: 0.94, bladeLen: 0.32, handleLen: 1.6 }),
    scale: 0.95,
    torso: [
      [0, 8.6, 10.0],
      [0.25, 7.0, 7.8],
      [0.45, 6.8, 7.0],
      [0.7, 8.4, 7.4],
      [0.88, 7.2, 7.6],
      [1, 3.8, 4.6],
    ],
    neck: [
      [0, 2.7, 3.0],
      [1, 2.4, 2.6],
    ],
    upperArm: LEAN_UPPER,
    forearm: LEAN_FORE,
    thigh: [
      [0, 6.8, 7.4],
      [0.3, 6.8, 6.6],
      [1, 4.0, 4.0],
    ],
    shin: LEAN_SHIN,
    headR: 6.0,
    head: FACE,
    headwear: 'foxMask',
    torsoWear: 'gi',
    cloth: ['ponytail', 'sash'],
    weapon: 'sickle',
    eyes: { color: 0xffffff, kind: 'mask' },
    accent: 0xf4efe8,
    accent2: 0xc0101c,
    fist: true,
  },
  ronin: {
    id: 'ronin',
    body: scaleBody(HERO_BODY, { bladeLen: 1.35, handleLen: 1.3 }),
    scale: 1.06,
    torso: ROBE_TORSO,
    neck: NECK,
    upperArm: [
      [0, 6.0, 6.0],
      [0.6, 6.4, 6.4],
      [1, 6.0, 6.0],
    ],
    forearm: [
      [0, 5.5, 5.5],
      [0.4, 4.0, 4.0],
      [1, 2.8, 2.8],
    ],
    thigh: WIDE_THIGH,
    shin: WIDE_SHIN,
    headR: 6.4,
    head: FACE,
    headwear: 'kasa',
    torsoWear: 'kimono',
    cloth: ['sash', 'kimonoSleeve'],
    weapon: 'nodachi',
    eyes: { color: 0xffffff, kind: 'slit' },
    accent: 0x2a2a30,
    fist: true,
  },
};

/** Thug variants: headwear + weapon combos. */
export const THUG_VARIANTS: { headwear: HeadwearId; weapon: WeaponId }[] = [
  { headwear: 'hood', weapon: 'machete' },
  { headwear: 'cap', weapon: 'bat' },
  { headwear: 'bandana', weapon: 'pipe' },
  { headwear: 'gasMask', weapon: 'knife' },
];
