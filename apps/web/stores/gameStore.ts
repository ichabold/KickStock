'use client';

/**
 * gameStore — Centralized multiplayer version.
 *
 * State is authoritative on the server (Supabase DB).
 * The store is a client-side cache updated by:
 *   1. Initial fetch on mount
 *   2. Polling every 3 s (via startSync / stopSync)
 *   3. Optimistic updates after trade / advanceDay responses
 *
 * No persist middleware — localStorage only stores device_id (see lib/device.ts).
 */

import { create } from 'zustand';
import { getDeviceId } from '@/lib/device';
import { fetchGameState, apiTrade, apiAdvanceDay } from '@/lib/api';
import { pctOf, fmt } from '@kickstock/game-engine';
import { NATIONS } from '@kickstock/constants';
import type { GameState, TradeMode, StoredMatchResult, Match } from '@kickstock/types';

export { fmt, pctOf };

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdvanceDayResult {
  results: StoredMatchResult[];
  flash:   Record<string, 'fu' | 'fd'>;
}

interface GameStore extends GameState {
  // ── Async lifecycle ────────────────────────────────────────────────────────
  loading:   boolean;
  syncing:   boolean;  // background poll in flight
  error:     string | null;

  // ── Actions ────────────────────────────────────────────────────────────────
  fetchState: () => Promise<void>;
  startSync:  () => void;
  stopSync:   () => void;

  trade: (mode: TradeMode, nationId: string, quantity: number) => Promise<string | null>;
  advanceDay: () => Promise<AdvanceDayResult | null>;
  resetGame:  () => void;

  // ── Internal (poll interval id) ────────────────────────────────────────────
  _pollId: ReturnType<typeof setInterval> | null;
}

// ── Empty state (before first fetch) ─────────────────────────────────────────

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

