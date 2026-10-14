import { z } from 'zod';
import { BEST_MOMENTS, ENEMY_IDS, ERROR_PATTERNS, type DebriefPayload } from '../../shared/debrief';

const ratio = z.number().min(0).max(1);
const ms = z.number().int().min(0).max(60_000).nullable();
/** Signed: negative = before the beat. */
const signedMs = z.number().int().min(-60_000).max(60_000).nullable();
const count = z.number().int().min(0).max(10_000);

/**
 * Debrief request (v3, "Blood Moon"): a compact, numeric-only description of a finished fight.
 * No free text from the client reaches the model — only numbers and enum values.
 */
export const debriefSchema = z.object({
  kind: z.literal('debrief'),
  lang: z.enum(['ru', 'en']),
  run: z.object({
    mode: z.enum(['spark', 'flow', 'calm']),
    durationSec: z.number().int().min(0).max(7200),
    grade: z.enum(['S', 'A', 'B', 'C']),
    accuracy: ratio,
    timingMeanMs: ms,
    timingBiasMs: signedMs,
    kills: count,
    decaps: count,
    maxCombo: count,
    longestPerfect: count,
    feintsTotal: count,
    feintsFooled: count,
    patternRepeats: count,
    patternOk: count,
    execCuts: count,
    execCorrect: count,
    hitsTaken: count,
    reboots: count,
    impulsive: count,
    best: z.enum(BEST_MOMENTS),
    weakestKind: z.enum(ENEMY_IDS).nullable(),
  }),
  history: z.object({ runs: count, previousAccuracy: ratio.nullable(), previousTimingMs: ms }).optional(),
  patterns: z.array(z.enum(ERROR_PATTERNS)).max(ERROR_PATTERNS.length).default([]),
});

export type DebriefRequest = z.infer<typeof debriefSchema>;

export const mentorRequestSchema = z.discriminatedUnion('kind', [debriefSchema]);
export type MentorRequest = z.infer<typeof mentorRequestSchema>;

// Compile-time guarantee that the validated shape matches the shared client type.
type Assert<T extends true> = T;
export type _SchemaMatchesShared = Assert<DebriefRequest extends DebriefPayload ? (DebriefPayload extends DebriefRequest ? true : false) : false>;
