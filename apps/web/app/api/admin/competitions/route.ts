import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as {
    name: string; season: number; league_id: number;
  };

  if (!body.name || !body.season || !body.league_id) {
    return NextResponse.json({ error: 'Champs requis: name, season, league_id' }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;

  // Upsert: si (league_id, season) existe déjà, on retourne l'ID existant
  // et on met à jour le nom — ça permet de "reprendre" une compétition
  // sans planter sur la contrainte UNIQUE.
  const { data: comp, error } = await adm
    .from('competitions')
    .upsert(
      { ...body, is_active: false },
      { onConflict: 'league_id,season', ignoreDuplicates: false },
    )
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Initialise le game state si absent (ON CONFLICT DO NOTHING)
  await adm.from('competition_game_state').upsert(
    {
      competition_id:    comp.id,
      current_day_index: 0,
      current_phase:     'Groups',
      advancing:         false,
      eliminated:        [],
      r32_pool: [], r16_pool: [], qf_pool: [],
      sf_pool: [], final_pool: [], third_pool: [],
    },
    { onConflict: 'competition_id', ignoreDuplicates: true },
  );

  return NextResponse.json({ ok: true, id: comp.id });
}
