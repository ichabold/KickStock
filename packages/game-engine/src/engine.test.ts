import { describe, it, expect } from 'vitest';
import { applyResult } from '../src/applyResult';
import { calcTax } from '../src/calcTax';
import { calcDividend } from '../src/calcDividends';
import { simulate } from '../src/simulate';

describe('applyResult', () => {
  it('winner gets 50% of loser value', () => {
    const [nA, nB] = applyResult(100, 100, 'A');
    expect(nA).toBe(150);
    expect(nB).toBe(50);
  });

  it('draw: each gains 25% of opponent', () => {
    const [nA, nB] = applyResult(100, 100, 'draw');
    expect(nA).toBe(125);
    expect(nB).toBe(125);
  });

  it('asymmetric prices: favourite wins', () => {
    const [nA, nB] = applyResult(200, 50, 'A');
    expect(nA).toBe(225);   // 200 + 50*0.5
    expect(nB).toBe(25);    // 50 * 0.5
  });

  it('price never goes below 1', () => {
    const [, nB] = applyResult(1000, 10, 'A');
    expect(nB).toBeGreaterThanOrEqual(1);
  });
});

describe('calcTax', () => {
  it('group stage: 10% min 10 KC', () => {
    expect(calcTax(200, 100, false)).toBe(20);   // 10% of 200
    expect(calcTax(50,  50,  false)).toBe(10);   // min 10 KC
  });

  it('KO stage: 5% min 10 KC', () => {
    expect(calcTax(200, 100, true)).toBe(10);    // 5% of 200
    expect(calcTax(300, 100, true)).toBe(15);    // 5% of 300
  });

  it('eliminated (price=1): 0 tax', () => {
    expect(calcTax(100, 1, false)).toBe(0);
    expect(calcTax(100, 1, true)).toBe(0);
  });
});

describe('calcDividend', () => {
  it('R32: 10% of current price', () => {
    expect(calcDividend(200, 'r32')).toBe(20);
  });

  it('Champion: 50% of current price', () => {
    expect(calcDividend(500, 'champion')).toBe(250);
  });

  it('Unknown key: 0', () => {
    expect(calcDividend(100, 'unknown')).toBe(0);
  });
});

describe('simulate', () => {
  it('always returns A or B in KO (no draw)', () => {
    for (let i = 0; i < 50; i++) {
      const { res } = simulate(80, 60, true);
      expect(['A', 'B']).toContain(res);
    }
  });

  it('can return draw in group stage', () => {
    const results = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { res } = simulate(70, 70, false);
      results.add(res);
    }
    expect(results.has('draw')).toBe(true);
  });

  it('favourite wins more often with big gap', () => {
    let favWins = 0;
    for (let i = 0; i < 1000; i++) {
      const { res } = simulate(95, 40, false); // huge gap
      if (res === 'A') favWins++;
    }
    expect(favWins).toBeGreaterThan(700); // >70% fav wins
  });
});
