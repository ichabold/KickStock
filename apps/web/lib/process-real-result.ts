/**
 * process-real-result.ts — Handles an API-Football fixture result.
 *
 * processRealMatchResult():
 *   - Idempotent: skips if match already has processed_at set
 *   - Applies the result to competition-scoped prices
 *   - Distributes dividends and liquidates KO losers (competition-scoped)
 *   - Sets processed_at + trade_lock_until
 */

import { applyResult }                     from '@kickstock/game-engine';
import { createAdminClient }               from '@/lib/supabase/admin';
import * as Sentry                          from '@sentry/nextjs';
import { fetchFixtureEvents }              from './football-api';
import type { ApiFixture }                 from './football-api';
import type { Goal }                       from '@kickstock/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

interface MatchRow {
  id:             string;
  fixture_id:     number;
  competition_id: number;
  nation_a:       string;
  nation_b:       string;
  phase:          string;
  day_index:      number;
  processed_at:   string | null;
}

interface TeamRow {
  id:          string;
  strength:    number;
  api_team_id: number | null;
}

interface DayRow {
  div_key: string | null;
  is_ko:   boolean;
}

function determineResult(fixture: ApiFixture): 'A' | 'B' | 'draw' {
  const status = fixture.fixture.status.short;
  if (status === 'PEN') {
    const penHome = fixture.score.penalty.home ?? 0;
    const penAway = fixture.score.penalty.away ?? 0;
    if (penHome > penAway) return 'A';
    if (penAway > penHome) return 'B';
  }
  const home = fixture.goals.home ?? 0;
  const away = fixture.goals.away ?? 0;
  if (home > away) return 'A';
  if (away > home) return 'B';
  return 'draw';
}

function detectUpset(result: 'A' | 'B' | 'draw', strA: number, strB: number): boolean {
  if (result === 'draw') return false;
  const gap = Math.abs(strA - strB);
  if (gap <= 5) return false;
  const favoured: 'A' | 'B' = strA >= strB ? 'A' : 'B';
  return result !== favoured;
}

