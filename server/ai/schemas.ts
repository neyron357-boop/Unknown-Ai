import { z } from 'zod';
import type { DebriefPayload } from '../../shared/debrief';

const ratio = z.number().min(0).max(1);
const ms = z.number().int().min(0).max(60_000).nullable();
const count = z.number().int().min(0).max(10_000);

/**
 * Debrief request: a compact, numeric-only description of a finished run.
 * No free text from the client reaches the model except enum values.
 */
export const debriefSchema = z.object({
  kind: z.literal('debrief'),
  lang: z.enum(['ru', 'en']),
  run: z.object({
    mode: z.enum(['spark', 'flow', 'calm']),
    durationSec: z.number().int().min(0).max(7200),
    grade: z.enum(['S', 'A', 'B', 'C']),
    accuracy: ratio,
    reactionMedianMs: ms,
    timingMs: ms,
    blindAttempted: count,
    blindCorrect: count,
    phantoms: count,
    fooled: count,
    calcCorrect: count,
    calcTotal: count,
    recallCorrect: count,
    recallTotal: count,
    maxCombo: count,
    impulsive: count,
    reboots: count,
    bestDecision: z.enum(['perfectAscension', 'blindRead', 'ironWill', 'mathMind', 'perfectStreak', 'comboKing', 'fastReaction', 'persistence']),
    weakestKind: z.enum(['mid', 'high', 'low']).nullable(),
  }),
  history: z.object({ runs: count, previousAccuracy: ratio.nullable(), previousReactionMs: ms }).optional(),
  patterns: z.array(z.enum(['typeWeakness', 'impulsive', 'blindStruggle', 'phantomBait', 'mathSlip', 'memoryGap'])).max(6).default([]),
});

export type DebriefRequest = z.infer<typeof debriefSchema>;

export const mentorRequestSchema = z.discriminatedUnion('kind', [debriefSchema]);
export type MentorRequest = z.infer<typeof mentorRequestSchema>;

// Compile-time guarantee that the validated shape matches the shared client type.
type Assert<T extends true> = T;
export type _SchemaMatchesShared = Assert<DebriefRequest extends DebriefPayload ? (DebriefPayload extends DebriefRequest ? true : false) : false>;
