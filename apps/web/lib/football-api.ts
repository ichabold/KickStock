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
    // Upstash REST: POST to base URL with Redis command array
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', key, value, 'EX', ttl]),
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
  isValid?:  (v: T) => boolean,
): Promise<T> {
  // Try cache first
  const cached = await redisGet(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as T;
      // Reject corrupt/malformed cached values (e.g. from a previous buggy redisSet)
      if (!isValid || isValid(parsed)) return parsed;
      console.warn(`[football-api] cached value failed validation for ${cacheKey}, refetching`);
    } catch { /* corrupt JSON, refetch */ }
  }

  try {
    const result = await fetcher();
    await redisSet(cacheKey, JSON.stringify(result), ttl);
    return result;
  } catch (err) {
    // Stale-while-revalidate: if we have a stale cached value, return it
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as T;
        if (!isValid || isValid(parsed)) {
          console.warn(`[football-api] fetch failed, returning stale cache for ${cacheKey}`, err);
          return parsed;
        }
      } catch { /* corrupt, can't use stale */ }
    }
    throw err;
  }
}

function parseFixtures(body: unknown): ApiFixture[] {
  const data = body as { response?: ApiFixture[]; errors?: unknown; message?: string };

  // api-sports.io key error: { "errors": { "token": "..." } }
  if (data.errors && typeof data.errors === 'object' && Object.keys(data.errors as object).length > 0) {
    const errMsg = JSON.stringify(data.errors);
    console.error('[football-api] API error response (errors field):', errMsg);
    throw new Error(`API-Football error: ${errMsg}`);
  }

  // RapidAPI rejection: { "message": "You are not subscribed to this API." }
  if (data.message && !data.response) {
    console.error('[football-api] API gateway error:', data.message);
    throw new Error(`API-Football gateway: ${data.message}`);
  }

  if (!data.response) {
    console.error('[football-api] unexpected response shape', body);
    throw new Error(`API-Football: réponse inattendue — ${JSON.stringify(body).slice(0, 200)}`);
  }
  return data.response;
}

