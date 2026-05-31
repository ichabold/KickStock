/**
 * bootstrap.ts — Loads and caches competition data.
 *
 * Data comes from /api/competition/bootstrap?competition_id=N, cached in
 * localStorage per competition (24h TTL).
 */

import type { BootstrapData, TeamMeta } from '@kickstock/types';

const CACHE_TTL = 24 * 60 * 60 * 1000;

function cacheKey(competitionId: number) {
  return `kickstock:bootstrap:v2:${competitionId}`;
}

interface CacheEntry { data: BootstrapData; fetchedAt: number }

function readCache(competitionId: number): BootstrapData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey(competitionId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.fetchedAt < CACHE_TTL) return entry.data;
    return null;
  } catch { return null; }
}

function readStale(competitionId: number): BootstrapData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey(competitionId));
    if (!raw) return null;
    return (JSON.parse(raw) as CacheEntry).data;
  } catch { return null; }
}

function writeCache(competitionId: number, data: BootstrapData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(cacheKey(competitionId), JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch { /* storage full / private mode */ }
}

export async function getBootstrap(competitionId = 1): Promise<BootstrapData | null> {
  const cached = readCache(competitionId);
  if (cached) return cached;

  try {
    const res = await fetch(`/api/competition/bootstrap?competition_id=${competitionId}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as BootstrapData;

    if (!data.teams?.length || !data.days?.length) {
      throw new Error('Bootstrap empty — run sync-fixtures first');
    }

    writeCache(competitionId, data);
    return data;
  } catch (err) {
    console.warn('[bootstrap] fetch failed:', err);
    const stale = readStale(competitionId);
    if (stale) { console.warn('[bootstrap] using stale cache'); return stale; }
    return null;
  }
}

export async function refreshBootstrap(competitionId = 1): Promise<BootstrapData | null> {
  if (typeof window !== 'undefined') localStorage.removeItem(cacheKey(competitionId));
  return getBootstrap(competitionId);
}

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
