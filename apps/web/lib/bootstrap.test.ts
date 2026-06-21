import { describe, it, expect } from 'vitest';
import { deriveDynamicKey } from './bootstrap';
import type { BootstrapData } from '@kickstock/types';

function makeBootstrap(days: Array<{ day_index: number; phase: string; is_ko: boolean }>): BootstrapData {
  return {
    competition: { id: 1, name: 'Test', start_date: '2026-01-01', league_id: 1, season: 2026 },
    teams: [],
    days: days.map(d => ({ ...d, full_label: `Day ${d.day_index}`, date_label: 'Jan 1', div_key: null, scheduled_times: [] })),
    group_fixtures: [],
    squads: {},
    generated_at: new Date().toISOString(),
  };
}

describe('deriveDynamicKey', () => {
  it('retourne les clés R32 dans l ordre', () => {
    const bootstrap = makeBootstrap([
      { day_index: 17, phase: 'R32', is_ko: true },
      { day_index: 18, phase: 'R32', is_ko: true },
      { day_index: 19, phase: 'R32', is_ko: true },
      { day_index: 20, phase: 'R32', is_ko: true },
      { day_index: 21, phase: 'R32', is_ko: true },
      { day_index: 22, phase: 'R32', is_ko: true },
    ]);
    expect(deriveDynamicKey('R32', 17, bootstrap)).toBe('r32_1');
    expect(deriveDynamicKey('R32', 18, bootstrap)).toBe('r32_2');
    expect(deriveDynamicKey('R32', 22, bootstrap)).toBe('r32_6');
  });

  it('retourne final pour la phase Final', () => {
    const bootstrap = makeBootstrap([{ day_index: 35, phase: 'Final', is_ko: true }]);
    expect(deriveDynamicKey('Final', 35, bootstrap)).toBe('final');
  });

  it('retourne les clés SF correctement', () => {
    const bootstrap = makeBootstrap([
      { day_index: 30, phase: 'SF', is_ko: true },
      { day_index: 31, phase: 'SF', is_ko: true },
    ]);
    expect(deriveDynamicKey('SF', 30, bootstrap)).toBe('sf_1');
    expect(deriveDynamicKey('SF', 31, bootstrap)).toBe('sf_2');
  });
});
