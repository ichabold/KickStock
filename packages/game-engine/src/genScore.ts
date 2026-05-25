/**
 * Generates a realistic scoreline from the simulation result.
 * Handles normal time, extra time, and penalties (score stays tied in pens).
 */
export function genScore(
  res: string,
  res90: string,
  etRes: string | null,
  penWinner: string | null,
): [number, number] {
  const b = () => Math.floor(Math.random() * 3);

  // Group stage draw
  if (res === 'draw' && !etRes && !penWinner) {
    const g = b();
    return [g, g];
  }

  // KO match that went to ET (90min ended in draw)
  if (res90 === 'draw' && (etRes || penWinner)) {
    const g = b(); // goals each side in 90min
    if (etRes) {
      // ET winner scored one extra goal
      return etRes === 'A' ? [g + 1, g] : [g, g + 1];
    } else {
      // Penalties: 90+ET scores remain equal
      return [g, g];
    }
  }

  // Normal decisive 90min result
  const loser  = b();
  const winner = loser + 1 + Math.floor(Math.random() * 2);
  return res === 'A' ? [winner, loser] : [loser, winner];
}
