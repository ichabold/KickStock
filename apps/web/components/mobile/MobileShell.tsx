'use client';

import { useState, useEffect } from 'react';
import { useGameStore, fmt } from '@/stores/gameStore';
import Ticker from '@/components/shared/Ticker';
import AuthWidget from '@/components/shared/AuthWidget';
import MarketTab from './MarketTab';
import ScheduleTab from './ScheduleTab';
import PortfolioTab from './PortfolioTab';
import SimulateTab from './SimulateTab';
import StandingsTab from './StandingsTab';
import styles from './MobileShell.module.css';
import type { TabId } from '@kickstock/types';
import { CALENDAR } from '@kickstock/constants';

const TABS: { id: TabId; ico: string; label: string; play?: boolean }[] = [
  { id: 'schedule',  ico: '📅', label: 'SCHED.'  },
  { id: 'standings', ico: '🏆', label: 'STNDGS'  },
  { id: 'simulate',  ico: '⚡', label: 'PLAY',  play: true },
  { id: 'market',    ico: '📊', label: 'MARKET'  },
  { id: 'portfolio', ico: '💼', label: 'PORTF.'  },
];

export default function MobileShell() {
  const [tab, setTab] = useState<TabId>('schedule');

  useEffect(() => {
    useGameStore.persist.rehydrate();
  }, []);

  const cash      = useGameStore(s => s.cash);
  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);
  const dayIndex  = useGameStore(s => s.dayIndex);
  const champion  = useGameStore(s => s.champion);

  const portVal = Object.entries(portfolio).reduce(
    (a, [id, q]) => a + q * (prices[id] ?? 0), 0,
  );
  const totVal = cash + portVal;
  const pl     = totVal - 10000;
  const day    = CALENDAR[dayIndex];

  return (
    <div className={styles.shell}>
      {/* HEADER */}
      <header className={styles.header}>
        <span className={styles.logo}>KICKSTOCK</span>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <div className={styles.statLbl}>CASH</div>
            <div className={styles.statVal}>{fmt(cash)}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLbl}>TOTAL</div>
            <div className={styles.statVal} style={{ color: pl >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
              {fmt(totVal)}
            </div>
          </div>
        </div>
        <div className={styles.authArea}>
          <AuthWidget compact />
        </div>
      </header>

      {/* TICKER */}
      <Ticker />

      {/* STATUS BAR */}
      <div className={styles.statusBar}>
        <span className={styles.statusDay}>
          {!day
            ? champion
              ? `🏆 FIN · ${champion}`
              : '🏆 TOURNOI TERMINÉ'
            : day.label}
        </span>
        {day && (
          <span className={`${styles.pill} ${day.isKO ? styles.pillKO : styles.pillGroup}`}>
            {day.phase}
          </span>
        )}
      </div>

      {/* CONTENT */}
      <main className={styles.scroll}>
        {tab === 'schedule'  && <ScheduleTab />}
        {tab === 'standings' && <StandingsTab />}
        {tab === 'simulate'  && <SimulateTab onDone={() => setTab('schedule')} />}
        {tab === 'market'    && <MarketTab />}
        {tab === 'portfolio' && <PortfolioTab />}
      </main>

      {/* BOTTOM NAV */}
      <nav className={styles.nav}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`${styles.navBtn} ${tab === t.id ? styles.navBtnOn : ''} ${t.play ? styles.navBtnPlay : ''}`}
            onClick={() => setTab(t.id)}
            aria-label={t.label}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <span className={styles.navIco}>{t.ico}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
