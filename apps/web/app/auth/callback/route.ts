/**
 * GET /auth/callback
 * Handles the OAuth redirect from Supabase (Google Sign-In).
 *
 * Flow:
 *  1. Exchange the `code` param for a Supabase session
 *  2. Read `ks_pending_device` cookie set by the Google button
 *  3. Call migrate_guest_to_user RPC if a device_id is present
 *  4. Detect first-time signup
 *  5. Redirect to / with query params for WelcomeModal
 *
 * NOTE: We intentionally do NOT update profiles.username here.
 * The handle_new_user trigger fires server-side when auth.users is created,
 * but it may not have run yet by the time this route handler executes (race).
 * Instead, the guest_username is passed to the client via `ks_pseudo` and
 * applied in WelcomeModal — at that point the trigger has definitely run.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminRpc = (a: ReturnType<typeof createAdminClient>, fn: string, args: object) => (a as any).rpc(fn, args);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code  = searchParams.get('code');
  const error = searchParams.get('error');

  // OAuth error from Google/Supabase
  if (error || !code) {
    return NextResponse.redirect(`${origin}/?ks_auth_error=1`);
  }

  // Build Supabase client with cookie forwarding (required for SSR session)
  const response = NextResponse.redirect(`${origin}/`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
        );
        },
      },
    },
  );

  // Exchange code for session
  const { data: { session }, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeErr || !session) {
    return NextResponse.redirect(`${origin}/?ks_auth_error=1`);
  }

  const userId   = session.user.id;
  const deviceId = request.cookies.get('ks_pending_device')?.value ?? null;

  // Clear the pending device cookie
  response.cookies.set('ks_pending_device', '', { maxAge: 0, path: '/' });

  const admin = createAdminClient();

  // ── Detect first-time signup ──────────────────────────────────────────────
  // Use session.user.created_at — available immediately without a DB round-trip.
  const isNewUser = session.user.created_at
    ? Date.now() - new Date(session.user.created_at).getTime() < 2 * 60 * 1000
    : false;

  // ── Migrate guest portfolio if device_id present ──────────────────────────
  let migrationStatus: string | null = null;
  let guestUsername:   string | null = null;

  if (deviceId) {
    const { data: result } = await adminRpc(admin, 'migrate_guest_to_user', {
      p_device_id: deviceId,
      p_user_id:   userId,
    });
    const rpcResult = result as { status: string; guest_username?: string } | null;
    migrationStatus = rpcResult?.status ?? null;

    if (migrationStatus === 'migrated' || migrationStatus === 'conflict_resolved') {
      guestUsername = rpcResult?.guest_username ?? null;
    }
  }

  // ── Build redirect URL ────────────────────────────────────────────────────
  const redirectUrl = new URL(`${origin}/`);

  if (migrationStatus === 'migrated' || migrationStatus === 'conflict_resolved') {
    redirectUrl.searchParams.set('ks_migrated', '1');
  }
  if (isNewUser) {
    redirectUrl.searchParams.set('ks_new_user', '1');
  }
  // Pass the guest_username to the client so WelcomeModal can apply it once
  // the auth trigger has run and the profile row exists.
  if (guestUsername) {
    redirectUrl.searchParams.set('ks_pseudo', guestUsername);
  }

  response.headers.set('Location', redirectUrl.toString());
  return response;
}
