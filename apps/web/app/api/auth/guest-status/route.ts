/**
 * GET /api/auth/guest-status?deviceId=<uuid>
 *
 * Self-healing fallback for GuestModal: a device's `kickstock_pseudo`
 * localStorage entry can be lost (cleared storage, browser↔mobile shell
 * remount edge cases, etc.) even though the device already registered a
 * guest pseudo server-side (portfolios.guest_username). Rather than show
 * the pseudo-registration modal again — which would let the player pick
 * a NEW pseudo and silently orphan their existing portfolio — this route
 * lets the client check whether a guest_username already exists for this
 * device and, if so, repair localStorage instead of re-prompting.
 *
 * Returns { pseudo: string | null }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { captureApiException } from '@/lib/sentryCapture';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get('deviceId');

    if (!deviceId || !UUID_V4.test(deviceId)) {
      return NextResponse.json({ error: 'invalid_device_id' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data, error } = await adm(admin)
      .from('portfolios')
      .select('guest_username, updated_at')
      .eq('device_id', deviceId)
      .not('guest_username', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const pseudo = (data as { guest_username: string | null } | null)?.guest_username ?? null;

    return NextResponse.json({ pseudo });
  } catch (err) {
    captureApiException(err, { route: 'GET /api/auth/guest-status' });
    console.error('[GET /api/auth/guest-status]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
