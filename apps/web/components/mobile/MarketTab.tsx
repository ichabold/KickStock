'use client';

import { useState, useMemo } from 'react';
import { NATIONS, GROUPS } from '@kickstock/constants';
import NationCard from '@/components/shared/NationCard';
import TradeModal from '@/components/shared/TradeModal';
import NationDetailOverlay from '@/components/shared/NationDetailOverlay';
import type { Nation, TradeMode, SortBy } from '@kickstock/types';
import { useGameStore } from '@/stores/gameStore';
import styles from './MarketTab.module.css';

export default function MarketTab() {
  const [filter,   setFilter]   = useState('');
  const [group,    setGroup]    = useState('ALL');
  const [sortBy,   setSortBy]   = useState<SortBy>('default');
  const [modal,    setModal]    = useState<{ nation: Nation; mode: TradeMode } | null>(null);
  const [nationId, setNationId] = useState<string | null>(null);

  const prices     = useGameStore(s => s.prices);
  const portfolio  = useGameStore(s => s.portfolio);
  const eliminated = useGameStore(s => s.eliminated);

  const SORTS: { id: SortBy; label: string }[] = [
    { id: 'default',    label: 'DEFAULT'  },
    { id: 'price_desc', label: 'PRIX ▼'  },
    { id: 'price_asc',  label: 'PRIX ▲'  },
    { id: 'change',     label: 'PERF %'  },
    { id: 'held',       label: 'PORTEFEUILLE' },
  ];

  const filtered = useMemo(() => {
    let list = NATIONS.filter(n =>
      (group === 'ALL' || n.group === group) &&
      (filter === '' || n.name.toLowerCase().includes(filter.toLowerCase()) || n.id.toLowerCase().includes(filter.toLowerCase()))
    );

    switch (sortBy) {
      case 'price_desc': list = [...list].sort((a, b) => (prices[b.id] ?? 0) - (prices[a.id] ?? 0)); break;
      case 'price_asc':  list = [...list].sort((a, b) => (prices[a.id] ?? 0) - (prices[b.id] ?? 0)); break;
      case 'change':     list = [...list].sort((a, b) => {
        const pctA = ((prices[a.id] ?? a.p) - a.p) / a.p;
        const pctB = ((prices[b.id] ?? b.p) - b.p) / b.p;
        return pctB - pctA;
      }); break;
      case 'held': list = [...list].sort((a, b) => (portfolio[b.id] ?? 0) - (portfolio[a.id] ?? 0)); break;
    }

    return list;
  }, [filter, group, sortBy, prices, portfolio]);

  return (
    <>
      <div>
        <div className={styles.filters}>
          <input
            className={styles.search}
            placeholder="Rechercher…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <div className={styles.groups}>
            {GROUPS.map(g => (
              <button
                key={g}
                className={`${styles.gp} ${group === g ? styles.gpOn : ''}`}
                onClick={() => setGroup(g)}
              >{g}</button>
            ))}
          </div>
        </div>

        <div className={styles.sortRow}>
          {SORTS.map(s => (
            <button
              key={s.id}
              className={`${styles.sortBtn} ${sortBy === s.id ? styles.sortBtnOn : ''}`}
              onClick={() => setSortBy(s.id)}
            >{s.label}</button>
          ))}
        </div>

        <div className={styles.grid}>
          {filtered.map(n => (
            <NationCard
              key={n.id}
              nation={n}
              onBuy={() => setModal({ nation: n, mode: 'buy' })}
              onSell={() => setModal({ nation: n, mode: 'sell' })}
              onCardClick={() => setNationId(n.id)}
            />
          ))}
        </div>
      </div>

      {modal && (
        <TradeModal
          nation={modal.nation}
          initMode={modal.mode}
          onClose={() => setModal(null)}
        />
      )}

      {nationId && (
        <NationDetailOverlay
          nationId={nationId}
          onClose={() => setNationId(null)}
        />
      )}
    </>
  );
}
