/**
 * ko-qualifiers.ts — Competition-agnostic KO qualification logic.
 *
 * Replaces the hardcoded buildR32Pool (WC2026 only) with a generic function
 * that works for any competition format:
 *   - WC2022: 8 groups × top-2 = 16 teams → R16
 *   - WC2026: 12 groups × top-2 + best-8-thirds = 32 teams → R32
 *
 * The number of qualifiers is derived from how many team slots exist in the
 * next KO phase's scheduled matches in the DB.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import type { StoredMatchResult } from '@kickstock/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

interface TeamStanding {
  id:  string;
  pts: number;
  gd:  number;
  gf:  number;
  str: number;
}

export async function buildKOQualifiers(
  competitionId:  number,
  allGroupResults: Record<number, StoredMatchResult[]>,
  eliminated:     string[],
  nextPhase:      string,
): Promise<{ qualifiers: string[]; newEliminated: string[] }> {
  const admin = createAdminClient();

  // ── 1. How many KO spots are available in the next phase ─────────────────
  // Try to derive from scheduled matches in DB first; fall back to phase defaults
  // so simulation works even before KO fixtures are published by the API.
  const PHASE_SPOTS: Record<string, number> = {
    R32: 32, R16: 16, QF: 8, SF: 4, Final: 2, '3rd': 2,
  };

  const { count: matchCount } = await adm(admin)
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('competition_id', competitionId)
    .eq('phase', nextPhase)
    .not('fixture_id', 'is', null);

  const totalSpots = (matchCount ?? 0) > 0
    ? (matchCount ?? 0) * 2
    : (PHASE_SPOTS[nextPhase] ?? 16);

  // ── 2. Load teams with group assignments ──────────────────────────────────
  interface CTRow { team_id: string; group_code: string | null; teams: { strength: number } | null }
  const { data: ctRaw } = await adm(admin)
    .from('competition_teams')
    .select('team_id, group_code, teams(strength)')
    .eq('competition_id', competitionId);

  const ctTeams = (ctRaw ?? []) as CTRow[];
  const groups  = [...new Set(ctTeams.map(t => t.group_code).filter(Boolean) as string[])].sort();

  // ── 3. Compute group standings from match results ─────────────────────────
  const standings = new Map<string, TeamStanding[]>();
  for (const g of groups) {
    standings.set(g, ctTeams
      .filter(t => t.group_code === g && !eliminated.includes(t.team_id))
      .map(t => ({ id: t.team_id, pts: 0, gd: 0, gf: 0, str: t.teams?.strength ?? 75 }))
    );
  }

  for (const results of Object.values(allGroupResults)) {
    for (const r of results) {
      if (r.phase && r.phase !== 'Groups') continue;
      for (const gTeams of standings.values()) {
        const tA = gTeams.find(t => t.id === r.a);
        const tB = gTeams.find(t => t.id === r.b);
        if (!tA || !tB) continue;
        tA.gf += r.scoreA; tA.gd += r.scoreA - r.scoreB;
        tB.gf += r.scoreB; tB.gd += r.scoreB - r.scoreA;
        if (r.res === 'A')      { tA.pts += 3; }
        else if (r.res === 'B') { tB.pts += 3; }
        else                    { tA.pts++;  tB.pts++; }
      }
    }
  }

  const cmp = (a: TeamStanding, b: TeamStanding) =>
    (b.pts - a.pts) || (b.gd - a.gd) || (b.gf - a.gf) || (b.str - a.str);

  // ── 4. Top-2 per group advance automatically ──────────────────────────────
  const qualifiers: string[] = [];
  const thirds: Array<TeamStanding & { group: string }> = [];

  for (const g of groups) {
    const sorted = [...(standings.get(g) ?? [])].sort(cmp);
    // Top 2
    for (let i = 0; i < Math.min(2, sorted.length); i++) {
      qualifiers.push(sorted[i].id);
    }
    // Best third (candidate)
    if (sorted.length >= 3) {
      thirds.push({ ...sorted[2], group: g });
    }
  }

  // ── 5. Fill remaining spots with best thirds ──────────────────────────────
  const remaining = totalSpots - qualifiers.length;
  if (remaining > 0 && thirds.length > 0) {
    const bestThirds = [...thirds].sort(cmp).slice(0, remaining);
    for (const t of bestThirds) qualifiers.push(t.id);
  }

  // ── 6. Non-qualifiers are now eliminated ──────────────────────────────────
  const qualSet = new Set(qualifiers);
  const newEliminated = [...eliminated];
  for (const { team_id } of ctTeams) {
    if (!qualSet.has(team_id) && !eliminated.includes(team_id)) {
      newEliminated.push(team_id);
    }
  }

  return { qualifiers, newEliminated };
}
