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
import { strengthToPrice }             from '@/lib/normalizer';

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

  // Fetch FIFA rankings for strength seeding (best-effort — endpoint may not be
  // available on all API plans). Falls back to existing DB strength.
  let strengthMap = new Map<number, number>();
  try {
    strengthMap = await fetchTeamStrengths();
  } catch {
    console.warn('[import-teams] FIFA rankings fetch failed — will use existing DB strength');
  }

  // Pre-load existing strength values from DB as fallback
  const { data: existingTeams } = await adm
    .from('teams')
    .select('id, api_team_id, strength');
  const dbStrengthByApiId = new Map<number, number>();
  const dbStrengthById    = new Map<string, number>();
  for (const row of (existingTeams ?? []) as Array<{ id: string; api_team_id: number | null; strength: number }>) {
    if (row.api_team_id) dbStrengthByApiId.set(row.api_team_id, row.strength);
    dbStrengthById.set(row.id, row.strength);
  }

  let imported = 0;
  let skipped  = 0;
  const unmapped: string[] = [];

  for (const item of apiTeams) {
    const t = item.team;

    const teamId = apiNameToTeamId(t.name, comp.league_id);
    if (!teamId) {
      skipped++;
      unmapped.push(t.name);
      continue;
    }

    // Priority: FIFA API → existing DB value → default 75
    const strength     = strengthMap.get(t.id)
                      ?? dbStrengthByApiId.get(t.id)
                      ?? dbStrengthById.get(teamId)
                      ?? 75;
    const initialPrice = strengthToPrice(strength);
    const flagEmoji    = teamIdToFlagEmoji(teamId);

    // Upsert team — only update strength if we got a fresh value from FIFA API
    const teamPatch: Record<string, unknown> = {
      id:          teamId,
      api_team_id: t.id,
      name:        t.name,
      logo_url:    t.logo ?? null,
      flag_emoji:  flagEmoji ?? null,
    };
    if (strengthMap.get(t.id) !== undefined) {
      teamPatch.strength             = strength;
      teamPatch.strength_updated_at  = new Date().toISOString();
    }
    await adm.from('teams').upsert(teamPatch, { onConflict: 'id', ignoreDuplicates: false });

    // Upsert competition_teams with recalculated price
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
