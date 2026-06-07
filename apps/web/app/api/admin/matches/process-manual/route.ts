/**
 * POST /api/admin/matches/process-manual
 *
 * Allows an admin to manually enter a match result (with optional ET / pens)
 * as a fallback when API-Football doesn't deliver the result.
 *
 * Reuses the same price/dividend/liquidation logic as simulate-day so the
 * game state is consistent regardless of whether results came from the API or admin.
 *
 * Body: {
 *   matchId:    string    — UUID from matches table
 *   scoreA:     number    — full-time (or AET) goals for nation_a
 *   scoreB:     number    — full-time (or AET) goals for nation_b
 *   etRes?:     'A'|'B'|null   — who won in extra time (null if FT decision)
 *   penWinner?: 'A'|'B'|null   — who won on penalties (null if no pens)
 *   penA?:      number    — penalties scored by nation_a
 *   penB?:      number    — penalties scored by nation_b
 * }
 */
import { NextRequest, NextResponse }         from 'next/server';
import { createAdminClient }                 from '@/lib/supabase/admin';
import { createClient }                      from '@/lib/supabase/server';
import { captureApiException }               from '@/lib/sentryCapture';
import { applyResult, genGoals }             from '@kickstock/game-engine';
import { DIV_RATES }                         from '@kickstock/constants';
import { checkAndAdvancePhase }              from '@/lib/check-advance-phase';

