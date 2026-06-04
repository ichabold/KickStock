/**
 * GET /api/admin/matches/unprocessed?competitionId=X&dayIndex=Y
 * Returns unprocessed matches for a given competition day.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/supabase/admin';
import { createClient }              from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const A = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.app_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const competitionId = parseInt(searchParams.get('competitionId') ?? '0', 10);
  const dayIndex      = parseInt(searchParams.get('dayIndex')      ?? '0', 10);

  if (!competitionId) return NextResponse.json({ error: 'competitionId requis' }, { status: 400 });

  const admin = createAdminClient();

  const { data: raw } = await A(admin)
    .from('matches')
    .select('id, nation_a, nation_b, phase, nation_a_team:teams!matches_nation_a_fkey(name, flag_emoji), nation_b_team:teams!matches_nation_b_fkey(name, flag_emoji)')
    .eq('competition_id', competitionId)
    .eq('day_index', dayIndex)
    .is('processed_at', null)
    .not('api_status', 'in', '("PST","SUSP","CANC","ABD")');

  type Row = {
    id: string; nation_a: string; nation_b: string; phase: string;
    nation_a_team: { name: string; flag_emoji: string | null } | null;
    nation_b_team: { name: string; flag_emoji: string | null } | null;
  };

  const matches = ((raw ?? []) as Row[]).map(m => ({
    id:       m.id,
    nation_a: m.nation_a,
    nation_b: m.nation_b,
    phase:    m.phase,
    nameA:    m.nation_a_team?.name    ?? m.nation_a,
    nameB:    m.nation_b_team?.name    ?? m.nation_b,
    flagA:    m.nation_a_team?.flag_emoji ?? '🏳',
    flagB:    m.nation_b_team?.flag_emoji ?? '🏳',
  }));

  return NextResponse.json({ matches });
}
