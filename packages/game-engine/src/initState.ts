import { NATIONS, INIT_CASH } from '@kickstock/constants';
import type { GameState, TeamMeta } from '@kickstock/types';

/**
 * Initialises a fresh GameState.
 *
 * Preferred (API-driven): pass `teams` from the bootstrap endpoint.
 * Legacy fallback: if called with no args, uses the hardcoded NATIONS constant.
 * The fallback exists only to keep the server advance route working during migration.
 */
export function initState(teams?: TeamMeta[]): GameState {
  const src = teams ?? NATIONS.map(n => ({
    id: n.id, name: n.name, flag: n.flag,
    group: n.group, strength: n.str, initialPrice: n.p,
  }));

  const prices: Record<string, number>       = {};
  const priceHistory: Record<string, number[]> = {};

  for (const t of src) {
    prices[t.id]       = t.initialPrice;
    priceHistory[t.id] = [t.initialPrice];
  }

  return {
    cash: INIT_CASH,
    portfolio: {},
    avgCost: {},
    prices,
    priceHistory,
    dayIndex: 0,
    eliminated: [],
    champion: null,
    matchResults: {},
    r32Pool: [],
    r16Pool: [],
    qfPool: [],
    sfPool: [],
    finalPool: [],
    thirdPool: [],
    txLog: [],
    bestScore: null,
  };
}

export function pctOf(price: number, initial: number): number {
  return parseFloat(((price - initial) / initial * 100).toFixed(1));
}

export function fmt(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}
