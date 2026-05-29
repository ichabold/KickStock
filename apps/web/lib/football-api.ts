/**
 * football-api.ts — API-Football v3 (RapidAPI) service layer.
 *
 * All functions are parameterized (no hardcoded league/season values).
 * Redis caching via Upstash REST reduces API quota usage:
 *   - Daily fixture list: TTL 3600s
 *   - Finished fixtures (5-min bucket): TTL 300s
 *
 * Stale-while-revalidate on 429/5xx: returns the last cached value
 * rather than crashing the cron.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApiFixtureStatus {
  short: string;  // "NS"|"1H"|"HT"|"2H"|"ET"|"BT"|"P"|"FT"|"AET"|"PEN"|"PST"|"SUSP"|"CANC"|"ABD"
  long:  string;
  elapsed: number | null;
}

export interface ApiTeamRef {
  id:     number;
  name:   string;
  logo:   string;
}

export interface ApiLeagueRef {
  id:     number;
  name:   string;
  round:  string;   // "Group Stage - 1", "Round of 32", "Quarter-finals", "Final", etc.
  group:  string | null; // "Group A"…"Group L" — null for KO rounds
}

export interface ApiVenue {
  id:   number | null;
  name: string | null;
  city: string | null;
}

export interface ApiScore {
  home: number | null;
  away: number | null;
}

export interface ApiFixture {
  fixture: {
    id:     number;
    date:   string;          // ISO 8601: "2026-06-11T18:00:00+00:00"
    status: ApiFixtureStatus;
    venue:  ApiVenue;
  };
  league:  ApiLeagueRef;
  teams: {
    home: ApiTeamRef;
    away: ApiTeamRef;
  };
  goals: ApiScore;
  score: {
    halftime:   ApiScore;
    fulltime:   ApiScore;
    extratime:  ApiScore;
    penalty:    ApiScore;
  };
}

// ── Redis helpers (Upstash REST — no Node.js client needed in Edge) ───────────

async function redisGet(key: string): Promise<string | null> {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const res  = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json() as { result: string | null };
    return json.result;
  } catch { return null; }
}

async function redisSet(key: string, value: string, ttl: number): Promise<void> {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, ex: ttl }),
    });
  } catch { /* best-effort */ }
}

// ── Core fetch ────────────────────────────────────────────────────────────────

const API_BASE = 'https://v3.football.api-sports.io';

async function apiFetch(path: string, params: Record<string, string>): Promise<Response> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY is not set');

  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  return fetch(url.toString(), {
    headers: {
      'x-apisports-key': key,
    },
    // No next.js cache — we manage it ourselves via Redis
    cache: 'no-store',
  });
}

async function fetchWithCache<T>(
  cacheKey: string,
  ttl:       number,
  fetcher:   () => Promise<T>,
): Promise<T> {
  // Try cache first
  const cached = await redisGet(cacheKey);
  if (cached) {
    try { return JSON.parse(cached) as T; } catch { /* corrupt cache, refetch */ }
  }

  try {
    const result = await fetcher();
    await redisSet(cacheKey, JSON.stringify(result), ttl);
    return result;
  } catch (err) {
    // Stale-while-revalidate: if we have a stale cached value, return it
    if (cached) {
      console.warn(`[football-api] fetch failed, returning stale cache for ${cacheKey}`, err);
      return JSON.parse(cached) as T;
    }
    throw err;
  }
}

function parseFixtures(body: unknown): ApiFixture[] {
  const data = body as { response?: ApiFixture[]; errors?: unknown };
  if (!data.response) {
    console.error('[football-api] unexpected response shape', data.errors ?? body);
    return [];
  }
  return data.response;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * All fixtures for a competition.
 * Used by sync-fixtures cron (daily).
 * Cache: 1 hour (the schedule doesn't change mid-day).
 */
export async function fetchAllFixtures(
  leagueId: number,
  season:   number,
): Promise<ApiFixture[]> {
  const today    = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const cacheKey = `api:fixtures:${leagueId}:${season}:${today}`;

  return fetchWithCache(cacheKey, 3600, async () => {
    const res  = await apiFetch('/fixtures', {
      league: String(leagueId),
      season: String(season),
    });
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
    return parseFixtures(await res.json());
  });
}

/**
 * Finished fixtures (FT/AET/PEN) for the given league IDs.
 * Used by sync-results cron (every 30 min).
 * Cache: 30-minute bucket — two calls within the same 30-min window share one response.
 */
export async function fetchFinishedFixtures(
  leagueIds: number[],
  season:    number,
): Promise<ApiFixture[]> {
  const bucket   = Math.floor(Date.now() / 1_800_000); // 30-min bucket
  const hash     = leagueIds.sort().join('-');
  const cacheKey = `api:finished:${hash}:${bucket}`;

  return fetchWithCache(cacheKey, 1800, async () => {
    const allFixtures: ApiFixture[] = [];

    for (const leagueId of leagueIds) {
      const res = await apiFetch('/fixtures', {
        league: String(leagueId),
        season: String(season),
        status: 'FT-AET-PEN',
      });
      if (!res.ok) {
        console.error(`[football-api] fetchFinishedFixtures failed for league ${leagueId}: ${res.status}`);
        continue;
      }
      allFixtures.push(...parseFixtures(await res.json()));
    }

    return allFixtures;
  });
}

/**
 * Currently live fixtures.
 * Used for real-time score display (no cache — called only when needed).
 */
export async function fetchLiveFixtures(
  leagueIds: number[],
): Promise<ApiFixture[]> {
  const allFixtures: ApiFixture[] = [];

  for (const leagueId of leagueIds) {
    const res = await apiFetch('/fixtures', {
      league: String(leagueId),
      live:   'all',
    });
    if (!res.ok) continue;
    allFixtures.push(...parseFixtures(await res.json()));
  }

  return allFixtures;
}

/**
 * FIFA rankings for all teams.
 * Used by seed-team-rankings script (one-off, not cached).
 */
export async function fetchFifaRankings(): Promise<Array<{
  team: { id: number; name: string };
  points: number;
  ranking: number;
}>> {
  const res = await apiFetch('/teams/rankings/fifa', {});
  if (!res.ok) throw new Error(`FIFA rankings fetch failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as {
    response?: Array<{ team: { id: number; name: string }; points: number; ranking: number }>;
  };
  return data.response ?? [];
}
