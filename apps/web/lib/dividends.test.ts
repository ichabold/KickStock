import { describe, it, expect } from 'vitest';
import { calcDividend } from '@kickstock/game-engine';

describe('calcDividend — taux par phase', () => {
  const cases: Array<[string, number, number]> = [
    ['r32',      200,  20  ],
    ['r16',      200,  30  ],
    ['qf',       200,  40  ],
    ['sf',       200,  60  ],
    ['3rd',      200,  50  ],
    ['champion', 200,  100 ],
    ['unknown',  200,  0   ],
  ];

  it.each(cases)('div_key=%s, prix=%d → dividende=%d KC/part', (key, price, expected) => {
    expect(calcDividend(price, key)).toBe(expected);
  });

  it('arrondi à 1 décimale', () => {
    expect(calcDividend(15, 'r32')).toBe(1.5);
  });

  it('prix = 0 → dividende = 0', () => {
    expect(calcDividend(0, 'r32')).toBe(0);
  });
});
