/**
 * POST /api/auth/guest
 * Body: { pseudo: string, deviceId: string }
 * Validates pseudo, checks uniqueness, then:
 *   1. Ensures a portfolio exists for this deviceId (get_or_create_portfolio)
 *   2. Sets guest_username via set_guest_username RPC
 * Returns { ok: true } or { error: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

const RESERVED = new Set(['admin', 'kickstock', 'moderator', 'system', 'support', 'official']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminFrom = (a: ReturnType<typeof createAdminClient>, t: string) => (a as any).from(t);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminRpc  = (a: ReturnType<typeof createAdminClient>, fn: string, args: object) => (a as any).rpc(fn, args);

export async function POST(req: NextRequest) {
  let body: { pseudo?: string; deviceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { pseudo, deviceId } = body;

  if (!pseudo || !deviceId) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  const trimmed = pseudo.trim();

  if (!isValidFormat(trimmed)) {
    return NextResponse.json({ error: 'invalid_format' }, { status: 400 });
  }

  if (RESERVED.has(trimmed.toLowerCase())) {
    return NextResponse.json({ error: 'reserved' }, { status: 400 });
  }

  const admin = createAdminClient();
  const lower = trimmed.toLowerCase();

  // Uniqueness check (same logic as check-pseudo)
  const [{ data: guestMatch }, { data: profileMatch }] = await Promise.all([
    adminFrom(admin, 'portfolios').select('id').ilike('guest_username', lower).limit(1),
    adminFrom(admin, 'profiles').select('id').ilike('username', lower).limit(1),
  ]);

  if ((guestMatch?.length ?? 0) > 0 || (profileMatch?.length ?? 0) > 0) {
    return NextResponse.json({ error: 'taken' }, { status: 409 });
  }

  // Ensure portfolio exists for this deviceId
  const { error: pidErr } = await adminRpc(admin, 'get_or_create_portfolio', {
    p_device_id: deviceId,
    p_user_id:   null,
  });
  if (pidErr) {
    return NextResponse.json({ error: 'portfolio_error' }, { status: 500 });
  }

  // Set username on the portfolio
  const { data: result, error: setErr } = await adminRpc(admin, 'set_guest_username', {
    p_device_id: deviceId,
    p_username:  trimmed,
  });

  if (setErr || result === 'not_found') {
    return NextResponse.json({ error: 'set_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function isValidFormat(p: string): boolean {
  if (p.length < 3 || p.length > 20) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(p)) return false;
  if (/^[_-]|[_-]$/.test(p)) return false;
  return true;
}
