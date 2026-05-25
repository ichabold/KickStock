'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { syncBestScore } from '@/hooks/useAuth';
import {
  initState, applyResult, calcTax, simulate,
  genScore, genGoals, buildR32Pool, buildMatchesForDay,
  pctOf, fmt,
} from '@kickstock/game-engine';
import { NATIONS, CALENDAR, DIV_RATES, INIT_CASH } from '@kickstock/constants';
import type { GameState, TradeMode, StoredMatchResult, Match } from '@kickstock/types';

export { fmt, pctOf };

const STORAGE_KEY = 'ks_p2';

// 40% concentration cap applies during Groups and R32
function isCapPhase(state: GameState): boolean {
  const day = CALENDAR[state.dayIndex];
  return !!day && ['Groups', 'R32'].includes(day.phase);
}

// Build the playable matches for the current day
export function buildMatchesForCurrentDay(state: GameState): Match[] {
  const day = CALENDAR[state.dayIndex];
  if (!day) return [];

  // Fixed group-stage matches
  if (day.matches.length > 0) {
    return day.matches.filter(m => {
      const nA = NATIONS.find(n => n.id === m.a);
      const nB = NATIONS.find(n => n.id === m.b);
      return nA && nB && !state.eliminated.includes(m.a) && !state.eliminated.includes(m.b);
    });
  }

  // Dynamic KO matches
  if (day.dynamic) {
    return buildMatchesForDay(day.dynamic, state).filter(m => {
      const nA = NATIONS.find(n => n.id === m.a);
      const nB = NATIONS.find(n => n.id === m.b);
      return nA && nB;
    });
  }

  return [];
}

interface AdvanceDayResult {
  results: StoredMatchResult[];
  flash: Record<string, 'fu' | 'fd'>;
}

