/**
 * match-window.ts — Smart polling guard for sync-results cron.
 *
 * isMatchWindowActive() queries the DB for unprocessed matches
 * scheduled within a ±2h30 window around now.
 *
 * When it returns false, sync-results skips the API call entirely
 * (0 quota consumed). On a normal day with no matches, this saves
 * ~280 API calls per competition.
 */

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Returns true if at least one unprocessed, non-cancelled match
 * is scheduled within [now - 2h30, now + 2h30].
 *
 * Window: ±3h around now.
 * With 30-min cron granularity this covers:
 *   - Matches starting in the next 30 min (T-3h buffer with margin)
 *   - Matches in progress (up to 90 + 30 extra time + penalty = ~2h10)
 *   - Matches just ended (T+30min post-match grace for the next cron tick)
 *
 * `includeStuckRetry` (default true) additionally retries matches stuck
 * unprocessed long after their window closed (e.g. a failed API call).
 * [QUOTA FIX] live-poll runs every 2 min, 24/7 — if it inherits this
 * fallback, a single permanently-stuck match (API outage, bad fixture id,
 * etc.) keeps the window "active" forever and burns the whole daily
 * API-Football quota retrying it every 2 minutes. Only the 30-min
 * sync-results cron (≤48 calls/day) should use the stuck-match fallback;
 * live-poll passes `includeStuckRetry: false` and relies on sync-results
 * as the safety net for genuinely stuck matches.
 */
export async function isMatchWindowActive(
  competitionIds: number[],
  opts: { includeStuckRetry?: boolean } = {},
): Promise<boolean> {
  if (competitionIds.length === 0) return false;

  const { includeStuckRetry = true } = opts;
  const admin = createAdminClient();
  const now   = new Date();
  const start = new Date(+now - 3 * 3_600_000).toISOString();  // T-3h
  const end   = new Date(+now + 3 * 3_600_000).toISOString();  // T+3h

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const A = (admin as any);

  // Primary check: unprocessed match within the ±3h window
  const { count, error } = await A
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .in('competition_id', competitionIds)
    .is('processed_at', null)
    .not('api_status', 'in', '("PST","SUSP","CANC","ABD")')
    .gte('scheduled_at', start)
    .lte('scheduled_at', end);

  if (error) {
    console.error('[match-window] isMatchWindowActive error:', error);
    return true; // fail open
  }

  if ((count ?? 0) > 0) return true;
  if (!includeStuckRetry) return false;

  // Fallback: any unprocessed match scheduled before the T-3h window.
  // This covers two cases:
  //  a) Match started (1H/2H etc.) but processRealMatchResult failed and the
  //     match has since left the ±3h window — would never be retried otherwise.
  //  b) Match never kicked off in our DB (api_status = 'NS') but its
  //     scheduled_at is now in the past — likely FT in API-Football already.
  const { count: stuckCount, error: stuckErr } = await A
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .in('competition_id', competitionIds)
    .is('processed_at', null)
    .not('api_status', 'in', '("PST","SUSP","CANC","ABD","TBD")')
    .lt('scheduled_at', start);  // scheduled before T-3h

  if (stuckErr) {
    console.error('[match-window] stuck-match check error:', stuckErr);
    return false;
  }

  return (stuckCount ?? 0) > 0;
}
