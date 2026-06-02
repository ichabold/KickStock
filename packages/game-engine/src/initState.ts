import { INIT_CASH } from '@kickstock/constants';
import type { GameState, TeamMeta } from '@kickstock/types';

export function initState(teams: TeamMeta[]): GameState {
  const src = teams;

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
