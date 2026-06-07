import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let rateLimitedResult = { limited: false, remaining: 9, reset: 0 };

vi.mock('@/lib/rateLimitRedis', () => ({
  checkRateLimit: vi.fn(async () => rateLimitedResult),
}));

// Mock the Supabase admin REST fetch call (global fetch) so the nominal path
// doesn't require network/env configuration.
const fetchMock = vi.fn(async () => ({
  ok: true,
  json: async () => ({ users: [] }),
}));
vi.stubGlobal('fetch', fetchMock);

import { GET } from './route';

function makeReq(q: string, ip = '203.0.113.7') {
  return new NextRequest(`http://localhost/api/auth/check-email?q=${encodeURIComponent(q)}`, {
    headers: { 'x-forwarded-for': ip },
  });
}

describe('GET /api/auth/check-email — rate limiting (anti-énumération)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitedResult = { limited: false, remaining: 9, reset: 0 };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('200 — sous la limite, le flow normal fonctionne', async () => {
    const res  = await GET(makeReq('csptest@example.com'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ exists: false, confirmed: false });
  });

  it('429 too_many_requests — quota dépassé (avec Retry-After), aucun appel à Supabase', async () => {
    rateLimitedResult = { limited: true, remaining: 0, reset: Math.floor(Date.now() / 1000) + 120 };
    const res  = await GET(makeReq('csptest@example.com'));
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.error).toBe('too_many_requests');
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400 invalid_email — la validation du paramètre reste inchangée (sous la limite)', async () => {
    const res = await GET(makeReq('not-an-email'));
    expect(res.status).toBe(400);
  });
});