export async function processRealMatchResult(
  fixtureId: number,
  fixture:   ApiFixture,
): Promise<boolean> {
  const admin = createAdminClient();

  // ── 1. Load match ─────────────────────────────────────────────────────────
  const { data: matchRaw, error: matchErr } = await adm(admin)
    .from('matches')
    .select('id, fixture_id, competition_id, nation_a, nation_b, phase, day_index, processed_at')
    .eq('fixture_id', fixtureId)
    .maybeSingle();

  if (matchErr) throw matchErr;
  if (!matchRaw) {
    console.warn(`[process-result] Fixture ${fixtureId} not in DB — skipping`);
    return false;
  }

  const match = matchRaw as MatchRow;

  // ── 2. Idempotence guard ──────────────────────────────────────────────────
  if (match.processed_at !== null) return false;

  // ── 3. Load team strengths + api_team_id (needed for real event fetching) ──
  const { data: teamsRaw } = await adm(admin)
    .from('teams')
    .select('id, strength, api_team_id')
    .in('id', [match.nation_a, match.nation_b]);

  const teamList = (teamsRaw ?? []) as TeamRow[];
  const teamA    = teamList.find(t => t.id === match.nation_a);
  const teamB    = teamList.find(t => t.id === match.nation_b);
  const strA     = teamA?.strength ?? 75;
  const strB     = teamB?.strength ?? 75;
  const apiIdA   = teamA?.api_team_id ?? null;
  const apiIdB   = teamB?.api_team_id ?? null;

  // ── 4. Determine result ───────────────────────────────────────────────────
  const res      = determineResult(fixture);
  const isUpset  = detectUpset(res, strA, strB);
  const winnerId = res === 'draw' ? null : (res === 'A' ? match.nation_a : match.nation_b);
  const loserId  = res === 'draw' ? null : (res === 'A' ? match.nation_b : match.nation_a);

  // ── 5. Load current prices from competition_teams ─────────────────────────
  const { data: priceRowsRaw } = await adm(admin)
    .from('competition_teams')
    .select('team_id, current_price, initial_price')
    .eq('competition_id', match.competition_id)
    .in('team_id', [match.nation_a, match.nation_b]);

  const priceRows = (priceRowsRaw ?? []) as Array<{ team_id: string; current_price: number | null; initial_price: number }>;
  const pA = priceRows.find(p => p.team_id === match.nation_a)?.current_price ?? 100;
  const pB = priceRows.find(p => p.team_id === match.nation_b)?.current_price ?? 100;

  // ── 6. Apply result to prices ─────────────────────────────────────────────
  const [rawPA, rawPB] = applyResult(pA, pB, res);
  const newPA = Math.max(1, rawPA);
  const newPB = Math.max(1, rawPB);

  // ── 7. Update competition-scoped prices ───────────────────────────────────
  await adm(admin).rpc('update_competition_prices', {
    p_competition_id: match.competition_id,
    p_team_a:         match.nation_a,
    p_new_price_a:    newPA,
    p_team_b:         match.nation_b,
    p_new_price_b:    newPB,
    p_day_index:      match.day_index,
  });

  // ── 8. KO: liquidate loser ────────────────────────────────────────────────
  if (match.phase !== 'Groups' && match.phase !== 'SF' && match.phase !== '3rd') {
    if (loserId) {
      const loserPrice = loserId === match.nation_a ? newPA : newPB;
      await adm(admin).rpc('liquidate_competition_eliminated', {
        p_competition_id: match.competition_id,
        p_team_id:        loserId,
        p_day_index:      match.day_index,
        p_price:          loserPrice,
      });
    }
  }

  // ── 9. Fetch real goal events from API ───────────────────────────────────
  const events  = await fetchFixtureEvents(fixtureId);
  const goals: Goal[] = events
    .filter(e => e.type === 'Goal' && e.detail !== 'Missed Penalty')
    .map(e => ({
      min:  e.time.elapsed + (e.time.extra ?? 0),
      team: (apiIdA !== null && e.team.id === apiIdA) ? 'A' as const : 'B' as const,
      name: e.player.name ?? 'Unknown',
    }))
    .sort((a, b) => a.min - b.min);

  // ── 10. Dividends ─────────────────────────────────────────────────────────
  const { data: dayRaw } = await adm(admin)
    .from('competition_days')
    .select('div_key, is_ko')
    .eq('competition_id', match.competition_id)
    .eq('day_index', match.day_index)
    .maybeSingle();

  const day = dayRaw as DayRow | null;
  const { DIV_RATES } = await import('@kickstock/constants');

  if (day?.div_key) {
    const rate = DIV_RATES[day.div_key] ?? 0;

    // Gagnant (tous rounds KO, y compris 3rd)
    if (winnerId && rate > 0) {
      await adm(admin).rpc('distribute_competition_dividends', {
        p_competition_id: match.competition_id,
        p_team_id:        winnerId,
        p_round:          day.div_key,
        p_rate:           rate,
        p_price:          newPA,
        p_day_index:      match.day_index,
      });
    }
  }

  // Champion → dividende bonus 50%
  if (match.phase === 'Final' && winnerId) {
    const champRate = DIV_RATES['champion'] ?? 0.50;
    if (champRate > 0) {
      await adm(admin).rpc('distribute_competition_dividends', {
        p_competition_id: match.competition_id,
        p_team_id:        winnerId,
        p_round:          'champion',
        p_rate:           champRate,
        p_price:          newPA,
        p_day_index:      match.day_index,
      });
    }
  }

  // ── 11. Mark match as processed ───────────────────────────────────────────
  const now         = new Date();
  const tradeUnlock = new Date(+now + 15 * 60_000).toISOString();

  // [G6 FIX] res90 doit refléter le vrai résultat à 90 min.
  // Pour AET et PEN, le match était nul à 90 min.
  const status  = fixture.fixture.status.short;
  const isAET   = status === 'AET' || status === 'PEN';
  const res90   = isAET ? 'draw' as const : res;
  const etRes   = isAET
    ? ((fixture.goals.home ?? 0) > (fixture.goals.away ?? 0) ? 'A' : 'B') as 'A' | 'B'
    : null;
  const penWinner = status === 'PEN'
    ? ((fixture.score.penalty.home ?? 0) > (fixture.score.penalty.away ?? 0) ? 'A' : 'B') as 'A' | 'B'
    : null;

  const { error: updateErr } = await adm(admin)
    .from('matches')
    .update({
      score_a:          fixture.goals.home ?? 0,
      score_b:          fixture.goals.away ?? 0,
      winner_id:        winnerId,
      is_upset:         isUpset,
      played_at:        fixture.fixture.date,
      processed_at:     now.toISOString(),
      trade_lock_until: tradeUnlock,
      api_status:       status,
      result_data: {
        a:         match.nation_a,
        b:         match.nation_b,
        scoreA:    fixture.goals.home ?? 0,
        scoreB:    fixture.goals.away ?? 0,
        res,
        res90,
        isUpset,
        pA,
        pB,
        newPA,
        newPB,
        elimId:    loserId && match.phase !== 'Groups' ? loserId : null,
        winnerId,
        loserId,
        etRes,
        penWinner,
        penA:    fixture.score.penalty.home ?? 0,
        penB:    fixture.score.penalty.away ?? 0,
        divCash: 0,
        phase:   match.phase,
        goals,
      },
    })
    .eq('fixture_id', fixtureId);

  if (updateErr) {
    Sentry.captureException(updateErr, { tags: { fn: 'processRealMatchResult' }, extra: { fixtureId } });
    throw updateErr;
  }

  return true;
}
