import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; team_id: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const competitionId = parseInt(params.id, 10);
  const teamId = params.team_id;

  const body = await req.json() as {
    strength?:      number;
    group_code?:    string;
    initial_price?: number;
  };

  if (body.strength !== undefined && (body.strength < 0 || body.strength > 100)) {
    return NextResponse.json({ error: 'strength doit être entre 0 et 100' }, { status: 400 });
  }
  if (body.initial_price !== undefined && body.initial_price <= 0) {
    return NextResponse.json({ error: 'initial_price doit être positif' }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;

  const updates: Record<string, unknown> = {};
  if (body.strength     !== undefined) updates.strength     = body.strength;
  if (body.group_code   !== undefined) updates.group_code   = body.group_code;
  if (body.initial_price !== undefined) {
    updates.initial_price = body.initial_price;
    updates.current_price = body.initial_price;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  const { error } = await adm
    .from('competition_teams')
    .update(updates)
    .eq('competition_id', competitionId)
    .eq('team_id', teamId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
