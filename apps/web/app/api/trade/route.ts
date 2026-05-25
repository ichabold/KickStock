/**
 * POST /api/trade
 * Executes a buy or sell via the execute_trade RPC (SECURITY DEFINER, atomic).
 * Player identified by X-Device-ID header or Supabase session.
 *
 * Body: { nationId: string, mode: 'buy'|'sell', quantity: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from "@/lib/supabase/server";
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nationId, mode, quantity } = body;

    if (!nationId || !mode || !quantity || quantity <= 0) {
      return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 });
    }
    if (!['buy', 'sell'].includes(mode)) {
      return NextResponse.json({ error: 'Mode invalide: buy ou sell' }, { status: 400 });
    }

    const deviceId = req.headers.get('X-Device-ID') ?? null;
    if (!deviceId) {
      return NextResponse.json({ error: 'Missing X-Device-ID header' }, { status: 400 });
    }

    // Optional: get logged-in user
    let userId: string | null = null;
    try {
      
      const sb = await createServerClient();
      const { data: { user } } = await sb.auth.getUser();
      userId = user?.id ?? null;
    } catch { /* fine */ }

    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any).rpc('execute_trade', {
      p_device_id: deviceId,
      p_nation_id: nationId,
      p_mode:      mode,
      p_quantity:  Math.floor(quantity),
      p_user_id:   userId,
    });

    if (error) throw error;

    const result = data as { ok?: boolean; error?: string; new_cash?: number; new_held?: number; price?: number; fee?: number };
    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json({
      ok:      true,
      newCash: result?.new_cash,
      newHeld: result?.new_held,
      price:   result?.price,
      fee:     result?.fee,
    });

  } catch (err) {
    console.error('[POST /api/trade]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
