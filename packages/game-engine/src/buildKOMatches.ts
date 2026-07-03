import { DIV_RATES } from '@kickstock/constants';
import type { Match, GameState, StoredMatchResult, TeamMeta } from '@kickstock/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveGroups(teams: TeamMeta[]): string[] {
  return [...new Set(teams.map(t => t.group).filter(Boolean))].sort();
}

// ─── GROUP STANDINGS ──────────────────────────────────────────────────────────

interface StandingEntry {
  id: string;
  pts: number;
  gf: number;
  ga: number;
  str: number;
}

function cmp(a: StandingEntry, b: StandingEntry): number {
  return (b.pts - a.pts) || ((b.gf - b.ga) - (a.gf - a.ga)) || (b.gf - a.gf) || (b.str - a.str);
}

export function deriveGroupStandings(
  matchResults: Record<number, StoredMatchResult[]>,
  eliminated:   string[],
  teams:        TeamMeta[],
): Record<string, string[]> {
  const allTeams = teams;
  const groups   = resolveGroups(allTeams);
  const gs: Record<string, StandingEntry[]> = {};

  for (const g of groups) {
    gs[g] = allTeams.filter(t => t.group === g).map(t => ({
      id: t.id, pts: 0, gf: 0, ga: 0, str: t.strength,
    }));
  }

  for (const results of Object.values(matchResults)) {
    for (const r of results) {
      for (const g of groups) {
        const tA = gs[g].find(t => t.id === r.a);
        const tB = gs[g].find(t => t.id === r.b);
        if (!tA || !tB) continue;
        tA.gf += r.scoreA; tA.ga += r.scoreB;
        tB.gf += r.scoreB; tB.ga += r.scoreA;
        if (r.res === 'A') { tA.pts += 3; }
        else if (r.res === 'B') { tB.pts += 3; }
        else { tA.pts++; tB.pts++; }
      }
    }
  }

  const standings: Record<string, string[]> = {};
  for (const g of groups) {
    standings[g] = [...gs[g]]
      .filter(t => !eliminated.includes(t.id))
      .sort(cmp)
      .map(t => t.id);
  }
  return standings;
}

// ─── DETAILED STANDINGS (for UI) ─────────────────────────────────────────────

export interface StandingRow {
  id: string;
  flag: string;
  name: string;
  mp: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  price: number;
  initP: number;
  elim: boolean;
}

export function buildGroupStandingsUI(
  matchResults: Record<number, StoredMatchResult[]>,
  prices:       Record<string, number>,
  eliminated:   string[],
  teams:        TeamMeta[],
): Record<string, StandingRow[]> {
  const allTeams = teams;
  const groups   = resolveGroups(allTeams);
  const gs: Record<string, StandingRow[]> = {};

  for (const g of groups) {
    gs[g] = allTeams.filter(t => t.group === g).map(t => ({
      id: t.id, flag: t.flag, name: t.name,
      mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0,
      price: prices[t.id] ?? t.initialPrice, initP: t.initialPrice,
      elim: eliminated.includes(t.id),
    }));
  }

  for (const [, results] of Object.entries(matchResults)) {
    for (const r of results) {
      if (r.phase && r.phase !== 'Groups') continue; // skip KO results
      for (const g of groups) {
        const tA = gs[g].find(t => t.id === r.a);
        const tB = gs[g].find(t => t.id === r.b);
        if (!tA || !tB) continue;
        tA.mp++; tB.mp++;
        tA.gf += r.scoreA; tA.ga += r.scoreB;
        tB.gf += r.scoreB; tB.ga += r.scoreA;
        if (r.res === 'A') { tA.w++; tA.pts += 3; tB.l++; }
        else if (r.res === 'B') { tB.w++; tB.pts += 3; tA.l++; }
        else { tA.d++; tB.d++; tA.pts++; tB.pts++; }
      }
    }
  }

  for (const g of groups) {
    gs[g].sort((a, b) =>
      (b.pts - a.pts) || ((b.gf - b.ga) - (a.gf - a.ga)) || (b.gf - a.gf),
    );
  }
  return gs;
}

