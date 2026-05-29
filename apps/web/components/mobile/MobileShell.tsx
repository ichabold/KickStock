'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useGameStore, fmt } from '@/stores/gameStore';
import { useValidateMechanics } from '@/hooks/useValidateMechanics';
import { usePortfolioTotals } from '@/components/mechanics';
import Ticker from '@/components/shared/Ticker';
import { Suspense } from 'react';
import AuthWidget from '@/components/shared/AuthWidget';
import GuestModal from '@/components/auth/GuestModal';
import WelcomeModal from '@/components/auth/WelcomeModal';
import CoachMarkOverlay from '@/components/shared/CoachMarkOverlay';
import { useAuth } from '@/hooks/useAuth';
import MarketTab from './MarketTab';
import ScheduleTab from './ScheduleTab';
import PortfolioTab from './PortfolioTab';
import SimulateTab from './SimulateTab';
import LiveTab from './LiveTab';
import StandingsTab from './StandingsTab';
import BottomNav from './BottomNav';
import styles from './MobileShell.module.css';
import type { TabId } from '@kickstock/types';
import { useGameMode } from '@/hooks/useGameMode';

export default function MobileShell() {
  const t = useTranslations('shell');
  const [tab, setTab]         = useState<TabId>('schedule');
  const [showTut, setShowTut] = useState(false);
  const { user: mobileUser }  = useAuth();

  useEffect(() => {
    useGameStore.getState().startSync();
    return () => useGameStore.getState().stopSync();
  }, []);

  useEffect(() => {
    function handleShowTut() {
      localStorage.setItem('kickstock_seen_tutorial', '1');
      setTab('market');
      setShowTut(true);
    }
    window.addEventListener('kickstock:show-tutorial', handleShowTut);
    return () => window.removeEventListener('kickstock:show-tutorial', handleShowTut);
  }, []);

  const syncUser = useGameStore(s => (s as { syncFromServer?: () => Promise<void> }).syncFromServer);
  useEffect(() => {
    if (mobileUser) syncUser?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileUser?.id]);

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

  const { cash, totalVal: totVal, pl } = usePortfolioTotals();

  const dayIndex  = useGameStore(s => s.dayIndex);
  const champion  = useGameStore(s => s.champion);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bootstrap = useGameStore(s => (s as any)._bootstrap);
  const { mode }  = useGameMode();
  const isOnline  = mode === 'online';

  const day       = bootstrap?.days?.find((d: { day_index: number }) => d.day_index === dayIndex) ?? null;
  const totalDays = bootstrap?.days?.length ?? 34;
  const progressPct = Math.min(100, (dayIndex / Math.max(1, totalDays)) * 100);

  return (
    <div className={styles.shell}>
      {/* HEADER */}
      <header className={styles.header}>
        <span className={styles.logo}>KICKSTOCK</span>
        <div className={styles.stats}>
          <div className={styles.stat} data-coach="cash-stat">
            <div className={styles.statLbl}>{t('cash')}</div>
            <div className={styles.statVal}>{fmt(cash)}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLbl}>{t('total')}</div>
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
      <div className={styles.progress} title={`${dayIndex + 1} / ${totalDays}`}>
        <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
      </div>

      {/* STATUS BAR */}
      <div className={styles.statusBar}>
        <span className={styles.statusDay}>
          {!day
            ? champion
              ? t('tournamentEndedChampion', { champion })
              : t('tournamentEnded')
            : day.full_label}
        </span>
        {day && (
          <span className={`${styles.pill} ${day.is_ko ? styles.pillKO : styles.pillGroup}`}>
            {day.phase}
          </span>
        )}
        {isOnline && (
          <span style={{ fontSize: 9, color: 'var(--gain)', fontWeight: 700, letterSpacing: 1, marginLeft: 4 }}>
            ● LIVE
          </span>
        )}
      </div>

      {/* CONTENT */}
      <main className={styles.scroll}>
        {tab === 'schedule'  && <ScheduleTab />}
        {tab === 'standings' && <StandingsTab />}
        {tab === 'simulate'  && (isOnline
          ? <LiveTab />
          : <SimulateTab onDone={() => setTab('schedule')} />
        )}
        {tab === 'market'    && <MarketTab />}
        {tab === 'portfolio' && <PortfolioTab />}
      </main>

      <GuestModal onDone={() => {}} />
      <Suspense><WelcomeModal /></Suspense>
      {showTut && <CoachMarkOverlay shell="mobile" onDone={() => setShowTut(false)} />}

      {/* BOTTOM NAV */}
      <BottomNav
        active={tab}
        onChange={setTab}
        onPlay={() => setTab('simulate')}
        isOnline={isOnline}
      />
    </div>
  );
}
