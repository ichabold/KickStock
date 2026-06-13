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
import { fetchGameState, apiTrade, apiAdvanceDay, apiReset } from '@/lib/api';
import { pctOf, fmt } from '@kickstock/game-engine';
import { getBootstrap, bootstrapToTeams, deriveDynamicKey, buildMatchesForCurrentDayFromBootstrap } from '@/lib/bootstrap';
import { createClient }                   from '@/lib/supabase/client';
import type {
  GameState, TradeMode, StoredMatchResult, Match,
  TeamMeta, BootstrapData, BootstrapDay,
} from '@kickstock/types';
import type { RealtimeChannel } from '@supabase/supabase-js';

const COMPETITION_KEY = 'kickstock:competition';

// 0 = no explicit choice — loadBootstrap resolves to the active competition.
export function getCompetitionIdSync(): number {
  if (typeof window === 'undefined') return 0;
  const stored = localStorage.getItem(COMPETITION_KEY);
  return stored ? parseInt(stored, 10) : 0;
}

export function setCompetitionId(id: number): void {
  localStorage.setItem(COMPETITION_KEY, String(id));
  window.location.reload();
}

export { fmt, pctOf };

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdvanceDayResult {
  results: StoredMatchResult[];
  flash:   Record<string, 'fu' | 'fd'>;
}

// Shape returned by GET /api/game/live-matches (subset of `matches` columns)
export interface LiveMatch {
  fixture_id:       number | null;
  nation_a:         string;
  nation_b:         string;
  api_status:       string;
  score_a:          number | null;
  score_b:          number | null;
  trade_lock_until: string | null;
  processed_at:     string | null;
}

interface OnlineGameStore extends GameState {
  _competitionId:    number;
  _bootstrap:        BootstrapData | null;
  _teams:            TeamMeta[];
  bootstrapLoading:  boolean;
  bootstrapError:    boolean;

  loading:          boolean;
  syncing:          boolean;
  error:            string | null;
  _pollId:          ReturnType<typeof setInterval> | null;
  _realtimeChannel: RealtimeChannel | null;

  /** Team IDs whose match is currently live or in its post-match trade-lock window. */
  lockedTeams:      Set<string>;
  /** Raw rows from /api/game/live-matches — used to show live scores on the schedule. */
  liveMatches:      LiveMatch[];
  _lockPollId:      ReturnType<typeof setInterval> | null;

  loadBootstrap:    () => Promise<void>;
  fetchState:       () => Promise<void>;
  startSync:        () => void;
  stopSync:         () => void;
  refreshLockedTeams: () => Promise<void>;
  trade:            (mode: TradeMode, nationId: string, quantity: number) => Promise<string | null>;
  advanceDay:       () => Promise<AdvanceDayResult | null>;
  resetGame:        () => Promise<void>;
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
  _competitionId:   getCompetitionIdSync(),
  _bootstrap:       null,
  _teams:           [],
  bootstrapLoading: false,
  bootstrapError:   false,
  loading:          true,
  syncing:          false,
  error:            null,
  _pollId:          null,
  _realtimeChannel: null,
  lockedTeams:      new Set<string>(),
  liveMatches:      [],
  _lockPollId:      null,

  // ── loadBootstrap ────────────────────────────────────────────────────────────
  loadBootstrap: async () => {
    const current = get();
    if (current._bootstrap || current.bootstrapLoading) return;

    set({ bootstrapLoading: true, bootstrapError: false });
    const data = await getBootstrap(current._competitionId || undefined);

    if (!data) {
      set({ bootstrapLoading: false, bootstrapError: true });
      return;
    }

    set({
      _bootstrap:       data,
      _teams:           bootstrapToTeams(data),
      bootstrapLoading: false,
      // Resolve to the competition the server picked (active one, when none was chosen)
      _competitionId:   data.competition.id,
    });
  },

