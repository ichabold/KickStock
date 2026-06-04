/**
 * GET /api/competition/bootstrap
 *
 * Returns everything the offline mode (localGameStore) needs to function
 * without NATIONS and CALENDAR constants.
 *
 * Response is cached in localStorage client-side (TTL 24h).
 * Server-side: no-store (always fresh from DB, cached at client).
 *
 * Response shape:
 * {
 *   competition: { id, name, start_date, league_id, season },
 *   teams:        [{ id, name, flag_emoji, group_code, strength, initial_price }],
 *   days:         [{ day_index, full_label, phase, is_ko, div_key }],
 *   group_fixtures: [{ day_index, nation_a, nation_b, venue }]
 * }
 *
 * KO fixtures are NOT included (unknown until group stage ends).
 * The offline store resolves KO matches at simulation time using buildKOMatches.
 */

import { NextResponse }        from 'next/server';
import { createAdminClient }   from '@/lib/supabase/admin';
import { teamIdToFlagEmoji }   from '@/lib/team-mapping/team-iso2';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function GET(req: Request) {
  const admin = createAdminClient();
  const url   = new URL(req.url);
  const competitionIdParam = url.searchParams.get('competition_id');
  const versionOnly        = url.searchParams.get('version_only') === '1';

  // ── 1. Competition ────────────────────────────────────────────────────────
  let compQuery = adm(admin)
    .from('competitions')
    .select('id, name, start_date, league_id, season');

  if (competitionIdParam && /^\d+$/.test(competitionIdParam)) {
    compQuery = compQuery.eq('id', parseInt(competitionIdParam, 10));
  } else {
    compQuery = compQuery.eq('is_active', true).order('id', { ascending: false });
  }

  const { data: comp, error: compErr } = await compQuery
    .select('id, name, start_date, league_id, season, last_sync_at')
    .limit(1).single();

  if (compErr || !comp) {
    return NextResponse.json(
      { error: 'Competition not found. Run sync-fixtures first.' },
      { status: 404 }
    );
  }

  // Version-only request — cheap cache-bust check (no DB joins needed)
  if (versionOnly) {
    return NextResponse.json({ version: comp.last_sync_at ?? comp.id });
  }

  // ── 2. Teams with group + pricing ─────────────────────────────────────────
  const { data: teamsRaw } = await adm(admin)
    .from('competition_teams')
    .select(`
      team_id,
      group_code,
      initial_price,
      teams (
        id,
        name,
        flag_emoji,
        logo_url,
        strength,
        confederation
      )
    `)
    .eq('competition_id', comp.id)
    .order('group_code', { ascending: true });

  const teams = ((teamsRaw ?? []) as Array<{
    team_id:       string;
    group_code:    string | null;
    initial_price: number;
    teams: {
      id:            string;
      name:          string;
      flag_emoji:    string | null;
      logo_url:      string | null;
      strength:      number;
      confederation: string | null;
    };
  }>).map(ct => ({
    id:            ct.teams.id,
    name:          ct.teams.name,
    flag_emoji:    ct.teams.flag_emoji ?? teamIdToFlagEmoji(ct.teams.id),
    logo_url:      ct.teams.logo_url,
    group_code:    ct.group_code,
    strength:      ct.teams.strength,
    initial_price: ct.initial_price,
    confederation: ct.teams.confederation,
  }));

  // ── 3. Competition days ───────────────────────────────────────────────────
  const { data: daysRaw } = await adm(admin)
    .from('competition_days')
    .select('day_index, full_label, date_label, phase, is_ko, div_key')
    .eq('competition_id', comp.id)
    .order('day_index', { ascending: true });

  const days = (daysRaw ?? []) as Array<{
    day_index:  number;
    full_label: string;
    date_label: string;
    phase:      string;
    is_ko:      boolean;
    div_key:    string | null;
  }>;

  // ── 4. Squad data for genGoals (outfield players only) ───────────────────
  const teamIds = teams.map(t => t.id);
  const { data: squadRaw } = await adm(admin)
    .from('team_players')
    .select('team_id, players(name)')
    .in('team_id', teamIds)
    .eq('season', comp.season)
    .neq('position', 'Goalkeeper');

  type SquadRow = { team_id: string; players: { name: string } | null };
  const squads: Record<string, string[]> = {};
  for (const row of (squadRaw ?? []) as SquadRow[]) {
    if (!row.players?.name) continue;
    if (!squads[row.team_id]) squads[row.team_id] = [];
    squads[row.team_id].push(row.players.name);
  }

  // ── 5. Group-stage fixtures ───────────────────────────────────────────────
  const { data: fixturesRaw } = await adm(admin)
    .from('matches')
    .select('day_index, nation_a, nation_b, venue, scheduled_at, api_status')
    .eq('competition_id', comp.id)
    .eq('phase', 'Groups')
    .not('api_status', 'in', '("PST","SUSP","CANC","ABD")')
    .order('scheduled_at', { ascending: true });

  const groupFixtures = (fixturesRaw ?? []) as Array<{
    day_index:    number;
    nation_a:     string;
    nation_b:     string;
    venue:        string | null;
    scheduled_at: string;
    api_status:   string;
  }>;

  // ── 5. Assemble response ──────────────────────────────────────────────────
  return NextResponse.json(
    {
      competition: {
        id:         comp.id,
        name:       comp.name,
        start_date: comp.start_date,
        league_id:  comp.league_id,
        season:     comp.season,
      },
      teams,
      days,
      group_fixtures: groupFixtures.map(f => ({
        day_index: f.day_index,
        nation_a:  f.nation_a,
        nation_b:  f.nation_b,
        venue:     f.venue,
      })),
      squads,
      generated_at: new Date().toISOString(),
    },
    {
      headers: {
        // Client caches for 1h, CDN (Vercel Edge) caches for 1h too
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  );
}
