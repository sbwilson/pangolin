// Seeded randomness for the seed world (AD-15). Nothing here reads `Math.random` or the clock:
// every stream comes from a string, so the same seed always gives the same numbers.

/** A deterministic stream of random numbers. */
export interface Rng {
  /** A uniform number in `[0, 1)`. */
  next(): number;
  /** A uniform integer in `[min, max]`, both inclusive. */
  int(min: number, max: number): number;
  /** One element of a non-empty list, chosen uniformly. */
  pick<T>(items: readonly T[]): T;
}

/** cyrb128: hashes a string to four 32-bit words, the state for `sfc32`. */
export function hash128(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32 (Small Fast Counter): a 128-bit-state PRNG returning uniform numbers in `[0, 1)`. */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  let s0 = a >>> 0;
  let s1 = b >>> 0;
  let s2 = c >>> 0;
  let s3 = d >>> 0;
  return () => {
    const t = (((s0 + s1) >>> 0) + s3) >>> 0;
    s3 = (s3 + 1) >>> 0;
    s0 = s1 ^ (s1 >>> 9);
    s1 = (s2 + (s2 << 3)) >>> 0;
    s2 = (s2 << 21) | (s2 >>> 11);
    s2 = (s2 + t) >>> 0;
    return t / 4294967296;
  };
}

/** An `Rng` seeded from any string. */
export function createRng(seed: string): Rng {
  const next = sfc32(...hash128(seed));
  // Discard the first outputs: sfc32 needs a few rounds to mix a fresh state.
  for (let i = 0; i < 12; i++) next();
  return {
    next,
    int(min, max) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
        throw new RangeError(`rng.int: expected integers with min <= max, got ${min}, ${max}`);
      }
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(items) {
      if (items.length === 0) throw new RangeError("rng.pick: the list is empty");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
  };
}

/**
 * The stream for one module: seeded from `seed + ":" + module`, so adding, removing or
 * reordering other modules never changes what this module draws.
 */
export function rngFor(seed: string, module: string): Rng {
  return createRng(`${seed}:${module}`);
}