  // ── fetchState ───────────────────────────────────────────────────────────────
  fetchState: async () => {
    await get().loadBootstrap();
    const deviceId = getDeviceId();
    const competitionId = get()._competitionId;
    try {
      const data = await fetchGameState(deviceId, competitionId);
      set({
        cash: data.cash, portfolio: data.portfolio, avgCost: data.avgCost,
        prices: data.prices, priceHistory: data.priceHistory,
        dayIndex: data.dayIndex, eliminated: data.eliminated, champion: data.champion,
        matchResults: data.matchResults, r32Pool: data.r32Pool, r16Pool: data.r16Pool,
        qfPool: data.qfPool, sfPool: data.sfPool, finalPool: data.finalPool,
        thirdPool: data.thirdPool,
        txLog: data.txLog,
        bestScore: data.bestScore,
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

  // ── refreshLockedTeams ───────────────────────────────────────────────────────
  // Mirrors the server-side check added to execute_competition_trade
  // (db/migrations/023): a team is locked while its match is currently live
  // (api_status IN 1H/HT/2H/ET/BT/P) or while its post-match `trade_lock_until`
  // window (set by process-real-result.ts, +15min) is still active.
  refreshLockedTeams: async () => {
    const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P']);
    try {
      const res = await fetch('/api/game/live-matches', {
        headers: { 'X-Competition-ID': String(get()._competitionId) },
      });
      if (!res.ok) return;
      const data = await res.json() as { matches?: LiveMatch[] };
      const now = Date.now();
      const locked = new Set<string>();
      for (const m of data.matches ?? []) {
        const lockUntil = m.trade_lock_until ? new Date(m.trade_lock_until).getTime() : null;
        const isLocked  = LIVE_STATUSES.has(m.api_status) || (lockUntil !== null && lockUntil > now);
        if (isLocked) {
          locked.add(m.nation_a);
          locked.add(m.nation_b);
        }
      }
      set({ lockedTeams: locked, liveMatches: data.matches ?? [] });
    } catch { /* best-effort — UI lock is advisory, server enforces it */ }
  },

  // ── startSync ────────────────────────────────────────────────────────────────
  startSync: () => {
    if (get()._pollId || get()._realtimeChannel) return;

    const id = setInterval(() => {
      if (get().syncing) return;
      set({ syncing: true });
      get().fetchState();
    }, 30_000);
    set({ _pollId: id });

    const lockId = setInterval(() => { get().refreshLockedTeams(); }, 30_000);
    set({ _lockPollId: lockId });
    get().refreshLockedTeams();

    // fetchState() resolves the active competition (via loadBootstrap) before
    // we read _competitionId for the realtime channel below.
    get().fetchState().then(() => {
      // stopSync ran while we were waiting — don't open a channel we'd never clean up
      if (get()._pollId === null || get()._realtimeChannel) return;

      const supabase     = createClient();
      const competitionId = get()._competitionId;
      const channel = supabase
        .channel(`ks_game_state_${competitionId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE', schema: 'public', table: 'competition_game_state',
            filter: `competition_id=eq.${competitionId}`,
          },
          () => {
            if (get().syncing) return;
            set({ syncing: true });
            get().fetchState();
          },
        )
        .subscribe();

      set({ _realtimeChannel: channel });
    });
  },

  // ── stopSync ─────────────────────────────────────────────────────────────────
  stopSync: () => {
    const { _pollId, _realtimeChannel, _lockPollId } = get();
    if (_pollId) clearInterval(_pollId);
    if (_lockPollId) clearInterval(_lockPollId);
    if (_realtimeChannel) createClient().removeChannel(_realtimeChannel);
    set({ _pollId: null, _realtimeChannel: null, _lockPollId: null });
  },

  // ── trade ────────────────────────────────────────────────────────────────────
  trade: async (mode, nationId, quantity) => {
    const s     = get();
    const team  = s._teams.find(t => t.id === nationId);
    if (!team) return 'Nation introuvable';

    const price      = s.prices[nationId] ?? team.initialPrice;
    const held       = s.portfolio[nationId] ?? 0;
    const currentDay = s._bootstrap?.days.find(d => d.day_index === s.dayIndex) ?? null;
    const isKO       = currentDay?.is_ko ?? (s.dayIndex >= 17);

    if (s.lockedTeams.has(nationId)) return '🔒 Trading verrouillé pendant le match';

    if (mode === 'buy') {
      if (s.eliminated.includes(nationId)) return 'Nation éliminée 💀';
      if (price * quantity > s.cash)       return 'Fonds insuffisants';
    } else {
      if (held < quantity) return 'Actions insuffisantes';
    }

    let result: Awaited<ReturnType<typeof apiTrade>>;
    try {
      result = await apiTrade(getDeviceId(), get()._competitionId, mode, nationId, quantity);
    } catch (e) {
      return e instanceof Error ? e.message : 'Erreur réseau';
    }
    if (result.error) return result.error;

    if (mode === 'buy') {
      const confirmedPrice = result.price ?? price;
      const prevAvg = s.avgCost[nationId] ?? team.initialPrice;
      const newAvg  = held === 0
        ? confirmedPrice
        : (held * prevAvg + quantity * confirmedPrice) / (held + quantity);
      set({
        cash:      result.newCash ?? Math.round((s.cash - confirmedPrice * quantity) * 10) / 10,
        portfolio: { ...s.portfolio, [nationId]: held + quantity },
        avgCost:   { ...s.avgCost, [nationId]: Math.round(newAvg * 10) / 10 },
        txLog:     [{ dir: 'buy' as const, flag: team.flag, name: team.name, qty: quantity, price: confirmedPrice, day: s.dayIndex }, ...s.txLog].slice(0, 100),
      });
    } else {
      const confirmedPrice = result.price ?? price;
      const gross   = confirmedPrice * quantity;
      const isElim  = s.eliminated.includes(nationId);
      const fee     = isElim || confirmedPrice <= 1
        ? 0
        : Math.max(gross * (isKO ? 0.05 : 0.10), 10);
      const net     = gross - fee;
      const newHeld = Math.max(0, held - quantity);
      const newPort = { ...s.portfolio };
      const newAvgs = { ...s.avgCost };
      if (newHeld > 0) newPort[nationId] = newHeld;
      else { delete newPort[nationId]; delete newAvgs[nationId]; }
      set({
        cash:      result.newCash ?? Math.round((s.cash + net) * 10) / 10,
        portfolio: newPort, avgCost: newAvgs,
        txLog:     [{ dir: 'sell' as const, flag: team.flag, name: team.name, qty: quantity, price: confirmedPrice, day: s.dayIndex }, ...s.txLog].slice(0, 100),
      });
    }
    return null;
  },

  // ── advanceDay ───────────────────────────────────────────────────────────────
  advanceDay: async () => {
    const s = get();
    const response = await apiAdvanceDay(getDeviceId(), s._competitionId, s.dayIndex);
    if (!response?.results) return null;

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
      matchResults: { ...s.matchResults, [s.dayIndex]: response.results },
    });

    // Réconcilier portfolio et avgCost (éliminations/liquidations en DB)
    get().fetchState().catch(() => {});

    return { results: response.results, flash: response.flash };
  },

  // ── resetGame ────────────────────────────────────────────────────────────────
  resetGame: async () => {
    const { _competitionId } = get();
    set({ loading: true });
    try {
      await apiReset(getDeviceId(), _competitionId);
    } catch { /* best-effort */ }
    await get().fetchState();
  },
}));

// ── buildMatchesForCurrentDay — exported for UI tabs ─────────────────────────
export function buildMatchesForCurrentDay(
  state: GameState & { _bootstrap?: BootstrapData | null }
): Match[] {
  return buildMatchesForCurrentDayFromBootstrap(state as GameState, state._bootstrap ?? null);
}
