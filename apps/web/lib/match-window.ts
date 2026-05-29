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
 */
export async function isMatchWindowActive(competitionIds: number[]): Promise<boolean> {
  if (competitionIds.length === 0) return false;

  const admin = createAdminClient();
  const now   = new Date();
  const start = new Date(+now - 3 * 3_600_000).toISOString();  // T-3h
  const end   = new Date(+now + 3 * 3_600_000).toISOString();  // T+3h

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (admin as any)
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .in('competition_id', competitionIds)
    .is('processed_at', null)
    .not('api_status', 'in', '("PST","SUSP","CANC","ABD")')
    .gte('scheduled_at', start)
    .lte('scheduled_at', end);

  if (error) {
    console.error('[match-window] isMatchWindowActive error:', error);
    // Fail open: if we can't check, assume there might be matches
    return true;
  }

  return (count ?? 0) > 0;
}
