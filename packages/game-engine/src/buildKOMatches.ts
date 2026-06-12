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

export const WC2026_R32_PAIRINGS: [R32SlotSpec, R32SlotSpec][] = [
  [{ type: 'winner', group: 'A' }, { type: 'third', candidates: ['C', 'E', 'F', 'H', 'I'] }],
  [{ type: 'winner', group: 'B' }, { type: 'third', candidates: ['E', 'F', 'G', 'I', 'J'] }],
  [{ type: 'runner', group: 'A' }, { type: 'runner', group: 'B' }],
  [{ type: 'winner', group: 'C' }, { type: 'runner', group: 'F' }],
  [{ type: 'winner', group: 'D' }, { type: 'third', candidates: ['B', 'E', 'F', 'I', 'J'] }],
  [{ type: 'winner', group: 'E' }, { type: 'third', candidates: ['A', 'B', 'C', 'D', 'F'] }],
  [{ type: 'runner', group: 'C' }, { type: 'winner', group: 'F' }],
  [{ type: 'runner', group: 'D' }, { type: 'runner', group: 'G' }],
  [{ type: 'runner', group: 'E' }, { type: 'runner', group: 'I' }],
  [{ type: 'winner', group: 'G' }, { type: 'third', candidates: ['A', 'E', 'H', 'I', 'J'] }],
  [{ type: 'winner', group: 'H' }, { type: 'runner', group: 'J' }],
  [{ type: 'runner', group: 'K' }, { type: 'runner', group: 'L' }],
  [{ type: 'winner', group: 'I' }, { type: 'third', candidates: ['C', 'D', 'F', 'G', 'H'] }],
  [{ type: 'winner', group: 'J' }, { type: 'runner', group: 'H' }],
  [{ type: 'winner', group: 'K' }, { type: 'third', candidates: ['D', 'E', 'I', 'J', 'L'] }],
  [{ type: 'winner', group: 'L' }, { type: 'third', candidates: ['E', 'H', 'I', 'J', 'K'] }],
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
    r32_28: [0, 4],   r32_29: [4, 10],  r32_30: [10, 16],
    r32_1:  [16, 22], r32_2:  [22, 26], r32_3:  [26, 32],
  };
  if (r32Slices[dynamic]) {
    const [s, e] = r32Slices[dynamic];
    return pairSlice(r32Pool, s, e);
  }

  const r16Slices: Record<string, [number, number]> = {
    r16_1: [0, 4], r16_2: [4, 8], r16_3: [8, 12], r16_4: [12, 16],
  };
  if (r16Slices[dynamic]) {
    const [s, e] = r16Slices[dynamic];
    return pairSlice(r16Pool, s, e);
  }

  const qfSlices: Record<string, [number, number]> = {
    qf_1: [0, 2], qf_2: [2, 4], qf_3: [4, 8],
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
