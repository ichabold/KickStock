/**
 * GET /api/game/state
 * Returns the full shared game state + the requesting player's portfolio.
 * Player identified by X-Device-ID header (anonymous) or Supabase session (logged in).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { NATIONS } from '@kickstock/constants';
import type { StoredMatchResult } from '@kickstock/types';

export const dynamic = 'force-dynamic';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminFrom = (a: ReturnType<typeof createAdminClient>, t: string) => (a as any).from(t);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminRpc  = (a: ReturnType<typeof createAdminClient>, fn: string, args: object) => (a as any).rpc(fn, args);

export async function GET(req: NextRequest) {
  try {
    const deviceId = req.headers.get('X-Device-ID') ?? null;
    const admin    = createAdminClient();

    // Optional: logged-in user
    let userId: string | null = null;
    try {
      const sb = await createServerClient();
      const { data: { user } } = await sb.auth.getUser();
      userId = user?.id ?? null;
    } catch { /* fine */ }

    if (!deviceId && !userId) {
      return NextResponse.json({ error: 'Missing X-Device-ID header' }, { status: 400 });
    }

    if (deviceId && !UUID_V4.test(deviceId)) {
      return NextResponse.json({ error: 'invalid_device_id' }, { status: 400 });
    }

    // ── Get or create portfolio ───────────────────────────────────────────────
    const { data: portfolioId, error: pidErr } = await adminRpc(admin, 'get_or_create_portfolio', {
      p_device_id: deviceId,
      p_user_id:   userId,
    });
    if (pidErr) throw pidErr;

    // ── Parallel fetches ──────────────────────────────────────────────────────
    const [gsRes, nRes, npRes, mRes, pfRes, hRes, txRes] = await Promise.all([
      adminFrom(admin, 'game_state').select('*').single(),
      adminFrom(admin, 'nations').select('id, current_price'),
      adminFrom(admin, 'nation_prices').select('nation_id, price, day_index').order('day_index', { ascending: true }),
      adminFrom(admin, 'matches').select('*').not('played_at', 'is', null).order('day_index'),
      adminFrom(admin, 'portfolios').select('cash, avg_cost, tx_log, best_score').eq('id', portfolioId).single(),
      adminFrom(admin, 'holdings').select('nation_id, quantity').eq('portfolio_id', portfolioId),
      adminFrom(admin, 'transactions').select('nation_id, type, quantity, price, day_index').eq('portfolio_id', portfolioId).order('created_at', { ascending: false }).limit(100),
    ]);

    interface GSRow {
      current_day_index: number; current_phase: string; champion_id: string | null;
      eliminated: string[]; r32_pool: string[]; r16_pool: string[]; qf_pool: string[];
      sf_pool: string[]; final_pool: string[]; third_pool: string[];
    }
    const gs = gsRes.data as GSRow | null;
    if (!gs) throw new Error('game_state not initialized — run seed 001_game_data.sql');

    // ── Prices record ─────────────────────────────────────────────────────────
    const pricesRecord: Record<string, number> = {};
    for (const n of (nRes.data ?? []) as Array<{ id: string; current_price: number | null }>) {
      pricesRecord[n.id] = n.current_price ?? 0;
    }

    // ── Price history ─────────────────────────────────────────────────────────
    const priceHistory: Record<string, number[]> = {};
    for (const row of (npRes.data ?? []) as Array<{ nation_id: string; price: number; day_index: number }>) {
      if (!priceHistory[row.nation_id]) priceHistory[row.nation_id] = [];
      priceHistory[row.nation_id][row.day_index] = row.price;
    }

    // ── Match results ─────────────────────────────────────────────────────────
    const matchResults: Record<number, StoredMatchResult[]> = {};
    for (const m of (mRes.data ?? []) as Array<{ day_index: number; result_data: unknown }>) {
      if (!m.result_data) continue;
      if (!matchResults[m.day_index]) matchResults[m.day_index] = [];
      matchResults[m.day_index].push(m.result_data as StoredMatchResult);
    }

    // ── Player holdings ───────────────────────────────────────────────────────
    const portfolioQty: Record<string, number> = {};
    for (const h of (hRes.data ?? []) as Array<{ nation_id: string; quantity: number }>) {
      if (h.quantity > 0) portfolioQty[h.nation_id] = h.quantity;
    }

    // ── Transaction log ───────────────────────────────────────────────────────
    const txLog = ((txRes.data ?? []) as Array<{ nation_id: string; type: string; quantity: number; price: number; day_index: number }>).map(t => {
      const n = NATIONS.find(x => x.id === t.nation_id);
      return { dir: t.type as 'buy' | 'sell', flag: n?.flag ?? '', name: n?.name ?? t.nation_id, qty: t.quantity, price: t.price, day: t.day_index };
    });

    const pf = pfRes.data as { cash: number; avg_cost: unknown; tx_log: unknown; best_score: number | null } | null;

    return NextResponse.json({
      dayIndex:    gs.current_day_index,
      phase:       gs.current_phase,
      champion:    gs.champion_id ?? null,
      eliminated:  gs.eliminated  ?? [],
      r32Pool:     gs.r32_pool    ?? [],
      r16Pool:     gs.r16_pool    ?? [],
      qfPool:      gs.qf_pool     ?? [],
      sfPool:      gs.sf_pool     ?? [],
      finalPool:   gs.final_pool  ?? [],
      thirdPool:   gs.third_pool  ?? [],
      prices:      pricesRecord,
      priceHistory,
      matchResults,
      cash:        pf?.cash       ?? 10000,
      portfolio:   portfolioQty,
      avgCost:     (pf?.avg_cost  as Record<string, number>) ?? {},
      txLog,
      bestScore:   pf?.best_score ?? null,
    });

  } catch (err) {
    console.error('[GET /api/game/state]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
