import { describe, it, expect } from 'vitest';

function computeMaxBuy(
  totVal:      number,
  held:        number,
  price:       number,
  cash:        number,
  isCapPhase:  boolean,
): number {
  const maxBuyRaw = Math.max(0, Math.floor(cash / price));
  const maxBuyCap = isCapPhase
    ? Math.max(0, Math.floor((totVal * 0.40 - held * price) / price))
    : maxBuyRaw;
  return Math.min(maxBuyRaw, maxBuyCap);
}

describe('Règle de concentration 40%', () => {
  it('sans holdings : peut acheter jusqu\'à 40% de la valeur totale en phase de groupes', () => {
    const max = computeMaxBuy(10_000, 0, 100, 10_000, true);
    expect(max).toBe(40);
  });

  it('avec holdings existants : la capacité est réduite', () => {
    const max = computeMaxBuy(10_000, 20, 100, 10_000, true);
    expect(max).toBe(20);
  });

  it('à exactement 40% : ne peut plus acheter', () => {
    const max = computeMaxBuy(10_000, 40, 100, 10_000, true);
    expect(max).toBe(0);
  });

  it('au-delà de 40% : retourne 0', () => {
    const max = computeMaxBuy(10_000, 50, 100, 10_000, true);
    expect(max).toBe(0);
  });

  it('en phase KO (isCapPhase=false) : pas de cap de concentration', () => {
    const max = computeMaxBuy(10_000, 50, 100, 10_000, false);
    expect(max).toBe(100);
  });

  it('limité par le cash si cash < cap', () => {
    const max = computeMaxBuy(10_000, 0, 100, 500, true);
    expect(max).toBe(5);
  });
});
