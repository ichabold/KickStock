/**
 * GET /api/game/state
 *
 * Returns the full competition game state + the requesting player's portfolio.
 * Competition identified by X-Competition-ID header (defaults to active competition).
 * Player identified by X-Device-ID header (anonymous) or Supabase session (logged in).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import * as Sentry from '@sentry/nextjs';
import type { StoredMatchResult } from '@kickstock/types';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

    // ── Resolve competition ───────────────────────────────────────────────────
    const rawCompId = req.headers.get('X-Competition-ID');
    let competitionId: number;

    if (rawCompId && /^\d+$/.test(rawCompId)) {
      competitionId = parseInt(rawCompId, 10);
    } else {
      const { data: comp } = await adm(admin)
        .from('competitions')
        .select('id')
        .eq('is_active', true)
        .limit(1)
        .single();
      if (!comp) return NextResponse.json({ error: 'No active competition' }, { status: 404 });
      competitionId = (comp as { id: number }).id;
    }

    // ── Get or create portfolio (competition-scoped) ───────────────────────────
    const { data: portfolioId, error: pidErr } = await adm(admin).rpc(
      'get_or_create_competition_portfolio',
      { p_competition_id: competitionId, p_device_id: deviceId, p_user_id: userId },
    );
    if (pidErr) throw pidErr;

    // ── Parallel fetches ──────────────────────────────────────────────────────
    const [gsRes, ctRes, cpRes, mRes, pfRes, hRes, txRes] = await Promise.all([
      // Game state (competition-scoped)
      adm(admin)
        .from('competition_game_state')
        .select('*')
        .eq('competition_id', competitionId)
        .single(),

      // Team prices + metadata
      adm(admin)
        .from('competition_teams')
        .select('team_id, current_price, initial_price, teams(name, flag_emoji)')
        .eq('competition_id', competitionId),

      // Price history (competition-scoped)
      adm(admin)
        .from('competition_prices')
        .select('team_id, price, day_index')
        .eq('competition_id', competitionId)
        .order('day_index', { ascending: true }),

      // Played matches (competition-scoped)
      adm(admin)
        .from('matches')
        .select('day_index, result_data')
        .eq('competition_id', competitionId)
        .not('played_at', 'is', null)
        .order('day_index'),

      // Portfolio
      adm(admin)
        .from('portfolios')
        .select('cash, avg_cost, tx_log, best_score')
        .eq('id', portfolioId)
        .single(),

      // Holdings (competition-scoped)
      adm(admin)
        .from('holdings')
        .select('nation_id, quantity')
        .eq('portfolio_id', portfolioId)
        .eq('competition_id', competitionId),

      // Transactions (competition-scoped, last 100)
      adm(admin)
        .from('transactions')
        .select('nation_id, type, quantity, price, day_index')
        .eq('portfolio_id', portfolioId)
        .eq('competition_id', competitionId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    interface GSRow {
      current_day_index: number; current_phase: string; champion_id: string | null;
      eliminated: string[]; r32_pool: string[]; r16_pool: string[]; qf_pool: string[];
      sf_pool: string[]; final_pool: string[]; third_pool: string[];
    }
    const gs = gsRes.data as GSRow | null;
    if (!gs) return NextResponse.json({ error: 'competition_game_state not initialized' }, { status: 500 });

    // ── Team lookup map (for txLog enrichment) ────────────────────────────────
    interface CTRow { team_id: string; current_price: number | null; initial_price: number; teams: { name: string; flag_emoji: string | null } | null }
    const teamMap: Record<string, { name: string; flag: string }> = {};
    const pricesRecord: Record<string, number> = {};

    for (const ct of (ctRes.data ?? []) as CTRow[]) {
      pricesRecord[ct.team_id] = ct.current_price ?? ct.initial_price;
      if (ct.teams) {
        teamMap[ct.team_id] = { name: ct.teams.name, flag: ct.teams.flag_emoji ?? '' };
      }
    }

    // ── Price history ─────────────────────────────────────────────────────────
    const priceHistory: Record<string, number[]> = {};
    for (const row of (cpRes.data ?? []) as Array<{ team_id: string; price: number; day_index: number }>) {
      if (!priceHistory[row.team_id]) priceHistory[row.team_id] = [];
      priceHistory[row.team_id][row.day_index] = row.price;
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
      const team = teamMap[t.nation_id];
      return { dir: t.type as 'buy' | 'sell', flag: team?.flag ?? '', name: team?.name ?? t.nation_id, qty: t.quantity, price: t.price, day: t.day_index };
    });

    const pf = pfRes.data as { cash: number; avg_cost: unknown; tx_log: unknown; best_score: number | null } | null;

    const responseBody = {
      competitionId,
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
    };

    const etag = `"c${competitionId}-d${gs.current_day_index}-p${portfolioId}"`;
    if (req.headers.get('If-None-Match') === etag) {
      return new Response(null, { status: 304 });
    }

    return NextResponse.json(responseBody, {
      headers: {
        'ETag':          etag,
        'Cache-Control': 'private, no-cache',
      },
    });

  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'GET /api/game/state' } });
    console.error('[GET /api/game/state]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
