'use client';

/**
 * onlineGameStore — Multiplayer version backed by Supabase.
 *
 * State is authoritative on the server (shared game_state row).
 * Push model: Supabase Realtime notifies of game_state changes;
 * we refetch only when the server signals something changed.
 * A 30s fallback poll keeps clients in sync if the websocket drops.
 *
 * Team and calendar data come from /api/competition/bootstrap (same as
 * localGameStore — no hardcoded NATIONS or CALENDAR).
 */

import { create } from 'zustand';
import { getDeviceId }                    from '@/lib/device';
import { fetchGameState, apiTrade, apiAdvanceDay } from '@/lib/api';
import { pctOf, fmt, buildMatchesForDay } from '@kickstock/game-engine';
import { getBootstrap, bootstrapToTeams } from '@/lib/bootstrap';
import { createClient }                   from '@/lib/supabase/client';
import type {
  GameState, TradeMode, StoredMatchResult, Match,
  TeamMeta, BootstrapData, BootstrapDay,
} from '@kickstock/types';
import type { RealtimeChannel } from '@supabase/supabase-js';

export { fmt, pctOf };

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdvanceDayResult {
  results: StoredMatchResult[];
  flash:   Record<string, 'fu' | 'fd'>;
}

interface OnlineGameStore extends GameState {
  _bootstrap:        BootstrapData | null;
  _teams:            TeamMeta[];
  bootstrapLoading:  boolean;
  bootstrapError:    boolean;

  loading:          boolean;
  syncing:          boolean;
  error:            string | null;
  _pollId:          ReturnType<typeof setInterval> | null;
  _realtimeChannel: RealtimeChannel | null;

