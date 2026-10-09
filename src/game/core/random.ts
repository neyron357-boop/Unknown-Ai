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