// ─── OFFICIAL WC2026 R32 PAIRING MATRIX ──────────────────────────────────────
//
// Shared between the client-side (offline/simulated) pool builder below and
// the server-side incremental bracket placement (apps/web/lib/ko-qualifiers.ts).
// Each entry is [slotA, slotB] for one R32 match; the resulting pool is
// flattened to 32 entries (2 per match) in matrix order.

export type R32SlotSpec =
  | { type: 'winner'; group: string }
  | { type: 'runner'; group: string }
  | { type: 'third';  candidates: string[] };

// Ordered in CALENDAR order (Jun 28 → Jul 3) so that the 6 engine days map
// directly to contiguous pool slices. After all R32 is played, r16Pool is
// rebuilt in the official bracket order via buildR16PoolFromR32Results.
//
// Pool index → R32 match:
//   [0-1]  M73  [2-3]  M74  [4-5]  M75  [6-7]  M76   ← Jun 28-29
//   [8-9]  M77 [10-11] M78 [12-13] M79 [14-15]  M80   ← Jun 30 - Jul 1
//  [16-17] M81 [18-19] M82 [20-21] M83 [22-23]  M84   ← Jul 1-2
//  [24-25] M85 [26-27] M86 [28-29] M87 [30-31]  M88   ← Jul 2-3
export const WC2026_R32_PAIRINGS: [R32SlotSpec, R32SlotSpec][] = [
  // ── Jun 28 (1 match) ──────────────────────────────────────────────────────
  [{ type: 'runner', group: 'A' }, { type: 'runner', group: 'B' }],                              // M73
  // ── Jun 29 (3 matches) ────────────────────────────────────────────────────
  [{ type: 'winner', group: 'E' }, { type: 'third',  candidates: ['A', 'B', 'C', 'D', 'F'] }],  // M74
  [{ type: 'winner', group: 'F' }, { type: 'runner', group: 'C' }],                              // M75
  [{ type: 'winner', group: 'C' }, { type: 'runner', group: 'F' }],                              // M76
  // ── Jun 30 (3 matches) ────────────────────────────────────────────────────
  [{ type: 'winner', group: 'I' }, { type: 'third',  candidates: ['C', 'D', 'F', 'G', 'H'] }],  // M77
  [{ type: 'runner', group: 'E' }, { type: 'runner', group: 'I' }],                              // M78
  [{ type: 'winner', group: 'A' }, { type: 'third',  candidates: ['C', 'E', 'F', 'H', 'I'] }],  // M79
  // ── Jul 1 (3 matches) ─────────────────────────────────────────────────────
  [{ type: 'winner', group: 'L' }, { type: 'third',  candidates: ['E', 'H', 'I', 'J', 'K'] }],  // M80
  [{ type: 'winner', group: 'D' }, { type: 'third',  candidates: ['B', 'E', 'F', 'I', 'J'] }],  // M81
  [{ type: 'winner', group: 'G' }, { type: 'third',  candidates: ['A', 'E', 'H', 'I', 'J'] }],  // M82
  // ── Jul 2 (3 matches) ─────────────────────────────────────────────────────
  [{ type: 'runner', group: 'K' }, { type: 'runner', group: 'L' }],                              // M83
  [{ type: 'winner', group: 'H' }, { type: 'runner', group: 'J' }],                              // M84
  [{ type: 'winner', group: 'B' }, { type: 'third',  candidates: ['E', 'F', 'G', 'I', 'J'] }],  // M85
  // ── Jul 3 (3 matches) ─────────────────────────────────────────────────────
  [{ type: 'winner', group: 'J' }, { type: 'runner', group: 'H' }],                              // M86
  [{ type: 'winner', group: 'K' }, { type: 'third',  candidates: ['D', 'E', 'I', 'J', 'L'] }],  // M87
  [{ type: 'runner', group: 'D' }, { type: 'runner', group: 'G' }],                              // M88
];

// ─── R32 POOL BUILDER ─────────────────────────────────────────────────────────

