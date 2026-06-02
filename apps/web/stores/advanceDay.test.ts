import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BootstrapData, TeamMeta } from '@kickstock/types';

// ── Mocks — must be declared BEFORE any store import ─────────────────────────

vi.mock('@/hooks/useAuth', () => ({
  syncBestScore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from: vi.fn(() => ({
      select:  vi.fn().mockReturnThis(),
      eq:      vi.fn().mockReturnThis(),
      single:  vi.fn().mockResolvedValue({ data: null }),
      upsert:  vi.fn().mockResolvedValue({ error: null }),
    })),
  })),
}));

vi.mock('@/lib/bootstrap', () => ({
  getBootstrap:          vi.fn(),
  bootstrapToTeams:      vi.fn(),
  deriveDynamicKey:      vi.fn().mockReturnValue('groups'),
  buildMatchesForCurrentDayFromBootstrap: vi.fn().mockReturnValue([]),
}));

// ── localStorage mock ─────────────────────────────────────────────────────────

const mockStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem:    (k: string) => mockStore[k] ?? null,
  setItem:    (k: string, v: string) => { mockStore[k] = v; },
  removeItem: (k: string) => { delete mockStore[k]; },
  clear:      () => { Object.keys(mockStore).forEach(k => delete mockStore[k]); },
  length: 0,
  key: (_: number) => null,
};
Object.defineProperty(global, 'localStorage', { value: mockLocalStorage, writable: true });

// ── Test data ─────────────────────────────────────────────────────────────────

const TEAM_A: TeamMeta = {
  id: 'AAA', name: 'Team A', flag: '🇦',
  group: 'A', strength: 80, initialPrice: 100,
};
const TEAM_B: TeamMeta = {
  id: 'BBB', name: 'Team B', flag: '🇧',
  group: 'A', strength: 60, initialPrice: 50,
};

function makeBootstrap(): BootstrapData {
  return {
    competition: { id: 1, name: 'Test', start_date: '2026-01-01', league_id: 1, season: 2026 },
    teams: [
      { id: 'AAA', name: 'Team A', flag_emoji: '🇦', logo_url: null,
        group_code: 'A', strength: 80, initial_price: 100, confederation: null },
      { id: 'BBB', name: 'Team B', flag_emoji: '🇧', logo_url: null,
        group_code: 'A', strength: 60, initial_price: 50,  confederation: null },
    ],
    days: [
      { day_index: 0, full_label: 'Day 0', date_label: 'Jun 1', phase: 'Groups', is_ko: false, div_key: null },
      { day_index: 1, full_label: 'Day 1', date_label: 'Jun 2', phase: 'Groups', is_ko: false, div_key: null },
    ],
    group_fixtures: [
      { day_index: 0, nation_a: 'AAA', nation_b: 'BBB', venue: null },
    ],
    generated_at: new Date().toISOString(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('advanceDay offline — logique métier', () => {
  beforeEach(async () => {
    mockLocalStorage.clear();

    const { getBootstrap, bootstrapToTeams } = await import('@/lib/bootstrap');
    vi.mocked(getBootstrap).mockResolvedValue(makeBootstrap());
    vi.mocked(bootstrapToTeams).mockReturnValue([TEAM_A, TEAM_B]);

    vi.resetModules();
  });

  it('les prix changent après une journée de groupe', async () => {
    const { useLocalGameStore } = await import('./localGameStore');

    await useLocalGameStore.getState().loadBootstrap();

    const priceABefore = useLocalGameStore.getState().prices['AAA'];
    const priceBBefore = useLocalGameStore.getState().prices['BBB'];
    expect(priceABefore).toBe(100);
    expect(priceBBefore).toBe(50);

    const result = await useLocalGameStore.getState().advanceDay();

    expect(result).not.toBeNull();
    expect(result!.results).toHaveLength(1);

    const priceAAfter = useLocalGameStore.getState().prices['AAA'];
    const priceBAfter = useLocalGameStore.getState().prices['BBB'];

    // applyResult conserves total value (±1 KC rounding)
    const totalBefore = priceABefore + priceBBefore;
    const totalAfter  = priceAAfter  + priceBAfter;
    expect(Math.abs(totalAfter - totalBefore)).toBeLessThanOrEqual(1);

    const pricesMoved = priceAAfter !== priceABefore || priceBAfter !== priceBBefore;
    expect(pricesMoved).toBe(true);
  });

  it('dayIndex est incrémenté après advanceDay', async () => {
    const { useLocalGameStore } = await import('./localGameStore');

    await useLocalGameStore.getState().loadBootstrap();
    expect(useLocalGameStore.getState().dayIndex).toBe(0);

    await useLocalGameStore.getState().advanceDay();
    expect(useLocalGameStore.getState().dayIndex).toBe(1);
  });

  it('le résultat contient les champs attendus', async () => {
    const { useLocalGameStore } = await import('./localGameStore');

    await useLocalGameStore.getState().loadBootstrap();
    const result = await useLocalGameStore.getState().advanceDay();

    expect(result).not.toBeNull();
    const r = result!.results[0];

    expect(r.a).toBe('AAA');
    expect(r.b).toBe('BBB');
    expect(typeof r.scoreA).toBe('number');
    expect(typeof r.scoreB).toBe('number');
    expect(['A', 'B', 'draw']).toContain(r.res);

    expect(r.newPA).toBeGreaterThanOrEqual(1);
    expect(r.newPB).toBeGreaterThanOrEqual(1);

    expect(r.phase).toBe('Groups');
  });

  it('tournoi terminé → advanceDay retourne null', async () => {
    const { getBootstrap } = await import('@/lib/bootstrap');
    vi.mocked(getBootstrap).mockResolvedValue({
      ...makeBootstrap(),
      days: [],
    });

    const { useLocalGameStore } = await import('./localGameStore');
    await useLocalGameStore.getState().loadBootstrap();

    const result = await useLocalGameStore.getState().advanceDay();
    expect(result).toBeNull();
  });
});
