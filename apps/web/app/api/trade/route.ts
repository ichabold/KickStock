/**
 * POST /api/trade
 * Executes a buy or sell via the execute_competition_trade RPC (SECURITY DEFINER, atomic).
 *
 * Body: { competitionId: number, nationId: string, mode: 'buy'|'sell', quantity: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { competitionId, nationId, mode, quantity } = body;

    if (!competitionId || typeof competitionId !== 'number') {
      return NextResponse.json({ code: 'INVALID_PARAMS', error: 'competitionId manquant' }, { status: 400 });
    }
    if (!nationId || typeof nationId !== 'string') {
      return NextResponse.json({ code: 'INVALID_PARAMS', error: 'nationId manquant' }, { status: 400 });
    }
    if (!['buy', 'sell'].includes(mode)) {
      return NextResponse.json({ code: 'INVALID_MODE', error: 'mode doit être buy ou sell' }, { status: 400 });
    }
    if (!quantity || typeof quantity !== 'number' || quantity <= 0 || !Number.isInteger(quantity)) {
      return NextResponse.json({ code: 'INVALID_QUANTITY', error: 'quantité invalide' }, { status: 400 });
    }

    const deviceId = req.headers.get('X-Device-ID') ?? null;
    if (!deviceId) {
      return NextResponse.json({ code: 'MISSING_DEVICE_ID', error: 'X-Device-ID requis' }, { status: 400 });
    }

    // Resolve authenticated user identity (best-effort)
    let userId: string | null = null;
    try {
      const sessionedClient = await createServerClient();
      const { data: { user } } = await sessionedClient.auth.getUser();
      if (user?.id) userId = user.id;
    } catch { /* anonymous player — proceed without userId */ }

    // Always use admin client for the SECURITY DEFINER RPC so it works for
    // both anon (no GRANT EXECUTE on authenticated/anon roles) and logged-in users.
    // User identity is passed explicitly via p_user_id.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminClient: any = createAdminClient();

    const { data, error } = await adminClient.rpc('execute_competition_trade', {
      p_competition_id: competitionId,
      p_device_id:      deviceId,
      p_team_id:        nationId,
      p_mode:           mode,
      p_quantity:       Math.floor(quantity),
      p_user_id:        userId,
    });

    if (error) {
      console.error('[POST /api/trade] RPC error:', error);
      throw error;
    }

    const result = data as { ok?: boolean; error?: string; code?: string; new_cash?: number; new_held?: number; price?: number; fee?: number };
    if (result?.error) {
      const code = result.code ?? errorToCode(result.error);
      return NextResponse.json({ code, error: result.error }, { status: 422 });
    }

    return NextResponse.json({
      ok:      true,
      newCash: result?.new_cash,
      newHeld: result?.new_held,
      price:   result?.price,
      fee:     result?.fee,
    });

  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'POST /api/trade' } });
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/trade]', msg);
    return NextResponse.json({ code: 'INTERNAL_ERROR', error: msg }, { status: 500 });
  }
}

function errorToCode(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('insuffisant') || m.includes('insufficient')) return 'INSUFFICIENT_FUNDS';
  if (m.includes('éliminé')     || m.includes('eliminated'))   return 'NATION_ELIMINATED';
  if (m.includes('introuvable') || m.includes('not found'))    return 'NOT_FOUND';
  if (m.includes('plafond'))                                   return 'CONCENTRATION_CAP';
  return 'TRADE_ERROR';
}
