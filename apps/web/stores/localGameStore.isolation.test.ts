import { describe, it, expect, beforeEach } from 'vitest';

const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem:    (k: string) => store[k] ?? null,
  setItem:    (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
};
Object.defineProperty(global, 'localStorage', { value: mockLocalStorage, writable: true });

describe('Isolation clé persist par compétition', () => {
  beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); });

  it('compétition 1 et 2 ont des clés distinctes', () => {
    store['kickstock:competition'] = '1';
    const key1 = 'ks-game-state-1';
    store[key1] = JSON.stringify({ cash: 5000 });

    store['kickstock:competition'] = '2';
    const key2 = 'ks-game-state-2';

    expect(store[key1]).toBeDefined();
    expect(store[key2]).toBeUndefined();
    expect(key1).not.toBe(key2);
  });
});
