/**
 * POST /api/admin/simulate-day
 *
 * Test endpoint: simulates one day of a competition as if real results arrived.
 * Used for WC2022 testing where isMatchWindowActive() always returns false.
 *
 * For each unprocessed match of the current day:
 *   - Generates a simulated result based on team strengths
 *   - Updates competition_teams.current_price
 *   - Marks match as processed
 *   - Distributes dividends / liquidates losers
 *
 * Then calls checkAndAdvancePhase to advance current_day_index.
 *
 * Security: requires Authorization: Bearer {CRON_SECRET}
 * Usage: curl -X POST -H "Authorization: Bearer <secret>" \
 *         -H "Content-Type: application/json" \
 *         -d '{"competitionId": 1}' \
 *         https://kick-stock-web.vercel.app/api/admin/simulate-day
 */
import { NextRequest, NextResponse }  from 'next/server';
import { createAdminClient }           from '@/lib/supabase/admin';
import { createClient }                from '@/lib/supabase/server';
import * as Sentry                     from '@sentry/nextjs';
import { simulate, applyResult, genScore, genGoals } from '@kickstock/game-engine';
import { DIV_RATES }                   from '@kickstock/constants';
import { checkAndAdvancePhase }        from '@/lib/check-advance-phase';

export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const A = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function POST(req: NextRequest) {
  // ── Auth — accept either CRON_SECRET (cron job) or logged-in admin ──────────
  const authHeader = req.headers.get('Authorization');
  const isCron     = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCron) {
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || user.app_metadata?.role !== 'admin') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const { competitionId = 1 } = await req.json() as { competitionId?: number };
    const admin = createAdminClient();

    // ── 1. Current game state ─────────────────────────────────────────────────
    const { data: gsRaw } = await A(admin)
      .from('competition_game_state')
      .select('current_day_index, current_phase, eliminated')
      .eq('competition_id', competitionId)
      .single();

    if (!gsRaw) {
      return NextResponse.json({ error: 'competition_game_state not found' }, { status: 404 });
    }

    const gs = gsRaw as { current_day_index: number; current_phase: string; eliminated: string[] };

    // ── 2. Today's unprocessed matches ────────────────────────────────────────
    const { data: matchesRaw } = await A(admin)
      .from('matches')
      .select('id, fixture_id, nation_a, nation_b, phase, day_index')
      .eq('competition_id', competitionId)
      .eq('day_index', gs.current_day_index)
      .is('processed_at', null)
      .not('api_status', 'in', '("PST","SUSP","CANC","ABD")');

    const matches = (matchesRaw ?? []) as Array<{
      id: string; fixture_id: number | null;
      nation_a: string; nation_b: string;
      phase: string; day_index: number;
    }>;

    if (matches.length === 0) {
      return NextResponse.json({
        skipped: true,
        reason: `No unprocessed matches on day ${gs.current_day_index}`,
        currentDay: gs.current_day_index,
        phase: gs.current_phase,
      });
    }

    // ── 3. Load team data ─────────────────────────────────────────────────────
    const teamIds = [...new Set(matches.flatMap(m => [m.nation_a, m.nation_b]))];

    const { data: ctRaw } = await A(admin)
      .from('competition_teams')
      .select('team_id, current_price, initial_price, teams(strength, name, flag_emoji)')
      .eq('competition_id', competitionId)
      .in('team_id', teamIds);

    interface CTRow { team_id: string; current_price: number; initial_price: number; teams: { strength: number; name: string; flag_emoji: string | null } | null }
    const ctTeams = (ctRaw ?? []) as CTRow[];
    const getTeam = (id: string) => ctTeams.find(t => t.team_id === id);

    // ── 4. Load day metadata for div_key ──────────────────────────────────────
    const { data: dayRaw } = await A(admin)
      .from('competition_days')
      .select('is_ko, div_key')
      .eq('competition_id', competitionId)
      .eq('day_index', gs.current_day_index)
      .maybeSingle();

    const day = dayRaw as { is_ko: boolean; div_key: string | null } | null;

    // ── 5. Simulate each match ────────────────────────────────────────────────
    const now = new Date();
    let processed = 0;

    for (const match of matches) {
      const tA = getTeam(match.nation_a);
      const tB = getTeam(match.nation_b);

      const pA   = tA?.current_price ?? tA?.initial_price ?? 100;
      const pB   = tB?.current_price ?? tB?.initial_price ?? 100;
      const strA = tA?.teams?.strength ?? 75;
      const strB = tB?.teams?.strength ?? 75;

      const isKO = match.phase !== 'Groups';
      const sim  = simulate(strA, strB, isKO);

      const [rawPA, rawPB] = applyResult(pA, pB, sim.res as 'A' | 'B' | 'draw');
      const newPA = Math.max(1, rawPA);
      const newPB = Math.max(1, rawPB);

      const [scoreA, scoreB] = genScore(sim.res, sim.res90, sim.etRes, sim.penWinner);
      const goals = genGoals(
        scoreA, scoreB,
        { id: match.nation_a, name: tA?.teams?.name ?? match.nation_a },
        { id: match.nation_b, name: tB?.teams?.name ?? match.nation_b },
        sim.res90, sim.etRes,
      );

      const winnerId = sim.res === 'draw' ? null : (sim.res === 'A' ? match.nation_a : match.nation_b);
      const loserId  = sim.res === 'draw' ? null : (sim.res === 'A' ? match.nation_b : match.nation_a);
      const elimId   = isKO && match.phase !== 'SF' && match.phase !== '3rd' ? loserId : null;

      const resultData = {
        a: match.nation_a, b: match.nation_b,
        scoreA, scoreB,
        res: sim.res, res90: sim.res90,
        isUpset: sim.isUpset, pA, pB, newPA, newPB,
        elimId, winnerId, loserId, goals,
        etRes: sim.etRes, penWinner: sim.penWinner,
        penA: sim.penA, penB: sim.penB,
        divCash: 0, phase: match.phase,
      };

      // Update prices
      await A(admin).rpc('update_competition_prices', {
        p_competition_id: competitionId,
        p_team_a: match.nation_a, p_new_price_a: newPA,
        p_team_b: match.nation_b, p_new_price_b: newPB,
        p_day_index: gs.current_day_index,
      });

      // KO: liquidate loser
      if (elimId) {
        await A(admin).rpc('liquidate_competition_eliminated', {
          p_competition_id: competitionId,
          p_team_id: elimId,
          p_day_index: gs.current_day_index,
        });
      }

      // Dividends
      if (day?.is_ko && day.div_key && winnerId) {
        const rate = DIV_RATES[day.div_key] ?? 0;
        if (rate > 0) {
          await A(admin).rpc('distribute_competition_dividends', {
            p_competition_id: competitionId,
            p_team_id: winnerId, p_round: day.div_key,
            p_rate: rate, p_price: newPA,
            p_day_index: gs.current_day_index,
          });
        }
      }

      // Mark match as processed
      await A(admin).from('matches').update({
        score_a: scoreA, score_b: scoreB,
        winner_id: winnerId, is_upset: sim.isUpset,
        played_at:        now.toISOString(),
        processed_at:     now.toISOString(),
        trade_lock_until: new Date(+now + 15 * 60_000).toISOString(),
        api_status:       'FT',
        result_data:      resultData,
      }).eq('id', match.id);

      processed++;
    }

    // ── 6. Advance game state — simulateMode creates KO matches if missing ────
    await checkAndAdvancePhase(competitionId, /* simulateMode */ true);

    // ── 7. Fetch updated state to return to caller ────────────────────────────
    const { data: newGs } = await A(admin)
      .from('competition_game_state')
      .select('current_day_index, current_phase, champion_id')
      .eq('competition_id', competitionId)
      .single();

    const updated = newGs as { current_day_index: number; current_phase: string; champion_id: string | null } | null;

    return NextResponse.json({
      ok: true,
      processed,
      simulatedDay: gs.current_day_index,
      phase: gs.current_phase,
      newDayIndex: updated?.current_day_index ?? gs.current_day_index + 1,
      newPhase: updated?.current_phase ?? gs.current_phase,
      champion: updated?.champion_id ?? null,
    });

  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'POST /api/admin/simulate-day' } });
    console.error('[POST /api/admin/simulate-day]', err);
    return NextResponse.json({ error: 'Internal server error', detail: String(err) }, { status: 500 });
  }
}
