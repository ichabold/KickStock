'use client';

/**
 * localGameStore — Offline / per-player game store.
 *
 * Entire game state (dayIndex, prices, portfolio, results…) lives in
 * localStorage via Zustand persist. Simulation runs client-side using the
 * same @kickstock/game-engine functions as the server route.
 *
 * Use this store when NEXT_PUBLIC_OFFLINE_MODE=true.
 * Each device/browser has a fully independent game — no shared state.
 *
 * Leaderboard scores are submitted to Supabase when the user is logged in
 * (fire-and-forget via syncBestScore).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  simulate, applyResult, calcTax, calcDividend,
  genScore, genGoals, buildR32Pool, buildMatchesForDay,
  pctOf, fmt,
} from '@kickstock/game-engine';
import { NATIONS, CALENDAR, DIV_RATES } from '@kickstock/constants';
import { syncBestScore } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import type { GameState, TradeMode, StoredMatchResult, Match } from '@kickstock/types';

// ── Cross-device sync helpers ─────────────────────────────────────────────────

/** Returns the logged-in user's id, or null if not authenticated. */
async function getLoggedInUserId(): Promise<string | null> {
  try {
    const { data: { user } } = await createClient().auth.getUser();
    return user?.id ?? null;
  } catch { return null; }
}

type PersistedState = Omit<GameState, never>; // all game state fields

/** Write current game state to Supabase (upsert, user_id = PK). */
async function writeStateToSupabase(userId: string, state: PersistedState): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (createClient() as any)
      .from('user_game_states')
      .upsert(
        { user_id: userId, game_state: state, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
  } catch { /* best-effort, don't crash the game */ }
}

// Debounce timer for trade saves (multiple rapid trades → one write)
let _tradeSaveTimer: ReturnType<typeof setTimeout> | null = null;

export { fmt, pctOf };

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdvanceDayResult {
  results: StoredMatchResult[];
  flash:   Record<string, 'fu' | 'fd'>;
}

interface LocalGameStore extends GameState {
  loading:  boolean;
  syncing:  boolean;
  error:    string | null;
  _pollId:  ReturnType<typeof setInterval> | null;

  fetchState:      () => Promise<void>;
  startSync:       () => void;
  stopSync:        () => void;
  trade:           (mode: TradeMode, nationId: string, quantity: number) => Promise<string | null>;
  advanceDay:      () => Promise<AdvanceDayResult | null>;
  resetGame:       () => void;
  /** Load game state from Supabase when the user logs in (cross-device sync). */
  syncFromServer:  () => Promise<void>;
}

// ── Initial state ─────────────────────────────────────────────────────────────

