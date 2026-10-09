/**
 * Shared between the server and the client: the debrief payload shape and the
 * deterministic demo/fallback mentor line. Lets the game speak even when the
 * API server is unreachable (e.g. static hosting, offline PWA).
 */
export type AttackTypeId = 'slashL' | 'slashR' | 'crush' | 'pierce';
export type BestDecisionId = 'perfectAscension' | 'readStreak' | 'fastReaction' | 'recovered' | 'firstRead' | 'persistence';
export type ErrorPatternId = 'typeWeakness' | 'impulsive' | 'latePredictor' | 'memoryGap';

export interface DebriefPayload {
  kind: 'debrief';
  lang: 'ru' | 'en';
  run: {
    mode: 'spark' | 'flow' | 'calm';
    durationSec: number;
    accuracy: number;
    reactionMedianMs: number | null;
    predictionsAttempted: number;
    predictionsCorrect: number;
    longestReadStreak: number;
    weakPointsCorrect: number;
    weakPointsTotal: number;
    impulsive: number;
    reboots: number;
    assists: number;
    bestDecision: BestDecisionId;
    weakestType: AttackTypeId | null;
  };
  history?: { runs: number; previousAccuracy: number | null; previousReactionMs: number | null };
  patterns: ErrorPatternId[];
}

export const TYPE_NAMES = {
  ru: { slashL: 'разрез слева', slashR: 'разрез справа', crush: 'обвал', pierce: 'пронзание' },
  en: { slashL: 'left slash', slashR: 'right slash', crush: 'crush', pierce: 'pierce' },
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
        return ru ? 'Ты запомнил все слабые точки без единой ошибки.' : 'You remembered every weak point without a single mistake.';
      case 'readStreak':
        return ru
          ? `Серия из ${r.longestReadStreak} прочтений подряд — ты видел раньше него.`
          : `You saw ${r.longestReadStreak} attacks in a row before he did.`;
      case 'fastReaction':
        return ru ? 'Твоя реакция была быстрее его сигнала.' : 'Your reaction outran his signal.';
      case 'recovered':
        return ru ? 'Ты ошибся в прогнозе — и всё равно выровнялся.' : 'Your prediction was wrong — and you still recovered.';
      case 'firstRead':
        return ru ? 'Ты впервые опередил его удар.' : 'You got ahead of his strike.';
      default:
        return ru ? 'Ты дошёл до конца. Это уже данные.' : 'You saw it through. That is data now.';
    }
  })();
  const tip = (() => {
    if (req.patterns.includes('impulsive'))
      return ru ? 'В следующий раз дай ритму прозвучать ещё раз, прежде чем рвануть.' : 'Next time, let the rhythm play once more before you commit.';
    if (req.patterns.includes('latePredictor'))
      return ru ? 'Попробуй двинуться в паузе — до вспышки.' : 'Try moving in the pause — before the flash.';
    if (req.patterns.includes('memoryGap'))
      return ru ? 'Слабые точки звучат по нотам — слушай порядок.' : 'Weak points ring in notes — listen to the order.';
    if (r.weakestType)
      return ru
        ? `Следи за сигналом «${TYPE_NAMES.ru[r.weakestType]}» — он тебя ловит.`
        : `Watch the ${TYPE_NAMES.en[r.weakestType]} signal — it catches you.`;
    return ru ? 'Попробуй режим ПОТОК — там ритм длиннее.' : 'Try FLOW mode — the rhythm runs longer there.';
  })();
  return `${strength} ${tip}`;
}
