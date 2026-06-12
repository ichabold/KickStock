'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import NationCard from '@/components/shared/NationCard';
import TradeModal from '@/components/shared/TradeModal';
import NationDetailOverlay from '@/components/shared/NationDetailOverlay';
import type { Nation, TradeMode, SortBy, TeamMeta, BootstrapData } from '@kickstock/types';

function teamToNation(t: TeamMeta): Nation {
  return { id: t.id, name: t.name, flag: t.flag, p: t.initialPrice, conf: t.confederation ?? '', str: t.strength, group: t.group };
}
import { useGameStore } from '@/stores/gameStore';
import styles from './MarketTab.module.css';

export default function MarketTab() {
  const t  = useTranslations('market');
  const tc = useTranslations('common');
  const [filter,   setFilter]   = useState('');
  const [group,    setGroup]    = useState('ALL');
  const [sortBy,   setSortBy]   = useState<SortBy>('alpha');
  const [modal,    setModal]    = useState<{ nation: Nation; mode: TradeMode } | null>(null);
  const [nationId, setNationId] = useState<string | null>(null);

  const prices     = useGameStore(s => s.prices);
  const portfolio  = useGameStore(s => s.portfolio);
  const eliminated = useGameStore(s => s.eliminated);
  const txLog      = useGameStore(s => s.txLog);
  const teams     = useGameStore(s => s._teams);
  const bootstrap = useGameStore(s => s._bootstrap);

  const isFirstRun = Object.values(portfolio).every(q => q === 0) && txLog.length === 0;

  // Derive group codes from bootstrap teams (e.g. "Stage - Group A")
  const groupCodes = useMemo(() => {
    return [...new Set(teams.map(t => t.group).filter(Boolean))].sort();
  }, [teams]);

  const SORTS: { id: SortBy; label: string }[] = [
    { id: 'alpha',      label: t('sortAlpha')     },
    { id: 'price_asc',  label: t('sortPriceAsc')  },
    { id: 'price_desc', label: t('sortPriceDesc') },
  ];

  const filtered = useMemo(() => {
    let list = teams.filter(n =>
      (group === 'ALL' || n.group === group) &&
      (filter === '' || n.name.toLowerCase().includes(filter.toLowerCase()) || n.id.toLowerCase().includes(filter.toLowerCase()))
    );

    switch (sortBy) {
      case 'alpha':      list = list.slice().sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'price_desc': list = list.slice().sort((a, b) => (prices[b.id] ?? b.initialPrice) - (prices[a.id] ?? a.initialPrice)); break;
      case 'price_asc':  list = list.slice().sort((a, b) => (prices[a.id] ?? a.initialPrice) - (prices[b.id] ?? b.initialPrice)); break;
    }
    return list;
  }, [teams, group, filter, sortBy, prices]);

  // (modal.nation already holds the full Nation object)

  if (!bootstrap) {
    return <div style={{ padding: 24, color: 'var(--muted)', textAlign: 'center' }}>{tc('loading')}</div>;
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
        <button
          className={`${styles.groupBtn} ${group === 'ALL' ? styles.groupActive : ''}`}
          onClick={() => setGroup('ALL')}
        >
          {t('groupAll')}
        </button>
        <span className={styles.groupLabel}>{t('groupsLabel')}</span>
        {groupCodes.map(g => (
          <button
            key={g}
            className={`${styles.groupBtn} ${group === g ? styles.groupActive : ''}`}
            onClick={() => setGroup(g)}
          >
            {g.slice(-1)}
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
            nation={teamToNation(n)}
            onBuy={() => setModal({ nation: teamToNation(n), mode: 'buy' })}
            onSell={() => setModal({ nation: teamToNation(n), mode: 'sell' })}
            onCardClick={() => setNationId(n.id)}
          />
        ))}
        {filtered.length === 0 && eliminated.length > 0 && (
          <div style={{ color: 'var(--muted)', padding: '24px 0', textAlign: 'center', fontSize: 12 }}>
            {t('allEliminated')}
          </div>
        )}
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
    </div>
  );
}
