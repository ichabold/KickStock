'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TeamMeta } from '@kickstock/types';
import { useGameStore } from '@/stores/gameStore';
import NationDetailOverlay from './NationDetailOverlay';
import styles from './Ticker.module.css';

export default function Ticker() {
  const t = useTranslations('ticker');
  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teams     = useGameStore(s => (s as any)._teams) as TeamMeta[];
  const [nationId, setNationId] = useState<string | null>(null);

  const items = useMemo(() => {
    return [...(teams ?? [])].sort((a, b) => {
      const heldA = (portfolio[a.id] ?? 0) > 0 ? 1 : 0;
      const heldB = (portfolio[b.id] ?? 0) > 0 ? 1 : 0;
      return heldB - heldA;
    });
  }, [teams, portfolio]);

  const doubled = [...items, ...items];

  return (
    <>
      <div className={styles.wrap} aria-label={t('ariaLabel')}>
        <div className={styles.ticker}>
          {doubled.map((n, i) => {
            const p    = prices[n.id] ?? n.initialPrice;
            const pct  = ((p - n.initialPrice) / n.initialPrice * 100).toFixed(1);
            const up   = p >= n.initialPrice;
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