// ── Free-tier workaround ───────────────────────────────────────────────────────
//
// [FREE-TIER SEASON BLOCK] Any /fixtures query that includes `season=2026`
// (with or without a `league` filter) is rejected on the Free plan:
//   { "errors": { "season": "Free plans do not have access to this season,
//     try from 2022 to 2024." } }
// This broke fetchAllFixtures and fetchFinishedFixtures outright the moment
// the Pro subscription lapsed — sync-fixtures stopped discovering newly
// confirmed KO fixtures, and live-poll/sync-results stopped detecting
// finished matches, even with quota available. Discovered when the France
// vs Paraguay R16 fixture never appeared in the DB at all.
//
// Workaround: query by `date` alone (no `league`/`season` param — not
// rejected) and filter the result client-side by `league.id`. Confirmed
// working: `/fixtures?date=2026-07-04` returns all fixtures worldwide for
// that date, World Cup included.

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function fetchFixturesByDate(date: string): Promise<ApiFixture[]> {
  const res = await apiFetch('/fixtures', { date });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return parseFixtures(await res.json());
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * All fixtures for a competition.
 * Used by sync-fixtures cron (daily).
 * Cache: 1 hour (the schedule doesn't change mid-day).
 *
 * Queries by date (yesterday through +10 days) instead of league+season —
 * see "Free-tier workaround" above. The lookahead window is enough to catch
 * newly-confirmed KO fixtures without re-fetching the whole (already-synced)
 * tournament history.
 */
export async function fetchAllFixtures(
  leagueId: number,
  season:   number,
): Promise<ApiFixture[]> {
  const today    = isoDate(0);
  const cacheKey = `api:fixtures:${leagueId}:${season}:${today}`;

  return fetchWithCache(cacheKey, 3600, async () => {
    const byId = new Map<number, ApiFixture>();
    for (let offset = -1; offset <= 10; offset++) {
      const date = isoDate(offset);
      try {
        const fixtures = await fetchFixturesByDate(date);
        for (const f of fixtures) {
          if (f.league.id === leagueId) byId.set(f.fixture.id, f);
        }
      } catch (err) {
        console.error(`[football-api] fetchAllFixtures: date ${date} failed`, err);
      }
    }
    return [...byId.values()];
  }, Array.isArray);
}

/**
 * Finished fixtures (FT/AET/PEN) for the given league IDs.
 * Used by live-poll (every 20 min, 16h-3h UTC) and sync-results (30 min,
 * safety net).
 *
 * Queries by date instead of league+season — see "Free-tier workaround"
 * above. Only queries "yesterday" in addition to "today" during 0h-2h UTC,
 * when a match that kicked off yesterday (UTC date) could still be running
 * — outside that window everything relevant already has today's date.
 *
 * Cache: 2-minute bucket — a fixture that turns FT is detected (and
 * processed_at/trade_lock_until set) within ~2 min instead of being masked
 * by a stale cached "not yet FT" response.
 */
export async function fetchFinishedFixtures(
  leagueIds: number[],
  season:    number,
): Promise<ApiFixture[]> {
  const bucket   = Math.floor(Date.now() / 120_000); // 2-min bucket
  const hash     = leagueIds.sort().join('-');
  const cacheKey = `api:finished:${hash}:${bucket}`;

  return fetchWithCache(cacheKey, 120, async () => {
    const leagueSet     = new Set(leagueIds);
    const needsYesterday = new Date().getUTCHours() < 3;
    const dates = needsYesterday ? [isoDate(-1), isoDate(0)] : [isoDate(0)];

    const allFixtures: ApiFixture[] = [];
    for (const date of dates) {
      try {
        const fixtures = await fetchFixturesByDate(date);
        for (const f of fixtures) {
          if (leagueSet.has(f.league.id) && ['FT', 'AET', 'PEN'].includes(f.fixture.status.short)) {
            allFixtures.push(f);
          }
        }
      } catch (err) {
        console.error(`[football-api] fetchFinishedFixtures: date ${date} failed`, err);
      }
    }

    return allFixtures;
  }, Array.isArray);
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

/**
 * Converts a FIFA world ranking position (1 = best) to a 50-100 strength score.
 *   rank 1   → 100
 *   rank 20  → 91
 *   rank 50  → 76
 *   rank 100 → 51
 *   rank 101+ → 50 (capped)
 */
export function rankingToStrength(ranking: number): number {
  return Math.max(50, Math.round(100 - (ranking - 1) * 0.5));
}

/**
 * Fetches FIFA world rankings and returns a Map<api_team_id → strength>.
 * Cached for 24h (rankings don't change mid-tournament).
 */
export async function fetchTeamStrengths(): Promise<Map<number, number>> {
  const cacheKey = 'api:fifa-rankings:latest';
  const rankings = await fetchWithCache(
    cacheKey,
    86_400,
    () => fetchFifaRankings(),
    (v) => Array.isArray(v) && v.length > 0,
  );
  const map = new Map<number, number>();
  for (const entry of rankings) {
    map.set(entry.team.id, rankingToStrength(entry.ranking));
  }
  return map;
}

// ── Squad types ───────────────────────────────────────────────────────────────

export interface ApiSquadPlayer {
  id:       number;
  name:     string;
  age:      number | null;
  number:   number | null;
  /** "Goalkeeper" | "Defender" | "Midfielder" | "Attacker" */
  position: string;
  photo:    string | null;
}

/**
 * Fetches the full squad for a team via /players/squads (PRO plan required).
 * Cache: 24h per team.
 */
export async function fetchSquad(apiTeamId: number): Promise<ApiSquadPlayer[]> {
  const cacheKey = `api:squad:${apiTeamId}`;
  return fetchWithCache(cacheKey, 86_400, async () => {
    const res = await apiFetch('/players/squads', { team: String(apiTeamId) });
    if (!res.ok) throw new Error(`Squad fetch failed for team ${apiTeamId}: ${res.status}`);
    const data = await res.json() as {
      response?: Array<{ team: { id: number }; players: ApiSquadPlayer[] }>;
    };
    return data.response?.[0]?.players ?? [];
  }, Array.isArray);
}

// ── Fixture events types ──────────────────────────────────────────────────────

export interface ApiFixtureEvent {
  time:   { elapsed: number; extra: number | null };
  team:   { id: number; name: string };
  player: { id: number | null; name: string | null };
  assist: { id: number | null; name: string | null };
  /** "Goal" | "Card" | "subst" | "Var" */
  type:   string;
  /** "Normal Goal" | "Own Goal" | "Penalty" | "Missed Penalty" */
  detail: string;
  comments: string | null;
}

// ── Standings types ───────────────────────────────────────────────────────────

export interface ApiStandingEntry {
  rank:        number;
  team:        { id: number; name: string };
  points:      number;
  goalsDiff:   number;
  group:       string;   // "Group A", "Group B", ...
  all: {
    played: number; win: number; draw: number; lose: number;
    goals: { for: number; against: number };
  };
}

/**
 * Fetches standings for a league/season and returns all entries
 * (flattened across all groups), excluding "Ranking of third-placed" rows.
 * Cache: 6h (standings update once per day at most during group stage).
 */
export async function fetchGroupStandings(
  leagueId: number,
  season:   number,
): Promise<ApiStandingEntry[]> {
  const cacheKey = `api:standings:${leagueId}:${season}`;
  return fetchWithCache(cacheKey, 21600, async () => {
    const res = await apiFetch('/standings', {
      league: String(leagueId),
      season: String(season),
    });
    if (!res.ok) throw new Error(`Standings API error ${res.status}`);
    const data = await res.json() as {
      response?: Array<{ league: { standings: ApiStandingEntry[][] } }>;
      errors?: unknown;
    };
    if (data.errors && typeof data.errors === 'object' && Object.keys(data.errors as object).length > 0) {
      throw new Error(`Standings API error: ${JSON.stringify(data.errors)}`);
    }
    if (!data.response?.[0]?.league?.standings) return [];
    return data.response[0].league.standings
      .flat()
      .filter(e => e.group?.startsWith('Group '));
  }, Array.isArray);
}

/**
 * Fetches real goal events for a finished fixture.
 * Used by processRealMatchResult to store real scorers.
 * No cache — called once per match when processing the result.
 */
export async function fetchFixtureEvents(fixtureId: number): Promise<ApiFixtureEvent[]> {
  try {
    const res = await apiFetch('/fixtures/events', { fixture: String(fixtureId) });
    if (!res.ok) return [];
    const data = await res.json() as { response?: ApiFixtureEvent[] };
    return data.response ?? [];
  } catch {
    return []; // non-blocking: if it fails, we just don't have real scorers
  }
}
