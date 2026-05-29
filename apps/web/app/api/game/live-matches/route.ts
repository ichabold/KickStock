/**
 * GET /api/game/live-matches
 *
 * Returns today's matches with their live status, scores, and trade lock state.
 * Used by LiveTab to show real-time match status without CALENDAR dependency.
 */

import { NextResponse }      from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function GET() {
  const admin = createAdminClient();

  // Active competition
  const { data: comp } = await adm(admin)
    .from('competitions')
    .select('id')
    .eq('is_active', true)
    .limit(1)
    .single();

  if (!comp) return NextResponse.json({ matches: [], teams: {} });

  // Today's matches (±1 day window to catch late-night matches)
  const now   = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end   = new Date(now);
  end.setHours(23, 59, 59, 999);

  const { data: matchesRaw } = await adm(admin)
    .from('matches')
    .select('fixture_id, nation_a, nation_b, scheduled_at, api_status, score_a, score_b, trade_lock_until, processed_at, phase, venue')
    .eq('competition_id', comp.id)
    .not('api_status', 'in', '("PST","SUSP","CANC","ABD")')
    .gte('scheduled_at', start.toISOString())
    .lte('scheduled_at', end.toISOString())
    .order('scheduled_at', { ascending: true });

  const matches = matchesRaw ?? [];

  if (!matches.length) return NextResponse.json({ matches: [], teams: {} });

  // Load team display info
  const teamIds = [...new Set((matches as Array<{ nation_a: string; nation_b: string }>).flatMap(m => [m.nation_a, m.nation_b]))];
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
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
