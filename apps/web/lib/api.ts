/**
 * Client-side API helpers — all calls go through Next.js API routes.
 * Device identification via X-Device-ID header.
 * Competition identification via X-Competition-ID header.
 */
import type { StoredMatchResult } from '@kickstock/types';

export interface GameStateResponse {
  competitionId: number;
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
  prices:       Record<string, number>;
  priceHistory: Record<string, number[]>;
  matchResults: Record<number, StoredMatchResult[]>;
  cash:       number;
  portfolio:  Record<string, number>;
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
  results:     StoredMatchResult[];
  flash:       Record<string, 'fu' | 'fd'>;
  newDayIndex: number;
  newPhase:    string;
  prices:      Record<string, number>;
  eliminated:  string[];
  r32Pool:     string[];
  r16Pool:     string[];
  qfPool:      string[];
  sfPool:      string[];
  finalPool:   string[];
  thirdPool:   string[];
  champion:    string | null;
  newCash:     number;
}

const _etagCache: Record<string, string> = {};

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  deviceId: string,
  competitionId?: number,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-ID': deviceId,
    ...(competitionId ? { 'X-Competition-ID': String(competitionId) } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (!options.method || options.method === 'GET') {
    const cached = _etagCache[path];
    if (cached) headers['If-None-Match'] = cached;
  }

  const res = await fetch(path, { ...options, headers });

  if (res.status === 304) throw new Error('NOT_MODIFIED');

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }

  const newEtag = res.headers.get('ETag');
  if (newEtag) _etagCache[path] = newEtag;

  return res.json();
}

export async function fetchGameState(deviceId: string, competitionId: number): Promise<GameStateResponse> {
  return apiFetch<GameStateResponse>('/api/game/state', {}, deviceId, competitionId);
}

export async function apiTrade(
  deviceId:      string,
  competitionId: number,
  mode:          'buy' | 'sell',
  nationId:      string,
  quantity:      number,
): Promise<{ error: string | null; newCash?: number; newHeld?: number }> {
  return apiFetch(
    '/api/trade',
    { method: 'POST', body: JSON.stringify({ competitionId, nationId, mode, quantity }) },
    deviceId,
    competitionId,
  );
}

export async function apiAdvanceDay(
  deviceId:      string,
  competitionId: number,
  dayIndex:      number,
): Promise<AdvanceDayResponse | null> {
  try {
    return await apiFetch<AdvanceDayResponse>(
      '/api/game/advance',
      { method: 'POST', body: JSON.stringify({ competitionId, dayIndex }) },
      deviceId,
      competitionId,
    );
  } catch (e) {
    console.error('[apiAdvanceDay]', e);
    return null;
  }
}