interface GameStore extends GameState {
  resetGame: () => void;
  trade: (mode: TradeMode, nationId: string, quantity: number) => string | null;
  liquidateEliminated: () => void;
  advanceDay: () => AdvanceDayResult | null;
}

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      ...initState(),

      resetGame: () => set(initState()),

      trade: (mode, nationId, quantity) => {
        const s = get();
        const n = NATIONS.find(n => n.id === nationId);
        const price = s.prices[nationId];
        if (!n || !price) return 'Nation introuvable';

        const isKO   = CALENDAR[s.dayIndex]?.isKO ?? false;
        const held   = s.portfolio[nationId] ?? 0;
        const totVal = s.cash + Object.entries(s.portfolio).reduce(
          (acc, [id, q]) => acc + q * (s.prices[id] ?? 0), 0,
        );

        if (mode === 'buy') {
          if (s.eliminated.includes(nationId)) return 'Nation éliminée 💀';

          // No tax on buy (v12 rule)
          const cost = price * quantity;
          if (cost > s.cash) return 'Fonds insuffisants';

          // 40% concentration cap in Groups + R32
          if (isCapPhase(s) && ((held + quantity) * price) / totVal > 0.40) {
            return '⛔ Plafond 40% atteint';
          }

          // Weighted average cost
          const prevAvg = s.avgCost[nationId] ?? n.p;
          const newAvg  = held === 0
            ? price
            : (held * prevAvg + quantity * price) / (held + quantity);

          const txEntry = { dir: 'buy' as const, flag: n.flag, name: n.name, qty: quantity, price, day: s.dayIndex };

          set({
            cash:     Math.round((s.cash - cost) * 10) / 10,
            portfolio: { ...s.portfolio, [nationId]: held + quantity },
            avgCost:  { ...s.avgCost, [nationId]: Math.round(newAvg * 10) / 10 },
            txLog:    [txEntry, ...s.txLog].slice(0, 100),
          });
        } else {
          if (held < quantity) return 'Actions insuffisantes';

          const gross = price * quantity;
          const fee   = s.eliminated.includes(nationId) ? 0 : calcTax(gross, price, isKO);
          const net   = gross - fee;

          const newHeld = held - quantity;
          const newPortfolio = { ...s.portfolio, [nationId]: newHeld };
          if (newHeld <= 0) delete newPortfolio[nationId];

          const newAvgCost = { ...s.avgCost };
          if (newHeld <= 0) delete newAvgCost[nationId];

          const txEntry = { dir: 'sell' as const, flag: n.flag, name: n.name, qty: quantity, price, day: s.dayIndex };

          set({
            cash:      Math.round((s.cash + net) * 10) / 10,
            portfolio: newPortfolio,
            avgCost:   newAvgCost,
            txLog:     [txEntry, ...s.txLog].slice(0, 100),
          });
        }
        return null;
      },

      liquidateEliminated: () => {
        const s = get();
        const elimHeld = Object.entries(s.portfolio).filter(
          ([id, q]) => q > 0 && s.eliminated.includes(id),
        );
        if (elimHeld.length === 0) return;

        let bonus = 0;
        const newPortfolio = { ...s.portfolio };
        for (const [id, q] of elimHeld) {
          bonus += q * 1; // eliminated price = 1 KC
          delete newPortfolio[id];
        }
        set({
          cash:      Math.round((s.cash + bonus) * 10) / 10,
          portfolio: newPortfolio,
        });
      },

      advanceDay: () => {
        const s = get();
        const day = CALENDAR[s.dayIndex];
        if (!day) return null;

        const matches = buildMatchesForCurrentDay(s);

        // KO day with empty pool → silently advance
        if (matches.length === 0 && day.isKO) {
          set({ dayIndex: s.dayIndex + 1 });
          return null;
        }
        if (matches.length === 0) return null;

        // ── Simulate all matches ──────────────────────────────────────────────
        const prices     = { ...s.prices };
        const priceHist  = { ...s.priceHistory };
        const eliminated = [...s.eliminated];
        let r32Pool  = [...s.r32Pool];
        let r16Pool  = [...s.r16Pool];
        let qfPool   = [...s.qfPool];
        let sfPool   = [...s.sfPool];
        let finalPool = [...(s.finalPool ?? [])];
        let thirdPool = [...s.thirdPool];
        let champion  = s.champion;
        let cashDelta = 0;
        const flash: Record<string, 'fu' | 'fd'> = {};

        const results: StoredMatchResult[] = matches.map(m => {
          const nA = NATIONS.find(n => n.id === m.a)!;
          const nB = NATIONS.find(n => n.id === m.b)!;
          const pA = prices[m.a] ?? nA.p;
          const pB = prices[m.b] ?? nB.p;

          const sim = simulate(nA.str, nB.str, day.isKO);
          const [newPA, newPB] = applyResult(pA, pB, sim.res as 'A' | 'B' | 'draw');
          const [scoreA, scoreB] = genScore(sim.res, sim.res90, sim.etRes, sim.penWinner);
          const goals = genGoals(scoreA, scoreB, nA, nB, sim.res90, sim.etRes);

          const winnerId = sim.res === 'draw' ? null : (sim.res === 'A' ? m.a : m.b);
          const loserId  = sim.res === 'draw' ? null : (sim.res === 'A' ? m.b : m.a);

          // SF losers and 3rd place loser stay in the tournament
          const elimId = day.isKO && day.phase !== 'SF' && day.phase !== '3rd' ? loserId : null;

          // Dividend for the winner (calculated on post-match price)
          const rate = day.divKey ? DIV_RATES[day.divKey] ?? 0 : 0;

          return {
            a: m.a, b: m.b, scoreA, scoreB,
            res: sim.res as 'A' | 'B' | 'draw',
            res90: sim.res90 as 'A' | 'B' | 'draw',
            isUpset: sim.isUpset,
            pA, pB,
            newPA: Math.max(1, newPA),
            newPB: Math.max(1, newPB),
            elimId,
            winnerId,
            loserId,
            venue: m.venue,
            goals,
            etRes: sim.etRes,
            penWinner: sim.penWinner,
            penA: sim.penA,
            penB: sim.penB,
            divCash: winnerId && rate > 0 && (s.portfolio[winnerId] ?? 0) > 0
              ? Math.round((s.portfolio[winnerId] ?? 0) * Math.max(1, newPA) * rate)
              : 0,
            phase: day.phase,
          };
        });

        // ── PASS 1 : apply prices + eliminations ─────────────────────────────
        for (const r of results) {
          prices[r.a] = r.newPA;
          prices[r.b] = r.newPB;
          flash[r.a]  = r.newPA > r.pA ? 'fu' : 'fd';
          flash[r.b]  = r.newPB > r.pB ? 'fu' : 'fd';

          if (r.elimId && !eliminated.includes(r.elimId)) {
            eliminated.push(r.elimId);
            prices[r.elimId] = 1;
            flash[r.elimId]  = 'fd';
          }
          if (day.phase === '3rd' && r.loserId && !eliminated.includes(r.loserId)) {
            eliminated.push(r.loserId);
            prices[r.loserId] = 1;
            flash[r.loserId]  = 'fd';
          }
        }

        // ── Build R32 pool at end of group stage (dayIndex 16 = last group day) ──
        if (s.dayIndex === 16 && r32Pool.length === 0) {
          // Include current results in matchResults for seeding
          const allMatchResults = { ...s.matchResults, [s.dayIndex]: results };
          r32Pool = buildR32Pool(allMatchResults, eliminated);

          // Crash all non-qualified teams to 1 KC
          const qualified = new Set(r32Pool.filter(Boolean));
          for (const n of NATIONS) {
            if (!qualified.has(n.id) && !eliminated.includes(n.id)) {
              eliminated.push(n.id);
              prices[n.id] = 1;
              flash[n.id]  = 'fd';
            }
          }
        }

        // ── PASS 2 : dividends + KO pool building ────────────────────────────
        for (const r of results) {
          if (!day.isKO || !r.winnerId) continue;

          // Build next-round pool
          if (day.phase === 'R32' && !r16Pool.includes(r.winnerId)) r16Pool.push(r.winnerId);
          if (day.phase === 'R16' && !qfPool.includes(r.winnerId))  qfPool.push(r.winnerId);
          if (day.phase === 'QF'  && !sfPool.includes(r.winnerId))  sfPool.push(r.winnerId);
          if (day.phase === 'SF') {
            if (!finalPool.includes(r.winnerId)) finalPool.push(r.winnerId);
            if (r.loserId && !thirdPool.includes(r.loserId)) thirdPool.push(r.loserId);
          }
          if (day.phase === 'Final') {
            champion = r.winnerId;
            // Eliminate finalist loser
            if (r.loserId && !eliminated.includes(r.loserId)) {
              eliminated.push(r.loserId);
              prices[r.loserId] = 1;
            }
            // Champion bonus +60%
            const champRate = DIV_RATES['champion'] ?? 0;
            const champHeld = s.portfolio[r.winnerId] ?? 0;
            if (champRate > 0 && champHeld > 0) {
              cashDelta += Math.round(champHeld * prices[r.winnerId] * champRate);
            }
          }

          // KC dividend (post-match price)
          const rate = day.divKey ? DIV_RATES[day.divKey] ?? 0 : 0;
          if (rate > 0 && !eliminated.includes(r.winnerId)) {
            const held = s.portfolio[r.winnerId] ?? 0;
            if (held > 0) cashDelta += Math.round(held * prices[r.winnerId] * rate);
          }

          // Final: both finalists get dividend
          if (day.phase === 'Final' && r.loserId && !eliminated.includes(r.loserId)) {
            const rate2 = DIV_RATES['final'] ?? 0;
            const held2 = s.portfolio[r.loserId] ?? 0;
            if (held2 > 0) cashDelta += Math.round(held2 * prices[r.loserId] * rate2);
          }
        }

        // ── Update price history ──────────────────────────────────────────────
        for (const r of results) {
          priceHist[r.a] = [...(priceHist[r.a] ?? [prices[r.a]]), prices[r.a]];
          priceHist[r.b] = [...(priceHist[r.b] ?? [prices[r.b]]), prices[r.b]];
          if (r.elimId) priceHist[r.elimId] = [...(priceHist[r.elimId] ?? []), 1];
        }

        // ── Compute best score ────────────────────────────────────────────────
        const newCash = Math.round((s.cash + cashDelta) * 10) / 10;
        const totalVal = newCash + Object.entries(s.portfolio).reduce(
          (acc, [id, q]) => acc + q * (prices[id] ?? 0), 0,
        );
        const newBest = s.bestScore === null
          ? totalVal
          : Math.max(s.bestScore, totalVal);

        // Sync best score to Supabase (fire-and-forget, silent if not logged in)
        if (newBest > (s.bestScore ?? 0)) {
          syncBestScore(newBest).catch(() => {});
        }

        set({
          prices,
          priceHistory: priceHist,
          eliminated,
          champion,
          cash:       newCash,
          dayIndex:   s.dayIndex + 1,
          matchResults: { ...s.matchResults, [s.dayIndex]: results },
          r32Pool,
          r16Pool,
          qfPool,
          sfPool,
          finalPool,
          thirdPool,
          bestScore:  newBest,
        });

        return { results, flash };
      },
    }),
    {
      name: STORAGE_KEY,
      skipHydration: true,
    },
  ),
);
