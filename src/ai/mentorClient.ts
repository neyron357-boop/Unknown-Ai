import { demoDebrief, type DebriefPayload } from '../../shared/debrief';
import { detectErrorPatterns, type RunSummary } from '@/cognitive/adaptation';
import type { BattleResult } from '@/game/v3/core/metrics';
import type { Lang } from '@/state/settings';

export type MentorSource = 'gemini' | 'demo' | 'fallback' | 'offline';
export type AiStatus = 'live' | 'demo' | 'offline';

/** Single-file build hosted without the API server: ECHO speaks from local lines only. */
const STATIC_BUILD = import.meta.env.VITE_TARGET === 'artifact';

const int = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number.isFinite(v) ? v : 0)));
const count = (v: number) => int(v, 0, 10_000);
const ratio = (v: number) => Math.round(Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)) * 1000) / 1000;
const msOrNull = (v: number | null) => (v === null || !Number.isFinite(v) ? null : int(v, 0, 60_000));
const signedMsOrNull = (v: number | null) => (v === null || !Number.isFinite(v) ? null : int(v, -60_000, 60_000));

/**
 * Builds the compact numeric payload for ECHO's debrief from a v3 fight result.
 * `previous` = earlier fights of the same mode (the newest one gives the deltas).
 * Nothing identifying leaves the device; values are clamped so the server always accepts them.
 */
export function buildDebriefPayload(result: BattleResult, lang: Lang, previous: RunSummary[]): DebriefPayload {
  const prev = [...previous].sort((a, b) => b.finishedAt - a.finishedAt)[0];
  return {
    kind: 'debrief',
    lang,
    run: {
      mode: result.mode,
      durationSec: int(result.durationMs / 1000, 0, 7200),
      grade: result.grade,
      accuracy: ratio(result.accuracy),
      timingMeanMs: msOrNull(result.timing.meanAbsMs),
      timingBiasMs: signedMsOrNull(result.timing.biasMs),
      kills: count(result.kills),
      decaps: count(result.decaps),
      maxCombo: count(result.maxCombo),
      longestPerfect: count(result.longestPerfect),
      feintsTotal: count(result.feints.total),
      feintsFooled: count(result.feints.fooled),
      patternRepeats: count(result.patterns.repeats),
      patternOk: count(result.patterns.repeatOk),
      execCuts: count(result.exec.cuts),
      execCorrect: count(result.exec.correct),
      hitsTaken: count(result.hitsTaken),
      reboots: count(result.reboots),
      impulsive: count(result.impulsive),
      best: result.best.kind,
      weakestKind: result.weakestKind,
    },
    history: prev
      ? { runs: count(previous.length), previousAccuracy: ratio(prev.result.accuracy), previousTimingMs: msOrNull(prev.result.timing.meanAbsMs) }
      : undefined,
    patterns: [...new Set(detectErrorPatterns(result).map((p) => p.kind))],
  };
}

/** The local line (no network): AI lines switched off, static build, or a failed request. */
export function localDebrief(payload: DebriefPayload): { text: string; source: MentorSource } {
  return { text: demoDebrief(payload), source: 'offline' };
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
    return localDebrief(payload);
  } catch {
    return localDebrief(payload);
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
