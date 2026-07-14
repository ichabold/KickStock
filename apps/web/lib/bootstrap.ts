/**
 * bootstrap.ts — Loads and caches competition data.
 *
 * Data comes from /api/competition/bootstrap?competition_id=N, cached in
 * localStorage per competition (24h TTL).
 */

import { buildMatchesForDay } from '@kickstock/game-engine';
import type { BootstrapData, GameState, Match, TeamMeta } from '@kickstock/types';

const CACHE_TTL = 24 * 60 * 60 * 1000;

// Bump this whenever the BootstrapData *shape* changes (new/renamed field,
// changed semantics) — e.g. v4 added `ko_fixtures`. The server-side version
// check (competitions.last_sync_at + game_state.updated_at) only busts the
// cache on data changes; it can't detect that a code deploy changed what the
// response contains, since the underlying DB rows didn't change. Bumping
// this forces every client to refetch once, regardless of cached "version".
const CACHE_SCHEMA_VERSION = 'v4';

function cacheKey(competitionId?: number) {
  return `kickstock:bootstrap:${CACHE_SCHEMA_VERSION}:${competitionId ?? 'active'}`;
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

// Real per-phase slots (matches buildKOMatches.ts's r32Slices/r16Slices/
// qfSlices/sfSlices). competition_days can have more day rows per phase than
// there are real slots (generic scaffolding created before real fixture
// dates are confirmed) — falling back to slot 1 for any day beyond the
// known slots repeated an earlier match on every extra day (e.g. QF days
// 3-5 all showing the same qf_2 pairing). Days beyond the known slots now
// get a key that matches no slice, rendering empty/TBD instead.
// [BUG FIX] '3rd' and 'Final' used to return a constant key regardless of
// position, so every placeholder day beyond the first for those phases
// (competition_days scaffolds 2 of each: e.g. day 37 AND day 39 both "3rd")
// showed the same single real match duplicated — reported as 2 third-place
// matches and 2 finals in the schedule. Single-element arrays here give them
// the same "only position 0 gets the real slot" treatment as the other phases.
const KO_PHASE_SLOTS: Record<string, string[]> = {
  R32:   ['r32_1', 'r32_2', 'r32_3', 'r32_4', 'r32_5', 'r32_6'],
  R16:   ['r16_1', 'r16_2', 'r16_3', 'r16_4', 'r16_5'],
  QF:    ['qf_1', 'qf_2'],
  SF:    ['sf_1', 'sf_2'],
  '3rd': ['3rd'],
  Final: ['final'],
};

export function deriveDynamicKey(phase: string, dayIndex: number, bootstrap: BootstrapData): string {
  const koDays     = bootstrap.days.filter(d => d.phase === phase).sort((a, b) => a.day_index - b.day_index);
  const posInPhase = koDays.findIndex(d => d.day_index === dayIndex);
  if (KO_PHASE_SLOTS[phase]) return KO_PHASE_SLOTS[phase][posInPhase] ?? `${phase.toLowerCase()}_none_${posInPhase}`;
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
