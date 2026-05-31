'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import NationCard from '@/components/shared/NationCard';
import TradeModal from '@/components/shared/TradeModal';
import NationDetailOverlay from '@/components/shared/NationDetailOverlay';
import type { TradeMode, SortBy, TeamMeta, BootstrapData } from '@kickstock/types';
import { useGameStore } from '@/stores/gameStore';
import styles from './MarketTab.module.css';

export default function MarketTab() {
  const t = useTranslations('market');
  const [filter,   setFilter]   = useState('');
  const [group,    setGroup]    = useState('ALL');
  const [sortBy,   setSortBy]   = useState<SortBy>('default');
  const [modal,    setModal]    = useState<{ teamId: string; mode: TradeMode } | null>(null);
  const [nationId, setNationId] = useState<string | null>(null);

  const prices     = useGameStore(s => s.prices);
  const portfolio  = useGameStore(s => s.portfolio);
  const eliminated = useGameStore(s => s.eliminated);
  const txLog      = useGameStore(s => s.txLog);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teams      = useGameStore(s => (s as any)._teams)     as TeamMeta[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bootstrap  = useGameStore(s => (s as any)._bootstrap) as BootstrapData | null;

  const isFirstRun = Object.values(portfolio).every(q => q === 0) && txLog.length === 0;

  // Derive groups from bootstrap teams
  const groups = useMemo(() => {
    const codes = [...new Set(teams.map(t => t.group).filter(Boolean))].sort();
    return ['ALL', ...codes];
  }, [teams]);

  const SORTS: { id: SortBy; label: string }[] = [
    { id: 'default',    label: t('sortDefault')   },
    { id: 'price_desc', label: t('sortPriceDesc') },
    { id: 'price_asc',  label: t('sortPriceAsc')  },
    { id: 'change',     label: t('sortPerf')      },
    { id: 'held',       label: t('sortPortfolio') },
  ];

  const filtered = useMemo(() => {
    let list = teams.filter(n =>
      (group === 'ALL' || n.group === group) &&
      (filter === '' || n.name.toLowerCase().includes(filter.toLowerCase()) || n.id.toLowerCase().includes(filter.toLowerCase()))
    );

    switch (sortBy) {
      case 'price_desc': list = list.slice().sort((a, b) => (prices[b.id] ?? b.initialPrice) - (prices[a.id] ?? a.initialPrice)); break;
      case 'price_asc':  list = list.slice().sort((a, b) => (prices[a.id] ?? a.initialPrice) - (prices[b.id] ?? b.initialPrice)); break;
      case 'change':     list = list.slice().sort((a, b) => {
        const pctA = ((prices[a.id] ?? a.initialPrice) - a.initialPrice) / a.initialPrice;
        const pctB = ((prices[b.id] ?? b.initialPrice) - b.initialPrice) / b.initialPrice;
        return pctB - pctA;
      }); break;
      case 'held': list = list.slice().sort((a, b) => (portfolio[b.id] ?? 0) - (portfolio[a.id] ?? 0)); break;
    }
    return list;
  }, [teams, group, filter, sortBy, prices, portfolio]);

  const modalTeam = modal ? teams.find(t => t.id === modal.teamId) : null;

  if (!bootstrap) {
    return <div style={{ padding: 24, color: 'var(--muted)', textAlign: 'center' }}>Chargement…</div>;
  }

  return (
    <div className={styles.wrap}>
      {isFirstRun && (
        <div className={styles.hint}>{t('hint')}</div>
      )}

      {/* Search */}
      <div className={styles.searchRow}>
        <input
          className={styles.search}
          placeholder={t('searchPlaceholder')}
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      {/* Group filter */}
      <div className={styles.groupRow}>
        {groups.map(g => (
          <button
            key={g}
            className={`${styles.groupBtn} ${group === g ? styles.groupActive : ''}`}
            onClick={() => setGroup(g)}
          >
            {g}
          </button>
        ))}
      </div>

      {/* Sort */}
      <div className={styles.sortRow}>
        {SORTS.map(s => (
          <button
            key={s.id}
            className={`${styles.sortBtn} ${sortBy === s.id ? styles.sortActive : ''}`}
            onClick={() => setSortBy(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Nation cards */}
      <div className={styles.list}>
        {filtered.map(n => (
          <NationCard
            key={n.id}
            nationId={n.id}
            onBuy={() => setModal({ teamId: n.id, mode: 'buy' })}
            onSell={() => setModal({ teamId: n.id, mode: 'sell' })}
            onCardClick={() => setNationId(n.id)}
          />
        ))}
        {filtered.length === 0 && eliminated.length > 0 && (
          <div style={{ color: 'var(--muted)', padding: '24px 0', textAlign: 'center', fontSize: 12 }}>
            {t('allEliminated')}
          </div>
        )}
      </div>

      {modal && modalTeam && (
        <TradeModal
          nationId={modal.teamId}
          mode={modal.mode}
          onClose={() => setModal(null)}
        />
      )}

      {nationId && (
        <NationDetailOverlay
          nationId={nationId}
          onClose={() => setNationId(null)}
        />
      )}
    </div>
  );
}
