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
import { WC2026_R32_PAIRINGS } from '@kickstock/game-engine';
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

// ─── INCREMENTAL R32 BRACKET (WC2026 — 12 groups, official pairing matrix) ────
//
// Unlike `buildKOQualifiers` (called once, at the end of the group stage),
// this is called on every `checkAndAdvancePhase` pass during the Groups
// phase. As soon as a given group's 3 matchdays are all processed, that
// group's winner/runner are placed into their official R32 slot(s)
// immediately — opponent slots that depend on the "best 8 thirds" stay
// empty ('') until ALL 12 groups are complete, at which point those slots
// are resolved and the remaining 4 thirds are eliminated.

interface GroupStanding extends TeamStanding {
  played: number;
}

export async function updateR32Bracket(
  competitionId:   number,
  allGroupResults: Record<number, StoredMatchResult[]>,
  eliminated:      string[],
  r32PoolIn:       string[],
  dayIndex:        number,
): Promise<{ r32Pool: string[]; eliminated: string[]; allGroupsComplete: boolean }> {
  const admin = createAdminClient();

  // ── 1. Load teams with group assignments ──────────────────────────────────
  interface CTRow { team_id: string; group_code: string | null; current_price: number | null; teams: { strength: number } | null }
  const { data: ctRaw } = await adm(admin)
    .from('competition_teams')
    .select('team_id, group_code, current_price, teams(strength)')
    .eq('competition_id', competitionId);

  const ctTeams = (ctRaw ?? []) as CTRow[];
  const priceOf = new Map(ctTeams.map(t => [t.team_id, t.current_price ?? 1]));

  const groupOf = new Map<string, string>();
  for (const t of ctTeams) {
    const m = t.group_code?.match(/Group ([A-Z])$/i);
    if (m) groupOf.set(t.team_id, m[1].toUpperCase());
  }
  const groupLetters = [...new Set(groupOf.values())].sort();

  // ── 2. Compute standings (pts/gd/gf/played) for each group ─────────────────
  const standings = new Map<string, GroupStanding[]>();
  for (const g of groupLetters) {
    standings.set(g, ctTeams
      .filter(t => groupOf.get(t.team_id) === g)
      .map(t => ({ id: t.team_id, pts: 0, gd: 0, gf: 0, str: t.teams?.strength ?? 75, played: 0 }))
    );
  }

  for (const results of Object.values(allGroupResults)) {
    for (const r of results) {
      if (r.phase && r.phase !== 'Groups') continue;
      for (const gTeams of standings.values()) {
        const tA = gTeams.find(t => t.id === r.a);
        const tB = gTeams.find(t => t.id === r.b);
        if (!tA || !tB) continue;
        tA.played++; tB.played++;
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

  // A group is "complete" once every team has played its 3 round-robin matches.
  const sorted = new Map<string, GroupStanding[]>();
  const completeGroups = new Set<string>();
  for (const g of groupLetters) {
    const teams = standings.get(g) ?? [];
    if (teams.length === 4 && teams.every(t => t.played === 3)) {
      completeGroups.add(g);
      sorted.set(g, [...teams].sort(cmp));
    }
  }

  // ── 3. Place winner/runner of completed groups into their official slots ──
  const r32Pool = r32PoolIn.length === 32 ? [...r32PoolIn] : Array(32).fill('');

  for (let i = 0; i < WC2026_R32_PAIRINGS.length; i++) {
    const [specA, specB] = WC2026_R32_PAIRINGS[i];
    [specA, specB].forEach((spec, j) => {
      const slotIdx = 2 * i + j;
      if (spec.type === 'winner' && completeGroups.has(spec.group)) {
        r32Pool[slotIdx] = sorted.get(spec.group)![0].id;
      } else if (spec.type === 'runner' && completeGroups.has(spec.group)) {
        r32Pool[slotIdx] = sorted.get(spec.group)![1].id;
      }
      // 'third' slots are resolved below, once all groups are complete.
    });
  }

  // ── 4. 4th-placed teams of completed groups are immediately eliminated ────
  const newEliminated = [...eliminated];
  for (const g of completeGroups) {
    const fourth = sorted.get(g)![3];
    if (fourth && !newEliminated.includes(fourth.id)) {
      newEliminated.push(fourth.id);
      await adm(admin).rpc('liquidate_competition_eliminated', {
        p_competition_id: competitionId,
        p_team_id:        fourth.id,
        p_day_index:      dayIndex,
        p_price:          priceOf.get(fourth.id) ?? 1,
      });
    }
  }

  const allGroupsComplete = groupLetters.length === 12 && completeGroups.size === 12;

  // ── 5. All groups done → resolve "best 8 thirds" and the remaining slots ──
  if (allGroupsComplete) {
    interface ThirdEntry extends GroupStanding { group: string }
    const allThirds: ThirdEntry[] = groupLetters.map(g => ({ ...sorted.get(g)![2], group: g }));
    allThirds.sort(cmp);
    const best8 = allThirds.slice(0, 8);
    const thirdGroups = new Set(best8.map(t => t.group));

    const pickThird = (candidates: string[]): string | null => {
      for (const g of candidates) {
        if (thirdGroups.has(g)) {
          const t = best8.find(t => t.group === g);
          if (t) { thirdGroups.delete(g); return t.id; }
        }
      }
      const t = best8.find(t => thirdGroups.has(t.group));
      if (t) { thirdGroups.delete(t.group); return t.id; }
      return null;
    };

    for (let i = 0; i < WC2026_R32_PAIRINGS.length; i++) {
      const [specA, specB] = WC2026_R32_PAIRINGS[i];
      [specA, specB].forEach((spec, j) => {
        const slotIdx = 2 * i + j;
        if (spec.type === 'third') {
          const id = pickThird(spec.candidates);
          if (id) r32Pool[slotIdx] = id;
        }
      });
    }

    // The 4 thirds not retained are eliminated now that the best-8 are known.
    for (const t of allThirds) {
      if (!best8.includes(t) && !newEliminated.includes(t.id)) {
        newEliminated.push(t.id);
        await adm(admin).rpc('liquidate_competition_eliminated', {
          p_competition_id: competitionId,
          p_team_id:        t.id,
          p_day_index:      dayIndex,
          p_price:          priceOf.get(t.id) ?? 1,
        });
      }
    }
  }

  return { r32Pool, eliminated: newEliminated, allGroupsComplete };
}
