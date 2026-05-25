/**
 * POST /api/game/advance
 * Advances the shared game by one day:
 *   1. Acquires CAS lock on game_state.advancing
 *   2. Builds matches using TypeScript engine
 *   3. Simulates all matches
 *   4. Writes results to DB (matches, nation_prices, game_state)
 *   5. Distributes dividends via RPC
 *   6. Returns results for client animation
 *
 * Body: { dayIndex: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import {
  simulate, applyResult, genScore, genGoals,
  buildMatchesForDay, buildR32Pool,
} from '@kickstock/game-engine';
import { NATIONS, CALENDAR, DIV_RATES } from '@kickstock/constants';
import type { StoredMatchResult, GameState } from '@kickstock/types';

export const dynamic = 'force-dynamic';

// ── Local types for DB rows ───────────────────────────────────────────────────
interface GSRow {
  current_day_index: number; current_phase: string;
  champion_id: string | null; advancing: boolean; eliminated: string[];
  r32_pool: string[]; r16_pool: string[]; qf_pool: string[];
  sf_pool: string[]; final_pool: string[]; third_pool: string[];
}

// ── Helper: typed admin.from() bypassing broken generic ──────────────────────
function adminFrom(admin: ReturnType<typeof createAdminClient>, table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (admin as any).from(table);
}
function adminRpc(admin: ReturnType<typeof createAdminClient>, fn: string, args: object) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (admin as any).rpc(fn, args);
}

export async function POST(req: NextRequest) {
  try {
    const { dayIndex: clientDay } = await req.json() as { dayIndex: number };
    const deviceId = req.headers.get('X-Device-ID') ?? null;
    const admin    = createAdminClient();

    // Optional: logged-in user
    let userId: string | null = null;
    try {
      const sb = await createServerClient();
      const { data: { user } } = await sb.auth.getUser();
      userId = user?.id ?? null;
    } catch { /* fine */ }

    // ── 1. Read game_state ────────────────────────────────────────────────────
    const { data: gsRaw } = await adminFrom(admin, 'game_state').select('*').single();
    const gs = gsRaw as GSRow | null;
    if (!gs) return NextResponse.json({ error: 'game_state not initialized' }, { status: 500 });

    if (clientDay !== gs.current_day_index) {
      return NextResponse.json({ alreadyAdvanced: true, newDayIndex: gs.current_day_index });
    }

    // ── 2. CAS lock ───────────────────────────────────────────────────────────
    const { data: locked } = await adminFrom(admin, 'game_state')
      .update({ advancing: true })
      .eq('id', 1)
      .eq('advancing', false)
      .eq('current_day_index', clientDay)
      .select('id');

    if (!locked || (locked as unknown[]).length === 0) {
      return NextResponse.json({ advancing: true, message: 'Day already advancing' }, { status: 409 });
    }

    try {
      // ── 3. Nation prices ──────────────────────────────────────────────────
      const { data: nationRows } = await adminFrom(admin, 'nations').select('id, current_price, str');
      const prices: Record<string, number> = {};
      for (const n of (nationRows ?? []) as Array<{ id: string; current_price: number | null; str: number }>) {
        prices[n.id] = n.current_price ?? 0;
      }

      const day = CALENDAR[gs.current_day_index];
      if (!day) {
        await adminFrom(admin, 'game_state').update({ advancing: false }).eq('id', 1);
        return NextResponse.json({ finished: true });
      }

      // ── 4. Played matches ─────────────────────────────────────────────────
      const { data: playedRaw } = await adminFrom(admin, 'matches')
        .select('day_index, result_data')
        .not('played_at', 'is', null);

      const matchResults: Record<number, StoredMatchResult[]> = {};
      for (const m of (playedRaw ?? []) as Array<{ day_index: number; result_data: unknown }>) {
        if (!m.result_data) continue;
        if (!matchResults[m.day_index]) matchResults[m.day_index] = [];
        matchResults[m.day_index].push(m.result_data as StoredMatchResult);
      }

      // ── 5. Engine state ───────────────────────────────────────────────────
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

      // ── 6. Today's matches ────────────────────────────────────────────────
      const todayMatches = day.matches.length > 0
        ? day.matches.filter(m => {
            const nA = NATIONS.find(n => n.id === m.a);
            const nB = NATIONS.find(n => n.id === m.b);
            return nA && nB && !engineState.eliminated!.includes(m.a) && !engineState.eliminated!.includes(m.b);
          })
        : day.dynamic
          ? buildMatchesForDay(day.dynamic, engineState as GameState).filter(m =>
              NATIONS.find(n => n.id === m.a) && NATIONS.find(n => n.id === m.b)
            )
          : [];

      if (todayMatches.length === 0 && day.isKO) {
        const nd = gs.current_day_index + 1;
        await adminFrom(admin, 'game_state').update({
          current_day_index: nd,
          current_phase: CALENDAR[nd]?.phase ?? gs.current_phase,
          advancing: false, updated_at: new Date().toISOString(),
        }).eq('id', 1);
        return NextResponse.json({ results: [], newDayIndex: nd, flash: {} });
      }

      // ── 7. Simulate ───────────────────────────────────────────────────────
      const newPrices:  Record<string, number>      = { ...prices };
      const eliminated: string[]                     = [...(gs.eliminated ?? [])];
      const flash:      Record<string, 'fu' | 'fd'> = {};
      let r32Pool = [...(gs.r32_pool ?? [])], r16Pool = [...(gs.r16_pool ?? [])];
      let qfPool  = [...(gs.qf_pool  ?? [])], sfPool  = [...(gs.sf_pool  ?? [])];
      let finalPool = [...(gs.final_pool ?? [])], thirdPool = [...(gs.third_pool ?? [])];
      let champion: string | null = gs.champion_id ?? null;

      const results: StoredMatchResult[] = todayMatches.map((m) => {
        const nA = NATIONS.find(n => n.id === m.a)!;
        const nB = NATIONS.find(n => n.id === m.b)!;
        const pA = newPrices[m.a] ?? nA.p;
        const pB = newPrices[m.b] ?? nB.p;
        const sim = simulate(nA.str, nB.str, day.isKO);
        const [rawPA, rawPB] = applyResult(pA, pB, sim.res as 'A' | 'B' | 'draw');
        const newPA = Math.max(1, rawPA), newPB = Math.max(1, rawPB);
        const [scoreA, scoreB] = genScore(sim.res, sim.res90, sim.etRes, sim.penWinner);
        const goals = genGoals(scoreA, scoreB, nA, nB, sim.res90, sim.etRes);
        const winnerId = sim.res === 'draw' ? null : (sim.res === 'A' ? m.a : m.b);
        const loserId  = sim.res === 'draw' ? null : (sim.res === 'A' ? m.b : m.a);
        const elimId   = day.isKO && day.phase !== 'SF' && day.phase !== '3rd' ? loserId : null;

        newPrices[m.a] = newPA; newPrices[m.b] = newPB;
        flash[m.a] = newPA > pA ? 'fu' : 'fd';
        flash[m.b] = newPB > pB ? 'fu' : 'fd';
        if (elimId && !eliminated.includes(elimId)) { eliminated.push(elimId); newPrices[elimId] = 1; flash[elimId] = 'fd'; }
        if (day.phase === '3rd' && loserId && !eliminated.includes(loserId)) { eliminated.push(loserId); newPrices[loserId] = 1; flash[loserId] = 'fd'; }

        return { a:m.a, b:m.b, scoreA, scoreB, res:sim.res as 'A'|'B'|'draw', res90:sim.res90 as 'A'|'B'|'draw',
          isUpset:sim.isUpset, pA, pB, newPA, newPB, elimId, winnerId, loserId,
          venue:m.venue, goals, etRes:sim.etRes, penWinner:sim.penWinner, penA:sim.penA, penB:sim.penB, divCash:0, phase:day.phase };
      });

      // ── 8. R32 pool ───────────────────────────────────────────────────────
      if (gs.current_day_index === 16 && r32Pool.length === 0) {
        const allRes = { ...matchResults, [gs.current_day_index]: results };
        r32Pool = buildR32Pool(allRes as Record<number, StoredMatchResult[]>, eliminated);
        const q = new Set(r32Pool.filter(Boolean));
        for (const n of NATIONS) {
          if (!q.has(n.id) && !eliminated.includes(n.id)) { eliminated.push(n.id); newPrices[n.id] = 1; flash[n.id] = 'fd'; }
        }
      }

      // ── 9. KO pools ───────────────────────────────────────────────────────
      for (const r of results) {
        if (!day.isKO || !r.winnerId) continue;
        if (day.phase === 'R32' && !r16Pool.includes(r.winnerId))  r16Pool.push(r.winnerId);
        if (day.phase === 'R16' && !qfPool.includes(r.winnerId))   qfPool.push(r.winnerId);
        if (day.phase === 'QF'  && !sfPool.includes(r.winnerId))   sfPool.push(r.winnerId);
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
      const newPhase    = CALENDAR[newDayIndex]?.phase ?? day.phase;

      // ── 10. Persist matches ───────────────────────────────────────────────
      const mUps = results.map((r, i) => ({
        id: `m_${gs.current_day_index}_${i}`, day_index: gs.current_day_index,
        nation_a: r.a, nation_b: r.b, venue: r.venue ?? null, phase: day.phase,
        score_a: r.scoreA, score_b: r.scoreB, winner_id: r.winnerId,
        is_upset: r.isUpset, played_at: new Date().toISOString(), result_data: r,
      }));
      await adminFrom(admin, 'matches').upsert(mUps, { onConflict: 'id' });

      // ── 11. Persist prices ────────────────────────────────────────────────
      const pUps = Object.entries(newPrices).map(([nid, price]) => ({
        nation_id: nid, price, day_index: newDayIndex, effective_at: new Date().toISOString(),
      }));
      for (let i = 0; i < pUps.length; i += 20) {
        await adminFrom(admin, 'nation_prices').upsert(pUps.slice(i, i+20), { onConflict: 'nation_id,day_index' });
      }

      // ── 12. Liquidate eliminated ──────────────────────────────────────────
      for (const r of results) {
        if (!r.elimId) continue;
        await adminRpc(admin, 'liquidate_eliminated', { p_nation_id: r.elimId, p_day_index: gs.current_day_index });
      }

      // ── 13. Dividends ─────────────────────────────────────────────────────
      if (day.isKO && day.divKey) {
        const rate = DIV_RATES[day.divKey] ?? 0;
        for (const r of results) {
          if (!r.winnerId || rate <= 0) continue;
          await adminRpc(admin, 'distribute_dividends', { p_nation_id: r.winnerId, p_round: day.divKey, p_rate: rate, p_price: newPrices[r.winnerId] ?? r.newPA, p_day_index: gs.current_day_index });
        }
        if (day.phase === 'Final') {
          for (const r of results) {
            if (!r.loserId) continue;
            await adminRpc(admin, 'distribute_dividends', { p_nation_id: r.loserId, p_round: 'final', p_rate: rate, p_price: newPrices[r.loserId] ?? r.newPB, p_day_index: gs.current_day_index });
          }
        }
      }
      if (champion && day.phase === 'Final') {
        await adminRpc(admin, 'distribute_dividends', { p_nation_id: champion, p_round: 'champion', p_rate: DIV_RATES['champion'] ?? 0.60, p_price: newPrices[champion] ?? 1, p_day_index: gs.current_day_index });
      }

      // ── 14. Advance game_state ────────────────────────────────────────────
      await adminFrom(admin, 'game_state').update({
        current_day_index: newDayIndex, current_phase: newPhase,
        champion_id: champion, advancing: false, eliminated,
        r32_pool: r32Pool, r16_pool: r16Pool, qf_pool: qfPool,
        sf_pool: sfPool, final_pool: finalPool, third_pool: thirdPool,
        updated_at: new Date().toISOString(),
      }).eq('id', 1);

      // ── 15. Player updated cash ───────────────────────────────────────────
      let newCash: number | null = null;
      if (deviceId || userId) {
        const { data: pid } = await adminRpc(admin, 'get_or_create_portfolio', { p_device_id: deviceId, p_user_id: userId });
        if (pid) {
          const { data: pf } = await adminFrom(admin, 'portfolios').select('cash').eq('id', pid).single();
          newCash = (pf as { cash: number } | null)?.cash ?? null;
        }
      }

      return NextResponse.json({ results, flash, newDayIndex, newPhase, prices: newPrices, eliminated, r32Pool, r16Pool, qfPool, sfPool, finalPool, thirdPool, champion, newCash });

    } catch (inner) {
      await adminFrom(admin, 'game_state').update({ advancing: false }).eq('id', 1);
      throw inner;
    }

  } catch (err) {
    console.error('[POST /api/game/advance]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