export function buildR32Pool(
  matchResults: Record<number, StoredMatchResult[]>,
  eliminated:   string[],
  teams:        TeamMeta[],
): string[] {
  const allTeams  = teams;
  const standings = deriveGroupStandings(matchResults, eliminated, allTeams);

  const winner  = (g: string) => standings[g]?.[0] ?? null;
  const runner  = (g: string) => standings[g]?.[1] ?? null;
  const thirdOf = (g: string) => standings[g]?.[2] ?? null;

  // Best 8 thirds from 12 groups
  interface ThirdEntry extends StandingEntry { group: string }
  const allThirds = resolveGroups(allTeams)
    .map(g => {
      const id = thirdOf(g);
      if (!id) return null;
      const t = allTeams.find(t => t.id === id);
      return t ? { id, group: g, pts: 0, gf: 0, ga: 0, str: t.strength } as ThirdEntry : null;
    })
    .filter(Boolean) as ThirdEntry[];

  for (const results of Object.values(matchResults)) {
    for (const r of results) {
      const t = allThirds.find(t => t.id === r.a || t.id === r.b);
      if (!t) continue;
      const isA = t.id === r.a;
      t.gf += isA ? r.scoreA : r.scoreB;
      t.ga += isA ? r.scoreB : r.scoreA;
      if ((isA && r.res === 'A') || (!isA && r.res === 'B')) t.pts += 3;
      else if (r.res === 'draw') t.pts += 1;
    }
  }
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

  const pool: Array<string | null> = [];
  for (const [specA, specB] of WC2026_R32_PAIRINGS) {
    for (const spec of [specA, specB]) {
      if (spec.type === 'winner')      pool.push(winner(spec.group));
      else if (spec.type === 'runner') pool.push(runner(spec.group));
      else                              pool.push(pickThird(spec.candidates));
    }
  }

  // Fill nulls with best remaining non-eliminated teams
  const used = new Set(pool.filter(Boolean) as string[]);
  const remaining = allTeams
    .filter(t => !eliminated.includes(t.id) && !used.has(t.id))
    .sort((a, b) => b.strength - a.strength);

  for (let i = 0; i < pool.length; i++) {
    if (!pool[i] && remaining.length > 0) pool[i] = remaining.shift()!.id;
  }

  return (pool.slice(0, 32) as string[]).filter(Boolean);
}

// ─── BUILD MATCHES FOR A CALENDAR DAY ────────────────────────────────────────

export function buildMatchesForDay(
  dynamic: string,
  state: Pick<GameState, 'r32Pool' | 'r16Pool' | 'qfPool' | 'sfPool' | 'finalPool' | 'thirdPool' | 'eliminated'>,
): Match[] {
  const { r32Pool, r16Pool, qfPool, sfPool, finalPool, thirdPool, eliminated } = state;
  const notElim = (id: string) => !eliminated.includes(id);

  const pairSlice = (pool: string[], start: number, end: number): Match[] => {
    const chunk = pool.slice(start, end);
    const res: Match[] = [];
    for (let i = 0; i < chunk.length - 1; i += 2) {
      if (chunk[i] && chunk[i + 1] && notElim(chunk[i]) && notElim(chunk[i + 1])) {
        res.push({ a: chunk[i], b: chunk[i + 1] });
      }
    }
    return res;
  };

  const r32Slices: Record<string, [number, number]> = {
    r32_1: [0,  2],  r32_2: [2,  8],
    r32_3: [8,  14], r32_4: [14, 20],
    r32_5: [20, 26], r32_6: [26, 32],
  };
  if (r32Slices[dynamic]) {
    const [s, e] = r32Slices[dynamic];
    return pairSlice(r32Pool, s, e);
  }

  const r16Slices: Record<string, [number, number]> = {
    r16_1: [0, 4], r16_2: [4, 8], r16_3: [8, 12], r16_4: [12, 14], r16_5: [14, 16],
  };
  if (r16Slices[dynamic]) {
    const [s, e] = r16Slices[dynamic];
    return pairSlice(r16Pool, s, e);
  }

  const qfSlices: Record<string, [number, number]> = {
    qf_1: [0, 4], qf_2: [4, 8],
  };
  if (qfSlices[dynamic]) {
    const [s, e] = qfSlices[dynamic];
    return pairSlice(qfPool, s, e);
  }

  if (dynamic === 'sf_1') return pairSlice(sfPool, 0, 2);
  if (dynamic === 'sf_2') return pairSlice(sfPool, 2, 4);

  if (dynamic === '3rd') {
    return thirdPool.length >= 2 ? [{ a: thirdPool[0], b: thirdPool[1] }] : [];
  }

  if (dynamic === 'final') {
    return finalPool.length >= 2 && notElim(finalPool[0]) && notElim(finalPool[1])
      ? [{ a: finalPool[0], b: finalPool[1] }]
      : [];
  }

  return [];
}

