/**
 * GET /api/cron/sync-fixtures
 *
 * Daily cron (06:00 UTC) — synchronizes competition fixtures from API-Football.
 *
 * For each active competition:
 *   1. Fetches all fixtures from API-Football (1 API call)
 *   2. Auto-discovers teams → upserts teams + competition_teams
 *   3. Derives day metadata → upserts competition_days
 *   4. Upserts matches (NEVER touches processed_at, score_a, score_b)
 *   5. Updates competitions.last_sync_at
 *
 * Idempotent: safe to run multiple times. Handles postponements automatically
 * (api_status PST updated, scheduled_at corrected, processed_at never touched).
 *
 * Security: requires Authorization: Bearer {CRON_SECRET}
 * Triggered by Vercel Cron (vercel.json) or manually from admin panel.
 */

import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAllFixtures }  from '@/lib/football-api';
import { normalizeFixture }  from '@/lib/normalizer';
import type { Competition }  from '@/lib/normalizer';

export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

// ── Helper: typed admin.from() ────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function GET(req: Request) {
  // ── Auth check ──────────────────────────────────────────────────────────────
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // ── Load active competitions ────────────────────────────────────────────────
  const { data: competitions, error: compErr } = await adm(admin)
    .from('competitions')
    .select('id, league_id, season, name, start_date')
    .eq('is_active', true);

  if (compErr) {
    Sentry.captureException(compErr, { tags: { cron: 'sync-fixtures' } });
    return Response.json({ error: compErr.message }, { status: 500 });
  }

  if (!competitions || competitions.length === 0) {
    return Response.json({ message: 'No active competitions' });
  }

  const results: Array<{
    competition: string;
    upserted?: number;
    skipped?: number;
    error?: string;
  }> = [];

  // ── Process each competition ────────────────────────────────────────────────
  for (const comp of competitions as Competition[]) {
    try {
      const fixtures = await fetchAllFixtures(comp.league_id, comp.season);
      console.log(`[sync-fixtures] ${comp.name} league=${comp.league_id} season=${comp.season}: API returned ${fixtures.length} fixtures`);
      console.log(`[sync-fixtures] DEBUG comp=${JSON.stringify(comp)}`);
      if (fixtures[0]) {
        const f0 = fixtures[0];
        const { calcDayIndex } = await import('@/lib/normalizer');
        console.log(`[sync-fixtures] DEBUG fixture[0].date=${f0.fixture.date} start_date=${comp.start_date} dayIndex=${comp.start_date ? calcDayIndex(f0.fixture.date, comp.start_date) : 'N/A'}`);
      }
      let upserted = 0;
      let skipped  = 0;

      for (const fixture of fixtures) {
        const normalized = normalizeFixture(fixture, comp);
        if (!normalized) {
          skipped++;
          continue;
        }

        const { teamA, teamB, compTeamA, compTeamB, day, match } = normalized;

        // ── 1. Upsert teams
        // Only update non-game-design fields (NOT strength — admin-configured)
        await adm(admin).from('teams').upsert(
          [
            { id: teamA.id, api_team_id: teamA.api_team_id, name: teamA.name, logo_url: teamA.logo_url, flag_emoji: teamA.flag_emoji },
            { id: teamB.id, api_team_id: teamB.api_team_id, name: teamB.name, logo_url: teamB.logo_url, flag_emoji: teamB.flag_emoji },
          ],
          {
            onConflict:       'id',
            ignoreDuplicates: false,
            // strength is NOT in this payload → will not be overwritten
          }
        );

        // ── 2. Upsert competition_teams (group_code only — NOT initial_price)
        await adm(admin).from('competition_teams').upsert(
          [
            { competition_id: compTeamA.competition_id, team_id: compTeamA.team_id, group_code: compTeamA.group_code },
            { competition_id: compTeamB.competition_id, team_id: compTeamB.team_id, group_code: compTeamB.group_code },
          ],
          { onConflict: 'competition_id,team_id', ignoreDuplicates: false }
        );

        // ── 3. Upsert competition_days (metadata)
        await adm(admin).from('competition_days').upsert(
          {
            competition_id: day.competition_id,
            day_index:      day.day_index,
            date_label:     day.date_label,
            full_label:     day.full_label,
            phase:          day.phase,
            is_ko:          day.is_ko,
            div_key:        day.div_key,
          },
          { onConflict: 'competition_id,day_index', ignoreDuplicates: false }
        );

        // ── 4. Upsert match (GOLDEN RULE: never touch processed_at / scores)
        // We use a raw SQL upsert via RPC to guarantee the exclusion.
        // Supabase JS client .upsert() would overwrite all columns by default.
        await adm(admin).rpc('upsert_fixture', {
          p_fixture_id:     match.fixture_id,
          p_competition_id: match.competition_id,
          p_nation_a:       match.nation_a,
          p_nation_b:       match.nation_b,
          p_day_index:      match.day_index,
          p_phase:          match.phase,
          p_league_round:   match.league_round,
          p_venue:          match.venue,
          p_scheduled_at:   match.scheduled_at,
          p_api_status:     match.api_status,
        });

        upserted++;
      }

      // ── 5. Update last_sync_at
      await adm(admin).from('competitions')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', comp.id);

      results.push({ competition: comp.name, upserted, skipped });

      console.log(`[sync-fixtures] ${comp.name}: ${upserted} upserted, ${skipped} skipped`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sync-fixtures] Error for ${comp.name}:`, err);
      Sentry.captureException(err, {
        tags:  { cron: 'sync-fixtures' },
        extra: { competition: comp.name },
      });
      results.push({ competition: comp.name, error: msg });
    }
  }

  return Response.json({ ok: true, results, ts: new Date().toISOString() });
}
