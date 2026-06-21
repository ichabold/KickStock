/**
 * bootstrap.ts — Loads and caches competition data.
 *
 * Data comes from /api/competition/bootstrap?competition_id=N, cached in
 * localStorage per competition (24h TTL).
 */

import { buildMatchesForDay } from '@kickstock/game-engine';
import type { BootstrapData, GameState, Match, TeamMeta } from '@kickstock/types';

const CACHE_TTL = 24 * 60 * 60 * 1000;

function cacheKey(competitionId?: number) {
  return `kickstock:bootstrap:v3:${competitionId ?? 'active'}`;
}

interface CacheEntry { data: BootstrapData; fetchedAt: number; serverVersion?: string }

function readCache(competitionId: number | undefined, serverVersion?: string): BootstrapData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey(competitionId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    // Bust cache if server version changed (prices/fixtures updated)
    if (serverVersion && entry.serverVersion !== serverVersion) return null;
    if (Date.now() - entry.fetchedAt < CACHE_TTL) return entry.data;
    return null;
  } catch { return null; }
}

function readStale(competitionId: number | undefined): BootstrapData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey(competitionId));
    if (!raw) return null;
    return (JSON.parse(raw) as CacheEntry).data;
  } catch { return null; }
}

function writeCache(competitionId: number | undefined, data: BootstrapData, serverVersion?: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(cacheKey(competitionId), JSON.stringify({ data, fetchedAt: Date.now(), serverVersion }));
  } catch { /* storage full / private mode */ }
}

export async function getBootstrap(competitionId?: number): Promise<BootstrapData | null> {
  // When no competition is specified, the API defaults to the active one.
  const param = competitionId ? `competition_id=${competitionId}&` : '';

  // Fetch just the version (last_sync_at) cheaply before deciding to use cache
  let serverVersion: string | undefined;
  try {
    const vRes = await fetch(`/api/competition/bootstrap?${param}version_only=1`, { cache: 'no-store' });
    if (vRes.ok) {
      const v = await vRes.json() as { version?: string };
      serverVersion = v.version;
    }
  } catch { /* ignore — fallback to TTL-based cache */ }

  const cached = readCache(competitionId, serverVersion);
  if (cached) return cached;

  try {
    const res = await fetch(`/api/competition/bootstrap?${param}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as BootstrapData;

    if (!data.teams?.length || !data.days?.length) {
      throw new Error('Bootstrap empty — run sync-fixtures first');
    }

    writeCache(competitionId, data, serverVersion ?? data.generated_at);
    return data;
  } catch (err) {
    console.warn('[bootstrap] fetch failed:', err);
    const stale = readStale(competitionId);
    if (stale) { console.warn('[bootstrap] using stale cache'); return stale; }
    return null;
  }
}

export async function refreshBootstrap(competitionId?: number): Promise<BootstrapData | null> {
  if (typeof window !== 'undefined') localStorage.removeItem(cacheKey(competitionId));
  return getBootstrap(competitionId);
}

export function deriveDynamicKey(phase: string, dayIndex: number, bootstrap: BootstrapData): string {
  const koDays     = bootstrap.days.filter(d => d.phase === phase).sort((a, b) => a.day_index - b.day_index);
  const posInPhase = koDays.findIndex(d => d.day_index === dayIndex);
  if (phase === 'R32')   return (['r32_1','r32_2','r32_3','r32_4','r32_5','r32_6'])[posInPhase] ?? 'r32_1';
  if (phase === 'R16')   return (['r16_1','r16_2','r16_3','r16_4'])[posInPhase] ?? 'r16_1';
  if (phase === 'QF')    return posInPhase === 0 ? 'qf_1' : 'qf_2';
  if (phase === 'SF')    return posInPhase === 0 ? 'sf_1' : 'sf_2';
  if (phase === '3rd')   return '3rd';
  if (phase === 'Final') return 'final';
  return phase.toLowerCase();
}

export function buildMatchesForCurrentDayFromBootstrap(
  state:     GameState,
  bootstrap: BootstrapData | null,
): Match[] {
  if (!bootstrap) return [];
  const day = bootstrap.days.find(d => d.day_index === state.dayIndex) ?? null;
  if (!day) return [];

  if (!day.is_ko) {
    return bootstrap.group_fixtures
      .filter(f => f.day_index === state.dayIndex)
      .filter(f => !state.eliminated.includes(f.nation_a) && !state.eliminated.includes(f.nation_b))
      .map(f => ({ a: f.nation_a, b: f.nation_b, venue: f.venue ?? undefined }));
  }
  return buildMatchesForDay(deriveDynamicKey(day.phase, state.dayIndex, bootstrap), state);
}

export function bootstrapToTeams(data: BootstrapData): TeamMeta[] {
  return data.teams.map(t => ({
    id:            t.id,
    name:          t.name,
    flag:          t.flag_emoji ?? '',
    group:         t.group_code?.match(/Group ([A-Z])$/i)?.[1] ?? t.group_code ?? '',
    strength:      t.strength,
    initialPrice:  t.initial_price,
    confederation: t.confederation ?? undefined,
    logoUrl:       t.logo_url ?? undefined,
  }));
}
