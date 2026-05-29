/**
 * normalizer.ts — Transforms raw API-Football fixtures into DB-ready rows.
 *
 * This is the core of the zero-hardcoding architecture:
 * every piece of data (team name, flag, phase, day label, div_key…)
 * is DERIVED from what the API provides — nothing is hardcoded.
 *
 * Entry point: normalizeFixture(fixture, competition)
 * Returns:     NormalizedFixture (4 DB upsert payloads) | null
 */

import type { ApiFixture } from './football-api';
import { apiNameToTeamId } from './team-mapping';

// ── Types for DB rows ─────────────────────────────────────────────────────────

export interface TeamRow {
  id:           string;        // "BRA"
  api_team_id:  number;
  name:         string;
  logo_url:     string | null;
  flag_emoji:   string | null;
}

export interface CompetitionTeamRow {
  competition_id: number;
  team_id:        string;
  group_code:     string | null;
}

export interface CompetitionDayRow {
  competition_id: number;
  day_index:      number;
  date_label:     string;     // "Jun 11"
  full_label:     string;     // "Day 1 · Thu Jun 11"
  phase:          string;     // "Groups"|"R32"|"R16"|"QF"|"SF"|"3rd"|"Final"
  is_ko:          boolean;
  div_key:        string | null;
}

export interface MatchRow {
  fixture_id:     number;
  competition_id: number;
  nation_a:       string;
  nation_b:       string;
  day_index:      number;
  phase:          string;
  league_round:   string;
  venue:          string | null;
  scheduled_at:   string;      // ISO 8601
  api_status:     string;
}

export interface NormalizedFixture {
  teamA:     TeamRow;
  teamB:     TeamRow;
  compTeamA: CompetitionTeamRow;
  compTeamB: CompetitionTeamRow;
  day:       CompetitionDayRow;
  match:     MatchRow;
}

export interface Competition {
  id:         number;
  league_id:  number;
  season:     number;
  name:       string;
  start_date: string | null;  // "2026-06-11"
}

// ── Game-rule constant (not factual data) ─────────────────────────────────────

/**
 * Maps KickStock phase names to dividend keys.
 * This is a BUSINESS RULE of the game, not a fact about football —
 * it belongs in code, not in DB.
 */
export const PHASE_TO_DIV: Record<string, string | null> = {
  Groups: null,
  R32:    'r32',
  R16:    'r16',
  QF:     'qf',
  SF:     'sf',
  '3rd':  null,
  Final:  'final',
};

// ── Derivation functions ──────────────────────────────────────────────────────

/**
 * Maps API-Football's league.round string to a KickStock phase name.
 * Examples:
 *   "Group Stage - 1"   → "Groups"
 *   "Round of 32"       → "R32"
 *   "Quarter-finals"    → "QF"
 *   "3rd Place Final"   → "3rd"
 */
export function leagueRoundToPhase(round: string): string {
  if (round.toLowerCase().startsWith('group')) return 'Groups';
  if (round === 'Round of 32')                 return 'R32';
  if (round === 'Round of 16')                 return 'R16';
  if (round === 'Quarter-finals')              return 'QF';
  if (round === 'Semi-finals')                 return 'SF';
  if (round === '3rd Place Final')             return '3rd';
  if (round === 'Final')                       return 'Final';
  // Unknown — return as-is so we can see it in logs and add a mapping
  console.warn(`[normalizer] Unknown league round: "${round}"`);
  return round;
}

/**
 * Computes a 0-based day index from the fixture date and competition start date.
 * Uses midnight ET (UTC-5) as the day boundary, matching the US host timezone.
 *
 * Examples:
 *   start_date = "2026-06-11", fixture_date = "2026-06-11T18:00:00Z" → 0
 *   start_date = "2026-06-11", fixture_date = "2026-06-12T02:00:00Z" → 0 (still Jun 11 ET)
 *   start_date = "2026-06-11", fixture_date = "2026-06-13T18:00:00Z" → 2
 */
export function calcDayIndex(fixtureDate: string, startDate: string): number {
  // Start of competition: midnight ET = UTC-5 = 05:00 UTC
  const start = new Date(`${startDate}T05:00:00Z`);
  const match = new Date(fixtureDate);
  return Math.max(0, Math.floor((match.getTime() - start.getTime()) / 86_400_000));
}

/**
 * Formats a short date label from an ISO date string.
 * "2026-06-11T18:00:00Z" → "Jun 11"
 */
