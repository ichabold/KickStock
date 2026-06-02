import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const VALID_PHASES   = ['Groups', 'R32', 'R16', 'QF', 'SF', '3rd', 'Final'] as const;
const VALID_DIV_KEYS = [null, 'r32', 'r16', 'qf', 'sf', 'final', 'champion'] as const;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const competitionId = parseInt(params.id, 10);
  const body = await req.json() as {
    day_index:  number;
    full_label: string;
    date_label: string;
    phase:      string;
    is_ko:      boolean;
    div_key:    string | null;
  };

  if (typeof body.day_index !== 'number' || body.day_index < 0) {
    return NextResponse.json({ error: 'day_index invalide (entier >= 0)' }, { status: 400 });
  }
  if (!body.full_label?.trim() || !body.date_label?.trim()) {
    return NextResponse.json({ error: 'full_label et date_label requis' }, { status: 400 });
  }
  if (!VALID_PHASES.includes(body.phase as typeof VALID_PHASES[number])) {
    return NextResponse.json({ error: `phase invalide. Valeurs: ${VALID_PHASES.join(', ')}` }, { status: 400 });
  }
  if (!VALID_DIV_KEYS.includes(body.div_key as typeof VALID_DIV_KEYS[number])) {
    return NextResponse.json({ error: `div_key invalide. Valeurs: ${VALID_DIV_KEYS.join(', ')}` }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;

  const { error } = await adm
    .from('competition_days')
    .upsert({
      competition_id: competitionId,
      day_index:      body.day_index,
      full_label:     body.full_label.trim(),
      date_label:     body.date_label.trim(),
      phase:          body.phase,
      is_ko:          body.is_ko,
      div_key:        body.div_key ?? null,
    }, { onConflict: 'competition_id,day_index' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
