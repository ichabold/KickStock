/**
 * GET /api/leaderboard/online?limit=50&deviceId=<uuid>&competitionId=<id>
 *
 * Live "Online" ranking: cash + current holdings value for every portfolio
 * in a competition, sorted descending (best score first).
 *
 * - `competitionId` is optional; defaults to the active competition (same
 *   resolution as /api/competition/bootstrap).
 * - `deviceId` (and/or the logged-in session) is used to locate "my" row.
 *   If it falls outside the top `limit`, it is appended at the end of
 *   `entries` so the player can always see their own rank.
 *
 * Returns { entries: RankingRow[], me: RankingRow | null, total: number }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { captureApiException } from '@/lib/sentryCapture';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export interface RankingRow {
  portfolio_id: string;
  user_id: string | null;
  device_id: string | null;
  username: string;
  country: string | null;
  user_type: 'registered' | 'guest';
  total_value: number;
  rank: number;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit    = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));
    const deviceId = url.searchParams.get('deviceId');
    const competitionIdParam = url.searchParams.get('competitionId');

    const admin = createAdminClient();

    // ── Resolve competition ────────────────────────────────────────────────
    let competitionId: number | null = null;
    if (competitionIdParam && /^\d+$/.test(competitionIdParam)) {
      competitionId = parseInt(competitionIdParam, 10);
    } else {
      const { data: comp } = await adm(admin)
        .from('competitions')
        .select('id')
        .eq('is_active', true)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      competitionId = (comp as { id: number } | null)?.id ?? null;
    }

    if (!competitionId) {
      return NextResponse.json({ entries: [], me: null, total: 0 });
    }

    // ── Live standings via SECURITY DEFINER RPC ─────────────────────────────
    const { data, error } = await adm(admin).rpc('get_online_ranking', {
      p_competition_id: competitionId,
    });
    if (error) throw error;

    const rows = (data ?? []) as RankingRow[];

    // ── Identify "me" ────────────────────────────────────────────────────────
    let me: RankingRow | null = null;
    try {
      const server = await createServerClient();
      const { data: { user } } = await server.auth.getUser();
      if (user) me = rows.find(r => r.user_id === user.id) ?? null;
    } catch { /* no session — fall through to device lookup */ }

    if (!me && deviceId) {
      me = rows.find(r => r.device_id === deviceId) ?? null;
    }

    const top = rows.slice(0, limit);
    const entries = (me && !top.some(r => r.portfolio_id === me!.portfolio_id))
      ? [...top, me]
      : top;

    return NextResponse.json({ entries, me, total: rows.length });
  } catch (err) {
    captureApiException(err, { route: 'GET /api/leaderboard/online' });
    console.error('[GET /api/leaderboard/online]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