function emptyState(): GameState {
  return {
    cash:         10_000,
    portfolio:    {},
    avgCost:      {},
    prices:       Object.fromEntries(NATIONS.map(n => [n.id, n.p])),
    priceHistory: Object.fromEntries(NATIONS.map(n => [n.id, [n.p]])),
    dayIndex:     0,
    eliminated:   [],
    champion:     null,
    matchResults: {},
    r32Pool:      [],
    r16Pool:      [],
    qfPool:       [],
    sfPool:       [],
    finalPool:    [],
    thirdPool:    [],
    txLog:        [],
    bestScore:    null,
  };
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useLocalGameStore = create<LocalGameStore>()(
  persist(
    (set, get) => ({
      ...emptyState(),
      loading:  false,
      syncing:  false,
      error:    null,
      _pollId:  null,

      // ── fetchState ──────────────────────────────────────────────────────────
      // No-op in offline mode: persist middleware already rehydrated from localStorage.
      fetchState: async () => { set({ loading: false }); },

      // ── syncFromServer ──────────────────────────────────────────────────────
      // Called when a registered user logs in (potentially on a new device).
      // • Server state exists + server dayIndex ≥ local → load server state.
      // • Server state exists + local is ahead → keep local, push to server.
      // • No server state yet → push current local state to server.
      syncFromServer: async () => {
        const userId = await getLoggedInUserId();
        if (!userId) return;

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data } = await (createClient() as any)
            .from('user_game_states')
            .select('game_state')
            .eq('user_id', userId)
            .single();

          const s = get();
          const { loading, syncing, error, _pollId, syncFromServer: _sf, ...localState } = s as LocalGameStore;

          if (data?.game_state) {
            const serverState = data.game_state as Partial<GameState>;
            const serverDay   = serverState.dayIndex ?? 0;
            const localDay    = s.dayIndex;

            if (serverDay >= localDay) {
              // Server is ahead (or equal) — use server state on this device
              set({
                ...(serverState as GameState),
                loading: false, syncing: false, error: null,
              });
            } else {
              // Local is ahead — push local state to server
              await writeStateToSupabase(userId, localState as PersistedState);
            }
          } else {
            // No server state = brand-new account → always start fresh
            const fresh = emptyState();
            set({ ...fresh, loading: false, syncing: false, error: null });
            await writeStateToSupabase(userId, fresh as PersistedState);
          }
        } catch { /* best-effort */ }
      },

      // ── startSync / stopSync ────────────────────────────────────────────────
      // In offline mode, "sync" only submits best_score to Supabase (for leaderboard).
      startSync: () => {
        const existing = get()._pollId;
        if (existing) return;
        // Submit best score immediately on mount
        const { bestScore } = get();
        if (bestScore) syncBestScore(bestScore).catch(() => {});

        const id = setInterval(() => {
          const { bestScore: bs } = get();
          if (bs) syncBestScore(bs).catch(() => {});
        }, 60_000);
        set({ _pollId: id });
      },

      stopSync: () => {
        const id = get()._pollId;
        if (id) clearInterval(id);
        set({ _pollId: null });
      },

      // ── trade ───────────────────────────────────────────────────────────────
      trade: async (mode, nationId, quantity) => {
        const s = get();
        const n = NATIONS.find(x => x.id === nationId);
        if (!n) return 'Nation introuvable';

        const price = s.prices[nationId] ?? n.p;
        const isKO  = s.dayIndex >= 17;

        if (mode === 'buy') {
          if (s.eliminated.includes(nationId)) return 'Nation éliminée 💀';
          const subtotal = price * quantity;
          const tax      = calcTax(subtotal, price, isKO);
          const total    = subtotal + tax;
          if (s.cash < total) return 'Fonds insuffisants';

          const prevQty = s.portfolio[nationId] ?? 0;
          const prevAvg = s.avgCost[nationId] ?? price;
          const newQty  = prevQty + quantity;
          const newAvg  = prevQty === 0
            ? price
            : Math.round(((prevAvg * prevQty + price * quantity) / newQty) * 10) / 10;

          set({
            cash:      Math.round((s.cash - total) * 10) / 10,
            portfolio: { ...s.portfolio, [nationId]: newQty },
            avgCost:   { ...s.avgCost,   [nationId]: newAvg },
            txLog:     [{ dir: 'buy' as const, flag: n.flag, name: n.name, qty: quantity, price, day: s.dayIndex }, ...s.txLog].slice(0, 100),
          });
        } else {
          const prevQty = s.portfolio[nationId] ?? 0;
          if (prevQty < quantity) return 'Actions insuffisantes';

          const subtotal = price * quantity;
          const tax      = s.eliminated.includes(nationId) ? 0 : calcTax(subtotal, price, isKO);
          const net      = subtotal - tax;

          const newQty  = prevQty - quantity;
          const newPort = { ...s.portfolio };
          const newAvgs = { ...s.avgCost };
          if (newQty > 0) newPort[nationId] = newQty;
          else { delete newPort[nationId]; delete newAvgs[nationId]; }

          set({
            cash:      Math.round((s.cash + net) * 10) / 10,
            portfolio: newPort,
            avgCost:   newAvgs,
            txLog:     [{ dir: 'sell' as const, flag: n.flag, name: n.name, qty: quantity, price, day: s.dayIndex }, ...s.txLog].slice(0, 100),
          });
        }

        // Debounced server save (5 s) — multiple quick trades collapse into one write
        getLoggedInUserId().then(userId => {
          if (!userId) return;
          if (_tradeSaveTimer) clearTimeout(_tradeSaveTimer);
          _tradeSaveTimer = setTimeout(() => {
            const { loading, syncing, error, _pollId, syncFromServer: _sf, ...st } = get() as LocalGameStore;
            writeStateToSupabase(userId, st as PersistedState);
            _tradeSaveTimer = null;
          }, 5_000);
        }).catch(() => {});

        return null;
      },

      // ── advanceDay ──────────────────────────────────────────────────────────
      advanceDay: async () => {
        const s = get();
        const {
          dayIndex, prices, matchResults, eliminated,
          r32Pool, r16Pool, qfPool, sfPool, finalPool, thirdPool,
          portfolio, cash, priceHistory,
        } = s;

        const day = CALENDAR[dayIndex];
        if (!day) return null;

        // Build today's matches using the engine
        const engineState = s as unknown as GameState;
        const todayMatches: Match[] = day.matches.length > 0
          ? day.matches.filter(m =>
              NATIONS.find(n => n.id === m.a) &&
              NATIONS.find(n => n.id === m.b) &&
              !eliminated.includes(m.a) &&
              !eliminated.includes(m.b)
            )
          : day.dynamic
            ? buildMatchesForDay(day.dynamic, engineState)
            : [];

        // Skip empty KO days (can happen if pool not fully populated)
        if (todayMatches.length === 0 && day.isKO) {
          set({ dayIndex: dayIndex + 1 });
          return { results: [], flash: {} };
        }

        // Mutable working copies
        const newPrices    = { ...prices };
        const newElim      = [...eliminated];
        const flash:       Record<string, 'fu' | 'fd'> = {};
        let newR32Pool     = [...r32Pool];
        let newR16Pool     = [...r16Pool];
        let newQfPool      = [...qfPool];
        let newSfPool      = [...sfPool];
        let newFinalPool   = [...finalPool];
        let newThirdPool   = [...thirdPool];
        let newChampion    = s.champion;
        let newCash        = cash;
        let newPortfolio   = { ...portfolio };

        // ── Simulate each match ───────────────────────────────────────────────
        const results: StoredMatchResult[] = todayMatches.map(m => {
          const nA = NATIONS.find(n => n.id === m.a)!;
          const nB = NATIONS.find(n => n.id === m.b)!;
          const pA = newPrices[m.a] ?? nA.p;
          const pB = newPrices[m.b] ?? nB.p;

          const sim           = simulate(nA.str, nB.str, day.isKO);
          const [rawPA, rawPB] = applyResult(pA, pB, sim.res as 'A' | 'B' | 'draw');
          const newPA         = Math.max(1, rawPA);
          const newPB         = Math.max(1, rawPB);
          const [scoreA, scoreB] = genScore(sim.res, sim.res90, sim.etRes, sim.penWinner);
          const goals         = genGoals(scoreA, scoreB, nA, nB, sim.res90, sim.etRes);
          const winnerId      = sim.res === 'draw' ? null : (sim.res === 'A' ? m.a : m.b);
          const loserId       = sim.res === 'draw' ? null : (sim.res === 'A' ? m.b : m.a);
          // KO elimination: loser out, except SF (both go on) and 3rd-place
          const elimId        = day.isKO && day.phase !== 'SF' && day.phase !== '3rd'
            ? loserId : null;

          newPrices[m.a] = newPA;
          newPrices[m.b] = newPB;
          flash[m.a]     = newPA > pA ? 'fu' : 'fd';
          flash[m.b]     = newPB > pB ? 'fu' : 'fd';

          // Eliminate loser + liquidate held shares at 1 KC
          if (elimId && !newElim.includes(elimId)) {
            newElim.push(elimId);
            newPrices[elimId] = 1;
            flash[elimId]     = 'fd';
            const qty = newPortfolio[elimId] ?? 0;
            if (qty > 0) {
              newCash += qty * 1;
              newPortfolio = { ...newPortfolio };
              delete newPortfolio[elimId];
            }
          }
          // 3rd-place match loser also eliminated after the game
          if (day.phase === '3rd' && loserId && !newElim.includes(loserId)) {
            newElim.push(loserId);
            newPrices[loserId] = 1;
            flash[loserId]     = 'fd';
          }

          return {
            a: m.a, b: m.b, scoreA, scoreB,
            res:   sim.res      as 'A' | 'B' | 'draw',
            res90: sim.res90    as 'A' | 'B' | 'draw',
            isUpset: sim.isUpset,
            pA, pB, newPA, newPB,
            elimId, winnerId, loserId,
            venue: m.venue, goals,
            etRes: sim.etRes, penWinner: sim.penWinner,
            penA: sim.penA, penB: sim.penB,
            divCash: 0, phase: day.phase,
          };
        });

        // ── Build R32 pool after last group stage day (index 16) ──────────────
        if (dayIndex === 16 && newR32Pool.length === 0) {
          const allRes = { ...matchResults, [dayIndex]: results } as Record<number, StoredMatchResult[]>;
          newR32Pool = buildR32Pool(allRes, newElim);
          const qualified = new Set(newR32Pool.filter(Boolean));
          for (const n of NATIONS) {
            if (!qualified.has(n.id) && !newElim.includes(n.id)) {
              newElim.push(n.id);
              newPrices[n.id] = 1;
              flash[n.id]     = 'fd';
            }
          }
        }

        // ── KO pools + dividends for current player ───────────────────────────
        for (const r of results) {
          if (!day.isKO) continue;

          if (r.winnerId) {
            if (day.phase === 'R32' && !newR16Pool.includes(r.winnerId))  newR16Pool.push(r.winnerId);
            if (day.phase === 'R16' && !newQfPool.includes(r.winnerId))   newQfPool.push(r.winnerId);
            if (day.phase === 'QF'  && !newSfPool.includes(r.winnerId))   newSfPool.push(r.winnerId);
            if (day.phase === 'SF') {
              if (!newFinalPool.includes(r.winnerId)) newFinalPool.push(r.winnerId);
              if (r.loserId && !newThirdPool.includes(r.loserId)) newThirdPool.push(r.loserId);
            }
            if (day.phase === 'Final') newChampion = r.winnerId;

            // Dividend for winner
            if (day.divKey) {
              const divPerShare = calcDividend(newPrices[r.winnerId] ?? r.newPA, day.divKey);
              const qty = newPortfolio[r.winnerId] ?? 0;
              if (qty > 0 && divPerShare > 0) {
                const total = Math.round(divPerShare * qty * 10) / 10;
                newCash += total;
                r.divCash = total;
              }
            }
          }

          // Final: runner-up also gets a dividend
          if (day.phase === 'Final' && r.loserId && day.divKey) {
            const divPerShare = calcDividend(newPrices[r.loserId] ?? r.newPB, day.divKey);
            const qty = newPortfolio[r.loserId] ?? 0;
            if (qty > 0 && divPerShare > 0) {
              newCash += Math.round(divPerShare * qty * 10) / 10;
            }
          }
        }

        // Champion bonus (separate rate)
        if (newChampion && day.phase === 'Final') {
          const champRate  = DIV_RATES['champion'] ?? 0.60;
          const champPrice = newPrices[newChampion] ?? 1;
          const qty        = newPortfolio[newChampion] ?? 0;
          if (qty > 0) {
            const champDiv = Math.round(champPrice * champRate * qty * 10) / 10;
            newCash += champDiv;
          }
        }

        const newDayIndex = dayIndex + 1;

        // ── Price history ─────────────────────────────────────────────────────
        const newPriceHistory = { ...priceHistory };
        for (const [id, price] of Object.entries(newPrices)) {
          newPriceHistory[id] = [...(newPriceHistory[id] ?? []), price];
        }

        const newMatchResults = { ...matchResults, [dayIndex]: results };

        // ── Best score ────────────────────────────────────────────────────────
        const portVal = Object.entries(newPortfolio)
          .reduce((acc, [id, qty]) => acc + qty * (newPrices[id] ?? 0), 0);
        const newTotal    = newCash + portVal;
        const newBestScore = s.bestScore === null || newTotal > s.bestScore
          ? newTotal : s.bestScore;

        set({
          dayIndex:     newDayIndex,
          prices:       newPrices,
          priceHistory: newPriceHistory,
          eliminated:   newElim,
          r32Pool:      newR32Pool,
          r16Pool:      newR16Pool,
          qfPool:       newQfPool,
          sfPool:       newSfPool,
          finalPool:    newFinalPool,
          thirdPool:    newThirdPool,
          champion:     newChampion,
          cash:         Math.round(newCash * 10) / 10,
          portfolio:    newPortfolio,
          matchResults: newMatchResults,
          bestScore:    newBestScore,
        });

        // Async: push best score to leaderboard
        if (newBestScore !== s.bestScore) {
          syncBestScore(newBestScore).catch(() => {});
        }

        // Immediate server save for registered users (day advance is a major checkpoint)
        getLoggedInUserId().then(userId => {
          if (!userId) return;
          // Read freshly-committed state from store
          const { loading, syncing, error, _pollId, syncFromServer: _sf, ...fresh } = get() as LocalGameStore;
          writeStateToSupabase(userId, fresh as PersistedState);
        }).catch(() => {});

        return { results, flash };
      },

      // ── resetGame ────────────────────────────────────────────────────────────
      resetGame: () => {
        set({ ...emptyState(), loading: false, syncing: false, error: null, _pollId: null });
      },
    }),
    {
      name: 'ks-game-state',
      storage: createJSONStorage(() => {
        // Guard against SSR (localStorage is undefined on server)
        if (typeof window === 'undefined') {
          return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        }
        return localStorage;
      }),
      // Only persist actual game state — not UI/lifecycle fields
      partialize: (state) => ({
        cash:         state.cash,
        portfolio:    state.portfolio,
        avgCost:      state.avgCost,
        txLog:        state.txLog,
        prices:       state.prices,
        priceHistory: state.priceHistory,
        dayIndex:     state.dayIndex,
        eliminated:   state.eliminated,
        champion:     state.champion,
        matchResults: state.matchResults,
        r32Pool:      state.r32Pool,
        r16Pool:      state.r16Pool,
        qfPool:       state.qfPool,
        sfPool:       state.sfPool,
        finalPool:    state.finalPool,
        thirdPool:    state.thirdPool,
        bestScore:    state.bestScore,
      }),
    },
  ),
);

// ── buildMatchesForCurrentDay — UI compatibility ───────────────────────────────
export function buildMatchesForCurrentDay(state: GameState): Match[] {
  const day = CALENDAR[state.dayIndex];
  if (!day) return [];
  if (day.matches.length > 0) {
    return day.matches.filter(m => {
      const nA = NATIONS.find(n => n.id === m.a);
      const nB = NATIONS.find(n => n.id === m.b);
      return nA && nB && !state.eliminated.includes(m.a) && !state.eliminated.includes(m.b);
    });
  }
  if (day.dynamic) {
    return buildMatchesForDay(day.dynamic, state).filter(m =>
      NATIONS.find(n => n.id === m.a) && NATIONS.find(n => n.id === m.b)
    );
  }
  return [];
}
