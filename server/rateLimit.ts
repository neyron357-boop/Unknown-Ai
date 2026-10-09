/**
 * Minimal in-memory token-bucket rate limiter (per client key).
 * Good enough for a single-instance personal server; swap for a shared
 * store (Redis etc.) if the server is ever scaled horizontally.
 */
export interface RateLimiter {
  take(key: string, now?: number): { ok: boolean; retryAfterSec: number };
}

export function createRateLimiter(perMinute: number, maxKeys = 5000): RateLimiter {
  const capacity = Math.max(1, perMinute);
  const refillPerMs = capacity / 60_000;
  const buckets = new Map<string, { tokens: number; at: number }>();

  return {
    take(key, now = Date.now()) {
      let b = buckets.get(key);
      if (!b) {
        if (buckets.size >= maxKeys) {
          // Drop the oldest entry to keep memory bounded.
          const first = buckets.keys().next().value;
          if (first !== undefined) buckets.delete(first);
        }
        b = { tokens: capacity, at: now };
        buckets.set(key, b);
      }
      b.tokens = Math.min(capacity, b.tokens + (now - b.at) * refillPerMs);
      b.at = now;
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { ok: true, retryAfterSec: 0 };
      }
      return { ok: false, retryAfterSec: Math.ceil((1 - b.tokens) / refillPerMs / 1000) };
    },
  };
}
