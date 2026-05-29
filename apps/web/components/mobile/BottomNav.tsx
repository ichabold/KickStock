'use client';

/**
 * BottomNav — mobile bottom navigation.
 *
 * Online mode:  [Market] [Fixtures] [⚡LIVE] [Portfolio] [Table]
 * Offline mode: [Market] [Fixtures] [▶ PLAY] [Portfolio] [Table]
 */
import { useTranslations } from 'next-intl';
import type { TabId } from '@kickstock/types';
import styles from './BottomNav.module.css';

interface Props {
  active:    TabId;
  onChange:  (t: TabId) => void;
  onPlay:    () => void;
  /** When true: central button is the ⚡LIVE tab instead of the simulate FAB */
  isOnline?: boolean;
}

export default function BottomNav({ active, onChange, onPlay, isOnline = false }: Props) {
  const t = useTranslations('nav');

  const TABS = [
    { id: 'market'    as TabId, label: t('market'),    icon: <IconChart />     },
    { id: 'schedule'  as TabId, label: t('fixtures'),  icon: <IconCalendar />  },
    { id: 'portfolio' as TabId, label: t('portfolio'), icon: <IconBriefcase /> },
    { id: 'standings' as TabId, label: t('table'),     icon: <IconTable />     },
  ];

  const left  = TABS.slice(0, 2);
  const right = TABS.slice(2);

  return (
    <nav className={styles.nav} aria-label="Primary">
      {left.map(tab => (
        <NavBtn key={tab.id} tab={tab} active={active === tab.id} onClick={() => onChange(tab.id)} />
      ))}

      {isOnline ? (
        // Online mode: LIVE tab (pulsing indicator)
        <button
          className={`${styles.play} ${active === 'simulate' ? styles.playActive : ''}`}
          onClick={() => onChange('simulate')}
          aria-label="Live matches"
          data-coach="live-btn"
        >
          <IconLive />
        </button>
      ) : (
        // Offline mode: simulate FAB
        <button
          className={styles.play}
          onClick={onPlay}
          aria-label="Simulate next match-day"
          data-coach="play-btn"
        >
          <IconPlay />
        </button>
      )}

      {right.map(tab => (
        <NavBtn key={tab.id} tab={tab} active={active === tab.id} onClick={() => onChange(tab.id)} />
      ))}
    </nav>
  );
}

function NavBtn({ tab, active, onClick }: { tab: { id: TabId; label: string; icon: JSX.Element }; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`${styles.btn} ${active ? styles.on : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      {tab.icon}
      <span>{tab.label}</span>
    </button>
  );
}

/* ── Icons ── */
const sv = {
  width: 22, height: 22, fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};
function IconChart()     { return <svg viewBox="0 0 24 24" {...sv}><path d="M3 13l4-4 4 4 6-6 4 4" /></svg>; }
function IconCalendar()  { return <svg viewBox="0 0 24 24" {...sv}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>; }
function IconBriefcase() { return <svg viewBox="0 0 24 24" {...sv}><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3"/></svg>; }
function IconTable()     { return <svg viewBox="0 0 24 24" {...sv}><path d="M6 21V9l6-5 6 5v12"/><path d="M10 21v-6h4v6"/></svg>; }
function IconPlay()      { return <svg viewBox="0 0 24 24" fill="#000"><polygon points="6 4 20 12 6 20" /></svg>; }
function IconLive()      {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
      <path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 17.7a8 8 0 0 0 0-11.4" />
      <path d="M8.8 8.8a5 5 0 0 0 0 6.4M15.2 15.2a5 5 0 0 0 0-6.4" />
    </svg>
  );
}
