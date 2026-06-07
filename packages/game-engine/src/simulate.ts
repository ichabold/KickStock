import type { SimulatedMatch } from '@kickstock/types';
import type { Rng } from './prng';

// Le paramètre rng est optionnel : Math.random par défaut (rétrocompatible côté serveur).
// En mode offline, injecter toujours un PRNG seedé — Math.random n'est plus utilisé.
export function simulate(strA: number, strB: number, isKO = false, rng: Rng = Math.random): SimulatedMatch {
  const gap = Math.abs(strA - strB);
  const fav: 'A' | 'B' = strA >= strB ? 'A' : 'B';
  const upsetP = Math.max(0.05, 0.26 - gap * 0.006);
  const drawP  = Math.max(0.08, 0.25 - gap * 0.004);

  const r = rng();
  const res90: 'A' | 'B' | 'draw' =
    r < upsetP ? (fav === 'A' ? 'B' : 'A') :
    r < upsetP + drawP ? 'draw' :
    fav;

  let etRes: 'A' | 'B' | null = null;
  let penWinner: 'A' | 'B' | null = null;
  let penA = 0, penB = 0;

  if (isKO && res90 === 'draw') {
    const etFav: 'A' | 'B' = strA >= strB ? 'A' : 'B';
    const etUpset = Math.max(0.08, 0.35 - gap * 0.008);

    if (rng() < 0.60) {
      const etR = rng();
      etRes = etR < etUpset ? (etFav === 'A' ? 'B' : 'A') : etFav;
    } else {
      let sA = 0, sB = 0;
      for (let i = 0; i < 5; i++) {
        sA += rng() < (0.73 + strA * 0.001) ? 1 : 0;
        sB += rng() < (0.73 + strB * 0.001) ? 1 : 0;
      }
      let round = 0;
      while (sA === sB && round < 10) {
        sA += rng() < 0.73 ? 1 : 0;
        sB += rng() < 0.73 ? 1 : 0;
        round++;
      }
      penA = sA; penB = sB;
      penWinner = sA > sB ? 'A' : 'B';
    }
  }

  const finalRes: 'A' | 'B' | 'draw' =
    penWinner ??
    etRes ??
    (res90 === 'draw' && isKO ? fav : res90);

  return {
    res: finalRes as 'A' | 'B' | 'draw',
    res90,
    isUpset: finalRes !== 'draw' && finalRes !== fav && gap > 8,
    etRes,
    penWinner,
    penA,
    penB,
  };
}
