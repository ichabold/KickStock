/**
 * process-real-result.ts — Handles an API-Football fixture result.
 *
 * processRealMatchResult():
 *   - Idempotent: skips if match already has processed_at set
 *   - Applies the result to prices (applyResult)
 *   - Updates group standings or liquidates KO loser
 *   - Distributes dividends if applicable
 *   - Sets processed_at + trade_lock_until
 *
 * This function is called by sync-results for each finished (FT/AET/PEN) fixture.
 */

import { applyResult }      from '@kickstock/game-engine';
import { createAdminClient } from '@/lib/supabase/admin';
import * as Sentry           from '@sentry/nextjs';
import type { ApiFixture }   from './football-api';

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
  id:       string;
  strength: number;
}

interface DayRow {
  div_key: string | null;
  is_ko:   boolean;
}

// ── Determine match result from API fixture ───────────────────────────────────

function determineResult(fixture: ApiFixture): 'A' | 'B' | 'draw' {
  const status = fixture.fixture.status.short;

  // Penalty shootout — winner determined by penalties
  if (status === 'PEN') {
    const penHome = fixture.score.penalty.home ?? 0;
    const penAway = fixture.score.penalty.away ?? 0;
    if (penHome > penAway) return 'A';
    if (penAway > penHome) return 'B';
  }

  // After extra time or full time
  const home = fixture.goals.home ?? 0;
  const away = fixture.goals.away ?? 0;
  if (home > away) return 'A';
  if (away > home) return 'B';
  return 'draw';
}

