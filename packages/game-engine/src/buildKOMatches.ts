import { NATIONS, GROUPS, DIV_RATES } from '@kickstock/constants';
import type { Match, GameState, StoredMatchResult } from '@kickstock/types';

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
  eliminated: string[],
): Record<string, string[]> {
  const gs: Record<string, StandingEntry[]> = {};

  for (const g of GROUPS.slice(1)) {
    gs[g] = NATIONS.filter(n => n.group === g).map(n => ({
      id: n.id, pts: 0, gf: 0, ga: 0, str: n.str,
    }));
  }

  for (const results of Object.values(matchResults)) {
    for (const r of results) {
      for (const g of GROUPS.slice(1)) {
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
  for (const g of GROUPS.slice(1)) {
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
  prices: Record<string, number>,
  eliminated: string[],
): Record<string, StandingRow[]> {
  const gs: Record<string, StandingRow[]> = {};

  for (const g of GROUPS.slice(1)) {
    gs[g] = NATIONS.filter(n => n.group === g).map(n => ({
      id: n.id, flag: n.flag, name: n.name,
      mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0,
      price: prices[n.id] ?? n.p, initP: n.p,
      elim: eliminated.includes(n.id),
    }));
  }

  for (const [diStr, results] of Object.entries(matchResults)) {
    const di = Number(diStr);
    // only group stage days (0-16)
    if (di >= 17) continue;
    for (const r of results) {
      for (const g of GROUPS.slice(1)) {
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

  for (const g of GROUPS.slice(1)) {
    gs[g].sort((a, b) =>
      (b.pts - a.pts) || ((b.gf - b.ga) - (a.gf - a.ga)) || (b.gf - a.gf),
    );
  }
  return gs;
}

// ─── R32 POOL BUILDER ─────────────────────────────────────────────────────────
// Official FIFA 2026 R32 bracket seeding based on group results

export function buildR32Pool(
  matchResults: Record<number, StoredMatchResult[]>,
  eliminated: string[],
): string[] {
  const standings = deriveGroupStandings(matchResults, eliminated);

  const winner = (g: string) => standings[g]?.[0] ?? null;
  const runner = (g: string) => standings[g]?.[1] ?? null;
  const thirdOf = (g: string) => standings[g]?.[2] ?? null;

  // Best 8 thirds from 12 groups
  const allThirds = GROUPS.slice(1)
    .map(g => {
      const id = thirdOf(g);
      if (!id) return null;
      const n = NATIONS.find(n => n.id === id);
      return n ? { id, group: g, pts: 0, gf: 0, ga: 0, str: n.str } : null;
    })
    .filter(Boolean) as Array<{ id: string; group: string; pts: number; gf: number; ga: number; str: number }>;

  // Enrich thirds with actual points from group results
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

  // Official FIFA 2026 R32 pairings
  const matches: [string | null, string | null][] = [
    [winner('A'), pickThird(['C', 'E', 'F', 'H', 'I'])],  // M1
    [winner('B'), pickThird(['E', 'F', 'G', 'I', 'J'])],  // M2
    [runner('A'), runner('B')],                            // M3
    [winner('C'), runner('F')],                            // M4
    [winner('D'), pickThird(['B', 'E', 'F', 'I', 'J'])],  // M5
    [winner('E'), pickThird(['A', 'B', 'C', 'D', 'F'])],  // M6
    [runner('C'), winner('F')],                            // M7
    [runner('D'), runner('G')],                            // M8
    [runner('E'), runner('I')],                            // M9
    [winner('G'), pickThird(['A', 'E', 'H', 'I', 'J'])],  // M10
    [winner('H'), runner('J')],                            // M11
    [runner('K'), runner('L')],                            // M12
    [winner('I'), pickThird(['C', 'D', 'F', 'G', 'H'])],  // M13
    [winner('J'), runner('H')],                            // M14
    [winner('K'), pickThird(['D', 'E', 'I', 'J', 'L'])],  // M15
    [winner('L'), pickThird(['E', 'H', 'I', 'J', 'K'])],  // M16
  ];

  // Flatten to [m1a, m1b, m2a, m2b, ...] — 32 entries
  const pool: Array<string | null> = [];
  for (const [a, b] of matches) {
    pool.push(a);
    pool.push(b);
  }

  // Fill nulls with best remaining non-eliminated teams
  const used = new Set(pool.filter(Boolean) as string[]);
  const remaining = NATIONS
    .filter(n => !eliminated.includes(n.id) && !used.has(n.id))
    .sort((a, b) => b.str - a.str);

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

  // R32: 32 teams in pairs, spread over 6 days
  const r32Slices: Record<string, [number, number]> = {
    r32_28: [0, 4],   r32_29: [4, 10],  r32_30: [10, 16],
    r32_1:  [16, 22], r32_2:  [22, 26], r32_3:  [26, 32],
  };
  if (r32Slices[dynamic]) {
    const [s, e] = r32Slices[dynamic];
    return pairSlice(r32Pool, s, e);
  }

  // R16: 16 winners, 2 matches/day
  const r16Slices: Record<string, [number, number]> = {
    r16_1: [0, 4], r16_2: [4, 8], r16_3: [8, 12], r16_4: [12, 16],
  };
  if (r16Slices[dynamic]) {
    const [s, e] = r16Slices[dynamic];
    return pairSlice(r16Pool, s, e);
  }

  // QF: 8 teams, spread over 3 days
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
