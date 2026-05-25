/**
 * Calculates new prices after a match result.
 * Winner gains 50% of loser's value. Loser loses 50% of their own value.
 * Draw: each team gains 25% of opponent's value.
 */
export function applyResult(
  pA: number,
  pB: number,
  res: 'A' | 'B' | 'draw'
): [number, number] {
  let nA = pA, nB = pB;

  if (res === 'A') {
    nA = pA + pB * 0.5;
    nB = pB * 0.5;
  } else if (res === 'B') {
    nB = pB + pA * 0.5;
    nA = pA * 0.5;
  } else {
    nA = pA + pB * 0.25;
    nB = pB + pA * 0.25;
  }

  return [Math.round(nA * 10) / 10, Math.round(nB * 10) / 10];
}
