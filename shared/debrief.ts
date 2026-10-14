/**
 * Shared between the server and the client: the ECHO debrief payload (v3, "Blood Moon") and the
 * deterministic demo/fallback line. Lets ECHO speak even when the API server is unreachable
 * (static hosting, offline PWA) or the AI lines are switched off.
 *
 * Self-contained on purpose (no `@/` imports): the server bundles this file too.
 */

export const ENEMY_IDS = ['grunt', 'brute', 'dodger', 'feinter', 'leaper', 'crawler', 'gunner', 'butcher', 'boss'] as const;
export type EnemyId = (typeof ENEMY_IDS)[number];

export const BEST_MOMENTS = ['flawlessExec', 'patternRead', 'ironWill', 'perfectStreak', 'comboKing', 'bloodlust', 'butcherSlayer', 'persistence'] as const;
export type BestMomentId = (typeof BEST_MOMENTS)[number];

export const ERROR_PATTERNS = ['typeWeakness', 'impulsive', 'feintBait', 'patternGap', 'execGap', 'early', 'late'] as const;
export type ErrorPatternId = (typeof ERROR_PATTERNS)[number];

export type ModeIdShared = 'spark' | 'flow' | 'calm';

/** Numbers and enum values only — nothing the player typed ever reaches the model. */
export interface DebriefPayload {
  kind: 'debrief';
  lang: 'ru' | 'en';
  run: {
    mode: ModeIdShared;
    durationSec: number;
    grade: 'S' | 'A' | 'B' | 'C';
    /** 0..1 */
    accuracy: number;
    /** Mean |offset| of hits, ms. */
    timingMeanMs: number | null;
    /** Mean signed offset of hits, ms (negative = before the beat). */
    timingBiasMs: number | null;
    kills: number;
    decaps: number;
    maxCombo: number;
    longestPerfect: number;
    feintsTotal: number;
    feintsFooled: number;
    /** Notes of VERDICT's strings shown a second time, and how many were answered. */
    patternRepeats: number;
    patternOk: number;
    execCuts: number;
    execCorrect: number;
    hitsTaken: number;
    reboots: number;
    /** Slashes at enemies that were not in range yet. */
    impulsive: number;
    best: BestMomentId;
    weakestKind: EnemyId | null;
  };
  /** Previous fights in the same mode. */
  history?: { runs: number; previousAccuracy: number | null; previousTimingMs: number | null };
  patterns: ErrorPatternId[];
}

export const DEBRIEF_MAX_CHARS = 200;

/** Who they are — for prompts and the demo line. */
export const ENEMY_NAMES: Record<'ru' | 'en', Record<EnemyId, string>> = {
  ru: {
    grunt: 'рядовые',
    brute: 'громилы',
    dodger: 'ловкачи',
    feinter: 'обманщики',
    leaper: 'прыгуны',
    crawler: 'ползуны',
    gunner: 'стрелки',
    butcher: 'Мясник',
    boss: 'Вердикт',
  },
  en: {
    grunt: 'grunts',
    brute: 'brutes',
    dodger: 'dodgers',
    feinter: 'feinters',
    leaper: 'leapers',
    crawler: 'crawlers',
    gunner: 'gunners',
    butcher: 'the Butcher',
    boss: 'Verdict',
  },
};

/** The counter-move for each threat (what the game actually expects). */
export const ENEMY_TIPS: Record<'ru' | 'en', Record<EnemyId, string>> = {
  ru: {
    grunt: 'режь в его сторону, в бит',
    brute: 'броня, два удара подряд',
    dodger: 'второй удар — в другую сторону',
    feinter: 'белые глаза — жди, красные — режь',
    leaper: 'атака сверху, режь вверх',
    crawler: 'атака снизу, режь вниз',
    gunner: 'отбей пулю в сторону стрелка',
    butcher: 'его третий замах — финт, не руби',
    boss: 'высокий — вверх, низкий — вниз, выпад — к нему',
  },
  en: {
    grunt: 'cut toward him, on the beat',
    brute: 'armor, two cuts in a row',
    dodger: 'the second cut goes to the other side',
    feinter: 'white eyes wait, red eyes cut',
    leaper: 'attacks from above, cut up',
    crawler: 'attacks from below, cut down',
    gunner: 'deflect the bullet toward the shooter',
    butcher: 'his third swing is a feint, hold',
    boss: 'high goes up, low goes down, thrust toward him',
  },
};

const pct = (v: number) => Math.round(v * 100);

