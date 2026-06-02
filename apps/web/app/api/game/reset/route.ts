/**
 * POST /api/game/reset
 * Réinitialise le portfolio du joueur pour une compétition donnée.
 * Body: { competitionId: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function POST(req: NextRequest) {
  try {
    const { competitionId } = await req.json() as { competitionId: number };
    const deviceId = req.headers.get('X-Device-ID') ?? null;

    if (!competitionId || !deviceId) {
      return NextResponse.json({ error: 'competitionId et X-Device-ID requis' }, { status: 400 });
    }

    const admin = createAdminClient();

    let userId: string | null = null;
    try {
      const sb = await createServerClient();
      const { data: { user } } = await sb.auth.getUser();
      userId = user?.id ?? null;
    } catch { /* anonymous */ }

    const { data: portfolioId } = await adm(admin).rpc(
      'get_or_create_competition_portfolio',
      { p_competition_id: competitionId, p_device_id: deviceId, p_user_id: userId },
    );

    if (!portfolioId) {
      return NextResponse.json({ error: 'Portfolio introuvable' }, { status: 404 });
    }

    await adm(admin)
      .from('portfolios')
      .update({ cash: 10000, avg_cost: {}, tx_log: [], best_score: null })
      .eq('id', portfolioId);

    await adm(admin)
      .from('holdings')
      .delete()
      .eq('portfolio_id', portfolioId)
      .eq('competition_id', competitionId);

    await adm(admin)
      .from('transactions')
      .delete()
      .eq('portfolio_id', portfolioId)
      .eq('competition_id', competitionId);

    return NextResponse.json({ ok: true });

  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'POST /api/game/reset' } });
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
