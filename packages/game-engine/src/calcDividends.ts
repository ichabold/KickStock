import { DIV_RATES } from '@kickstock/constants';

/**
 * Calculates cash dividends paid to holders when a team qualifies.
 * Returns amount in KC per share held.
 */
export function calcDividend(
  currentPrice: number,
  divKey: string
): number {
  const rate = DIV_RATES[divKey] ?? 0;
  return Math.round(currentPrice * rate * 10) / 10;
}
