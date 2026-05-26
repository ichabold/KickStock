/**
 * GET /api/auth/check-pseudo?q=Zidane
 * Checks pseudo availability across both guest_username (portfolios)
 * and username (profiles) — case-insensitive, shared namespace.
 * Returns { available: true } or { available: false, suggestion: "Zidane42" }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

const RESERVED = new Set(['admin', 'kickstock', 'moderator', 'system', 'support', 'official']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminFrom = (a: ReturnType<typeof createAdminClient>, t: string) => (a as any).from(t);

export async function GET(req: NextRequest) {
  const pseudo = req.nextUrl.searchParams.get('q')?.trim() ?? '';

  if (!isValidFormat(pseudo)) {
    return NextResponse.json({ available: false, error: 'invalid_format' });
  }

  if (RESERVED.has(pseudo.toLowerCase())) {
    return NextResponse.json({ available: false, suggestion: buildSuggestion(pseudo) });
  }

  const admin = createAdminClient();
  const lower = pseudo.toLowerCase();

  const [{ data: guestMatch }, { data: profileMatch }] = await Promise.all([
    adminFrom(admin, 'portfolios')
      .select('id')
      .ilike('guest_username', lower)
      .limit(1),
    adminFrom(admin, 'profiles')
      .select('id')
      .ilike('username', lower)
      .limit(1),
  ]);

  const taken = (guestMatch?.length ?? 0) > 0 || (profileMatch?.length ?? 0) > 0;

  if (!taken) {
    return NextResponse.json({ available: true });
  }

  return NextResponse.json({ available: false, suggestion: buildSuggestion(pseudo) });
}

function isValidFormat(p: string): boolean {
  if (p.length < 3 || p.length > 20) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(p)) return false;
  if (/^[_-]|[_-]$/.test(p)) return false;
  return true;
}

function buildSuggestion(base: string): string {
  const suffix = Math.floor(10 + Math.random() * 90);
  const trimmed = base.slice(0, 18); // leave room for 2-digit suffix
  return `${trimmed}${suffix}`;
}