export function formatDateLabel(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    month:    'short',
    day:      'numeric',
    timeZone: 'America/New_York',
  });
}

/**
 * Builds the full human-readable day label.
 * Groups:  "Day 1 · Thu Jun 11"
 * KO:      "R32 · Sun Jun 28"
 */
export function buildDayLabel(dayIndex: number, fixtureDate: string, phase: string): string {
  const d   = new Date(fixtureDate);
  const tz  = 'America/New_York';
  const dow = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz });
  const mdy = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz });
  return phase === 'Groups'
    ? `Day ${dayIndex + 1} · ${dow} ${mdy}`
    : `${phase} · ${dow} ${mdy}`;
}

/**
 * Derives a flag emoji from a 2-letter ISO country code.
 * Uses Unicode Regional Indicator Symbols (U+1F1E6…U+1F1FF).
 *
 * "BR" → 🇧🇷   "FR" → 🇫🇷   "US" → 🇺🇸
 */
export function isoToFlagEmoji(iso2: string): string {
  return [...iso2.toUpperCase()].map(c =>
    String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)
  ).join('');
}

/**
 * Extracts a 2-letter ISO code from an API-Football logo URL.
 * "https://media.api-sports.io/flags/br.svg" → "BR"
 * Returns null if the URL doesn't match the expected pattern.
 */
export function extractIsoFromLogoUrl(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  // Flags CDN: .../flags/br.svg
  const flagMatch = logoUrl.match(/\/flags\/([a-z]{2})\.svg$/i);
  if (flagMatch) return flagMatch[1].toUpperCase();
  return null;
}

/**
 * Strips "Group " prefix from league.group field.
 * "Group A" → "A"    null → null
 */
function parseGroupCode(group: string | null): string | null {
  if (!group) return null;
  return group.replace(/^Group\s+/i, '').trim() || null;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Transforms a single API-Football fixture into DB upsert payloads.
 *
 * Returns null (with a console.error) if the team names can't be mapped.
 * The caller (sync-fixtures cron) should skip nulls and increment a `skipped` counter.
 */
export function normalizeFixture(
  fixture:     ApiFixture,
  competition: Competition,
): NormalizedFixture | null {
  const idA = apiNameToTeamId(fixture.teams.home.name, competition.league_id);
  const idB = apiNameToTeamId(fixture.teams.away.name, competition.league_id);

  if (!idA || !idB) {
    // Error already logged by apiNameToTeamId
    return null;
  }

  const phase    = leagueRoundToPhase(fixture.league.round);
  const dayIndex = competition.start_date
    ? calcDayIndex(fixture.fixture.date, competition.start_date)
    : 0;
  const isoA = extractIsoFromLogoUrl(fixture.teams.home.logo);
  const isoB = extractIsoFromLogoUrl(fixture.teams.away.logo);
  const groupCode = parseGroupCode(fixture.league.group);

  return {
    teamA: {
      id:          idA,
      api_team_id: fixture.teams.home.id,
      name:        fixture.teams.home.name,
      logo_url:    fixture.teams.home.logo ?? null,
      flag_emoji:  isoA ? isoToFlagEmoji(isoA) : null,
    },
    teamB: {
      id:          idB,
      api_team_id: fixture.teams.away.id,
      name:        fixture.teams.away.name,
      logo_url:    fixture.teams.away.logo ?? null,
      flag_emoji:  isoB ? isoToFlagEmoji(isoB) : null,
    },
    compTeamA: {
      competition_id: competition.id,
      team_id:        idA,
      group_code:     groupCode,
    },
    compTeamB: {
      competition_id: competition.id,
      team_id:        idB,
      group_code:     groupCode,
    },
    day: {
      competition_id: competition.id,
      day_index:      dayIndex,
      date_label:     formatDateLabel(fixture.fixture.date),
      full_label:     buildDayLabel(dayIndex, fixture.fixture.date, phase),
      phase,
      is_ko:          phase !== 'Groups',
      div_key:        PHASE_TO_DIV[phase] ?? null,
    },
    match: {
      fixture_id:     fixture.fixture.id,
      competition_id: competition.id,
      nation_a:       idA,
      nation_b:       idB,
      day_index:      dayIndex,
      phase,
      league_round:   fixture.league.round,
      venue:          fixture.fixture.venue?.name ?? null,
      scheduled_at:   fixture.fixture.date,
      api_status:     fixture.fixture.status.short,
    },
  };
}
