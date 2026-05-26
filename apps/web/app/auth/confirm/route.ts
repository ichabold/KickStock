/**
 * GET /auth/confirm
 * Handles email OTP verification links sent by Supabase for:
 *   - Email confirmation after sign-up  (type=email or type=signup)
 *   - Password reset                    (type=recovery)
 *
 * Supabase appends ?token_hash=...&type=... to the emailRedirectTo URL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { EmailOtpType } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type       = searchParams.get('type') as EmailOtpType | null;

  if (!token_hash || !type) {
    return NextResponse.redirect(`${origin}/?ks_auth_error=1`);
  }

  // Prepare a redirect response — cookies will be set on it
  const redirectUrl = type === 'recovery'
    ? `${origin}/auth/reset-password`
    : `${origin}/?ks_email_confirmed=1`;

  const response = NextResponse.redirect(redirectUrl);

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

  const { error } = await supabase.auth.verifyOtp({ token_hash, type });

  if (error) {
    return NextResponse.redirect(`${origin}/?ks_auth_error=1`);
  }

  return response;
}
