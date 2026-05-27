'use client';

import { useState, useEffect } from 'react';
import { useGameStore, fmt } from '@/stores/gameStore';
import { useValidateMechanics } from '@/hooks/useValidateMechanics';
import { usePortfolioTotals } from '@/components/mechanics';
import Ticker from '@/components/shared/Ticker';
import { Suspense } from 'react';
import AuthWidget from '@/components/shared/AuthWidget';
import GuestModal from '@/components/auth/GuestModal';
import WelcomeModal from '@/components/auth/WelcomeModal';
import { useAuth } from '@/hooks/useAuth';
import MarketTab from './MarketTab';
import ScheduleTab from './ScheduleTab';
import PortfolioTab from './PortfolioTab';
import SimulateTab from './SimulateTab';
import StandingsTab from './StandingsTab';
import BottomNav from './BottomNav';
import styles from './MobileShell.module.css';
import type { TabId } from '@kickstock/types';
import { CALENDAR } from '@kickstock/constants';

export default function MobileShell() {
  const [tab, setTab]         = useState<TabId>('schedule');
  const { user: mobileUser }  = useAuth();

  useEffect(() => {
    useGameStore.getState().startSync();
    return () => useGameStore.getState().stopSync();
  }, []);

  // Cross-device sync: load server state when a registered user logs in
  const syncUser = useGameStore(s => (s as { syncFromServer?: () => Promise<void> }).syncFromServer);
  useEffect(() => {
    if (mobileUser) syncUser?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileUser?.id]);

  // Pattern 3 — validate at mount that this shell covers all required mechanics
  useValidateMechanics({
    canViewNationPrice: true,
    canBuy:             true,
    canSell:            true,
    canViewPortfolio:   true,
    canViewCash:        true,
    canViewPnL:         true,
    canSimulate:        true,
    canViewStandings:   true,
    canViewSchedule:    true,
  }, 'MobileShell');

  // usePortfolioTotals — mechanic hook, same formula as BrowserShell topbar
  const { cash, totalVal: totVal, pl } = usePortfolioTotals();

  const dayIndex = useGameStore(s => s.dayIndex);
  const champion = useGameStore(s => s.champion);

  const day = CALENDAR[dayIndex];
  const totalDays = CALENDAR.length;
  const progressPct = Math.min(100, (dayIndex / Math.max(1, totalDays)) * 100);

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

      {/* TOURNAMENT PROGRESS */}
      <div className={styles.progress} title={`Journée ${dayIndex + 1} / ${totalDays}`}>
        <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
      </div>

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

      <GuestModal onDone={() => {}} />
      <Suspense><WelcomeModal /></Suspense>

      {/* BOTTOM NAV */}
      <BottomNav
        active={tab}
        onChange={setTab}
        onPlay={() => setTab('simulate')}
      />
    </div>
  );
}
