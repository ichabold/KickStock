import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/trade
 * Phase 1: handled client-side via Zustand
 * Phase 2: this route validates + persists to Supabase
 *
 * Body: { nationId, mode: 'buy'|'sell', quantity }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nationId, mode, quantity } = body;

    if (!nationId || !mode || !quantity) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    // Phase 2: verify session, check portfolio, execute trade in DB
    // For now, return success (client handles state)
    return NextResponse.json({ ok: true, message: 'Trade accepted (Phase 1: client-side)' });

  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
