/**
 * GET /api/game/live-matches
 *
 * Returns today's matches with their live status, scores, and trade lock state.
 * Used by LiveTab to show real-time match status.
 *
 * [G3 FIX] Reads X-Competition-ID header (same as all other game routes).
 * [G7 FIX] For matches currently in progress (1H/HT/2H/ET/BT/P), enriches
 *          the response with live scores from API-Football (/fixtures?live=all).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }          from '@/lib/supabase/admin';
import { fetchLiveFixtures }          from '@/lib/football-api';

export const dynamic = 'force-dynamic';

// API-Football statuses that mean "currently playing"
const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function GET(req: NextRequest) {
  const admin = createAdminClient();

  // [G3 FIX] Use competition_id from header, fallback to first active competition
  const headerCompId = req.headers.get('X-Competition-ID');

  let compQuery = adm(admin)
    .from('competitions')
    .select('id, league_id')
    .eq('is_active', true);

  if (headerCompId && /^\d+$/.test(headerCompId)) {
    compQuery = compQuery.eq('id', parseInt(headerCompId, 10));
  } else {
    compQuery = compQuery.order('id', { ascending: false }).limit(1);
  }

  const { data: comp } = await compQuery.single();
  if (!comp) return NextResponse.json({ matches: [], teams: {} });

  // Today's matches (UTC day window)
  const now   = new Date();
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  const end   = new Date(now); end.setUTCHours(23, 59, 59, 999);

  const { data: matchesRaw } = await adm(admin)
    .from('matches')
    .select('fixture_id, nation_a, nation_b, scheduled_at, api_status, score_a, score_b, trade_lock_until, processed_at, phase, venue')
    .eq('competition_id', comp.id)
    .not('api_status', 'in', '("PST","SUSP","CANC","ABD")')
    .gte('scheduled_at', start.toISOString())
    .lte('scheduled_at', end.toISOString())
    .order('scheduled_at', { ascending: true });

  type DbMatch = {
    fixture_id: number | null;
    nation_a: string; nation_b: string;
    scheduled_at: string; api_status: string;
    score_a: number | null; score_b: number | null;
    trade_lock_until: string | null; processed_at: string | null;
    phase: string; venue: string | null;
  };

  const matches = (matchesRaw ?? []) as DbMatch[];
  if (!matches.length) return NextResponse.json({ matches: [], teams: {} });

  // [G7 FIX] If any match is in live status, fetch real-time scores from API
  const hasLiveMatch = matches.some(m => LIVE_STATUSES.has(m.api_status));
  const liveScores = new Map<number, { scoreA: number; scoreB: number; status: string }>();

  if (hasLiveMatch) {
    try {
      const liveFixtures = await fetchLiveFixtures([comp.league_id]);
      for (const lf of liveFixtures) {
        liveScores.set(lf.fixture.id, {
          scoreA: lf.goals.home ?? 0,
          scoreB: lf.goals.away ?? 0,
          status: lf.fixture.status.short,
        });
      }
    } catch {
      // non-blocking: if live fetch fails, return DB data as-is
    }
  }

  // Merge live API data into DB matches
  const enriched = matches.map(m => {
    if (m.fixture_id && liveScores.has(m.fixture_id)) {
      const live = liveScores.get(m.fixture_id)!;
      return { ...m, score_a: live.scoreA, score_b: live.scoreB, api_status: live.status };
    }
    return m;
  });

  // Load team display info
  const teamIds = [...new Set(matches.flatMap(m => [m.nation_a, m.nation_b]))];
  const { data: teamsRaw } = await adm(admin)
    .from('teams')
    .select('id, name, flag_emoji')
    .in('id', teamIds);

  const teams: Record<string, { id: string; name: string; flag_emoji: string | null }> = {};
  for (const t of (teamsRaw ?? []) as Array<{ id: string; name: string; flag_emoji: string | null }>) {
    teams[t.id] = t;
  }

  return NextResponse.json(
    { matches: enriched, teams },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
