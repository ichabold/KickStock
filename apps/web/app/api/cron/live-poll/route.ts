/**
 * GET /api/cron/live-poll
 *
 * Cron — smart live-score polling, intended to run every 20 min, 16h-3h UTC
 * (vercel.json). API-Football reverted to the Free tier (100 req/day), so
 * this can no longer run 24/7 at high frequency without exhausting quota.
 *
 * [VERCEL CRON BUG] Vercel's own scheduler has been observed still invoking
 * this route every ~2 minutes around the clock despite vercel.json being
 * correctly deployed to production (confirmed: Cron Jobs settings page and
 * runtime logs both show the old 2-minute cadence even after redeploys and
 * toggling the Cron Jobs feature off/on). Since we don't control that, this
 * route now enforces its own UTC-hour guard below as a hard backstop — it
 * exits with zero DB/API cost whenever invoked outside 16h-23h or 0h-2h UTC,
 * regardless of how often Vercel actually calls it.
 *
 * Short-circuit: reuses isMatchWindowActive() (same guard as sync-results).
 * If no unprocessed match is scheduled within ±3h of now, exits immediately
 * with 0 API-Football calls.
 *
 * When active:
 *   1. fetchLiveFixtures(leagueIds) — 1 call per active league.
 *      Updates matches.score_a/score_b/api_status for fixtures currently
 *      in progress (1H/HT/2H/ET/BT/P), so /api/game/live-matches can read
 *      fresh-enough data straight from the DB (no per-request API call).
 *   2. fetchFinishedFixtures(leagueIds, season) — cached 30 min, essentially
 *      free when called this often. For any fixture now FT/AET/PEN:
 *        - processRealMatchResult() → sets processed_at (idempotent)
 *        - checkAndAdvancePhase() per competition
 *      Once processed_at is set, the match falls out of the
 *      isMatchWindowActive() window on the next tick — automatic stop.
 *
 * sync-results (30 min, ±3h window) remains unchanged as a safety net in
 * case this cron misses a tick (deploy, transient error, etc.).
 *
 * Security: requires Authorization: Bearer {CRON_SECRET}
 */

import { captureApiException } from '@/lib/sentryCapture';
import { createAdminClient }       from '@/lib/supabase/admin';
import { fetchLiveFixtures, fetchFinishedFixtures } from '@/lib/football-api';
import { isMatchWindowActive }     from '@/lib/match-window';
import { processRealMatchResult }  from '@/lib/process-real-result';
import { checkAndAdvancePhase }    from '@/lib/check-advance-phase';

export const dynamic     = 'force-dynamic';
export const maxDuration = 30;

// In-progress statuses we mirror into matches.score_a/score_b/api_status.
const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P']);

// Mirrors the intended vercel.json schedule (16h-23h + 0h-2h UTC). Backstop
// against Vercel invoking this route outside that window — see file header.
const SCHEDULED_HOURS_UTC = new Set([16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function GET(req: Request) {
  // ── Auth check ──────────────────────────────────────────────────────────────
  if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── UTC-hour backstop — see file header ─────────────────────────────────────
  // `force=1` bypasses this (manual/admin trigger), same as the match-window check below.
  const force = new URL(req.url).searchParams.get('force') === '1';
  if (!force && !SCHEDULED_HOURS_UTC.has(new Date().getUTCHours())) {
    return Response.json({
      skipped: true,
      reason:  'outside scheduled hours (16h-23h, 0h-2h UTC)',
      checked: new Date().toISOString(),
    });
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

  const comps     = competitions as Array<{ id: number; league_id: number; season: number; name: string }>;
  const compIds   = comps.map(c => c.id);
  const leagueIds = comps.map(c => c.league_id);
  const season    = comps[0].season;

  // ── Smart window check — skip if no match expected now ─────────────────────
  // `force=1` (parsed above) bypasses the window (manual/admin trigger).
  // includeStuckRetry: false — this cron runs frequently within its scheduled
  // hours; retrying permanently-stuck matches here would burn the daily
  // API-Football quota. sync-results (30 min cadence) is the safety net for those.
  const active = force || await isMatchWindowActive(compIds, { includeStuckRetry: false });
  if (!active) {
    return Response.json({
      skipped: true,
      reason:  'no active match window',
      checked: new Date().toISOString(),
    });
  }

  let liveUpdated = 0;
  let processed   = 0;
  const errors: string[] = [];

  // ── 1. Live scores (in-progress matches) ────────────────────────────────────
  try {
    const liveFixtures = await fetchLiveFixtures(leagueIds);
    for (const f of liveFixtures) {
      const status = f.fixture.status.short;
      if (!LIVE_STATUSES.has(status)) continue;

      const { error, count } = await adm(admin)
        .from('matches')
        .update({
          score_a:    f.goals.home ?? 0,
          score_b:    f.goals.away ?? 0,
          api_status: status,
        }, { count: 'exact' })
        .eq('fixture_id', f.fixture.id)
        .is('processed_at', null);

      if (error) {
        errors.push(`live update fixture ${f.fixture.id}: ${error.message}`);
      } else {
        liveUpdated += count ?? 0;
      }
    }
  } catch (err) {
    console.error('[live-poll] fetchLiveFixtures failed:', err);
    captureApiException(err, { route: 'GET /api/cron/live-poll', extra: { step: 'live-fixtures' } });
    errors.push(`fetchLiveFixtures: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 2. Finished matches (automatic stop) ────────────────────────────────────
  try {
    const finished = await fetchFinishedFixtures(leagueIds, season);
    for (const fixture of finished) {
      try {
        const wasProcessed = await processRealMatchResult(fixture.fixture.id, fixture);
        if (wasProcessed) processed++;
      } catch (err) {
        const msg = `fixture ${fixture.fixture.id}: ${err instanceof Error ? err.message : String(err)}`;
        console.error('[live-poll]', msg, err);
        captureApiException(err, { route: 'GET /api/cron/live-poll', extra: { fixtureId: fixture.fixture.id } });
        errors.push(msg);
      }
    }

    if (processed > 0) {
      for (const comp of comps) {
        try {
          await checkAndAdvancePhase(comp.id);
        } catch (err) {
          captureApiException(err, { route: 'GET /api/cron/live-poll', extra: { step: 'advance-phase', competitionId: comp.id } });
        }
      }
    }
  } catch (err) {
    console.error('[live-poll] fetchFinishedFixtures failed:', err);
    captureApiException(err, { route: 'GET /api/cron/live-poll', extra: { step: 'finished-fixtures' } });
    errors.push(`fetchFinishedFixtures: ${err instanceof Error ? err.message : String(err)}`);
  }

  return Response.json({
    ok:          true,
    liveUpdated,
    processed,
    errors:      errors.length > 0 ? errors : undefined,
    ts:          new Date().toISOString(),
  });
}
