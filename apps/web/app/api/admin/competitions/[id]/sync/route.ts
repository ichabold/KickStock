/**
 * POST /api/admin/competitions/[id]/sync
 *
 * Admin-only route to trigger fixture sync for a specific competition.
 * [G9 FIX] Replaces the client-side NEXT_PUBLIC_CRON_SECRET approach.
 *          The CRON_SECRET never leaves the server.
 *
 * Auth: requires admin role (Supabase JWT).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }               from '@/lib/supabase/server';

export const dynamic     = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // ── Admin auth check ──────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  // ── Determine which sync to trigger ──────────────────────────────────────
  const body = await req.json().catch(() => ({})) as { type?: 'fixtures' | 'results' | 'squads' | 'schedule' };
  const type = body.type ?? 'fixtures';

  const paths: Record<string, string> = {
    fixtures: '/api/cron/sync-fixtures',
    results:  '/api/cron/sync-results',
    squads:   '/api/cron/sync-squads',
    schedule: '/api/cron/sync-schedule',
  };

  const path = paths[type];
  if (!path) {
    return NextResponse.json({ error: `Unknown sync type: ${type}` }, { status: 400 });
  }

  // ── Internal call to the cron route (server-side, CRON_SECRET stays private)
  // Pass competition_id so the cron processes this specific competition
  // even if it's not yet active.
  const origin = new URL(req.url).origin;
  const competitionId = params.id;
  // For results, bypass the smart match-window skip — an admin-triggered
  // sync is a deliberate request, regardless of the current time.
  const extra = type === 'results' ? '&force=1' : '';
  const cronUrl = `${origin}${path}?competition_id=${competitionId}${extra}`;
  const response = await fetch(cronUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secret}` },
  });

  const result = await response.json();
  return NextResponse.json({ ok: response.ok, type, ...result }, { status: response.ok ? 200 : 500 });
}
