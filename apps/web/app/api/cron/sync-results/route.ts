/**
 * GET /api/cron/sync-results
 *
 * Cron (every 30 minutes) — processes real match results.
 * Free plan budget: ~1 API call per run × 48 runs/day = ~48 calls/day max.
 * In practice much less thanks to isMatchWindowActive() short-circuit.
 *
 * Short-circuit: if isMatchWindowActive() returns false,
 * the cron exits immediately with 0 API calls consumed.
 *
 * When active:
 *   1. Fetches FT/AET/PEN fixtures from API-Football
 *   2. For each fixture not yet processed: processRealMatchResult()
 *   3. For each competition: checkAndAdvancePhase()
 *
 * Security: requires Authorization: Bearer {CRON_SECRET}
 */

import * as Sentry from '@sentry/nextjs';
import { createAdminClient }       from '@/lib/supabase/admin';
import { fetchFinishedFixtures }   from '@/lib/football-api';
import { isMatchWindowActive }     from '@/lib/match-window';
import { processRealMatchResult }  from '@/lib/process-real-result';
import { checkAndAdvancePhase }    from '@/lib/check-advance-phase';

export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function GET(req: Request) {
  // ── Auth check ──────────────────────────────────────────────────────────────
  if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // ── Load active competitions ────────────────────────────────────────────────
  const { data: competitions } = await adm(admin)
    .from('competitions')
    .select('id, league_id, season, name')
    .eq('is_active', true);

  if (!competitions || competitions.length === 0) {
    return Response.json({ skipped: true, reason: 'no active competitions' });
  }

  const compIds   = (competitions as Array<{ id: number; league_id: number; season: number; name: string }>).map(c => c.id);
  const leagueIds = (competitions as Array<{ id: number; league_id: number; season: number; name: string }>).map(c => c.league_id);
  const season    = (competitions as Array<{ id: number; league_id: number; season: number; name: string }>)[0].season;

  // ── Smart window check — skip if no matches expected now ───────────────────
  const active = await isMatchWindowActive(compIds);
  if (!active) {
    return Response.json({
      skipped: true,
      reason:  'no active match window',
      checked: new Date().toISOString(),
    });
  }

  // ── Fetch finished fixtures from API ───────────────────────────────────────
  let finished;
  try {
    finished = await fetchFinishedFixtures(leagueIds, season);
  } catch (err) {
    Sentry.captureException(err, { tags: { cron: 'sync-results' } });
    return Response.json({ error: 'API fetch failed', detail: String(err) }, { status: 500 });
  }

  let processed = 0;
  const errors: string[] = [];

  // ── Process each finished fixture ──────────────────────────────────────────
  for (const fixture of finished) {
    try {
      const wasProcessed = await processRealMatchResult(fixture.fixture.id, fixture);
      if (wasProcessed) processed++;
    } catch (err) {
      const msg = `fixture ${fixture.fixture.id}: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[sync-results]', msg, err);
      Sentry.captureException(err, {
        tags:  { cron: 'sync-results' },
        extra: { fixtureId: fixture.fixture.id },
      });
      errors.push(msg);
    }
  }

  // ── Advance phases for each competition ────────────────────────────────────
  for (const comp of competitions as Array<{ id: number }>) {
    try {
      await checkAndAdvancePhase(comp.id);
    } catch (err) {
      Sentry.captureException(err, {
        tags:  { cron: 'sync-results', step: 'advance-phase' },
        extra: { competitionId: comp.id },
      });
    }
  }

  return Response.json({
    ok:        true,
    processed,
    total:     finished.length,
    errors:    errors.length > 0 ? errors : undefined,
    ts:        new Date().toISOString(),
  });
}
