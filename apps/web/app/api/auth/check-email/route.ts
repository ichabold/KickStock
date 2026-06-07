/**
 * GET /api/auth/check-email?q=<email>
 * Returns whether the email is already registered and whether it is confirmed.
 * Uses the Supabase admin REST API (service role key) so we can query auth.users.
 * Response: { exists: boolean, confirmed: boolean }
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimitRedis';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = await checkRateLimit('checkEmail', ip);
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rl.reset * 1000 - Date.now()) / 1000)) },
      },
    );
  }

  const email = req.nextUrl.searchParams.get('q')?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'misconfigured' }, { status: 500 });
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
      {
        headers: {
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
      },
    );

    if (!res.ok) throw new Error(`Supabase admin API ${res.status}`);

    const data = await res.json() as { users?: Array<{ email: string; email_confirmed_at?: string | null }> };
    const match = (data.users ?? []).find(u => u.email?.toLowerCase() === email);

    if (!match) {
      return NextResponse.json({ exists: false, confirmed: false });
    }

    return NextResponse.json({
      exists:    true,
      confirmed: !!match.email_confirmed_at,
    });
  } catch (err) {
    console.error('[GET /api/auth/check-email]', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
