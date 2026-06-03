/**
 * POST /api/admin/competitions/[id]/import-teams
 *
 * Imports teams from API-Football for a given competition.
 * [G8 FIX] Uses apiNameToTeamId() to derive ISO2 team IDs ("FRA", "BRA")
 *          instead of the numeric API-Football ID ("157").
 * Also seeds team strength from FIFA rankings and initial_price from strength.
 */

import { NextRequest, NextResponse }   from 'next/server';
import { createAdminClient }           from '@/lib/supabase/admin';
import { createClient }                from '@/lib/supabase/server';
import { apiNameToTeamId }             from '@/lib/team-mapping';
import { teamIdToFlagEmoji }           from '@/lib/team-mapping/team-iso2';
import { fetchTeamStrengths }          from '@/lib/football-api';

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

async function fetchTeamsForLeague(leagueId: number, season: number) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new Error('API_FOOTBALL_KEY manquant');

  const res = await fetch(`${API_FOOTBALL_BASE}/teams?league=${leagueId}&season=${season}`, {
    headers: { 'x-apisports-key': apiKey },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`API-Football erreur: ${res.status}`);

  const json = await res.json() as {
    response: Array<{ team: { id: number; name: string; logo: string } }>;
  };
  return json.response ?? [];
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const competitionId = parseInt(params.id, 10);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;

  const { data: comp } = await adm
    .from('competitions')
    .select('league_id, season')
    .eq('id', competitionId)
    .single();

  if (!comp) return NextResponse.json({ error: 'Compétition introuvable' }, { status: 404 });

  // Fetch teams from API-Football
  let apiTeams: Awaited<ReturnType<typeof fetchTeamsForLeague>>;
  try {
    apiTeams = await fetchTeamsForLeague(comp.league_id, comp.season);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Fetch failed' }, { status: 500 });
  }

  // Fetch FIFA rankings for strength + initial_price seeding
  let strengthMap = new Map<number, number>();
  try {
    strengthMap = await fetchTeamStrengths();
  } catch {
    // non-blocking: teams will be imported with default strength 75
    console.warn('[import-teams] FIFA rankings fetch failed, using default strength');
  }

  let imported = 0;
  let skipped  = 0;
  const unmapped: string[] = [];

  for (const item of apiTeams) {
    const t = item.team;

    // [G8 FIX] Derive ISO2 team ID via the team-mapping (e.g. "Brazil" → "BRA")
    const teamId = apiNameToTeamId(t.name, comp.league_id);
    if (!teamId) {
      skipped++;
      unmapped.push(t.name);
      continue;
    }

    const strength     = strengthMap.get(t.id) ?? 75;
    const initialPrice = Math.round(strength * 1.5); // e.g. str=100 → 150 KC, str=75 → 112 KC
    const flagEmoji    = teamIdToFlagEmoji(teamId);

    // Upsert team (do NOT overwrite strength if already set manually)
    await adm.from('teams').upsert({
      id:          teamId,
      api_team_id: t.id,
      name:        t.name,
      logo_url:    t.logo ?? null,
      flag_emoji:  flagEmoji ?? null,
      strength,
      strength_updated_at: new Date().toISOString(),
    }, { onConflict: 'id', ignoreDuplicates: false });

    // Upsert competition_teams with pricing
    await adm.from('competition_teams').upsert({
      competition_id: competitionId,
      team_id:        teamId,
      initial_price:  initialPrice,
      current_price:  initialPrice,
    }, { onConflict: 'competition_id,team_id', ignoreDuplicates: false });

    imported++;
  }

  return NextResponse.json({
    ok: true,
    imported,
    skipped,
    unmapped: unmapped.length > 0 ? unmapped : undefined,
  });
}
