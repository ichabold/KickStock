/**
 * bootstrap.ts — Loads and caches competition data for offline mode.
 *
 * The bootstrap replaces the hardcoded NATIONS + CALENDAR constants.
 * Data comes from /api/competition/bootstrap, cached in localStorage (24h TTL).
 *
 * On cache miss (first load or expired):
 *   → Fetch from API → store in localStorage → return
 * On cache hit:
 *   → Return immediately (no network request)
 * On fetch failure with stale cache:
 *   → Return stale data (game continues, sync on next load)
 * On fetch failure with no cache:
 *   → Return null (caller shows an error/retry)
 */

import type { BootstrapData, TeamMeta } from '@kickstock/types';

const CACHE_KEY = 'kickstock:bootstrap:v1';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  data:      BootstrapData;
  fetchedAt: number;
}

function readCache(): BootstrapData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.fetchedAt < CACHE_TTL) return entry.data;
    return null; // expired
  } catch { return null; }
}

function readStale(): BootstrapData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as CacheEntry).data;
  } catch { return null; }
}

function writeCache(data: BootstrapData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch { /* storage full / private mode — ignore */ }
}

/**
 * Returns bootstrap data, using localStorage cache when possible.
 * Never throws — returns null on complete failure.
 */
export async function getBootstrap(): Promise<BootstrapData | null> {
  // 1. Cache hit
  const cached = readCache();
  if (cached) return cached;

  // 2. Fetch from API
  try {
    const res = await fetch('/api/competition/bootstrap', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as BootstrapData;

    if (!data.teams?.length || !data.days?.length) {
      throw new Error('Bootstrap response is empty — run sync-fixtures first');
    }

    writeCache(data);
    return data;
  } catch (err) {
    console.warn('[bootstrap] fetch failed:', err);
    // 3. Stale fallback
    const stale = readStale();
    if (stale) {
      console.warn('[bootstrap] using stale cache');
      return stale;
    }
    return null;
  }
}

/** Force-invalidates the cache and re-fetches. Use from admin panel. */
export async function refreshBootstrap(): Promise<BootstrapData | null> {
  if (typeof window !== 'undefined') localStorage.removeItem(CACHE_KEY);
  return getBootstrap();
}

/**
 * Converts BootstrapData.teams (snake_case DB rows) into the TeamMeta
 * shape expected by the game engine (camelCase).
 */
export function bootstrapToTeams(data: BootstrapData): TeamMeta[] {
  return data.teams.map(t => ({
    id:            t.id,
    name:          t.name,
    flag:          t.flag_emoji ?? '',
    group:         t.group_code ?? '',
    strength:      t.strength,
    initialPrice:  t.initial_price,
    confederation: t.confederation ?? undefined,
    logoUrl:       t.logo_url ?? undefined,
  }));
}
