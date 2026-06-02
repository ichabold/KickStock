import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; day_index: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const competitionId = parseInt(params.id, 10);
  const dayIndex      = parseInt(params.day_index, 10);

  if (isNaN(dayIndex)) {
    return NextResponse.json({ error: 'day_index invalide' }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;

  const { error } = await adm
    .from('competition_days')
    .delete()
    .eq('competition_id', competitionId)
    .eq('day_index', dayIndex);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
