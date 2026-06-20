/**
 * GET /api/leaderboard/offline?limit=50
 *
 * Offline ranking: best scores of REGISTERED players only (user_id IS NOT NULL).
 * Returns one row per player — their MAX(best_score) across all competitions —
 * so a player with multiple competition portfolios appears only once.
 *
 * Guests are intentionally excluded: their scores live only in localStorage /
 * a guest portfolio row and would pollute the registered-user ranking.
 *
 * Returns { entries: OfflineRankingRow[], me: OfflineRankingRow | null, total: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }        from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { captureApiException }      from '@/lib/sentryCapture';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export interface OfflineRankingRow {
  user_id:    string;
  username:   string;
  country:    string | null;
  best_score: number;
  rank:       number;
}

export async function GET(req: NextRequest) {
  try {
    const url   = new URL(req.url);
    const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));

    const admin = createAdminClient();

    const { data, error } = await adm(admin).rpc('get_offline_ranking', { p_limit: limit });
    if (error) throw error;

    const rows = (data ?? []) as OfflineRankingRow[];

    // ── Identify "me" (logged-in user only — no guest fallback) ──────────────
    let me: OfflineRankingRow | null = null;
    try {
      const server = await createServerClient();
      const { data: { user } } = await server.auth.getUser();
      if (user) me = rows.find(r => r.user_id === user.id) ?? null;
    } catch { /* no session */ }

    // If "me" falls outside the visible top N, append at the end
    const top     = rows.slice(0, limit);
    const entries = (me && !top.some(r => r.user_id === me!.user_id))
      ? [...top, me]
      : top;

    return NextResponse.json({ entries, me, total: rows.length });
  } catch (err) {
    captureApiException(err, { route: 'GET /api/leaderboard/offline' });
    console.error('[GET /api/leaderboard/offline]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
