import { describe, it, expect, vi } from 'vitest';

// Mock Supabase and Sentry before importing route
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } })) }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { POST } from './route';
import { NextRequest } from 'next/server';

describe('POST /api/game/reset', () => {
  it('retourne 400 si competitionId manquant', async () => {
    const req = new NextRequest('http://localhost/api/game/reset', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
