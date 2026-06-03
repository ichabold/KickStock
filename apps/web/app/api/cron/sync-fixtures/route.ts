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
import { createAdminClient }      from '@/lib/supabase/admin';
import { fetchAllFixtures, fetchTeamStrengths } from '@/lib/football-api';
import { normalizeFixture }       from '@/lib/normalizer';
import type { Competition }       from '@/lib/normalizer';

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

  // ── Load competitions ───────────────────────────────────────────────────────
  // If competition_id is provided (admin manual sync), target that specific
  // competition regardless of is_active status. Otherwise run on all active.
  const url            = new URL(req.url);
  const specificId     = url.searchParams.get('competition_id');
  const compQuery      = adm(admin)
    .from('competitions')
    .select('id, league_id, season, name, start_date');

  const { data: competitions, error: compErr } = specificId
    ? await compQuery.eq('id', parseInt(specificId, 10)).limit(1)
    : await compQuery.eq('is_active', true);

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
      console.log(`[sync-fixtures] ${comp.name}: ${fixtures.length} fixtures`);

      // Derive start_date from fixtures (most reliable — avoids DB/REST discrepancies).
      // The start_date stored in DB may lag behind due to connection pooler caching.
      const derivedStartDate = fixtures.length > 0
        ? fixtures.map(f => f.fixture.date.slice(0, 10)).sort()[0]
        : comp.start_date;
      const effectiveComp = { ...comp, start_date: derivedStartDate };

      let upserted = 0;
      let skipped  = 0;

      for (const fixture of fixtures) {
        const normalized = normalizeFixture(fixture, effectiveComp);
        if (!normalized) {
          skipped++;
          continue;
        }

        const { teamA, teamB, compTeamA, compTeamB, day, match } = normalized;

        // ── 1. Upsert teams (name, logo, flag — strength seeded separately below)
        for (const t of [teamA, teamB]) {
          const { error: tErr } = await adm(admin).from('teams').upsert(
            { id: t.id, api_team_id: t.api_team_id, name: t.name, logo_url: t.logo_url, flag_emoji: t.flag_emoji },
            { onConflict: 'id', ignoreDuplicates: false }
          );
          if (tErr) throw new Error(`teams upsert [${t.id}]: ${tErr.message}`);
        }

        // ── 2. Upsert competition_teams (group_code only — initial_price seeded below)
        for (const ct of [compTeamA, compTeamB]) {
          const { error: ctErr } = await adm(admin).from('competition_teams').upsert(
            { competition_id: ct.competition_id, team_id: ct.team_id, group_code: ct.group_code },
            { onConflict: 'competition_id,team_id', ignoreDuplicates: false }
          );
          if (ctErr) throw new Error(`competition_teams upsert [${ct.team_id}]: ${ctErr.message}`);
        }

        // ── 3. Upsert competition_days (metadata)
        const { error: dayErr } = await adm(admin).from('competition_days').upsert(
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
        if (dayErr) throw new Error(`competition_days upsert: ${dayErr.message}`);

        // ── 4. Upsert match (GOLDEN RULE: never touch processed_at / scores)
        // We use a raw SQL upsert via RPC to guarantee the exclusion.
        // Supabase JS client .upsert() would overwrite all columns by default.
        const { error: matchErr } = await adm(admin).rpc('upsert_fixture', {
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
        if (matchErr) throw new Error(`upsert_fixture RPC: ${matchErr.message}`);

        upserted++;
      }

      // ── 5. Seed strength + initial_price for teams that don't have one yet ──
      //       Runs once per competition per sync (cached 24h in Redis).
      try {
        const { data: unseeded } = await adm(admin)
          .from('competition_teams')
          .select('team_id, teams(api_team_id, strength)')
          .eq('competition_id', comp.id)
          .or('teams.strength.is.null,competition_teams.initial_price.is.null');

        if (unseeded && (unseeded as unknown[]).length > 0) {
          const strengthMap = await fetchTeamStrengths();

          for (const row of unseeded as Array<{ team_id: string; teams: { api_team_id: number | null; strength: number | null } | null }>) {
            const apiId    = row.teams?.api_team_id ?? null;
            const strength = (apiId && strengthMap.get(apiId)) ?? row.teams?.strength ?? 75;
            const price    = Math.round(strength * 1.5);

            // Update teams.strength only if missing
            if (!row.teams?.strength && apiId) {
              await adm(admin).from('teams').update({
                strength,
                strength_updated_at: new Date().toISOString(),
              }).eq('id', row.team_id);
            }

            // Always ensure initial_price + current_price are set
            await adm(admin).from('competition_teams').update({
              initial_price: price,
              current_price: price,
            })
              .eq('competition_id', comp.id)
              .eq('team_id', row.team_id)
              .is('initial_price', null);
          }

          console.log(`[sync-fixtures] ${comp.name}: strength seeded for ${(unseeded as unknown[]).length} teams`);
        }
      } catch (seedErr) {
        // Non-blocking: log but don't fail the whole sync
        console.warn(`[sync-fixtures] Strength seeding failed for ${comp.name}:`, seedErr);
        Sentry.captureException(seedErr, { tags: { cron: 'sync-fixtures', step: 'seed-strength' } });
      }

      // ── 6. Update last_sync_at
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
