/**
 * GET /api/game/live-matches
 *
 * Returns today's matches with their live status, scores, and trade lock state.
 * Used by LiveTab to show real-time match status.
 *
 * [G3 FIX] Reads X-Competition-ID header (same as all other game routes).
 * [SMART POLLING] Scores/status for in-progress matches (1H/HT/2H/ET/BT/P) are
 *                  now kept fresh directly in `matches` by the `/api/cron/live-poll`
 *                  cron (every 2 min during active match windows — see
 *                  SMART_POLLING_PLAN.md). This route now reads the DB only and
 *                  no longer calls API-Football on every request (data is at
 *                  most ~2 min stale, in line with the live-poll cadence).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }          from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function GET(req: NextRequest) {
  const admin = createAdminClient();

  // [G3 FIX] Use competition_id from header, fallback to first active competition
  const headerCompId = req.headers.get('X-Competition-ID');

  let compQuery = adm(admin)
    .from('competitions')
    .select('id')
    .eq('is_active', true);

  if (headerCompId && /^\d+$/.test(headerCompId)) {
    compQuery = compQuery.eq('id', parseInt(headerCompId, 10));
  } else {
    compQuery = compQuery.order('id', { ascending: false }).limit(1);
  }

  const { data: comp } = await compQuery.single();
  if (!comp) return NextResponse.json({ matches: [], teams: {} });

  // Today's matches (UTC day window) — PLUS any match that has already
  // kicked off but isn't processed yet, even if its scheduled_at falls on
  // the previous UTC day (late-evening kickoffs, e.g. 22:00 UTC + 2h+,
  // crossing midnight UTC). Without this, a match still live at 00:xx UTC
  // would silently drop out of "today" and both its trade lock (computed
  // client-side from this endpoint) and its live score would disappear.
  const now     = new Date();
  const start   = new Date(now); start.setUTCHours(0, 0, 0, 0);
  const end     = new Date(now); end.setUTCHours(23, 59, 59, 999);
  // Stuck-match lookback: unprocessed matches from up to 5h ago still included
  // so they're retried by the live-poll, but not so old they show as live indefinitely.
  const lookback = new Date(+now - 5 * 3_600_000).toISOString();

  const { data: matchesRaw } = await adm(admin)
    .from('matches')
    .select('fixture_id, nation_a, nation_b, scheduled_at, api_status, score_a, score_b, trade_lock_until, processed_at, phase, venue')
    .eq('competition_id', comp.id)
    .not('api_status', 'in', '("PST","SUSP","CANC","ABD")')
    .or(
      // Today's matches
      `and(scheduled_at.gte.${start.toISOString()},scheduled_at.lte.${end.toISOString()}),` +
      // Kicked off but not yet processed, within the 5h lookback window
      `and(processed_at.is.null,scheduled_at.gte.${lookback},scheduled_at.lte.${now.toISOString()}),` +
      // All future KO fixtures (for schedule CET time display — won't trigger trade locks)
      `and(phase.neq.Groups,processed_at.is.null,scheduled_at.gt.${now.toISOString()})`
    )
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

  // Live scores/status for in-progress matches are kept fresh in the DB by
  // the `/api/cron/live-poll` cron (every 2 min during active match windows).

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
    { matches, teams },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
