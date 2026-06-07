export type Rng = () => number;

// Mulberry32 — PRNG rapide, déterministe, 32 bits.
// Utilisé pour rendre simulate() résistant à l'override de Math.random.
export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Génère un seed à partir d'une chaîne (djb2 hash).
export function seedFromString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}
