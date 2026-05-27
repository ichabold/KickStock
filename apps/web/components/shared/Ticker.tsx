'use client';

import { useMemo, useState } from 'react';
import { NATIONS } from '@kickstock/constants';
import { useGameStore } from '@/stores/gameStore';
import NationDetailOverlay from './NationDetailOverlay';
import styles from './Ticker.module.css';

export default function Ticker() {
  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);
  const [nationId, setNationId] = useState<string | null>(null);

  const items = useMemo(() => {
    return [...NATIONS].sort((a, b) => {
      const heldA = (portfolio[a.id] ?? 0) > 0 ? 1 : 0;
      const heldB = (portfolio[b.id] ?? 0) > 0 ? 1 : 0;
      return heldB - heldA;
    });
  }, [portfolio]);

  const doubled = [...items, ...items];

  return (
    <>
      <div className={styles.wrap} aria-label="Cours en direct">
        <div className={styles.ticker}>
          {doubled.map((n, i) => {
            const p    = prices[n.id] ?? n.p;
            const pct  = ((p - n.p) / n.p * 100).toFixed(1);
            const up   = p >= n.p;
            const held = (portfolio[n.id] ?? 0) > 0;
            return (
              <button
                key={`${n.id}-${i}`}
                className={`${styles.item} ${up ? styles.up : styles.dn} ${held ? styles.held : ''}`}
                onClick={() => setNationId(n.id)}
                aria-label={`${n.name} — ${Math.round(p)} KC`}
              >
                {n.flag} {n.id} {Math.round(p)} KC
                <span className={styles.pct}>{up ? '+' : ''}{pct}%</span>
              </button>
            );
          })}
        </div>
      </div>

      {nationId && (
        <NationDetailOverlay
          nationId={nationId}
          onClose={() => setNationId(null)}
        />
      )}
    </>
  );
}
