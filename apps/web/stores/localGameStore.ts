'use client';

/**
 * localGameStore — Offline / per-player game store.
 *
 * Game state lives in localStorage via Zustand persist.
 * Team and calendar data come from /api/competition/bootstrap (cached 24h).
 * Simulation runs fully client-side using @kickstock/game-engine.
 *
 * NO hardcoded CALENDAR or NATIONS — everything comes from the bootstrap.
 */

import { create }                     from 'zustand';
import { persist, createJSONStorage }  from 'zustand/middleware';
import {
  simulate, applyResult, calcTax, calcDividend,
  genScore, genGoals, buildR32Pool, buildMatchesForDay,
  pctOf, fmt, mulberry32, seedFromString,
} from '@kickstock/game-engine';
import { DIV_RATES, INIT_CASH }  from '@kickstock/constants';
import { syncBestScore }          from '@/hooks/useAuth';
import { createClient }           from '@/lib/supabase/client';
import { getBootstrap, bootstrapToTeams, deriveDynamicKey, buildMatchesForCurrentDayFromBootstrap } from '@/lib/bootstrap';

const COMPETITION_KEY = 'kickstock:competition';

// 0 = no explicit choice — getBootstrap resolves to the active competition.
function getLocalCompetitionId(): number {
  if (typeof window === 'undefined') return 0;
  const stored = localStorage.getItem(COMPETITION_KEY);
  return stored ? parseInt(stored, 10) : 0;
}
import type {
  GameState, TradeMode, StoredMatchResult, Match,
  TeamMeta, BootstrapData, BootstrapDay,
} from '@kickstock/types';

// ── Cross-device sync helpers ─────────────────────────────────────────────────

async function getLoggedInUserId(): Promise<string | null> {
  try {
    const { data: { user } } = await createClient().auth.getUser();
    return user?.id ?? null;
  } catch { return null; }
}

type PersistedState = Omit<GameState, never>;

async function writeStateToSupabase(userId: string, state: PersistedState): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (createClient() as any)
      .from('user_game_states')
      .upsert(
        { user_id: userId, game_state: state, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
  } catch { /* best-effort */ }
}

let _tradeSaveTimer: ReturnType<typeof setTimeout> | null = null;

export { fmt, pctOf };

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdvanceDayResult {
  results: StoredMatchResult[];
  flash:   Record<string, 'fu' | 'fd'>;
}

interface LocalGameStore extends GameState {
  gameId: string;

  // Bootstrap state (not persisted)
  _bootstrap:        BootstrapData | null;
  _teams:            TeamMeta[];
  bootstrapLoading:  boolean;
  bootstrapError:    boolean;

  loading:  boolean;
  syncing:  boolean;
  error:    string | null;
  _pollId:  ReturnType<typeof setInterval> | null;

