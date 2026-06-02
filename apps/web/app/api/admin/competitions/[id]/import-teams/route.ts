import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

async function fetchTeamsForLeague(leagueId: number, season: number) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new Error('API_FOOTBALL_KEY manquant');

  const res = await fetch(`${API_FOOTBALL_BASE}/teams?league=${leagueId}&season=${season}`, {
    headers: { 'x-apisports-key': apiKey },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`API-Football erreur: ${res.status}`);

  const json = await res.json() as { response: Array<{ team: { id: number; name: string; logo: string } }> };
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

  let teams: Awaited<ReturnType<typeof fetchTeamsForLeague>>;
  try {
    teams = await fetchTeamsForLeague(comp.league_id, comp.season);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Fetch failed' }, { status: 500 });
  }

  let imported = 0;
  for (const item of teams) {
    const t = item.team;
    // Use API-Football team id as a string key (no ISO2 mapping for now)
    const teamId = String(t.id);

    await adm.from('teams').upsert({
      id:      teamId,
      name:    t.name,
      logo_url: t.logo ?? null,
    }, { onConflict: 'id' });

    await adm.from('competition_teams').upsert({
      competition_id: competitionId,
      team_id:        teamId,
      strength:       70,
      initial_price:  50,
      current_price:  50,
    }, { onConflict: 'competition_id,team_id' });

    imported++;
  }

  return NextResponse.json({ ok: true, imported });
}
