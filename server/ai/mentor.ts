import type { DebriefRequest } from './schemas';
import { KIND_NAMES } from '../../shared/debrief';
export { demoDebrief } from '../../shared/debrief';

/**
 * ECHO — the mentor voice. Gemini only *comments* on facts computed by the
 * game; it never decides outcomes, scores, or rules.
 */

const SYSTEM_RU = `Ты — ЭХО, голос внутри главного героя игры UNKNOWN: ASCENSION (тёмный sci-fi триллер, аниме-дуэль в ритме музыки).
Говоришь коротко, кинематографично, уверенно, по-взрослому. Обращаешься к игроку на «ты».
Правила:
- Максимум 2 коротких предложения, до 200 символов. Без эмодзи, без markdown, без списков.
- Используй только факты из запроса. Не придумывай чисел и не пересчитывай их.
- Не ставь диагнозов, не упоминай СДВГ, лечение, IQ, «мозг стал лучше». Это игра.
- Отметь одну сильную сторону и дай один конкретный игровой совет на следующий забег.
- Ошибки — не позор, а данные. Без стыда и давления.`;

const SYSTEM_EN = `You are ECHO, the voice inside the protagonist of UNKNOWN: ASCENSION (dark sci-fi thriller, an anime duel fought to the beat).
You speak briefly, cinematically, with confidence, like an adult. Address the player as "you".
Rules:
- At most 2 short sentences, under 200 characters. No emoji, no markdown, no lists.
- Use only facts from the request. Do not invent or recompute numbers.
- No diagnoses, never mention ADHD, treatment, IQ or "your brain improved". It is a game.
- Name one strength and give one concrete in-game tip for the next run.
- Mistakes are data, not shame. No guilt, no pressure.`;


export function buildDebriefPrompt(req: DebriefRequest): { system: string; prompt: string } {
  const r = req.run;
  const lines = [
    `mode=${r.mode}`,
    `duration_sec=${r.durationSec}`,
    `grade=${r.grade}`,
    `accuracy_pct=${Math.round(r.accuracy * 100)}`,
    `reaction_median_ms=${r.reactionMedianMs ?? 'n/a'}`,
    `timing_error_ms=${r.timingMs ?? 'n/a'}`,
    `blind_blocks=${r.blindCorrect}/${r.blindAttempted}`,
    `phantoms_fooled_you=${r.fooled}/${r.phantoms}`,
    `energy_math=${r.calcCorrect}/${r.calcTotal}`,
    `runes_recalled=${r.recallCorrect}/${r.recallTotal}`,
    `max_combo=${r.maxCombo}`,
    `hasty_inputs=${r.impulsive}`,
    `reboots=${r.reboots}`,
    `best_decision=${r.bestDecision}`,
    `weakest_attack=${r.weakestKind ? KIND_NAMES[req.lang][r.weakestKind] : 'none'}`,
    `repeated_error_patterns=${req.patterns.join(',') || 'none'}`,
  ];
  if (req.history) {
    lines.push(`previous_runs=${req.history.runs}`);
    if (req.history.previousAccuracy !== null) lines.push(`previous_accuracy_pct=${Math.round(req.history.previousAccuracy * 100)}`);
    if (req.history.previousReactionMs !== null) lines.push(`previous_reaction_ms=${req.history.previousReactionMs}`);
  }
  const ask = req.lang === 'ru' ? 'Миссия «Пробуждение» завершена. Факты:\n' : 'The mission "Awakening" just ended. Facts:\n';
  return { system: req.lang === 'ru' ? SYSTEM_RU : SYSTEM_EN, prompt: ask + lines.join('\n') };
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

