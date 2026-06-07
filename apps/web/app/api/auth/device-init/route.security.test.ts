import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

const TEST_SECRET = 'test-secret-for-device-init-binding-security-tests';
const DEVICE_ID   = '11111111-1111-4111-8111-111111111111';
const COOKIE_NAME = 'kickstock_device_sig';

const IP_A = '203.0.113.10';
const UA_A = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const IP_B = '198.51.100.20';
const UA_B = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124';

// ── Chainable Supabase admin-client mock ────────────────────────────────────
// Supports: .from('device_bindings').select(...).eq(...).maybeSingle()
//           .from('device_bindings').update(...).eq(...)        (awaitable)
//           .from('device_bindings').insert({...})              (awaitable)
let bindingLookup: { data: { first_ip_hash: string; first_ua_hash: string } | null } = { data: null };
let lookupShouldThrow = false;

function makeAdminMock() {
  const chain: Record<string, unknown> = {};
  chain.from       = vi.fn(() => chain);
  chain.select     = vi.fn(() => chain);
  chain.eq         = vi.fn(() => chain);
  chain.update     = vi.fn(() => chain);
  chain.insert     = vi.fn(async () => ({ data: null, error: null }));
  chain.maybeSingle = vi.fn(async () => {
    if (lookupShouldThrow) throw new Error('boom — table indisponible');
    return bindingLookup;
  });
  // `.eq(...)` doit être awaitable en bout de chaîne update (`await ...update().eq()`)
  (chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve({ data: null, error: null });
  return chain;
}

let adminMock: ReturnType<typeof makeAdminMock>;

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => adminMock),
}));
vi.mock('@/lib/sentryCapture', () => ({ captureApiException: vi.fn() }));

describe('POST /api/auth/device-init — verrou anti-usurpation (device_bindings)', () => {
  let POST: typeof import('./route').POST;
  let hashFingerprint: typeof import('@/lib/deviceSigning').hashFingerprint;

  beforeAll(async () => {
    // DEVICE_SIGNING_SECRET doit être présent AVANT que deviceSigning.ts
    // n'évalue sa constante de module — d'où l'import dynamique ici.
    process.env.DEVICE_SIGNING_SECRET = TEST_SECRET;
    ({ hashFingerprint } = await import('@/lib/deviceSigning'));
    ({ POST } = await import('./route'));
  });

  afterAll(() => {
    delete process.env.DEVICE_SIGNING_SECRET;
  });

  function makeReq(opts: { cookie?: string; ip?: string; ua?: string; deviceId?: string } = {}): NextRequest {
    const headers: Record<string, string> = {
      'Content-Type':   'application/json',
      'x-forwarded-for': opts.ip ?? IP_A,
      'user-agent':      opts.ua ?? UA_A,
    };
    if (opts.cookie) headers['Cookie'] = `${COOKIE_NAME}=${opts.cookie}`;
    return new NextRequest('http://localhost/api/auth/device-init', {
      method: 'POST',
      body: JSON.stringify({ deviceId: opts.deviceId ?? DEVICE_ID }),
      headers,
    });
  }

  beforeEach(() => {
    adminMock = makeAdminMock();
    bindingLookup = { data: null };
    lookupShouldThrow = false;
  });

  it('400 invalid_device_id — UUID v4 mal formé (validation inchangée)', async () => {
    const res = await POST(makeReq({ deviceId: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    expect(adminMock.from).not.toHaveBeenCalled();
  });

  it('200 reused — cookie déjà présent : court-circuite avant toute vérification de verrou', async () => {
    const res  = await POST(makeReq({ cookie: 'whatever-existing-sig' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, reused: true });
    expect(adminMock.from).not.toHaveBeenCalled();
  });

  it("200 — premier signataire d'un device_id neuf : crée le verrou et signe le cookie", async () => {
    const res  = await POST(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(adminMock.from).toHaveBeenCalledWith('device_bindings');
    expect(adminMock.insert).toHaveBeenCalledWith(
      expect.objectContaining({ device_id: DEVICE_ID }),
    );
    // Jamais d'IP en clair stockée
    const inserted = (adminMock.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(inserted.first_ip_hash).not.toBe(IP_A);
    expect(inserted.first_ua_hash).not.toBe(UA_A);
    expect(inserted.first_ip_hash).toBe(await hashFingerprint(IP_A));
    expect(inserted.first_ua_hash).toBe(await hashFingerprint(UA_A));
    // Cookie de signature posé
    expect(res.cookies.get(COOKIE_NAME)).toBeTruthy();
  });

  it('200 — propriétaire légitime revenant avec le même réseau (cookie perdu) : verrou rafraîchi, signature émise', async () => {
    bindingLookup = {
      data: { first_ip_hash: await hashFingerprint(IP_A), first_ua_hash: await hashFingerprint(UA_B) },
    };
    const res  = await POST(makeReq({ ip: IP_A, ua: UA_A })); // même IP, UA différent
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(adminMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ last_seen_at: expect.any(String) }),
    );
    expect(adminMock.insert).not.toHaveBeenCalled();
    expect(res.cookies.get(COOKIE_NAME)).toBeTruthy();
  });

  it('200 — propriétaire légitime revenant avec le même navigateur (réseau différent) : verrou rafraîchi, signature émise', async () => {
    bindingLookup = {
      data: { first_ip_hash: await hashFingerprint(IP_B), first_ua_hash: await hashFingerprint(UA_A) },
    };
    const res  = await POST(makeReq({ ip: IP_A, ua: UA_A })); // IP différente, même UA
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(adminMock.update).toHaveBeenCalled();
    expect(adminMock.insert).not.toHaveBeenCalled();
    expect(res.cookies.get(COOKIE_NAME)).toBeTruthy();
  });

  it("409 device_already_bound — usurpation : device_id déjà lié à une empreinte radicalement différente (réseau ET navigateur)", async () => {
    bindingLookup = {
      data: { first_ip_hash: await hashFingerprint(IP_A), first_ua_hash: await hashFingerprint(UA_A) },
    };
    const res  = await POST(makeReq({ ip: IP_B, ua: UA_B })); // tout diffère → attaquant probable
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body).toEqual({ error: 'device_already_bound', code: 'DEVICE_ALREADY_BOUND' });
    expect(adminMock.update).not.toHaveBeenCalled();
    expect(adminMock.insert).not.toHaveBeenCalled();
    // Aucun cookie de signature ne doit être délivré à l'attaquant
    expect(res.cookies.get(COOKIE_NAME)).toBeFalsy();
  });

  it('200 — dégradation gracieuse : la vérification du verrou échoue (table indisponible) sans bloquer la signature', async () => {
    lookupShouldThrow = true;
    const res  = await POST(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(res.cookies.get(COOKIE_NAME)).toBeTruthy();
  });
});