// Keep DIV_RATES re-export for any legacy callers
export { DIV_RATES };

// ─── R32 DAY SLICES ───────────────────────────────────────────────────────────
// 6 days matching the real FIFA calendar: Jun 28(1) Jun 29(3) Jun 30(3)
// Jul 1(3) Jul 2(3) Jul 3(3). Pool is in calendar order; after all R32 is
// played, r16Pool is rebuilt in official bracket order via buildR16PoolFromR32Results.
export const R32_DAY_SLICES: Record<string, [number, number]> = {
  r32_1: [0,  2],  r32_2: [2,  8],
  r32_3: [8,  14], r32_4: [14, 20],
  r32_5: [20, 26], r32_6: [26, 32],
};

// ─── R16 BRACKET ORDER ────────────────────────────────────────────────────────
// WC2026_R32_PAIRINGS is in calendar order (indices 0-15 = M73..M88).
// Official R16 bracket pairs consecutive R32 matches sequentially:
//   M89 = W(M73) vs W(M74)   M90 = W(M75) vs W(M76)
//   M91 = W(M77) vs W(M78)   M92 = W(M79) vs W(M80)
//   M93 = W(M81) vs W(M82)   M94 = W(M83) vs W(M84)
//   M95 = W(M85) vs W(M86)   M96 = W(M87) vs W(M88)
// r16Pool schedule (5 days: Jul 4-8, 2+2+2+1+1 matches):
//   r16_1 [0,4]:  M89, M90   r16_2 [4,8]:   M91, M92
//   r16_3 [8,12]: M93, M94   r16_4 [12,14]: M95   r16_5 [14,16]: M96
// QF97=W89vsW90, QF98=W91vsW92, QF99=W93vsW94, QF100=W95vsW96
export const WC2026_R16_BRACKET_ORDER: number[] = [
  0, 1,   // M89: W(M73[0]) vs W(M74[1])
  2, 3,   // M90: W(M75[2]) vs W(M76[3])
  4, 5,   // M91: W(M77[4]) vs W(M78[5])
  6, 7,   // M92: W(M79[6]) vs W(M80[7])
  8, 9,   // M93: W(M81[8]) vs W(M82[9])
  10, 11, // M94: W(M83[10]) vs W(M84[11])
  12, 13, // M95: W(M85[12]) vs W(M86[13])
  14, 15, // M96: W(M87[14]) vs W(M88[15])
];

// Rebuilds r16Pool in official bracket order from the r32Pool + all R32 results.
// Call this after the last R32 engine day in the offline store.
export function buildR16PoolFromR32Results(
  r32Pool:      string[],
  matchResults: Record<number, StoredMatchResult[]>,
): string[] {
  const r16Pool: string[] = [];
  for (const r32Idx of WC2026_R16_BRACKET_ORDER) {
    const teamA = r32Pool[r32Idx * 2];
    const teamB = r32Pool[r32Idx * 2 + 1];
    if (!teamA || !teamB) continue;
    let winner: string | null = null;
    outer: for (const results of Object.values(matchResults)) {
      for (const r of results) {
        if ((r.a === teamA && r.b === teamB) || (r.a === teamB && r.b === teamA)) {
          winner = r.winnerId ?? null;
          break outer;
        }
      }
    }
    if (winner) r16Pool.push(winner);
  }
  return r16Pool;
}

// ─── LIVE R32 POOL ─────────────────────────────────────────────────────────────
// Returns 32 slots (2 per match × 16 matches) with provisional/definitive flags.
// - winner/runner: current standings, definitive once the group has all 3 matchdays played
// - third: always provisionally assigned using current FIFA ranking of thirds
//   (pts → GD → GF → strength); definitive only when ALL groups are complete

