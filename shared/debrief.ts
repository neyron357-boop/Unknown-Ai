/**
 * Shared between the server and the client: the debrief payload shape and the
 * deterministic demo/fallback mentor line. Lets ECHO speak even when the API
 * server is unreachable (static hosting, offline PWA).
 */
export type AttackKindId = 'mid' | 'high' | 'low';
export type BestDecisionId = 'perfectAscension' | 'blindRead' | 'ironWill' | 'mathMind' | 'perfectStreak' | 'comboKing' | 'fastReaction' | 'persistence';
export type ErrorPatternId = 'typeWeakness' | 'impulsive' | 'blindStruggle' | 'phantomBait' | 'mathSlip' | 'memoryGap';

export interface DebriefPayload {
  kind: 'debrief';
  lang: 'ru' | 'en';
  run: {
    mode: 'spark' | 'flow' | 'calm';
    durationSec: number;
    grade: 'S' | 'A' | 'B' | 'C';
    accuracy: number;
    reactionMedianMs: number | null;
    timingMs: number | null;
    blindAttempted: number;
    blindCorrect: number;
    phantoms: number;
    fooled: number;
    calcCorrect: number;
    calcTotal: number;
    recallCorrect: number;
    recallTotal: number;
    maxCombo: number;
    impulsive: number;
    reboots: number;
    bestDecision: BestDecisionId;
    weakestKind: AttackKindId | null;
  };
  history?: { runs: number; previousAccuracy: number | null; previousReactionMs: number | null };
  patterns: ErrorPatternId[];
}

export const KIND_NAMES = {
  ru: { mid: 'выпад (тап)', high: 'верхний удар (вниз)', low: 'нижний удар (вверх)' },
  en: { mid: 'thrust (tap)', high: 'high swing (down)', low: 'low sweep (up)' },
} as const;

/**
 * Demo / fallback debrief — deterministic, built from the same facts.
 * Used when no API key is configured, the model fails, or the rate limit is hit.
 */
export function demoDebrief(req: DebriefPayload): string {
  const r = req.run;
  const ru = req.lang === 'ru';
  const strength = (() => {
    switch (r.bestDecision) {
      case 'perfectAscension':
        return ru ? 'Все руны — в точном порядке.' : 'Every rune, in the exact order.';
      case 'blindRead':
        return ru ? `Вслепую ты отбил ${r.blindCorrect} из ${r.blindAttempted}. Ритм уже в тебе.` : `Blind, you blocked ${r.blindCorrect} of ${r.blindAttempted}. The rhythm is in you.`;
      case 'ironWill':
        return ru ? 'Ни один фантом тебя не купил.' : 'Not one phantom fooled you.';
      case 'mathMind':
        return ru ? 'Ни одной ошибки в выборе энергии.' : 'Not a single wrong energy pick.';
      case 'perfectStreak':
        return ru ? 'Серия идеальных парирований — чистая работа.' : 'A streak of perfect parries — clean work.';
      case 'comboKing':
        return ru ? `Комбо ${r.maxCombo}. Ты держал бит.` : `Combo ${r.maxCombo}. You held the beat.`;
      case 'fastReaction':
        return ru ? 'Реакция быстрее его сигнала.' : 'Your reaction outran his signal.';
      default:
        return ru ? 'Ты дошёл до конца. Это уже данные.' : 'You saw it through. That is data now.';
    }
  })();
  const tip = (() => {
    if (req.patterns.includes('impulsive')) return ru ? 'Не жми на замахе — дождись бита.' : 'Do not press on the windup — wait for the beat.';
    if (req.patterns.includes('phantomBait')) return ru ? 'Перед ударом глянь вниз: без отражения — не трогай.' : 'Before you move, look down: no reflection, no touch.';
    if (req.patterns.includes('blindStruggle')) return ru ? 'В первых кругах проговаривай порядок про себя.' : 'In the early loops, say the order to yourself.';
    if (req.patterns.includes('mathSlip')) return ru ? 'Умножение выигрывает у большого числа не всегда — сравни оба.' : 'Multiplying does not always beat a big plus — compare both.';
    if (req.patterns.includes('memoryGap')) return ru ? 'Руны звучат по нотам — запоминай мелодию.' : 'Runes ring as notes — remember the tune.';
    if (r.weakestKind) return ru ? `Слабое место — ${KIND_NAMES.ru[r.weakestKind]}.` : `Weak spot: ${KIND_NAMES.en[r.weakestKind]}.`;
    return ru ? 'Попробуй ПОТОК — серии длиннее.' : 'Try FLOW — longer sequences.';
  })();
  return `${strength} ${tip}`;
}
