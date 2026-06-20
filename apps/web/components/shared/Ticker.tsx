'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useGameStore, buildMatchesForCurrentDay } from '@/stores/gameStore';
import NationDetailOverlay from './NationDetailOverlay';
import styles from './Ticker.module.css';

export default function Ticker() {
  const t = useTranslations('ticker');
  const prices       = useGameStore(s => s.prices);
  const portfolio    = useGameStore(s => s.portfolio);
  const teams        = useGameStore(s => s._teams);
  const dayIndex     = useGameStore(s => s.dayIndex);
  const matchResults = useGameStore(s => s.matchResults);
  const state        = useGameStore(s => s);
  const [nationId, setNationId] = useState<string | null>(null);

  // Teams involved in the last played matchday + today's matches.
  const relevantIds = useMemo(() => {
    const ids = new Set<string>();
    const prevResults = matchResults[dayIndex - 1] ?? [];
    prevResults.forEach(r => { ids.add(r.a); ids.add(r.b); });
    const todayMatches = buildMatchesForCurrentDay(state);
    todayMatches.forEach(m => { ids.add(m.a); ids.add(m.b); });
    return ids;
  }, [matchResults, dayIndex, state]);

  const items = useMemo(() => {
    const all = teams ?? [];
    const filtered = all.filter(team => relevantIds.has(team.id));
    const base = filtered.length > 0 ? filtered : all;
    return [...base].sort((a, b) => {
      const heldA = (portfolio[a.id] ?? 0) > 0 ? 1 : 0;
      const heldB = (portfolio[b.id] ?? 0) > 0 ? 1 : 0;
      return heldB - heldA;
    });
  }, [teams, portfolio, relevantIds]);

  const doubled = [...items, ...items];

  // Don't render the ticker wrap at all while items aren't loaded yet.
  // Avoids an invisible 30px bar AND ensures the CSS animation starts only
  // once real content is present (iOS Safari won't animate an empty element).
  if (doubled.length === 0) return null;

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
