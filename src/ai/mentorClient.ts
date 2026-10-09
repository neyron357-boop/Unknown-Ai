import { demoDebrief, type DebriefPayload } from '../../shared/debrief';
import { detectErrorPatterns, type RunSummary } from '@/cognitive/adaptation';
import type { MissionResult } from '@/game/core/metrics';
import type { AttackType } from '@/game/core/types';
import type { Lang } from '@/state/settings';

export type MentorSource = 'gemini' | 'demo' | 'fallback' | 'offline';
export type AiStatus = 'live' | 'demo' | 'offline';

/** Single-file build hosted without the API server: ECHO speaks from local lines only. */
const STATIC_BUILD = import.meta.env.VITE_TARGET === 'artifact';

/** Builds the compact numeric payload. Nothing identifying leaves the device. */
export function buildDebriefPayload(result: MissionResult, lang: Lang, previous: RunSummary[]): DebriefPayload {
  let weakestType: AttackType | null = null;
  let worst = 0;
  for (const [type, t] of Object.entries(result.byType) as [AttackType, { n: number; ok: number }][]) {
    const miss = t.n - t.ok;
    if (t.n >= 2 && miss > worst) {
      worst = miss;
      weakestType = type;
    }
  }
  const prev = [...previous].sort((a, b) => b.finishedAt - a.finishedAt)[0];
  return {
    kind: 'debrief',
    lang,
    run: {
      mode: result.mode,
      durationSec: Math.round(result.durationMs / 1000),
      accuracy: Math.round(result.accuracy * 1000) / 1000,
      reactionMedianMs: result.reactionMedianMs,
      predictionsAttempted: result.predictions.attempts,
      predictionsCorrect: result.predictions.correct,
      longestReadStreak: result.longestReadStreak,
      weakPointsCorrect: result.ascension.correct,
      weakPointsTotal: result.ascension.taps,
      impulsive: result.impulsive,
      reboots: result.reboots,
      assists: result.assists,
      bestDecision: result.bestDecision.kind,
      weakestType,
    },
    history: prev
      ? {
          runs: previous.length,
          previousAccuracy: Math.round(prev.result.accuracy * 1000) / 1000,
          previousReactionMs: prev.result.reactionMedianMs,
        }
      : undefined,
    patterns: [...new Set(detectErrorPatterns(result).map((p) => p.kind))],
  };
}

/** Asks the server for ECHO's debrief. Always resolves — falls back to a local line. */
export async function fetchDebrief(payload: DebriefPayload, timeoutMs = 6000): Promise<{ text: string; source: MentorSource }> {
  if (STATIC_BUILD) return { text: demoDebrief(payload), source: 'demo' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/api/ai/mentor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as { text?: string; source?: MentorSource } | null;
    if (data?.text && typeof data.text === 'string') return { text: data.text, source: data.source ?? 'fallback' };
    return { text: demoDebrief(payload), source: 'offline' };
  } catch {
    return { text: demoDebrief(payload), source: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAiStatus(): Promise<AiStatus> {
  if (STATIC_BUILD) return 'demo';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('/api/ai/status', { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return 'offline';
    const data = (await res.json()) as { mode?: string };
    return data.mode === 'live' ? 'live' : 'demo';
  } catch {
    return 'offline';
  }
}