  fetchState:       () => Promise<void>;
  loadBootstrap:    () => Promise<void>;
  startSync:        () => void;
  stopSync:         () => void;
  trade:            (mode: TradeMode, nationId: string, quantity: number) => Promise<string | null>;
  advanceDay:       () => Promise<AdvanceDayResult | null>;
  resetGame:        () => void;
  syncFromServer:   () => Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyPrices(teams: TeamMeta[]): Record<string, number> {
  return Object.fromEntries(teams.map(t => [t.id, t.initialPrice]));
}

function emptyHistory(teams: TeamMeta[]): Record<string, number[]> {
  return Object.fromEntries(teams.map(t => [t.id, [t.initialPrice]]));
}

function baseState(): GameState {
  return {
    cash: INIT_CASH, portfolio: {}, avgCost: {},
    prices: {}, priceHistory: {},
    dayIndex: 0, eliminated: [], champion: null,
    matchResults: {}, r32Pool: [], r16Pool: [], qfPool: [],
    sfPool: [], finalPool: [], thirdPool: [], txLog: [], bestScore: null,
  };
}

/** Returns the BootstrapDay for a given dayIndex, or null if tournament is over. */
function getDay(bootstrap: BootstrapData | null, dayIndex: number): BootstrapDay | null {
  if (!bootstrap) return null;
  return bootstrap.days.find(d => d.day_index === dayIndex) ?? null;
}

/**
 * The calendar has gaps between phases (rest days with no competition_days
 * row, e.g. day 23 between the last R32 day and the first R16 day).
 * Returns the smallest day_index >= fromIndex, or fromIndex itself if no
 * day exists at or after it (tournament truly over).
 */
function nextDayIndex(bootstrap: BootstrapData, fromIndex: number): number {
  const upcoming = bootstrap.days.map(d => d.day_index).filter(di => di >= fromIndex);
  return upcoming.length > 0 ? Math.min(...upcoming) : fromIndex;
}

/** Returns group-stage fixtures for a given dayIndex. */
function getGroupFixtures(bootstrap: BootstrapData | null, dayIndex: number): Match[] {
  if (!bootstrap) return [];
  return bootstrap.group_fixtures
    .filter(f => f.day_index === dayIndex)
    .map(f => ({ a: f.nation_a, b: f.nation_b, venue: f.venue ?? undefined }));
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useLocalGameStore = create<LocalGameStore>()(
  persist(
    (set, get) => ({
      ...baseState(),
      gameId:           crypto.randomUUID(),
      _bootstrap:       null,
      _teams:           [],
      bootstrapLoading: false,
      bootstrapError:   false,
      loading:          false,
      syncing:          false,
      error:            null,
      _pollId:          null,

      // ── loadBootstrap ────────────────────────────────────────────────────────
      loadBootstrap: async () => {
        const current = get();
        if (current._bootstrap || current.bootstrapLoading) return;

        set({ bootstrapLoading: true, bootstrapError: false });
        const competitionId = getLocalCompetitionId();
        const data = await getBootstrap(competitionId || undefined);

        if (!data) {
          set({ bootstrapLoading: false, bootstrapError: true });
          return;
        }

        const teams = bootstrapToTeams(data);

        // If prices are empty (fresh game or reset), seed them from bootstrap
        const existing = get();
        const needsSeed = Object.keys(existing.prices).length === 0;

        set({
          _bootstrap:      data,
          _teams:          teams,
          bootstrapLoading: false,
          ...(needsSeed ? {
            prices:       emptyPrices(teams),
            priceHistory: emptyHistory(teams),
          } : {}),
        });
      },

      // ── fetchState ───────────────────────────────────────────────────────────
      fetchState: async () => {
        set({ loading: false });
        await get().loadBootstrap();
      },

      // ── syncFromServer ───────────────────────────────────────────────────────
      syncFromServer: async () => {
        const userId = await getLoggedInUserId();
        if (!userId) return;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data } = await (createClient() as any)
            .from('user_game_states').select('game_state')
            .eq('user_id', userId).single();

          const s = get();
          const { loading, syncing, error, _pollId, _bootstrap, _teams,
                  bootstrapLoading, bootstrapError,
                  syncFromServer: _sf, ...localState } = s as LocalGameStore;

          if (data?.game_state) {
            const serverState = data.game_state as Partial<GameState>;
            if ((serverState.dayIndex ?? 0) >= s.dayIndex) {
              set({ ...(serverState as GameState), loading: false, syncing: false, error: null });
            } else {
              await writeStateToSupabase(userId, localState as PersistedState);
            }
          } else {
            const fresh = { ...baseState(), prices: emptyPrices(get()._teams), priceHistory: emptyHistory(get()._teams) };
            set({ ...fresh, loading: false, syncing: false, error: null });
            await writeStateToSupabase(userId, fresh as PersistedState);
          }
        } catch { /* best-effort */ }
      },

      // ── startSync / stopSync ────────────────────────────────────────────────
      startSync: () => {
        const existing = get()._pollId;
        if (existing) return;
        get().loadBootstrap();
        const { bestScore } = get();
        if (bestScore) syncBestScore(bestScore, get()._bootstrap?.competition.id ?? null).catch(() => {});
        const id = setInterval(() => {
          const { bestScore: bs } = get();
          if (bs) syncBestScore(bs, get()._bootstrap?.competition.id ?? null).catch(() => {});
        }, 60_000);
        set({ _pollId: id });
      },

      stopSync: () => {
        const id = get()._pollId;
        if (id) clearInterval(id);
        set({ _pollId: null });
      },

      // ── trade ────────────────────────────────────────────────────────────────
      trade: async (mode, nationId, quantity) => {
        const s = get();
        const team = s._teams.find(t => t.id === nationId);
        if (!team) return 'Nation introuvable';

        const price      = s.prices[nationId] ?? team.initialPrice;
        const currentDay = s._bootstrap?.days.find(d => d.day_index === s.dayIndex) ?? null;
        const isKO       = currentDay?.is_ko ?? (s.dayIndex >= 17);

        if (mode === 'buy') {
          if (s.eliminated.includes(nationId)) return 'Nation éliminée 💀';
          const total = price * quantity;
          if (s.cash < total) return 'Fonds insuffisants';

          const prevQty = s.portfolio[nationId] ?? 0;
          const prevAvg = s.avgCost[nationId] ?? price;
          const newQty  = prevQty + quantity;
          const newAvg  = prevQty === 0 ? price
            : Math.round(((prevAvg * prevQty + price * quantity) / newQty) * 10) / 10;

          set({
            cash:      Math.round((s.cash - total) * 10) / 10,
            portfolio: { ...s.portfolio, [nationId]: newQty },
            avgCost:   { ...s.avgCost,   [nationId]: newAvg },
            txLog:     [{ dir: 'buy' as const, flag: team.flag, name: team.name, qty: quantity, price, day: s.dayIndex }, ...s.txLog].slice(0, 100),
          });
        } else {
          const prevQty = s.portfolio[nationId] ?? 0;
          if (prevQty < quantity) return 'Actions insuffisantes';
          const subtotal = price * quantity;
          const tax      = s.eliminated.includes(nationId) ? 0 : calcTax(subtotal, price, isKO);
          const net      = subtotal - tax;
          const newQty   = prevQty - quantity;
          const newPort  = { ...s.portfolio };
          const newAvgs  = { ...s.avgCost };
          if (newQty > 0) newPort[nationId] = newQty;
          else { delete newPort[nationId]; delete newAvgs[nationId]; }

          set({
            cash:      Math.round((s.cash + net) * 10) / 10,
            portfolio: newPort,
            avgCost:   newAvgs,
            txLog:     [{ dir: 'sell' as const, flag: team.flag, name: team.name, qty: quantity, price, day: s.dayIndex }, ...s.txLog].slice(0, 100),
          });
        }

        getLoggedInUserId().then(userId => {
          if (!userId) return;
          if (_tradeSaveTimer) clearTimeout(_tradeSaveTimer);
          _tradeSaveTimer = setTimeout(() => {
            const { loading, syncing, error, _pollId, _bootstrap, _teams,
                    bootstrapLoading, bootstrapError,
                    syncFromServer: _sf, ...st } = get() as LocalGameStore;
            writeStateToSupabase(userId, st as PersistedState);
            _tradeSaveTimer = null;
          }, 5_000);
        }).catch(() => {});

        return null;
      },

      // ── advanceDay ───────────────────────────────────────────────────────────
      advanceDay: async () => {
        const s = get();
        const { _bootstrap, _teams, dayIndex, prices, matchResults, eliminated,
                r32Pool, r16Pool, qfPool, sfPool, finalPool, thirdPool,
                portfolio, cash, priceHistory } = s;

        if (!_bootstrap || _teams.length === 0) {
          await get().loadBootstrap();
          return null;
        }

        const day = getDay(_bootstrap, dayIndex);
        if (!day) {
          // dayIndex landed on a calendar gap (rest day with no
          // competition_days row) — skip ahead to the next real day.
          const next = nextDayIndex(_bootstrap, dayIndex);
          if (next === dayIndex) return null; // tournament truly over
          set({ dayIndex: next });
          return { results: [], flash: {} };
        }

        // Build today's matches
        const engineState = s as unknown as GameState;
        const todayMatches: Match[] = day.is_ko
          ? buildMatchesForDay(
              // derive the "dynamic" key from the phase + pool indices
              deriveDynamicKey(day.phase, dayIndex, _bootstrap),
              engineState
            )
          : getGroupFixtures(_bootstrap, dayIndex).filter(m =>
              !eliminated.includes(m.a) && !eliminated.includes(m.b)
            );

        if (todayMatches.length === 0 && day.is_ko) {
          set({ dayIndex: nextDayIndex(_bootstrap, dayIndex + 1) });
          return { results: [], flash: {} };
        }

        const newPrices  = { ...prices };
        const newElim    = [...eliminated];
        const flash: Record<string, 'fu' | 'fd'> = {};
        let newR32Pool   = [...r32Pool];
        let newR16Pool   = [...r16Pool];
        let newQfPool    = [...qfPool];
        let newSfPool    = [...sfPool];
        let newFinalPool = [...finalPool];
        let newThirdPool = [...thirdPool];
        let newChampion  = s.champion;
        let newCash      = cash;
        let newPortfolio = { ...portfolio };

        const results: StoredMatchResult[] = todayMatches.map(m => {
          const tA = _teams.find(t => t.id === m.a)!;
          const tB = _teams.find(t => t.id === m.b)!;
          const pA = newPrices[m.a] ?? tA.initialPrice;
          const pB = newPrices[m.b] ?? tB.initialPrice;

          const matchSeed = seedFromString(`${get().gameId}:${dayIndex}:${m.a}:${m.b}`);
          const rng       = mulberry32(matchSeed);
          const sim       = simulate(tA.strength, tB.strength, day.is_ko, rng);
          const [rawPA, rawPB]  = applyResult(pA, pB, sim.res as 'A' | 'B' | 'draw');
          const newPA          = Math.max(1, rawPA);
          const newPB          = Math.max(1, rawPB);
          const [scoreA, scoreB] = genScore(sim.res, sim.res90, sim.etRes, sim.penWinner);
          const goals = genGoals(scoreA, scoreB,
            { id: tA.id, name: tA.name, squad: _bootstrap?.squads?.[tA.id] },
            { id: tB.id, name: tB.name, squad: _bootstrap?.squads?.[tB.id] },
            sim.res90, sim.etRes,
          );
          const winnerId = sim.res === 'draw' ? null : (sim.res === 'A' ? m.a : m.b);
          const loserId  = sim.res === 'draw' ? null : (sim.res === 'A' ? m.b : m.a);
          const elimId   = day.is_ko && day.phase !== 'SF' && day.phase !== '3rd' ? loserId : null;

          newPrices[m.a] = newPA;
          newPrices[m.b] = newPB;
          flash[m.a]     = newPA > pA ? 'fu' : 'fd';
          flash[m.b]     = newPB > pB ? 'fu' : 'fd';

          if (elimId && !newElim.includes(elimId)) {
            newElim.push(elimId);
            newPrices[elimId] = 1;
            flash[elimId]     = 'fd';
            const qty = newPortfolio[elimId] ?? 0;
            if (qty > 0) { newCash += qty * 1; newPortfolio = { ...newPortfolio }; delete newPortfolio[elimId]; }
          }
          if (day.phase === '3rd' && loserId && !newElim.includes(loserId)) {
            newElim.push(loserId); newPrices[loserId] = 1; flash[loserId] = 'fd';
          }

          return {
            a: m.a, b: m.b, scoreA, scoreB,
            res:     sim.res      as 'A' | 'B' | 'draw',
            res90:   sim.res90    as 'A' | 'B' | 'draw',
            isUpset: sim.isUpset,
            pA, pB, newPA, newPB,
            elimId, winnerId, loserId,
            venue: m.venue, goals,
            etRes: sim.etRes, penWinner: sim.penWinner,
            penA: sim.penA, penB: sim.penB,
            divCash: 0, phase: day.phase,
          };
        });

        // R32 pool after last group day
        const isLastGroupDay = day.phase === 'Groups' &&
          !_bootstrap.days.some(d => d.phase === 'Groups' && d.day_index > dayIndex);

        if (isLastGroupDay && newR32Pool.length === 0) {
          const allRes = { ...matchResults, [dayIndex]: results } as Record<number, StoredMatchResult[]>;
          newR32Pool = buildR32Pool(allRes, newElim, _teams);
          const qualified = new Set(newR32Pool.filter(Boolean));
          for (const t of _teams) {
            if (!qualified.has(t.id) && !newElim.includes(t.id)) {
              newElim.push(t.id); newPrices[t.id] = 1; flash[t.id] = 'fd';
            }
          }
        }

        // KO pools + dividends
        for (const r of results) {
          if (!day.is_ko) continue;
          if (r.winnerId) {
            if (day.phase === 'R32' && !newR16Pool.includes(r.winnerId))  newR16Pool.push(r.winnerId);
            if (day.phase === 'R16' && !newQfPool.includes(r.winnerId))   newQfPool.push(r.winnerId);
            if (day.phase === 'QF'  && !newSfPool.includes(r.winnerId))   newSfPool.push(r.winnerId);
            if (day.phase === 'SF') {
              if (!newFinalPool.includes(r.winnerId)) newFinalPool.push(r.winnerId);
              if (r.loserId && !newThirdPool.includes(r.loserId)) newThirdPool.push(r.loserId);
            }
            if (day.phase === 'Final') newChampion = r.winnerId;

            if (day.div_key) {
              const divPerShare = calcDividend(newPrices[r.winnerId] ?? r.newPA, day.div_key);
              const qty = newPortfolio[r.winnerId] ?? 0;
              if (qty > 0 && divPerShare > 0) {
                const total = Math.round(divPerShare * qty * 10) / 10;
                newCash += total; r.divCash = total;
              }
            }
          }
          if (day.phase === 'Final' && r.loserId && day.div_key) {
            const divPerShare = calcDividend(newPrices[r.loserId] ?? r.newPB, day.div_key);
            const qty = newPortfolio[r.loserId] ?? 0;
            if (qty > 0 && divPerShare > 0) newCash += Math.round(divPerShare * qty * 10) / 10;
          }
        }

        if (newChampion && day.phase === 'Final') {
          const champRate  = DIV_RATES['champion'] ?? 0.60;
          const qty        = newPortfolio[newChampion] ?? 0;
          if (qty > 0) newCash += Math.round((newPrices[newChampion] ?? 1) * champRate * qty * 10) / 10;
        }

        const newDayIndex      = nextDayIndex(_bootstrap, dayIndex + 1);
        const newPriceHistory  = { ...priceHistory };
        for (const [id, price] of Object.entries(newPrices)) {
          newPriceHistory[id] = [...(newPriceHistory[id] ?? []), price];
        }

        const portVal      = Object.entries(newPortfolio).reduce((acc, [id, qty]) => acc + qty * (newPrices[id] ?? 0), 0);
        const newTotal     = newCash + portVal;
        const newBestScore = s.bestScore === null || newTotal > s.bestScore ? newTotal : s.bestScore;

        set({
          dayIndex: newDayIndex, prices: newPrices, priceHistory: newPriceHistory,
          eliminated: newElim, r32Pool: newR32Pool, r16Pool: newR16Pool,
          qfPool: newQfPool, sfPool: newSfPool, finalPool: newFinalPool,
          thirdPool: newThirdPool, champion: newChampion,
          cash: Math.round(newCash * 10) / 10, portfolio: newPortfolio,
          matchResults: { ...matchResults, [dayIndex]: results },
          bestScore: newBestScore,
        });

        if (newBestScore !== s.bestScore) syncBestScore(newBestScore, _bootstrap?.competition.id ?? null).catch(() => {});

        getLoggedInUserId().then(userId => {
          if (!userId) return;
          const { loading, syncing, error, _pollId, _bootstrap: _b, _teams: _t,
                  bootstrapLoading, bootstrapError,
                  syncFromServer: _sf, ...fresh } = get() as LocalGameStore;
          writeStateToSupabase(userId, fresh as PersistedState);
        }).catch(() => {});

        return { results, flash };
      },

      // ── resetGame ────────────────────────────────────────────────────────────
      resetGame: () => {
        const { _teams, bestScore } = get();
        set({
          ...baseState(),
          gameId:       crypto.randomUUID(),
          bestScore,
          prices:       emptyPrices(_teams),
          priceHistory: emptyHistory(_teams),
          loading: false, syncing: false, error: null, _pollId: null,
        });
      },
    }),
    {
      name: `ks-game-state-${getLocalCompetitionId()}`,
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') {
          return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        }
        return localStorage;
      }),
      partialize: (state) => ({
        gameId: state.gameId,
        cash: state.cash, portfolio: state.portfolio, avgCost: state.avgCost,
        txLog: state.txLog, prices: state.prices, priceHistory: state.priceHistory,
        dayIndex: state.dayIndex, eliminated: state.eliminated, champion: state.champion,
        matchResults: state.matchResults, r32Pool: state.r32Pool, r16Pool: state.r16Pool,
        qfPool: state.qfPool, sfPool: state.sfPool, finalPool: state.finalPool,
        thirdPool: state.thirdPool, bestScore: state.bestScore,
      }),
    },
  ),
);

// ── buildMatchesForCurrentDay — exported for SimulateTab UI ──────────────────
export function buildMatchesForCurrentDay(
  state: GameState & { _bootstrap?: BootstrapData | null; _teams?: TeamMeta[] }
): Match[] {
  return buildMatchesForCurrentDayFromBootstrap(state as GameState, state._bootstrap ?? null);
}
