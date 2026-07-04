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
import { captureApiException } from '@/lib/sentryCapture';
import { checkRateLimit }      from '@/lib/rateLimitRedis';
import { verifyDevice }        from '@/lib/verifyDevice';
import { buildR16PoolFromR32Results, buildQFPoolFromR16Results } from '@kickstock/game-engine';
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

    // Authenticated users are identified by their Supabase session (JWT verified
    // server-side) — device signature is only needed for anonymous guests.
    // This also fixes iOS PWA: Supabase auth is stored in cookies (always shared
    // between Safari and the PWA), but device_id lives in localStorage which is
    // isolated before iOS 16.4, causing verifyDevice to fail with a new device ID.
    if (!userId) {
      const deviceErr = await verifyDevice(req, deviceId);
      if (deviceErr) return deviceErr;
    }

    const rateLimitId = deviceId ?? userId ?? (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown');
    const rl = await checkRateLimit('state', rateLimitId);
    if (rl.limited) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
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
        .select('day_index, result_data, processed_at')
        .eq('competition_id', competitionId)
        .not('played_at', 'is', null)
        .order('day_index'),

      // Portfolio
      adm(admin)
        .from('portfolios')
        .select('cash, avg_cost, tx_log, best_score, updated_at')
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
    let maxProcessedAt = 0;
    for (const m of (mRes.data ?? []) as Array<{ day_index: number; result_data: unknown; processed_at: string | null }>) {
      if (m.processed_at) {
        const t = new Date(m.processed_at).getTime();
        if (t > maxProcessedAt) maxProcessedAt = t;
      }
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

    const pf = pfRes.data as { cash: number; avg_cost: unknown; tx_log: unknown; best_score: number | null; updated_at: string | null } | null;

    const responseBody = {
      competitionId,
      dayIndex:    gs.current_day_index,
      phase:       gs.current_phase,
      champion:    gs.champion_id ?? null,
      eliminated:  gs.eliminated  ?? [],
      r32Pool:     gs.r32_pool    ?? [],
      // Rebuild pools in official bracket order on-the-fly.
      // DB pools may have been written in calendar order; these correct the pairings.
      ...((): { r16Pool: string[]; qfPool: string[] } => {
        const r32Pool = gs.r32_pool ?? [];
        const phase = gs.current_phase;
        const KO_PHASES = ['R16', 'QF', 'SF', 'Final', '3rd'];
        const QF_PHASES = ['QF', 'SF', 'Final', '3rd'];
        let r16Pool = gs.r16_pool ?? [];
        let qfPool  = gs.qf_pool  ?? [];
        if (KO_PHASES.includes(phase) && r32Pool.length >= 32) {
          const rebuilt = buildR16PoolFromR32Results(r32Pool, matchResults);
          // Only replace if complete (16 winners). Partial rebuild means some R32
          // matches are still unprocessed — fall back to DB pool in that case.
          if (rebuilt.length === 16) r16Pool = rebuilt;
        }
        if (QF_PHASES.includes(phase) && r16Pool.length >= 16) {
          const rebuilt = buildQFPoolFromR16Results(r16Pool, matchResults);
          if (rebuilt.length === 8) qfPool = rebuilt;
        }
        return { r16Pool, qfPool };
      })(),
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

    // Include the portfolio's updated_at timestamp so that any mutation
    // (trade, reset, score sync…) invalidates the cached response — otherwise
    // dayIndex/portfolioId alone stay identical across trades and a stale
    // 304 gets served (e.g. right after buying then reloading on login/logout).
    //
    // Also include the most recent matches.processed_at across the whole
    // competition. A results sync writes fresh `result_data`/prices for
    // everyone, but neither current_day_index (only bumps on full phase
    // advance) nor the player's own portfolios.updated_at (only touched if
    // they hold a position in the affected team) necessarily change — so
    // without this, players uninvolved in tonight's match keep getting a
    // stale 304 until they hard-reload (which resets the client ETag cache).
    const pfVersion = pf?.updated_at ? new Date(pf.updated_at).getTime() : 'new';
    const etag = `"c${competitionId}-d${gs.current_day_index}-p${portfolioId}-u${pfVersion}-m${maxProcessedAt}"`;
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
    captureApiException(err, { route: 'GET /api/game/state' });
    console.error('[GET /api/game/state]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
