/**
 * GET /api/cron/sync-squads
 *
 * Fetches squad data (players) for all teams in active competitions.
 * Uses /players/squads endpoint (API-Football PRO required).
 *
 * Run this once before a tournament starts, then weekly to catch squad changes.
 * Each squad is cached 24h in Redis — ~48 teams × 1 call = 48 API calls total.
 *
 * Stores data in:
 *   - players (id, name, photo_url, nationality)
 *   - team_players (player_id, team_id, season, position, number)
 *
 * Security: requires Authorization: Bearer {CRON_SECRET}
 */

import { captureApiException }  from '@/lib/sentryCapture';
import { createAdminClient }    from '@/lib/supabase/admin';
import { fetchSquad }           from '@/lib/football-api';

export const dynamic     = 'force-dynamic';
export const maxDuration = 300; // squads can take a while (48 teams × 1 call)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function GET(req: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // ── Load competitions ───────────────────────────────────────────────────────
  const url        = new URL(req.url);
  const specificId = url.searchParams.get('competition_id');
  const compQuery  = adm(admin).from('competitions').select('id, season');
  const { data: competitions } = specificId
    ? await compQuery.eq('id', parseInt(specificId, 10)).limit(1)
    : await compQuery.eq('is_active', true);

  if (!competitions || (competitions as unknown[]).length === 0) {
    return Response.json({ skipped: true, reason: 'no active competitions' });
  }

  // Collect unique teams (with their api_team_id) across all active competitions
  type TeamRow = { team_id: string; teams: { api_team_id: number | null } | null };
  const allTeamRows: TeamRow[] = [];

  for (const comp of competitions as Array<{ id: number; season: number }>) {
    const { data: ctRaw } = await adm(admin)
      .from('competition_teams')
      .select('team_id, teams(api_team_id)')
      .eq('competition_id', comp.id)
      .not('teams.api_team_id', 'is', null);

    if (ctRaw) allTeamRows.push(...(ctRaw as TeamRow[]));
  }

  // Deduplicate by team_id
  const seen = new Set<string>();
  const teams = allTeamRows.filter(row => {
    if (!row.teams?.api_team_id) return false;
    if (seen.has(row.team_id)) return false;
    seen.add(row.team_id);
    return true;
  });

  if (teams.length === 0) {
    return Response.json({ skipped: true, reason: 'no teams with api_team_id found' });
  }

  const season = (competitions as Array<{ season: number }>)[0].season;
  let synced   = 0;
  let failed   = 0;
  const errors: string[] = [];

  for (const row of teams) {
    const apiTeamId = row.teams!.api_team_id!;
    try {
      const squad = await fetchSquad(apiTeamId);

      for (const player of squad) {
        // Upsert player
        const { error: pErr } = await adm(admin).from('players').upsert(
          {
            id:          player.id,
            name:        player.name,
            photo_url:   player.photo ?? null,
            updated_at:  new Date().toISOString(),
          },
          { onConflict: 'id', ignoreDuplicates: false },
        );
        if (pErr) throw new Error(`players upsert [${player.id}]: ${pErr.message}`);

        // Upsert team_players
        const { error: tpErr } = await adm(admin).from('team_players').upsert(
          {
            player_id: player.id,
            team_id:   row.team_id,
            season,
            position:  player.position ?? null,
            number:    player.number ?? null,
          },
          { onConflict: 'player_id,team_id,season', ignoreDuplicates: false },
        );
        if (tpErr) throw new Error(`team_players upsert [${player.id}/${row.team_id}]: ${tpErr.message}`);
      }

      synced++;
      console.log(`[sync-squads] ${row.team_id} (api_id=${apiTeamId}): ${squad.length} players`);
    } catch (err) {
      failed++;
      const msg = `${row.team_id}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      captureApiException(err, { route: 'GET /api/cron/sync-squads', extra: { teamId: row.team_id } });
    }
  }

  return Response.json({
    ok:     true,
    synced,
    failed,
    total:  teams.length,
    errors: errors.length > 0 ? errors : undefined,
    ts:     new Date().toISOString(),
  });
}
