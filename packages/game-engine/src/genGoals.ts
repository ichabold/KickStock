import type { Goal } from '@kickstock/types';

interface TeamRef {
  id:    string;
  name:  string;
  /** Optional squad of outfield player names. When provided, a random
   *  player is picked for each goal instead of the team name. */
  squad?: string[];
}

function pickScorer(team: TeamRef): string {
  if (team.squad && team.squad.length > 0) {
    return team.squad[Math.floor(Math.random() * team.squad.length)];
  }
  return team.name;
}

export function genGoals(
  scoreA: number,
  scoreB: number,
  nA: TeamRef,
  nB: TeamRef,
  res90: string,
  etRes: string | null,
): Goal[] {
  const nameA = () => pickScorer(nA);
  const nameB = () => pickScorer(nB);

  const isETMatch = res90 === 'draw' && etRes != null;
  const score90A = isETMatch ? (etRes === 'A' ? scoreA - 1 : scoreA) : scoreA;
  const score90B = isETMatch ? (etRes === 'B' ? scoreB - 1 : scoreB) : scoreB;
  const total90  = score90A + score90B;
  const total    = scoreA + scoreB;

  if (!total) return [];

  const used = new Set<number>();
  const MAX_RANGE = 84;

  const rMin = (lo: number, hi: number): number => {
    if (used.size >= hi - lo) return lo + Math.floor(Math.random() * (hi - lo));
    let m: number;
    do { m = lo + Math.floor(Math.random() * (hi - lo)); } while (used.has(m));
    used.add(m);
    return m;
  };

  const goals: Goal[] = [];

  // 90-minute goals
  if (total90 > 0) {
    const mins = Array.from(
      { length: Math.min(total90, MAX_RANGE) },
      () => rMin(4, 88),
    ).sort((a, b) => a - b);

    let cA = 0, cB = 0;
    for (const min of mins) {
      const remaining = total90 - (cA + cB);
      const needA = score90A - cA;
      const team: 'A' | 'B' = needA === 0
        ? 'B'
        : (score90B - cB) === 0
          ? 'A'
          : Math.random() < needA / remaining ? 'A' : 'B';
      if (team === 'A') cA++; else cB++;
      goals.push({ min, team, name: team === 'A' ? nameA() : nameB() });
    }
  }

  // Extra-time goal (minute 91-120)
  if (isETMatch && etRes) {
    const etMin = 91 + Math.floor(Math.random() * 30);
    goals.push({ min: etMin, team: etRes as 'A' | 'B', name: etRes === 'A' ? nameA() : nameB() });
  }

  return goals;
}
