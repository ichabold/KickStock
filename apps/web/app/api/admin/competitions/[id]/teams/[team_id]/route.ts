import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/supabase/admin';
import { createClient }              from '@/lib/supabase/server';
import { strengthToPrice }           from '@/lib/normalizer';

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

  // strength → table teams
  // group_code, initial_price, current_price → table competition_teams
  const teamUpdates: Record<string, unknown> = {};
  const compTeamUpdates: Record<string, unknown> = {};

  if (body.strength   !== undefined) teamUpdates.strength     = body.strength;
  if (body.group_code !== undefined) compTeamUpdates.group_code = body.group_code;

  if (body.initial_price !== undefined) {
    // Prix explicitement fourni → override direct
    compTeamUpdates.initial_price = body.initial_price;
    compTeamUpdates.current_price = body.initial_price;
  } else if (body.strength !== undefined) {
    // Strength modifiée sans prix explicite → recalcule le prix automatiquement
    const recalcPrice = strengthToPrice(body.strength);
    compTeamUpdates.initial_price = recalcPrice;
    compTeamUpdates.current_price = recalcPrice;
  }

  if (Object.keys(teamUpdates).length === 0 && Object.keys(compTeamUpdates).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  if (Object.keys(teamUpdates).length > 0) {
    const { error } = await adm.from('teams').update(teamUpdates).eq('id', teamId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (Object.keys(compTeamUpdates).length > 0) {
    const { error } = await adm
      .from('competition_teams')
      .update(compTeamUpdates)
      .eq('competition_id', competitionId)
      .eq('team_id', teamId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