/** Russian plural: 1 раз, 2 раза, 5 раз. */
function pluralRu(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/**
 * The best moment worth naming. A fight with almost no hits "ignores" every feint by doing
 * nothing — that is not iron will, so it reads as plain persistence.
 */
export function shownBest(best: BestMomentId, accuracy: number): BestMomentId {
  return best === 'ironWill' && accuracy < 0.3 ? 'persistence' : best;
}

function strength(req: DebriefPayload): string {
  const r = req.run;
  const ru = req.lang === 'ru';
  const prev = req.history?.previousAccuracy ?? null;
  switch (shownBest(r.best, r.accuracy)) {
    case 'flawlessExec':
      return ru ? 'Казнь — ни одной лишней линии.' : 'The execution: not one wrong line.';
    case 'patternRead':
      return ru ? `Ты читал его серии: ${r.patternOk} из ${r.patternRepeats}.` : `You read his strings: ${r.patternOk} of ${r.patternRepeats}.`;
    case 'ironWill':
      return ru ? 'Ни один финт тебя не купил.' : 'Not one feint bought you.';
    case 'perfectStreak':
      return ru ? `${r.longestPerfect} идеальных подряд. Холодно.` : `${r.longestPerfect} perfect cuts in a row. Cold.`;
    case 'comboKing':
      return ru ? `Комбо ${r.maxCombo}. Ты держал бит.` : `Combo ${r.maxCombo}. You held the beat.`;
    case 'bloodlust':
      return ru ? 'Жажда крови, и не раз. Город запомнит.' : 'Bloodlust, more than once. The city will remember.';
    case 'butcherSlayer':
      return ru ? 'Мясник лёг. Ни одного лишнего движения.' : 'The Butcher went down. Not one wasted move.';
    default:
      if (prev !== null && r.accuracy - prev >= 0.03)
        return ru ? `Точность выросла: ${pct(prev)}% → ${pct(r.accuracy)}%.` : `Accuracy up: ${pct(prev)}% → ${pct(r.accuracy)}%.`;
      if (r.reboots > 0)
        return ru ? `Ты падал ${r.reboots} ${pluralRu(r.reboots, 'раз', 'раза', 'раз')} — и вставал.` : `You went down ${r.reboots} ${r.reboots === 1 ? 'time' : 'times'} and got up.`;
      return ru ? 'Ты дошёл до конца.' : 'You saw it through.';
  }
}

function tip(req: DebriefPayload): string {
  const r = req.run;
  const ru = req.lang === 'ru';
  const has = (p: ErrorPatternId) => req.patterns.includes(p);
  if (has('impulsive')) return ru ? 'Не руби воздух — жди, пока враг войдёт в удар.' : 'Stop cutting air. Wait till he steps into range.';
  if (r.accuracy < 0.25) return ru ? 'Свайп — это удар. Режь в сторону врага, в бит.' : 'A swipe is a cut. Cut toward the enemy, on the beat.';
  if (has('feintBait')) return ru ? 'Белые глаза — ложь. Режь только на красных.' : 'White eyes lie. Cut only on red.';
  if (has('early')) return ru ? 'Ты режешь раньше бита. Дай ему упасть.' : 'You cut before the beat. Let it drop.';
  if (has('late')) return ru ? 'Ты опаздываешь. Режь на бит, не после.' : 'You are late. Cut on the beat, not after.';
  if (has('patternGap')) return ru ? 'Вердикт повторяет серии. Запомни первую.' : 'Verdict repeats his strings. Remember the first one.';
  if (has('execGap')) return ru ? 'На казни повтори линии в том же порядке.' : 'In the execution, repeat the lines in the same order.';
  if (r.weakestKind) {
    const name = ENEMY_NAMES[req.lang][r.weakestKind];
    const how = ENEMY_TIPS[req.lang][r.weakestKind];
    return ru ? `Слабое место — ${name}: ${how}.` : `Weak spot: ${name}. ${how[0].toUpperCase()}${how.slice(1)}.`;
  }
  if ((r.grade === 'S' || r.grade === 'A') && r.mode !== 'spark') return ru ? 'Дальше — ИСКРА. 128 BPM, без пощады.' : 'Next: SPARK. 128 BPM, no mercy.';
  return ru ? 'Ещё раз. Только чище.' : 'Again. Only cleaner.';
}

/**
 * Demo / fallback debrief — deterministic, built from the same facts: one strength, one concrete
 * in-game tip. Used without an API key, when the model fails or is rate-limited, when the AI
 * lines are switched off, and in the single-file build.
 */
export function demoDebrief(req: DebriefPayload): string {
  const line = `${strength(req)} ${tip(req)}`;
  return line.length <= DEBRIEF_MAX_CHARS ? line : strength(req);
}