export const useGameStore = create<GameStore>((set, get) => ({
  ...emptyState(),
  loading:  true,
  syncing:  false,
  error:    null,
  _pollId:  null,

  // ── fetchState ───────────────────────────────────────────────────────────────
  fetchState: async () => {
    const deviceId = getDeviceId();
    try {
      const data = await fetchGameState(deviceId);
      // Enrich txLog with flag/name from NATIONS constant
      const enriched = data.txLog.map(t => {
        const n = NATIONS.find(x => x.id === t.name) ?? null;
        return { ...t, flag: n?.flag ?? '', name: n?.name ?? t.name };
      });
      set({
        cash:         data.cash,
        portfolio:    data.portfolio,
        avgCost:      data.avgCost,
        prices:       data.prices,
        priceHistory: data.priceHistory,
        dayIndex:     data.dayIndex,
        eliminated:   data.eliminated,
        champion:     data.champion,
        matchResults: data.matchResults,
        r32Pool:      data.r32Pool,
        r16Pool:      data.r16Pool,
        qfPool:       data.qfPool,
        sfPool:       data.sfPool,
        finalPool:    data.finalPool,
        thirdPool:    data.thirdPool,
        txLog:        enriched,
        bestScore:    data.bestScore,
        loading:      false,
        syncing:      false,
        error:        null,
      });
    } catch (err) {
      set({ loading: false, syncing: false, error: String(err) });
    }
  },

  // ── startSync / stopSync ─────────────────────────────────────────────────────
  startSync: () => {
    const existing = get()._pollId;
    if (existing) return;  // already running

    // Initial load
    get().fetchState();

    const id = setInterval(() => {
      if (get().syncing) return;  // skip if previous poll still in flight
      set({ syncing: true });
      get().fetchState();
    }, 3_000);

    set({ _pollId: id });
  },

  stopSync: () => {
    const id = get()._pollId;
    if (id) {
      clearInterval(id);
      set({ _pollId: null });
    }
  },

  // ── trade ─────────────────────────────────────────────────────────────────────
  trade: async (mode, nationId, quantity) => {
    const deviceId = getDeviceId();
    const s        = get();
    const n        = NATIONS.find(x => x.id === nationId);
    if (!n) return 'Nation introuvable';

    // Optimistic local state update while waiting for API
    const price = s.prices[nationId] ?? n.p;
    const held  = s.portfolio[nationId] ?? 0;
    const isKO  = !!s.dayIndex && s.dayIndex > 16;

    if (mode === 'buy') {
      // Optimistic check (server will also validate)
      if (s.eliminated.includes(nationId)) return 'Nation éliminée 💀';
      const cost = price * quantity;
      if (cost > s.cash) return 'Fonds insuffisants';
    } else {
      if (held < quantity) return 'Actions insuffisantes';
    }

    const result = await apiTrade(deviceId, mode, nationId, quantity);
    if (result.error) return result.error;

    // Apply server-confirmed values
    if (mode === 'buy') {
      const prevAvg = s.avgCost[nationId] ?? n.p;
      const newAvg  = held === 0 ? price : (held * prevAvg + quantity * price) / (held + quantity);
      const txEntry = { dir: 'buy' as const, flag: n.flag, name: n.name, qty: quantity, price, day: s.dayIndex };
      set({
        cash:     result.newCash ?? Math.round((s.cash - price * quantity) * 10) / 10,
        portfolio: { ...s.portfolio, [nationId]: held + quantity },
        avgCost:  { ...s.avgCost,   [nationId]: Math.round(newAvg * 10) / 10 },
        txLog:    [txEntry, ...s.txLog].slice(0, 100),
      });
    } else {
      const gross   = price * quantity;
      const fee     = isKO ? gross * 0.10 : gross * 0.05;
      const net     = gross - (s.eliminated.includes(nationId) ? 0 : fee);
      const newHeld = Math.max(0, held - quantity);
      const newPort = { ...s.portfolio };
      const newAvgs = { ...s.avgCost };
      if (newHeld > 0) newPort[nationId] = newHeld;
      else { delete newPort[nationId]; delete newAvgs[nationId]; }
      const txEntry = { dir: 'sell' as const, flag: n.flag, name: n.name, qty: quantity, price, day: s.dayIndex };
      set({
        cash:      result.newCash ?? Math.round((s.cash + net) * 10) / 10,
        portfolio: newPort,
        avgCost:   newAvgs,
        txLog:     [txEntry, ...s.txLog].slice(0, 100),
      });
    }

    return null;
  },

  // ── advanceDay ────────────────────────────────────────────────────────────────
  advanceDay: async () => {
    const deviceId = getDeviceId();
    const s        = get();

    const response = await apiAdvanceDay(deviceId, s.dayIndex);
    if (!response || !response.results) return null;

    // Apply server-confirmed new state immediately
    set({
      prices:      response.prices,
      eliminated:  response.eliminated,
      r32Pool:     response.r32Pool,
      r16Pool:     response.r16Pool,
      qfPool:      response.qfPool,
      sfPool:      response.sfPool,
      finalPool:   response.finalPool,
      thirdPool:   response.thirdPool,
      champion:    response.champion,
      dayIndex:    response.newDayIndex,
      cash:        response.newCash ?? s.cash,
      matchResults: {
        ...s.matchResults,
        [s.dayIndex]: response.results,
      },
    });

    // Compute best score
    const totalVal = (response.newCash ?? s.cash) +
      Object.entries(s.portfolio).reduce(
        (acc, [id, q]) => acc + q * (response.prices[id] ?? s.prices[id] ?? 0), 0,
      );
    if (s.bestScore === null || totalVal > s.bestScore) {
      set({ bestScore: totalVal });
    }

    return {
      results: response.results,
      flash:   response.flash,
    };
  },

  // ── resetGame ─────────────────────────────────────────────────────────────────
  resetGame: () => {
    // Note: resetting only resets the LOCAL cache.
    // The shared game_state in DB is not reset by individual players.
    // (Admin would need to reset the DB directly.)
    set({ ...emptyState(), loading: false });
  },
}));

// ── buildMatchesForCurrentDay — kept for UI compatibility ────────────────────
import { buildMatchesForDay } from '@kickstock/game-engine';
import { CALENDAR } from '@kickstock/constants';

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
