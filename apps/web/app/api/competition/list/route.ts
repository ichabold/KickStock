/**
 * GET /api/competition/list
 * Returns all competitions available for selection.
 */
import { NextResponse }      from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function GET() {
  const admin = createAdminClient();

  const { data, error } = await adm(admin)
    .from('competitions')
    .select('id, name, season, is_active')
    .order('id', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ competitions: data ?? [] });
}
