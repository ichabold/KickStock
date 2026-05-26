'use client';

import { NATIONS } from '@kickstock/constants';
import { pctOf } from '@kickstock/game-engine';
import { useGameStore } from '@/stores/gameStore';

export interface PortfolioTotals {
  /** Current cash balance */
  cash: number;
  /** Market value of all held positions */
  portVal: number;
  /** Total cost basis of all held positions */
  invested: number;
  /** cash + portVal */
  totalVal: number;
  /** portVal - invested (unrealised P&L) */
  pl: number;
  /** P&L as a percentage of invested (0 if no invested) */
  plPct: number;
  /** Number of nations with qty > 0 */
  positions: number;
  /** Best score ever recorded for this player (null = no completed game) */
  bestScore: number | null;
}

/**
 * MECHANIC HOOK — portfolio totals calculation.
 *
 * Shared between MobileShell and BrowserShell (PortfolioTab, PortfolioView,
 * topbar stats). Guarantees that cash, P&L, and total value are computed
 * with the exact same formula on both platforms:
 *
 *   portVal  = Σ (qty[id] × prices[id])
 *   invested = Σ (qty[id] × avgCost[id] ?? nation.p)  — fallback to IPO price
 *   totalVal = cash + portVal
 *   pl       = portVal - invested
 *
 * Do NOT add shell-specific logic here.
 */
export function usePortfolioTotals(): PortfolioTotals {
  const cash      = useGameStore(s => s.cash);
  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);
  const avgCost   = useGameStore(s => s.avgCost);
  const bestScore = useGameStore(s => s.bestScore);

  const held = Object.entries(portfolio).filter(([, q]) => q > 0);

  const portVal = held.reduce(
    (a, [id, q]) => a + q * (prices[id] ?? 0),
    0,
  );

  const invested = held.reduce((a, [id, q]) => {
    const cost = avgCost[id] ?? NATIONS.find(n => n.id === id)?.p ?? 0;
    return a + q * cost;
  }, 0);

  const totalVal  = cash + portVal;
  const pl        = portVal - invested;
  const plPct     = invested > 0 ? pctOf(portVal, invested) : 0;
  const positions = held.length;

  return { cash, portVal, invested, totalVal, pl, plPct, positions, bestScore };
}
