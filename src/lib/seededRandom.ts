// =================================================================
// Seeded PRNG for deterministic recommendation rails
// =================================================================

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let activeRng: () => number = Math.random;

export function recRandom(): number {
  return activeRng();
}

export function withSeededRandom<T>(seed: string, fn: () => T): T {
  const prev = activeRng;
  activeRng = mulberry32(fnv1a(seed));
  try {
    return fn();
  } finally {
    activeRng = prev;
  }
}

export function schemaRecommendSeed(
  columns: { name: string; data_type: string }[],
  fileName: string,
): string {
  const sig = columns.map((c) => `${c.name}:${c.data_type}`).join("|");
  return `${fileName}\0${sig}`;
}