  loadBootstrap:    () => Promise<void>;
  fetchState:       () => Promise<void>;
  startSync:        () => void;
  stopSync:         () => void;
  trade:            (mode: TradeMode, nationId: string, quantity: number) => Promise<string | null>;
  advanceDay:       () => Promise<AdvanceDayResult | null>;
  resetGame:        () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseState(): GameState {
  return {
    cash: 10_000, portfolio: {}, avgCost: {},
    prices: {}, priceHistory: {},
    dayIndex: 0, eliminated: [], champion: null,
    matchResults: {}, r32Pool: [], r16Pool: [], qfPool: [],
    sfPool: [], finalPool: [], thirdPool: [], txLog: [], bestScore: null,
  };
}

function getDay(bootstrap: BootstrapData | null, dayIndex: number): BootstrapDay | null {
  if (!bootstrap) return null;
  return bootstrap.days.find(d => d.day_index === dayIndex) ?? null;
}

function getGroupFixtures(bootstrap: BootstrapData | null, dayIndex: number): Match[] {
  if (!bootstrap) return [];
  return bootstrap.group_fixtures
    .filter(f => f.day_index === dayIndex)
    .map(f => ({ a: f.nation_a, b: f.nation_b, venue: f.venue ?? undefined }));
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useOnlineGameStore = create<OnlineGameStore>((set, get) => ({
  ...baseState(),
  _bootstrap:       null,
  _teams:           [],
  bootstrapLoading: false,
  bootstrapError:   false,
  loading:          true,
  syncing:          false,
  error:            null,
  _pollId:          null,
  _realtimeChannel: null,

  // ── loadBootstrap ────────────────────────────────────────────────────────────
  loadBootstrap: async () => {
    const current = get();
    if (current._bootstrap || current.bootstrapLoading) return;

    set({ bootstrapLoading: true, bootstrapError: false });
    const data = await getBootstrap();

    if (!data) {
      set({ bootstrapLoading: false, bootstrapError: true });
      return;
    }

    set({
      _bootstrap:       data,
      _teams:           bootstrapToTeams(data),
      bootstrapLoading: false,
    });
  },

  // ── fetchState ───────────────────────────────────────────────────────────────
  fetchState: async () => {
    await get().loadBootstrap();
    const teams = get()._teams;

    const deviceId = getDeviceId();
    try {
      const data = await fetchGameState(deviceId);
      const enriched = data.txLog.map(t => {
        const team = teams.find(x => x.id === t.name) ?? null;
        return { ...t, flag: team?.flag ?? '', name: team?.name ?? t.name };
      });
      set({
        cash: data.cash, portfolio: data.portfolio, avgCost: data.avgCost,
        prices: data.prices, priceHistory: data.priceHistory,
        dayIndex: data.dayIndex, eliminated: data.eliminated, champion: data.champion,
        matchResults: data.matchResults, r32Pool: data.r32Pool, r16Pool: data.r16Pool,
        qfPool: data.qfPool, sfPool: data.sfPool, finalPool: data.finalPool,
        thirdPool: data.thirdPool, txLog: enriched, bestScore: data.bestScore,
        loading: false, syncing: false, error: null,
      });
    } catch (err) {
      if (String(err).includes('NOT_MODIFIED')) {
        set({ loading: false, syncing: false });
        return;
      }
      set({ loading: false, syncing: false, error: String(err) });
    }
  },

  // ── startSync ────────────────────────────────────────────────────────────────
  startSync: () => {
    if (get()._pollId || get()._realtimeChannel) return;

    get().fetchState();

    const supabase = createClient();
    const channel = supabase
      .channel('ks_game_state')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'game_state' },
        () => {
          if (get().syncing) return;
          set({ syncing: true });
          get().fetchState();
        },
      )
      .subscribe();

    const id = setInterval(() => {
      if (get().syncing) return;
      set({ syncing: true });
      get().fetchState();
    }, 30_000);

    set({ _pollId: id, _realtimeChannel: channel });
  },

  // ── stopSync ─────────────────────────────────────────────────────────────────
  stopSync: () => {
    const { _pollId, _realtimeChannel } = get();
    if (_pollId) clearInterval(_pollId);
    if (_realtimeChannel) createClient().removeChannel(_realtimeChannel);
    set({ _pollId: null, _realtimeChannel: null });
  },

  // ── trade ────────────────────────────────────────────────────────────────────
  trade: async (mode, nationId, quantity) => {
    const s     = get();
    const team  = s._teams.find(t => t.id === nationId);
    if (!team) return 'Nation introuvable';

    const price = s.prices[nationId] ?? team.initialPrice;
    const held  = s.portfolio[nationId] ?? 0;
    const isKO  = s.dayIndex >= 17;

    if (mode === 'buy') {
      if (s.eliminated.includes(nationId)) return 'Nation éliminée 💀';
      if (price * quantity > s.cash)       return 'Fonds insuffisants';
    } else {
      if (held < quantity) return 'Actions insuffisantes';
    }

    const result = await apiTrade(getDeviceId(), mode, nationId, quantity);
    if (result.error) return result.error;

    if (mode === 'buy') {
      const prevAvg = s.avgCost[nationId] ?? team.initialPrice;
      const newAvg  = held === 0 ? price : (held * prevAvg + quantity * price) / (held + quantity);
      set({
        cash:      result.newCash ?? Math.round((s.cash - price * quantity) * 10) / 10,
        portfolio: { ...s.portfolio, [nationId]: held + quantity },
        avgCost:   { ...s.avgCost, [nationId]: Math.round(newAvg * 10) / 10 },
        txLog:     [{ dir: 'buy' as const, flag: team.flag, name: team.name, qty: quantity, price, day: s.dayIndex }, ...s.txLog].slice(0, 100),
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
      set({
        cash:      result.newCash ?? Math.round((s.cash + net) * 10) / 10,
        portfolio: newPort, avgCost: newAvgs,
        txLog:     [{ dir: 'sell' as const, flag: team.flag, name: team.name, qty: quantity, price, day: s.dayIndex }, ...s.txLog].slice(0, 100),
      });
    }
    return null;
  },

  // ── advanceDay ───────────────────────────────────────────────────────────────
  advanceDay: async () => {
    const s = get();
    const response = await apiAdvanceDay(getDeviceId(), s.dayIndex);
    if (!response?.results) return null;
    set({
      prices: response.prices, eliminated: response.eliminated,
      r32Pool: response.r32Pool, r16Pool: response.r16Pool,
      qfPool: response.qfPool, sfPool: response.sfPool,
      finalPool: response.finalPool, thirdPool: response.thirdPool,
      champion: response.champion, dayIndex: response.newDayIndex,
      cash: response.newCash ?? s.cash,
      matchResults: { ...s.matchResults, [s.dayIndex]: response.results },
    });
    return { results: response.results, flash: response.flash };
  },

  // ── resetGame ────────────────────────────────────────────────────────────────
  resetGame: () => { set({ ...baseState(), loading: false }); },
}));

// ── buildMatchesForCurrentDay — exported for UI tabs ─────────────────────────
export function buildMatchesForCurrentDay(
  state: GameState & { _bootstrap?: BootstrapData | null }
): Match[] {
  const bootstrap = state._bootstrap ?? null;
  const day       = getDay(bootstrap, state.dayIndex);
  if (!day) return [];

  if (!day.is_ko) {
    return getGroupFixtures(bootstrap, state.dayIndex).filter(
      m => !state.eliminated.includes(m.a) && !state.eliminated.includes(m.b)
    );
  }
  return buildMatchesForDay(
    deriveDynamicKey(day.phase, state.dayIndex, bootstrap!),
    state as GameState
  );
}

function deriveDynamicKey(phase: string, dayIndex: number, bootstrap: BootstrapData): string {
  const koDays     = bootstrap.days.filter(d => d.phase === phase).sort((a, b) => a.day_index - b.day_index);
  const posInPhase = koDays.findIndex(d => d.day_index === dayIndex);
  if (phase === 'R32') return (['r32_28','r32_29','r32_30','r32_1','r32_2','r32_3'])[posInPhase] ?? 'r32_1';
  if (phase === 'R16') return (['r16_1','r16_2','r16_3','r16_4'])[posInPhase] ?? 'r16_1';
  if (phase === 'QF')  return (['qf_1','qf_2','qf_3'])[posInPhase] ?? 'qf_1';
  if (phase === 'SF')  return posInPhase === 0 ? 'sf_1' : 'sf_2';
  if (phase === '3rd') return '3rd';
  if (phase === 'Final') return 'final';
  return phase.toLowerCase();
}
