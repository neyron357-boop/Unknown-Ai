import type { DebriefRequest } from './schemas';
import { ENEMY_NAMES, ENEMY_TIPS, type BestMomentId, type ErrorPatternId, type ModeIdShared } from '../../shared/debrief';
export { demoDebrief } from '../../shared/debrief';

/**
 * ECHO — the cold voice in the hero's head. After a fight Gemini only *comments* on facts the
 * game computed; it never decides outcomes, scores or rules.
 */

const SYSTEM_RU = `Ты — ЭХО, холодный голос в голове героя игры UNKNOWN: ASCENSION. Это нуар-экшен 18+: герой — живой клинок, каждый удар — свайп в бит фонка, ночь кровавой луны, город в крови.
Бой только что закончился. Ты подводишь итог: тихо, жёстко, без эмоций, как в нуарном кино. Обращаешься к игроку на «ты».
Правила:
- Максимум 2 коротких предложения, не больше 200 символов. Без эмодзи, markdown, списков, кавычек и ремарок.
- Только факты из запроса. Не придумывай чисел и не пересчитывай их.
- Первое предложение — одна сильная сторона. Второе — один конкретный игровой совет на следующий бой: кого ждать, куда и когда резать.
- Никаких диагнозов и медицины: не упоминай СДВГ, лечение, терапию, IQ, «мозг стал лучше». Это игра.
- Жёстко, но без мата и унижения. Ошибка — это данные, не позор.`;

const SYSTEM_EN = `You are ECHO, the cold voice inside the hero's head in UNKNOWN: ASCENSION, an 18+ noir action game: the hero is a living blade, every cut is a swipe on the beat of phonk, a night under a blood moon, a city soaked in blood.
A fight just ended. You sum it up: quiet, hard, emotionless, like a noir film. Address the player as "you".
Rules:
- At most 2 short sentences, under 200 characters. No emoji, markdown, lists, quotes or stage directions.
- Use only facts from the request. Never invent or recompute numbers.
- First sentence: one strength. Second: one concrete in-game tip for the next fight: what to wait for, where and when to cut.
- No diagnoses, no medicine: never mention ADHD, treatment, therapy, IQ or "your brain improved". It is a game.
- Hard, but no profanity and no humiliation. Mistakes are data, not shame.`;

const MISSION = {
  ru: 'Кровавая луна: крыша → падение с небоскрёба → крыша поезда (мини-босс Мясник с бензопилой) → храм, дуэль с Вердиктом и казнь',
  en: 'Blood Moon: rooftop → falling down a skyscraper → train roof (mini-boss the Butcher with a chainsaw) → temple, duel with Verdict and the execution',
} as const;

const MODE: Record<'ru' | 'en', Record<ModeIdShared, string>> = {
  ru: { spark: 'ИСКРА, 128 BPM, плотные волны', flow: 'ПОТОК, 120 BPM, длинные серии и дуэль', calm: 'ТИШИНА, 100 BPM, шире окна' },
  en: { spark: 'SPARK, 128 BPM, dense waves', flow: 'FLOW, 120 BPM, long runs and duel', calm: 'CALM, 100 BPM, wider timing windows' },
};

const BEST: Record<'ru' | 'en', Record<BestMomentId, string>> = {
  ru: {
    flawlessExec: 'казнь без единой ошибки',
    patternRead: 'все повторы серий Вердикта отбиты',
    ironWill: 'ни разу не купился на финт',
    perfectStreak: 'длинная серия идеальных ударов',
    comboKing: 'длинное комбо',
    bloodlust: 'несколько раз вошёл в жажду крови',
    butcherSlayer: 'Мясник убит только идеальными ударами',
    persistence: 'дошёл до конца',
  },
  en: {
    flawlessExec: 'a flawless execution',
    patternRead: 'answered every repeat of Verdict’s strings',
    ironWill: 'never fell for a feint',
    perfectStreak: 'a long streak of perfect cuts',
    comboKing: 'a long combo',
    bloodlust: 'entered bloodlust more than once',
    butcherSlayer: 'killed the Butcher with perfect cuts only',
    persistence: 'saw the fight through',
  },
};