export interface LiveR32Slot {
  teamId: string | null;
  definitive: boolean;
  slotType: 'winner' | 'runner' | 'third';
  group?: string;
  candidates?: string[];
}

export function buildLiveR32Pool(
  matchResults: Record<number, StoredMatchResult[]>,
  teams:        TeamMeta[],
  eliminated:   string[],
): LiveR32Slot[] {
  const groups = resolveGroups(teams);
  if (groups.length === 0) return [];

  // Count group-stage matches played per team
  const playedCount = new Map<string, number>();
  for (const results of Object.values(matchResults)) {
    for (const r of results) {
      if (r.phase && r.phase !== 'Groups') continue;
      playedCount.set(r.a, (playedCount.get(r.a) ?? 0) + 1);
      playedCount.set(r.b, (playedCount.get(r.b) ?? 0) + 1);
    }
  }

  const completeGroups = new Set<string>();
  for (const g of groups) {
    const gt = teams.filter(t => t.group === g);
    if (gt.length >= 4 && gt.every(t => (playedCount.get(t.id) ?? 0) >= 3)) {
      completeGroups.add(g);
    }
  }
  const allGroupsComplete = completeGroups.size === groups.length;

  const standings = deriveGroupStandings(matchResults, eliminated, teams);

  // ── Build ranked list of current third-place teams (FIFA rule: pts→GD→GF→str) ──
  // Always computed, whether or not all groups are done.
  type ThirdInfo = { id: string; group: string; pts: number; gf: number; gd: number; str: number };
  const allCurrentThirds: ThirdInfo[] = [];
  for (const g of groups) {
    const thirdId = standings[g]?.[2];
    if (!thirdId) continue;
    const t = teams.find(t => t.id === thirdId);
    if (!t) continue;
    let pts = 0, gf = 0, ga = 0;
    for (const results of Object.values(matchResults)) {
      for (const r of results) {
        if (r.phase && r.phase !== 'Groups') continue;
        if (r.a !== thirdId && r.b !== thirdId) continue;
        const isA = r.a === thirdId;
        gf += isA ? r.scoreA : r.scoreB;
        ga += isA ? r.scoreB : r.scoreA;
        if ((isA && r.res === 'A') || (!isA && r.res === 'B')) pts += 3;
        else if (r.res === 'draw') pts += 1;
      }
    }
    allCurrentThirds.push({ id: thirdId, group: g, pts, gf, gd: gf - ga, str: t.strength });
  }
  allCurrentThirds.sort((a, b) => (b.pts - a.pts) || (b.gd - a.gd) || (b.gf - a.gf) || (b.str - a.str));

  // Take provisional top-8 thirds (or fewer if not all groups have played yet)
  const best8 = allCurrentThirds.slice(0, 8);
  const remaining = new Set(best8.map(t => t.id));

  // Greedy picker: for a given candidates list, pick the best available provisional third
  const thirdPicker = (candidates: string[]): string | null => {
    for (const g of candidates) {
      const entry = best8.find(t => t.group === g && remaining.has(t.id));
      if (entry) { remaining.delete(entry.id); return entry.id; }
    }
    // fallback: any remaining best-8 third (shouldn't happen in a well-formed bracket)
    const fallback = best8.find(t => remaining.has(t.id));
    if (fallback) { remaining.delete(fallback.id); return fallback.id; }
    return null;
  };

  const result: LiveR32Slot[] = [];
  for (const [specA, specB] of WC2026_R32_PAIRINGS) {
    for (const spec of [specA, specB] as R32SlotSpec[]) {
      if (spec.type === 'winner') {
        result.push({
          teamId:     standings[spec.group]?.[0] ?? null,
          definitive: completeGroups.has(spec.group),
          slotType:   'winner',
          group:      spec.group,
        });
      } else if (spec.type === 'runner') {
        result.push({
          teamId:     standings[spec.group]?.[1] ?? null,
          definitive: completeGroups.has(spec.group),
          slotType:   'runner',
          group:      spec.group,
        });
      } else {
        // Third: always pick provisionally; only definitive when all groups complete
        result.push({
          teamId:     thirdPicker(spec.candidates),
          definitive: allGroupsComplete,
          slotType:   'third',
          candidates: spec.candidates,
        });
      }
    }
  }

  return result;
}
