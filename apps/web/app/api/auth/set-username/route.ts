/**
 * POST /api/auth/set-username
 * Body: { username: string }
 * Sets the username for the currently authenticated user.
 * Uses admin client to bypass RLS — authentication is verified via JWT.
 * Returns { ok: true } or { error: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';

const RESERVED = new Set(['admin', 'kickstock', 'moderator', 'system', 'support', 'official']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminFrom = (a: ReturnType<typeof createAdminClient>, t: string) => (a as any).from(t);

export async function POST(req: NextRequest) {
  let body: { username?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { username } = body;
  if (!username) return NextResponse.json({ error: 'missing_username' }, { status: 400 });

  const trimmed = username.trim();

  if (!isValidFormat(trimmed)) {
    return NextResponse.json({ error: 'invalid_format' }, { status: 400 });
  }
  if (RESERVED.has(trimmed.toLowerCase())) {
    return NextResponse.json({ error: 'reserved' }, { status: 400 });
  }

  // Verify the caller is authenticated
  const response = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const admin = createAdminClient();
  const lower = trimmed.toLowerCase();

  // Uniqueness check (case-insensitive, exclude the user's own current username)
  const [{ data: guestMatch }, { data: profileMatch }] = await Promise.all([
    adminFrom(admin, 'portfolios').select('id').ilike('guest_username', lower).limit(1),
    adminFrom(admin, 'profiles').select('id').ilike('username', lower).neq('id', user.id).limit(1),
  ]);

  if ((guestMatch?.length ?? 0) > 0 || (profileMatch?.length ?? 0) > 0) {
    return NextResponse.json({ error: 'taken' }, { status: 409 });
  }

  // Update using admin client (bypasses RLS)
  const { error: updateErr } = await adminFrom(admin, 'profiles')
    .update({ username: trimmed })
    .eq('id', user.id);

  if (updateErr) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function isValidFormat(p: string): boolean {
  if (p.length < 3 || p.length > 20) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(p)) return false;
  if (/^[_-]|[_-]$/.test(p)) return false;
  return true;
}
