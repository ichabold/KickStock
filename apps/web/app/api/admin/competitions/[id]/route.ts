/**
 * PATCH /api/admin/competitions/[id]
 *
 * Édite les métadonnées d'une compétition existante :
 * name, season, league_id, start_date, is_active.
 *
 * Auth: requires admin role.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/supabase/admin';
import { createClient }              from '@/lib/supabase/server';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'ID invalide' }, { status: 400 });

  const body = await req.json() as Partial<{
    name:       string;
    season:     number;
    league_id:  number;
    start_date: string | null;
    is_active:  boolean;
  }>;

  // Only allow known fields
  const patch: Record<string, unknown> = {};
  if (body.name       !== undefined) patch.name       = body.name;
  if (body.season     !== undefined) patch.season     = body.season;
  if (body.league_id  !== undefined) patch.league_id  = body.league_id;
  if (body.start_date !== undefined) patch.start_date = body.start_date || null;
  if (body.is_active  !== undefined) patch.is_active  = body.is_active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;
  const { error } = await adm
    .from('competitions')
    .update(patch)
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
