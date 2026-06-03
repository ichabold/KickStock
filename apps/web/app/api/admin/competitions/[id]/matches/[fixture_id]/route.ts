/**
 * PATCH /api/admin/competitions/[id]/matches/[fixture_id]
 * Update a match's scheduled_at, score, or api_status manually.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/supabase/admin';
import { createClient }              from '@/lib/supabase/server';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; fixture_id: string } },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const fixtureId = parseInt(params.fixture_id, 10);
  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: 'fixture_id invalide' }, { status: 400 });
  }

  const body = await req.json() as {
    scheduled_at?: string;
    score_a?: number | null;
    score_b?: number | null;
    api_status?: string | null;
  };

  const patch: Record<string, unknown> = {};
  if (body.scheduled_at !== undefined) patch.scheduled_at = body.scheduled_at;
  if (body.score_a      !== undefined) patch.score_a      = body.score_a;
  if (body.score_b      !== undefined) patch.score_b      = body.score_b;
  if (body.api_status   !== undefined) patch.api_status   = body.api_status;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;
  const { error } = await adm
    .from('matches')
    .update(patch)
    .eq('fixture_id', fixtureId)
    .eq('competition_id', parseInt(params.id, 10));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