function detectUpset(result: 'A' | 'B' | 'draw', strA: number, strB: number): boolean {
  if (result === 'draw') return false;
  // Upset = weaker team wins AND strength gap > 5
  const gap = Math.abs(strA - strB);
  if (gap <= 5) return false;
  const favoured: 'A' | 'B' = strA >= strB ? 'A' : 'B';
  return result !== favoured;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Processes a single finished fixture.
 * Returns true if the match was processed now, false if already done (idempotent skip).
 */
export async function processRealMatchResult(
  fixtureId: number,
  fixture:   ApiFixture,
): Promise<boolean> {
  const admin = createAdminClient();

  // ── 1. Load match from DB ─────────────────────────────────────────────────
  const { data: matchRaw, error: matchErr } = await adm(admin)
    .from('matches')
    .select('id, fixture_id, competition_id, nation_a, nation_b, phase, day_index, processed_at')
    .eq('fixture_id', fixtureId)
    .maybeSingle();

  if (matchErr) throw matchErr;
  if (!matchRaw) {
    // Fixture not in our DB yet (possible if sync-fixtures ran before this cron)
    // Log and skip — next sync-fixtures cycle will catch it
    console.warn(`[process-result] Fixture ${fixtureId} not in DB — skipping`);
    return false;
  }

  const match = matchRaw as MatchRow;

  // ── 2. Idempotence guard ──────────────────────────────────────────────────
  if (match.processed_at !== null) {
    return false; // already processed
  }

  // ── 3. Load team strengths ────────────────────────────────────────────────
  const { data: teamsRaw } = await adm(admin)
    .from('teams')
    .select('id, strength')
    .in('id', [match.nation_a, match.nation_b]);

  const teams = (teamsRaw ?? []) as TeamRow[];
  const teamA = teams.find(t => t.id === match.nation_a);
  const teamB = teams.find(t => t.id === match.nation_b);
  const strA  = teamA?.strength ?? 75;
  const strB  = teamB?.strength ?? 75;

  // ── 4. Determine result ───────────────────────────────────────────────────
  const res      = determineResult(fixture);
  const isUpset  = detectUpset(res, strA, strB);
  const winnerId = res === 'draw' ? null : (res === 'A' ? match.nation_a : match.nation_b);
  const loserId  = res === 'draw' ? null : (res === 'A' ? match.nation_b : match.nation_a);

  // ── 5. Load current prices ────────────────────────────────────────────────
  const { data: priceRowsRaw } = await adm(admin)
    .from('nations')
    .select('id, current_price, initial_price')
    .in('id', [match.nation_a, match.nation_b]);

  const priceRows = (priceRowsRaw ?? []) as Array<{ id: string; current_price: number | null; initial_price: number }>;
  const pA = priceRows.find(p => p.id === match.nation_a)?.current_price ?? 100;
  const pB = priceRows.find(p => p.id === match.nation_b)?.current_price ?? 100;

  // ── 6. Apply result to prices ─────────────────────────────────────────────
  const [rawPA, rawPB] = applyResult(pA, pB, res);
  const newPA = Math.max(1, rawPA);
  const newPB = Math.max(1, rawPB);

  // ── 7. Update prices in DB ────────────────────────────────────────────────
  // Update nations.current_price (trigger also writes to nation_prices)
  await adm(admin).rpc('update_prices_after_match', {
    p_nation_a:   match.nation_a,
    p_new_price_a: newPA,
    p_nation_b:   match.nation_b,
    p_new_price_b: newPB,
    p_day_index:  match.day_index,
  });

  // ── 8. KO: liquidate loser ────────────────────────────────────────────────
  if (match.phase !== 'Groups' && match.phase !== 'SF' && match.phase !== '3rd') {
    if (loserId) {
      await adm(admin).rpc('liquidate_eliminated', {
        p_nation_id: loserId,
        p_day_index: match.day_index,
      });
    }
  }

  // ── 9. Dividends ──────────────────────────────────────────────────────────
  const { data: dayRaw } = await adm(admin)
    .from('competition_days')
    .select('div_key, is_ko')
    .eq('competition_id', match.competition_id)
    .eq('day_index', match.day_index)
    .maybeSingle();

  const day = dayRaw as DayRow | null;

  if (day?.div_key && winnerId) {
    await adm(admin).rpc('distribute_dividends', {
      p_nation_id: winnerId,
      p_round:     day.div_key,
      p_price:     Math.max(newPA, newPB),
      p_day_index: match.day_index,
    });
  }

  // ── 10. Mark match as processed ───────────────────────────────────────────
  const now = new Date();
  const tradeUnlock = new Date(+now + 15 * 60_000).toISOString();

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
      api_status:       fixture.fixture.status.short,
      result_data: {
        a:         match.nation_a,
        b:         match.nation_b,
        scoreA:    fixture.goals.home ?? 0,
        scoreB:    fixture.goals.away ?? 0,
        res,
        res90:     res,  // simplification — PEN/AET winner is still the result
        isUpset,
        pA,
        pB,
        newPA,
        newPB,
        elimId:    loserId && match.phase !== 'Groups' ? loserId : null,
        winnerId,
        loserId,
        etRes:     fixture.fixture.status.short === 'AET' || fixture.fixture.status.short === 'PEN'
                     ? (fixture.goals.home ?? 0) > (fixture.goals.away ?? 0) ? 'A' : 'B'
                     : null,
        penWinner: fixture.fixture.status.short === 'PEN'
                     ? ((fixture.score.penalty.home ?? 0) > (fixture.score.penalty.away ?? 0) ? 'A' : 'B')
                     : null,
        penA:      fixture.score.penalty.home ?? 0,
        penB:      fixture.score.penalty.away ?? 0,
        divCash:   0,   // individual dividend amounts computed client-side
        phase:     match.phase,
      },
    })
    .eq('fixture_id', fixtureId);

  if (updateErr) {
    Sentry.captureException(updateErr, {
      tags:  { fn: 'processRealMatchResult' },
      extra: { fixtureId },
    });
    throw updateErr;
  }

  console.log(`[process-result] ✅ ${match.nation_a} vs ${match.nation_b} → ${res} (fixture ${fixtureId})`);
  return true;
}