export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const A = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function POST(req: NextRequest) {
  // ── Auth: admin only ────────────────────────────────────────────────────────
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.app_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json() as {
      matchId:    string;
      scoreA:     number;
      scoreB:     number;
      etRes?:     'A' | 'B' | null;
      penWinner?: 'A' | 'B' | null;
      penA?:      number;
      penB?:      number;
    };

    const { matchId, scoreA, scoreB } = body;
    const etRes     = body.etRes     ?? null;
    const penWinner = body.penWinner ?? null;
    const penA      = body.penA ?? 0;
    const penB      = body.penB ?? 0;

    if (!matchId) return NextResponse.json({ error: 'matchId requis' }, { status: 400 });
    if (typeof scoreA !== 'number' || typeof scoreB !== 'number') {
      return NextResponse.json({ error: 'scoreA et scoreB requis' }, { status: 400 });
    }

    const admin = createAdminClient();

    // ── 1. Load match ─────────────────────────────────────────────────────────
    const { data: matchRaw } = await A(admin)
      .from('matches')
      .select('id, competition_id, nation_a, nation_b, phase, day_index, processed_at')
      .eq('id', matchId)
      .single();

    if (!matchRaw) return NextResponse.json({ error: 'Match introuvable' }, { status: 404 });

    const match = matchRaw as {
      id: string; competition_id: number;
      nation_a: string; nation_b: string;
      phase: string; day_index: number; processed_at: string | null;
    };

    if (match.processed_at) {
      return NextResponse.json({ error: 'Match déjà traité' }, { status: 409 });
    }

    const competitionId = match.competition_id;

    // ── 2. Determine result from score + pens ─────────────────────────────────
    // penWinner overrides normal score logic (draw in normal/ET, decided by pens)
    let res: 'A' | 'B' | 'draw';
    if (penWinner) {
      res = penWinner; // pen winner is always different from score winner
    } else if (scoreA > scoreB) {
      res = 'A';
    } else if (scoreB > scoreA) {
      res = 'B';
    } else {
      res = 'draw';
    }

    const isKO    = match.phase !== 'Groups';
    const winnerId = res === 'draw' ? null : (res === 'A' ? match.nation_a : match.nation_b);
    const loserId  = res === 'draw' ? null : (res === 'A' ? match.nation_b : match.nation_a);
    const elimId   = isKO && match.phase !== 'SF' && match.phase !== '3rd' ? loserId : null;

    // ── 3. Load current prices ────────────────────────────────────────────────
    const { data: ctRaw } = await A(admin)
      .from('competition_teams')
      .select('team_id, current_price, initial_price, teams(strength, name, flag_emoji)')
      .eq('competition_id', competitionId)
      .in('team_id', [match.nation_a, match.nation_b]);

    interface CTRow {
      team_id: string; current_price: number; initial_price: number;
      teams: { strength: number; name: string; flag_emoji: string | null } | null;
    }
    const ctTeams = (ctRaw ?? []) as CTRow[];
    const getTeam = (id: string) => ctTeams.find(t => t.team_id === id);

    const tA = getTeam(match.nation_a);
    const tB = getTeam(match.nation_b);
    const pA = tA?.current_price ?? tA?.initial_price ?? 100;
    const pB = tB?.current_price ?? tB?.initial_price ?? 100;

    // ── 4. Apply price changes ────────────────────────────────────────────────
    const [rawPA, rawPB] = applyResult(pA, pB, res);
    const newPA = Math.max(1, rawPA);
    const newPB = Math.max(1, rawPB);

    // ── 5. Build result_data (goals are estimated from score) ─────────────────
    // res90: if there was ET/pens the 90-min result was a draw, otherwise same as final
    const res90 = etRes || penWinner ? 'draw' : res;
    const goals = genGoals(
      scoreA, scoreB,
      { id: match.nation_a, name: tA?.teams?.name ?? match.nation_a },
      { id: match.nation_b, name: tB?.teams?.name ?? match.nation_b },
      res90, etRes,
    );

    const isUpset = (res === 'A' && (tA?.teams?.strength ?? 75) < (tB?.teams?.strength ?? 75) - 10)
                 || (res === 'B' && (tB?.teams?.strength ?? 75) < (tA?.teams?.strength ?? 75) - 10);

    const resultData = {
      a: match.nation_a, b: match.nation_b,
      scoreA, scoreB, res,
      res90: etRes ? 'draw' : res,
      isUpset, pA, pB, newPA, newPB,
      elimId, winnerId, loserId, goals,
      etRes, penWinner, penA, penB,
      divCash: 0, phase: match.phase,
    };

    const now = new Date();

    // ── 6. Update prices ──────────────────────────────────────────────────────
    await A(admin).rpc('update_competition_prices', {
      p_competition_id: competitionId,
      p_team_a:         match.nation_a, p_new_price_a: newPA,
      p_team_b:         match.nation_b, p_new_price_b: newPB,
      p_day_index:      match.day_index,
    });

    // ── 7. KO: liquidate loser ────────────────────────────────────────────────
    if (elimId) {
      await A(admin).rpc('liquidate_competition_eliminated', {
        p_competition_id: competitionId,
        p_team_id:        elimId,
        p_day_index:      match.day_index,
      });
    }

    // ── 8. Dividends ──────────────────────────────────────────────────────────
    const { data: dayRaw } = await A(admin)
      .from('competition_days')
      .select('is_ko, div_key')
      .eq('competition_id', competitionId)
      .eq('day_index', match.day_index)
      .maybeSingle();

    const day = dayRaw as { is_ko: boolean; div_key: string | null } | null;

    if (day?.is_ko && day.div_key && winnerId) {
      const rate = DIV_RATES[day.div_key] ?? 0;
      if (rate > 0) {
        await A(admin).rpc('distribute_competition_dividends', {
          p_competition_id: competitionId,
          p_team_id:        winnerId,
          p_round:          day.div_key,
          p_rate:           rate,
          p_price:          newPA,
          p_day_index:      match.day_index,
        });
      }
    }

    // ── 9. Mark match as processed ────────────────────────────────────────────
    await A(admin).from('matches').update({
      score_a:          scoreA,
      score_b:          scoreB,
      winner_id:        winnerId,
      is_upset:         isUpset,
      played_at:        now.toISOString(),
      processed_at:     now.toISOString(),
      trade_lock_until: new Date(+now + 15 * 60_000).toISOString(),
      api_status:       'FT',
      result_data:      resultData,
    }).eq('id', matchId);

    // ── 10. Advance phase if all today's matches are done ─────────────────────
    await checkAndAdvancePhase(competitionId);

    return NextResponse.json({
      ok: true,
      match:   `${match.nation_a} ${scoreA}–${scoreB} ${match.nation_b}`,
      res,
      newPA:   Math.round(newPA),
      newPB:   Math.round(newPB),
      elimId:  elimId ?? null,
    });

  } catch (err) {
    captureApiException(err, { route: 'POST /api/admin/matches/process-manual' });
    console.error('[process-manual]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
