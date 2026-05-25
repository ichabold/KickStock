/**
 * Client-side API helpers — all calls go through Next.js API routes.
 * Device identification via X-Device-ID header (anonymous play).
 */
import type { StoredMatchResult } from '@kickstock/types';

export interface GameStateResponse {
  // ── Shared game state ────────────────────────────────────────────────────────
  dayIndex:    number;
  phase:       string;
  champion:    string | null;
  eliminated:  string[];
  r32Pool:     string[];
  r16Pool:     string[];
  qfPool:      string[];
  sfPool:      string[];
  finalPool:   string[];
  thirdPool:   string[];
  // ── Prices ───────────────────────────────────────────────────────────────────
  prices:       Record<string, number>;
  priceHistory: Record<string, number[]>;
  // ── Match results (for Schedule + Standings) ─────────────────────────────────
  matchResults: Record<number, StoredMatchResult[]>;
  // ── Player portfolio ─────────────────────────────────────────────────────────
  cash:       number;
  portfolio:  Record<string, number>;  // nationId → qty
  avgCost:    Record<string, number>;
  txLog:      TxEntry[];
  bestScore:  number | null;
}

export interface TxEntry {
  dir:   'buy' | 'sell';
  flag:  string;
  name:  string;
  qty:   number;
  price: number;
  day:   number;
}

export interface AdvanceDayResponse {
  results:    StoredMatchResult[];
  flash:      Record<string, 'fu' | 'fd'>;
  newDayIndex: number;
  newPhase:   string;
  // Updated shared state (avoid a second poll)
  prices:     Record<string, number>;
  eliminated: string[];
  r32Pool:    string[];
  r16Pool:    string[];
  qfPool:     string[];
  sfPool:     string[];
  finalPool:  string[];
  thirdPool:  string[];
  champion:   string | null;
  // Updated player cash (after dividends)
  newCash:    number;
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────
async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  deviceId: string,
): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Device-ID': deviceId,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchGameState(deviceId: string): Promise<GameStateResponse> {
  return apiFetch<GameStateResponse>('/api/game/state', {}, deviceId);
}

export async function apiTrade(
  deviceId:  string,
  mode:      'buy' | 'sell',
  nationId:  string,
  quantity:  number,
): Promise<{ error: string | null; newCash?: number; newHeld?: number }> {
  return apiFetch(
    '/api/trade',
    { method: 'POST', body: JSON.stringify({ nationId, mode, quantity }) },
    deviceId,
  );
}

export async function apiAdvanceDay(
  deviceId:  string,
  dayIndex:  number,
): Promise<AdvanceDayResponse | null> {
  try {
    return await apiFetch<AdvanceDayResponse>(
      '/api/game/advance',
      { method: 'POST', body: JSON.stringify({ dayIndex }) },
      deviceId,
    );
  } catch (e) {
    console.error('[apiAdvanceDay]', e);
    return null;
  }
}
