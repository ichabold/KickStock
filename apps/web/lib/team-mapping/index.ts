/**
 * team-mapping/index.ts — Maps API-Football team names to KickStock team IDs.
 *
 * Usage:
 *   const id = apiNameToTeamId('Korea Republic', 1)  // → "KOR"
 *   const id = apiNameToTeamId('Unknown Team', 1)    // → null (+ Sentry warning)
 *
 * To add a new competition mapping:
 *   1. Create league_N.ts with the mapping Record
 *   2. Import it here and add it to MAPPINGS
 *   3. Run: pnpm tsx scripts/validate-team-mapping.ts --league=N --season=YYYY
 */

import { LEAGUE_1_MAPPING } from './league_1';

const MAPPINGS: Record<number, Record<string, string>> = {
  1: LEAGUE_1_MAPPING,
  // 2:  LEAGUE_2_MAPPING,   // UEFA Champions League (V2)
  // 39: LEAGUE_39_MAPPING,  // English Premier League (V2)
};

/**
 * Converts an API-Football team name to a KickStock team ID.
 *
 * @param apiName  - team name as returned by API-Football
 * @param leagueId - API-Football league ID (determines which mapping to use)
 * @returns        - team ID string ("BRA") or null if not found
 */
export function apiNameToTeamId(apiName: string, leagueId: number): string | null {
  const mapping = MAPPINGS[leagueId];
  if (!mapping) {
    console.error(`[team-mapping] No mapping found for league ${leagueId}`);
    return null;
  }

  const id = mapping[apiName];
  if (!id) {
    console.error(
      `[team-mapping] Unknown team name: "${apiName}" (league ${leagueId}). ` +
      `Add it to league_${leagueId}.ts`
    );
    return null;
  }

  return id;
}

/**
 * Returns all known team IDs for a league (for validation scripts).
 */
export function getAllTeamIds(leagueId: number): string[] {
  return Object.values(MAPPINGS[leagueId] ?? {});
}

/**
 * Returns all known API team names for a league (for validation scripts).
 */
export function getAllApiNames(leagueId: number): string[] {
  return Object.keys(MAPPINGS[leagueId] ?? {});
}
