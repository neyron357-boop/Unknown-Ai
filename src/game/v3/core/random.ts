/** Small deterministic PRNG (mulberry32) so hidden rules are reproducible from a seed. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks `count` distinct indices in [0, poolSize) using the given rng. */
export function pickDistinct(rng: () => number, poolSize: number, count: number): number[] {
  const pool = Array.from({ length: poolSize }, (_, i) => i);
  const out: number[] = [];
  const n = Math.min(count, poolSize);
  for (let k = 0; k < n; k++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/** Weighted pick over a record of weights (keys with weight ≤ 0 are skipped). */
export function pickWeighted<K extends string>(rng: () => number, weights: Partial<Record<K, number>>): K {
  const entries = (Object.entries(weights) as [K, number][]).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

/** Derives an independent stream from a seed and a few integers. */
export function subRng(seed: number, ...salt: number[]): () => number {
  let h = seed >>> 0;
  for (const s of salt) h = Math.imul(h ^ (s + 0x9e3779b9), 0x85ebca6b) >>> 0;
  return createRng(h ^ (h >>> 13));
}
