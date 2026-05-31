/**
 * POST /api/game/advance
 *
 * Advances a competition by one day (simulation mode).
 * No longer depends on hardcoded CALENDAR or NATIONS — all data from DB.
 *
 * Body: { competitionId: number, dayIndex: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import * as Sentry from '@sentry/nextjs';
import {
  simulate, applyResult, genScore, genGoals,
  buildMatchesForDay, buildR32Pool,
} from '@kickstock/game-engine';
import { DIV_RATES } from '@kickstock/constants';
import type { StoredMatchResult, GameState } from '@kickstock/types';

export const dynamic  = 'force-dynamic';
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const A = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

interface GSRow {
  current_day_index: number; current_phase: string;
  champion_id: string | null; advancing: boolean; eliminated: string[];
  r32_pool: string[]; r16_pool: string[]; qf_pool: string[];
  sf_pool: string[]; final_pool: string[]; third_pool: string[];
}

interface DayRow {
  day_index: number; full_label: string; phase: string;
  is_ko: boolean; div_key: string | null;
}

interface TeamRow {
  team_id: string; current_price: number; initial_price: number;
  teams: { strength: number; name: string; flag_emoji: string | null } | null;
}

export async function POST(req: NextRequest) {
  try {
    const { competitionId, dayIndex: clientDay } = await req.json() as { competitionId: number; dayIndex: number };
    const deviceId = req.headers.get('X-Device-ID') ?? null;
    const admin    = createAdminClient();

    if (!competitionId) {
      return NextResponse.json({ error: 'competitionId requis' }, { status: 400 });
    }

    let userId: string | null = null;
    try {
      const sb = await createServerClient();
      const { data: { user } } = await sb.auth.getUser();
      userId = user?.id ?? null;
    } catch { /* fine */ }

    // ── 1. Read competition game state ────────────────────────────────────────
    const { data: gsRaw } = await A(admin)
      .from('competition_game_state')
      .select('*')
      .eq('competition_id', competitionId)
      .single();

    const gs = gsRaw as GSRow | null;
    if (!gs) return NextResponse.json({ error: 'competition_game_state not initialized' }, { status: 500 });

    if (clientDay !== gs.current_day_index) {
      return NextResponse.json({ alreadyAdvanced: true, newDayIndex: gs.current_day_index });
    }

    // ── 2. CAS lock ───────────────────────────────────────────────────────────
    const { data: locked } = await A(admin)
      .from('competition_game_state')
      .update({ advancing: true })
      .eq('competition_id', competitionId)
      .eq('advancing', false)
      .eq('current_day_index', clientDay)
      .select('competition_id');

    if (!locked || (locked as unknown[]).length === 0) {
      return NextResponse.json({ advancing: true, message: 'Day already advancing' }, { status: 409 });
    }

    try {
      // ── 3. Load team data (prices + strengths) ────────────────────────────
      const { data: teamRows } = await A(admin)
        .from('competition_teams')
        .select('team_id, current_price, initial_price, teams(strength, name, flag_emoji)')
        .eq('competition_id', competitionId);

      const teams = (teamRows ?? []) as TeamRow[];
      const prices: Record<string, number> = {};
      const strengths: Record<string, number> = {};

      for (const t of teams) {
        prices[t.team_id]    = t.current_price ?? t.initial_price;
        strengths[t.team_id] = t.teams?.strength ?? 75;
      }

      // ── 4. Load today's day metadata from competition_days ────────────────
      const { data: dayRaw } = await A(admin)
        .from('competition_days')
        .select('day_index, full_label, phase, is_ko, div_key')
        .eq('competition_id', competitionId)
        .eq('day_index', gs.current_day_index)
        .maybeSingle();

      const day = dayRaw as DayRow | null;

      if (!day) {
        // No more days — tournament finished
        await A(admin)
          .from('competition_game_state')
          .update({ advancing: false })
          .eq('competition_id', competitionId);
        return NextResponse.json({ finished: true });
      }

      // ── 5. Load played match results ──────────────────────────────────────
      const { data: playedRaw } = await A(admin)
        .from('matches')
        .select('day_index, result_data')
        .eq('competition_id', competitionId)
        .not('played_at', 'is', null);

      const matchResults: Record<number, StoredMatchResult[]> = {};
      for (const m of (playedRaw ?? []) as Array<{ day_index: number; result_data: unknown }>) {
        if (!m.result_data) continue;
        if (!matchResults[m.day_index]) matchResults[m.day_index] = [];
        matchResults[m.day_index].push(m.result_data as StoredMatchResult);
      }

      // ── 6. Build today's matches ──────────────────────────────────────────
      const engineState = {
        prices, matchResults,
        eliminated: gs.eliminated ?? [],
        r32Pool:    gs.r32_pool   ?? [],
        r16Pool:    gs.r16_pool   ?? [],
        qfPool:     gs.qf_pool    ?? [],
        sfPool:     gs.sf_pool    ?? [],
        finalPool:  gs.final_pool ?? [],
        thirdPool:  gs.third_pool ?? [],
        champion:   gs.champion_id ?? null,
      } as Partial<GameState>;

      let todayMatches: Array<{ a: string; b: string; venue?: string }>;

      if (!day.is_ko) {
        // Group stage: load fixtures from matches table for this competition + day
        const { data: fixtureRows } = await A(admin)
          .from('matches')
          .select('nation_a, nation_b, venue')
          .eq('competition_id', competitionId)
          .eq('day_index', gs.current_day_index)
          .is('played_at', null);

        todayMatches = ((fixtureRows ?? []) as Array<{ nation_a: string; nation_b: string; venue: string | null }>)
          .filter(f => !engineState.eliminated!.includes(f.nation_a) && !engineState.eliminated!.includes(f.nation_b))
          .map(f => ({ a: f.nation_a, b: f.nation_b, venue: f.venue ?? undefined }));
      } else {
        // KO stage: derive dynamic key from phase + position within phase
        const dynamicKey = await deriveDynamicKey(admin, competitionId, day.phase, gs.current_day_index);
        todayMatches = buildMatchesForDay(dynamicKey, engineState as GameState)
          .filter(m => prices[m.a] !== undefined && prices[m.b] !== undefined);
      }

      if (todayMatches.length === 0 && day.is_ko) {
        // Empty KO day — skip ahead
        const nd = gs.current_day_index + 1;
        const { data: nextDay } = await A(admin)
          .from('competition_days')
          .select('phase')
          .eq('competition_id', competitionId)
          .eq('day_index', nd)
          .maybeSingle();

        await A(admin)
          .from('competition_game_state')
          .update({ current_day_index: nd, current_phase: (nextDay as { phase: string } | null)?.phase ?? day.phase, advancing: false, updated_at: new Date().toISOString() })
          .eq('competition_id', competitionId);

        return NextResponse.json({ results: [], newDayIndex: nd, flash: {} });
      }

      // ── 7. Simulate ───────────────────────────────────────────────────────
      const newPrices:  Record<string, number>      = { ...prices };
      const eliminated: string[]                     = [...(gs.eliminated ?? [])];
      const flash:      Record<string, 'fu' | 'fd'> = {};
      let r32Pool   = [...(gs.r32_pool   ?? [])], r16Pool   = [...(gs.r16_pool   ?? [])];
      let qfPool    = [...(gs.qf_pool    ?? [])], sfPool    = [...(gs.sf_pool    ?? [])];
      let finalPool = [...(gs.final_pool ?? [])], thirdPool = [...(gs.third_pool ?? [])];
      let champion: string | null = gs.champion_id ?? null;

      const results: StoredMatchResult[] = todayMatches.map((m) => {
        const pA  = newPrices[m.a] ?? 100;
        const pB  = newPrices[m.b] ?? 100;
        const strA = strengths[m.a] ?? 75;
        const strB = strengths[m.b] ?? 75;
        const teamA = teams.find(t => t.team_id === m.a);
        const teamB = teams.find(t => t.team_id === m.b);

        const sim = simulate(strA, strB, day.is_ko);
        const [rawPA, rawPB] = applyResult(pA, pB, sim.res as 'A' | 'B' | 'draw');
        const newPA = Math.max(1, rawPA), newPB = Math.max(1, rawPB);
        const [scoreA, scoreB] = genScore(sim.res, sim.res90, sim.etRes, sim.penWinner);
        const goals = genGoals(
          scoreA, scoreB,
          { id: m.a, name: teamA?.teams?.name ?? m.a, flag: teamA?.teams?.flag_emoji ?? '', p: pA, str: strA, conf: '', group: '' },
          { id: m.b, name: teamB?.teams?.name ?? m.b, flag: teamB?.teams?.flag_emoji ?? '', p: pB, str: strB, conf: '', group: '' },
          sim.res90, sim.etRes,
        );
        const winnerId = sim.res === 'draw' ? null : (sim.res === 'A' ? m.a : m.b);
        const loserId  = sim.res === 'draw' ? null : (sim.res === 'A' ? m.b : m.a);
        const elimId   = day.is_ko && day.phase !== 'SF' && day.phase !== '3rd' ? loserId : null;

        newPrices[m.a] = newPA; newPrices[m.b] = newPB;
        flash[m.a] = newPA > pA ? 'fu' : 'fd';
        flash[m.b] = newPB > pB ? 'fu' : 'fd';
        if (elimId && !eliminated.includes(elimId)) { eliminated.push(elimId); newPrices[elimId] = 1; flash[elimId] = 'fd'; }
        if (day.phase === '3rd' && loserId && !eliminated.includes(loserId)) { eliminated.push(loserId); newPrices[loserId] = 1; flash[loserId] = 'fd'; }

        return {
          a: m.a, b: m.b, scoreA, scoreB,
          res: sim.res as 'A' | 'B' | 'draw', res90: sim.res90 as 'A' | 'B' | 'draw',
          isUpset: sim.isUpset, pA, pB, newPA, newPB,
          elimId, winnerId, loserId, venue: m.venue, goals,
          etRes: sim.etRes, penWinner: sim.penWinner, penA: sim.penA, penB: sim.penB,
          divCash: 0, phase: day.phase,
        };
      });

      // ── 8. R32 pool (after last group day) ────────────────────────────────
      if (day.phase === 'Groups' && r32Pool.length === 0) {
        const { data: lastGroupDay } = await A(admin)
          .from('competition_days')
          .select('day_index')
          .eq('competition_id', competitionId)
          .eq('phase', 'Groups')
          .order('day_index', { ascending: false })
          .limit(1)
          .maybeSingle();

        if ((lastGroupDay as { day_index: number } | null)?.day_index === gs.current_day_index) {
          const allRes = { ...matchResults, [gs.current_day_index]: results };
          r32Pool = buildR32Pool(allRes as Record<number, StoredMatchResult[]>, eliminated);
          const q = new Set(r32Pool.filter(Boolean));
          for (const tid of Object.keys(prices)) {
            if (!q.has(tid) && !eliminated.includes(tid)) { eliminated.push(tid); newPrices[tid] = 1; flash[tid] = 'fd'; }
          }
        }
      }

      // ── 9. KO pools ───────────────────────────────────────────────────────
      for (const r of results) {
        if (!day.is_ko || !r.winnerId) continue;
        if (day.phase === 'R32'   && !r16Pool.includes(r.winnerId))   r16Pool.push(r.winnerId);
        if (day.phase === 'R16'   && !qfPool.includes(r.winnerId))    qfPool.push(r.winnerId);
        if (day.phase === 'QF'    && !sfPool.includes(r.winnerId))    sfPool.push(r.winnerId);
        if (day.phase === 'SF') {
          if (!finalPool.includes(r.winnerId)) finalPool.push(r.winnerId);
          if (r.loserId && !thirdPool.includes(r.loserId)) thirdPool.push(r.loserId);
        }
        if (day.phase === 'Final') {
          champion = r.winnerId;
          if (r.loserId && !eliminated.includes(r.loserId)) { eliminated.push(r.loserId); newPrices[r.loserId] = 1; }
        }
      }

      const newDayIndex = gs.current_day_index + 1;
      const { data: nextDayRow } = await A(admin)
        .from('competition_days')
        .select('phase')
        .eq('competition_id', competitionId)
        .eq('day_index', newDayIndex)
        .maybeSingle();
      const newPhase = (nextDayRow as { phase: string } | null)?.phase ?? day.phase;

      // ── 10. Persist simulated matches ─────────────────────────────────────
      const mUps = results.map((r, i) => ({
        id: `m_sim_${competitionId}_${gs.current_day_index}_${i}`,
        competition_id: competitionId,
        day_index: gs.current_day_index,
        nation_a: r.a, nation_b: r.b, venue: r.venue ?? null, phase: day.phase,
        score_a: r.scoreA, score_b: r.scoreB, winner_id: r.winnerId,
        is_upset: r.isUpset, played_at: new Date().toISOString(), result_data: r,
      }));
      await A(admin).from('matches').upsert(mUps, { onConflict: 'id' });

      // ── 11. Persist prices (competition-scoped) ───────────────────────────
      for (const [teamId, price] of Object.entries(newPrices)) {
        await A(admin).rpc('update_competition_prices', {
          p_competition_id: competitionId,
          p_team_a: teamId, p_new_price_a: price,
          p_team_b: teamId, p_new_price_b: price,
          p_day_index: newDayIndex,
        });
      }

      // ── 12. Liquidate eliminated ──────────────────────────────────────────
      for (const r of results) {
        if (!r.elimId) continue;
        await A(admin).rpc('liquidate_competition_eliminated', {
          p_competition_id: competitionId,
          p_team_id: r.elimId,
          p_day_index: gs.current_day_index,
        });
      }

      // ── 13. Dividends ─────────────────────────────────────────────────────
      if (day.is_ko && day.div_key) {
        const rate = DIV_RATES[day.div_key] ?? 0;
        for (const r of results) {
          if (!r.winnerId || rate <= 0) continue;
          await A(admin).rpc('distribute_competition_dividends', {
            p_competition_id: competitionId,
            p_team_id: r.winnerId, p_round: day.div_key,
            p_rate: rate, p_price: newPrices[r.winnerId] ?? r.newPA,
            p_day_index: gs.current_day_index,
          });
        }
        if (day.phase === 'Final') {
          for (const r of results) {
            if (!r.loserId) continue;
            await A(admin).rpc('distribute_competition_dividends', {
              p_competition_id: competitionId,
              p_team_id: r.loserId, p_round: 'final',
              p_rate: rate, p_price: newPrices[r.loserId] ?? r.newPB,
              p_day_index: gs.current_day_index,
            });
          }
        }
      }
      if (champion && day.phase === 'Final') {
        await A(admin).rpc('distribute_competition_dividends', {
          p_competition_id: competitionId,
          p_team_id: champion, p_round: 'champion',
          p_rate: DIV_RATES['champion'] ?? 0.60,
          p_price: newPrices[champion] ?? 1,
          p_day_index: gs.current_day_index,
        });
      }

      // ── 14. Advance competition_game_state ────────────────────────────────
      await A(admin)
        .from('competition_game_state')
        .update({
          current_day_index: newDayIndex, current_phase: newPhase,
          champion_id: champion, advancing: false, eliminated,
          r32_pool: r32Pool, r16_pool: r16Pool, qf_pool: qfPool,
          sf_pool: sfPool, final_pool: finalPool, third_pool: thirdPool,
          updated_at: new Date().toISOString(),
        })
        .eq('competition_id', competitionId);

      // ── 15. Player updated cash ───────────────────────────────────────────
      let newCash: number | null = null;
      if (deviceId || userId) {
        const { data: pid } = await A(admin).rpc('get_or_create_competition_portfolio', {
          p_competition_id: competitionId, p_device_id: deviceId, p_user_id: userId,
        });
        if (pid) {
          const { data: pf } = await A(admin).from('portfolios').select('cash').eq('id', pid).single();
          newCash = (pf as { cash: number } | null)?.cash ?? null;
        }
      }

      return NextResponse.json({
        results, flash, newDayIndex, newPhase, prices: newPrices,
        eliminated, r32Pool, r16Pool, qfPool, sfPool, finalPool, thirdPool, champion, newCash,
      });

    } catch (inner) {
      await A(admin)
        .from('competition_game_state')
        .update({ advancing: false })
        .eq('competition_id', competitionId);
      throw inner;
    }

  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'POST /api/game/advance' } });
    console.error('[POST /api/game/advance]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── Derive KO dynamic key from phase + position within that phase ─────────────
async function deriveDynamicKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  competitionId: number,
  phase: string,
  dayIndex: number,
): Promise<string> {
  const { data: phaseDays } = await admin
    .from('competition_days')
    .select('day_index')
    .eq('competition_id', competitionId)
    .eq('phase', phase)
    .order('day_index', { ascending: true });

  const days = (phaseDays ?? []) as Array<{ day_index: number }>;
  const pos  = days.findIndex(d => d.day_index === dayIndex);

  if (phase === 'R32')   return (['r32_28','r32_29','r32_30','r32_1','r32_2','r32_3'])[pos]  ?? 'r32_1';
  if (phase === 'R16')   return (['r16_1','r16_2','r16_3','r16_4'])[pos]                      ?? 'r16_1';
  if (phase === 'QF')    return (['qf_1','qf_2','qf_3'])[pos]                                 ?? 'qf_1';
  if (phase === 'SF')    return pos === 0 ? 'sf_1' : 'sf_2';
  if (phase === '3rd')   return '3rd';
  if (phase === 'Final') return 'final';
  return phase.toLowerCase();
}
