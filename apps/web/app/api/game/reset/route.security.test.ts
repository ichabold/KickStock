import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

const TEST_SECRET = 'test-secret-for-reset-route-security-tests';
const DEVICE_ID   = '11111111-1111-4111-8111-111111111111';
const COOKIE_NAME = 'kickstock_device_sig';

// ── Chainable Supabase admin-client mock ────────────────────────────────────
// Supports: .rpc(...), .from('portfolios').update(...).eq(...),
//           .from('holdings'|'transactions').delete().eq(...).eq(...)
function makeAdminMock() {
  const chain: Record<string, unknown> = {};
  chain.rpc    = vi.fn(async () => ({ data: 'pf-123', error: null }));
  chain.from   = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.delete = vi.fn(() => chain);
  chain.eq     = vi.fn(() => chain);
  chain.single = vi.fn(async () => ({ data: null, error: null }));
  // .eq(...) needs to be awaitable at the end of a delete/update chain
  // (the route does `await adm(admin).from(...).update(...).eq(...)`)
  // — make the chain thenable so `await chain` resolves.
  (chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve({ data: null, error: null });
  return chain;
}

let adminMock: ReturnType<typeof makeAdminMock>;
let rateLimitedResult = { limited: false, remaining: 999, reset: 0 };

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => adminMock),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } })),
}));
vi.mock('@/lib/sentryCapture', () => ({ captureApiException: vi.fn() }));
vi.mock('@/lib/rateLimitRedis', () => ({
  checkRateLimit: vi.fn(async () => rateLimitedResult),
}));

describe('POST /api/game/reset — sécurité (verifyDevice + rate limiting)', () => {
  let POST: typeof import('./route').POST;
  let signDeviceId: typeof import('@/lib/deviceSigning').signDeviceId;

  beforeAll(async () => {
    // DEVICE_SIGNING_SECRET doit être présent AVANT que deviceSigning.ts
    // n'évalue sa constante de module — d'où l'import dynamique ici.
    process.env.DEVICE_SIGNING_SECRET = TEST_SECRET;
    ({ signDeviceId } = await import('@/lib/deviceSigning'));
    ({ POST } = await import('./route'));
  });

  afterAll(() => {
    delete process.env.DEVICE_SIGNING_SECRET;
  });

  function makeReq(opts: { cookie?: string } = {}): NextRequest {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Device-ID':  DEVICE_ID,
    };
    if (opts.cookie) headers['Cookie'] = `${COOKIE_NAME}=${opts.cookie}`;
    return new NextRequest('http://localhost/api/game/reset', {
      method: 'POST',
      body: JSON.stringify({ competitionId: 1 }),
      headers,
    });
  }

  beforeEach(() => {
    adminMock = makeAdminMock();
    rateLimitedResult = { limited: false, remaining: 999, reset: 0 };
  });

  it('401 device_not_initialized — aucun cookie de signature', async () => {
    const res  = await POST(makeReq());
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.code).toBe('DEVICE_NOT_INIT');
    expect(adminMock.rpc).not.toHaveBeenCalled();
  });

  it('403 device_signature_mismatch — cookie présent mais signature invalide', async () => {
    const res  = await POST(makeReq({ cookie: 'deadbeef'.repeat(8) }));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe('DEVICE_MISMATCH');
    expect(adminMock.rpc).not.toHaveBeenCalled();
  });

  it("403 device_signature_mismatch — signature valide pour un AUTRE device_id (anti-usurpation)", async () => {
    const sigForOtherDevice = await signDeviceId('22222222-2222-4222-8222-222222222222');
    const res  = await POST(makeReq({ cookie: sigForOtherDevice }));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe('DEVICE_MISMATCH');
    expect(adminMock.rpc).not.toHaveBeenCalled();
  });

  it('200 ok — signature valide pour le bon device_id → reset exécuté', async () => {
    rateLimitedResult = { limited: false, remaining: 4, reset: 0 };
    const validSig = await signDeviceId(DEVICE_ID);
    const res  = await POST(makeReq({ cookie: validSig }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(adminMock.rpc).toHaveBeenCalledWith(
      'get_or_create_competition_portfolio',
      expect.objectContaining({ p_device_id: DEVICE_ID }),
    );
    expect(adminMock.from).toHaveBeenCalledWith('portfolios');
    expect(adminMock.from).toHaveBeenCalledWith('holdings');
    expect(adminMock.from).toHaveBeenCalledWith('transactions');
  });

  it('429 rate_limited — quota de reset dépassé (avec Retry-After)', async () => {
    rateLimitedResult = { limited: true, remaining: 0, reset: Math.floor(Date.now() / 1000) + 42 };
    const validSig = await signDeviceId(DEVICE_ID);
    const res  = await POST(makeReq({ cookie: validSig }));
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.code).toBe('RESET_RATE_LIMITED');
    expect(res.headers.get('Retry-After')).toBeTruthy();
    // Le reset ne doit PAS avoir été exécuté
    expect(adminMock.rpc).not.toHaveBeenCalled();
  });
});
