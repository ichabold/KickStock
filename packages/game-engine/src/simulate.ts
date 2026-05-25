import type { SimulatedMatch } from '@kickstock/types';

/**
 * Simulates a match result based on team strengths.
 * In KO rounds, draws go to extra time / penalties.
 */
export function simulate(strA: number, strB: number, isKO = false): SimulatedMatch {
  const gap = Math.abs(strA - strB);
  const fav: 'A' | 'B' = strA >= strB ? 'A' : 'B';
  const upsetP = Math.max(0.05, 0.26 - gap * 0.006);
  const drawP  = Math.max(0.08, 0.25 - gap * 0.004);

  const r = Math.random();
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

    if (Math.random() < 0.60) {
      const etR = Math.random();
      etRes = etR < etUpset ? (etFav === 'A' ? 'B' : 'A') : etFav;
    } else {
      let sA = 0, sB = 0;
      for (let i = 0; i < 5; i++) {
        sA += Math.random() < (0.73 + strA * 0.001) ? 1 : 0;
        sB += Math.random() < (0.73 + strB * 0.001) ? 1 : 0;
      }
      let round = 0;
      while (sA === sB && round < 10) {
        sA += Math.random() < 0.73 ? 1 : 0;
        sB += Math.random() < 0.73 ? 1 : 0;
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
