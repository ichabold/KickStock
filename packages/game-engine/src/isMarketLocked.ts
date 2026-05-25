import type { CalendarDay } from '@kickstock/types';

/**
 * Market is locked for a team:
 * - 15 minutes before kickoff
 * - Until 30 minutes after final whistle (estimated match + 15min buffer)
 *
 * In Phase 1 (simulation mode), market is never locked — returns false always.
 */
export function isMarketLocked(
  _teamId: string,
  _now: Date,
  _schedule: CalendarDay[]
): boolean {
  // Phase 1: always open (simulation mode, no real-time clock)
  return false;
}