const PATTERN: Record<'ru' | 'en', Record<ErrorPatternId, string>> = {
  ru: {
    typeWeakness: 'часто пропускает один тип врага',
    impulsive: 'рубит воздух до того, как враг подошёл',
    feintBait: 'покупается на финты (белые глаза)',
    patternGap: 'не запоминает повторы серий Вердикта',
    execGap: 'ошибается в линиях казни',
    early: 'режет раньше бита',
    late: 'режет позже бита',
  },
  en: {
    typeWeakness: 'keeps missing one enemy type',
    impulsive: 'cuts thin air before the enemy is in range',
    feintBait: 'falls for feints (white eyes)',
    patternGap: 'does not remember Verdict’s repeated strings',
    execGap: 'cuts wrong lines in the execution',
    early: 'cuts before the beat',
    late: 'cuts after the beat',
  },
};

export function buildDebriefPrompt(req: DebriefRequest): { system: string; prompt: string } {
  const r = req.run;
  const L = req.lang;
  const none = L === 'ru' ? 'нет' : 'none';
  const lines = [
    `mission=${MISSION[L]}`,
    `mode=${MODE[L][r.mode]}`,
    `duration_sec=${r.durationSec}`,
    `grade=${r.grade} (S best, C worst)`,
    `accuracy_pct=${Math.round(r.accuracy * 100)}`,
    `timing_mean_ms=${r.timingMeanMs ?? 'n/a'}`,
    `timing_bias_ms=${r.timingBiasMs ?? 'n/a'} (negative = before the beat)`,
    `kills=${r.kills}`,
    `decapitations=${r.decaps}`,
    `max_combo=${r.maxCombo}`,
    `longest_perfect_streak=${r.longestPerfect}`,
    `feints_fooled_you=${r.feintsFooled}/${r.feintsTotal}`,
    `verdict_repeated_strings_answered=${r.patternOk}/${r.patternRepeats}`,
    `execution_cuts=${r.execCorrect}/${r.execCuts}`,
    `hits_taken=${r.hitsTaken}`,
    `reboots=${r.reboots}`,
    `hasty_slashes=${r.impulsive}`,
    `best_moment=${BEST[L][r.best]}`,
    `weakest_enemy=${r.weakestKind ? `${ENEMY_NAMES[L][r.weakestKind]} (${ENEMY_TIPS[L][r.weakestKind]})` : none}`,
    `repeated_error_patterns=${req.patterns.map((p) => PATTERN[L][p]).join('; ') || none}`,
  ];
  if (req.history) {
    lines.push(`previous_fights_in_mode=${req.history.runs}`);
    if (req.history.previousAccuracy !== null) lines.push(`previous_accuracy_pct=${Math.round(req.history.previousAccuracy * 100)}`);
    if (req.history.previousTimingMs !== null) lines.push(`previous_timing_mean_ms=${req.history.previousTimingMs}`);
  }
  const ask = L === 'ru' ? 'Бой окончен. Факты:\n' : 'The fight is over. Facts:\n';
  return { system: L === 'ru' ? SYSTEM_RU : SYSTEM_EN, prompt: ask + lines.join('\n') };
}

/** Normalises model output into a short, safe, plain-text line. */
export function sanitizeLine(text: string, maxLen = 220): string {
  let s = text
    .replace(/[*_`#>~]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^["«»“”']+|["«»“”']+$/g, '')
    .trim();
  if (s.length > maxLen) {
    const cut = s.slice(0, maxLen);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('.'));
    s = lastStop > 40 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + '…';
  }
  return s;
}

/** Medical / diagnostic talk is never allowed — the game is not a medical tool. */
const MEDICAL = /(сдвг|adhd|синдром|диагноз|diagnos|лечени|лечит|терапи|therap|treatment|медицин|medic|расстройств|disorder|мозг|brain|айкью|(^|[^\p{L}])iq([^\p{L}]|$))/iu;
const PROFANITY = /(^|[^\p{L}])(х[уy][йяеёию]|пизд|[её]б[аеиуоыё]|бля|сука|fuck|cunt|nigg|fag)/iu;

/** A model line ECHO may say: non-trivial, no medical claims, no profanity. */
export function isSafeDebrief(text: string): boolean {
  return text.length >= 8 && !MEDICAL.test(text) && !PROFANITY.test(text);
}
