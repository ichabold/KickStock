'use client';

/**
 * BottomNav — mobile bottom navigation with SVG icons and FAB-style PLAY button.
 * Replaces the emoji-based nav block in MobileShell.tsx.
 */
import type { TabId } from '@kickstock/types';
import styles from './BottomNav.module.css';

interface Tab {
  id: TabId;
  label: string;
  icon: JSX.Element;
}

const TABS: Tab[] = [
  { id: 'market',    label: 'Market',   icon: <IconChart />     },
  { id: 'schedule',  label: 'Fixtures', icon: <IconCalendar />  },
  { id: 'portfolio', label: 'Portfolio', icon: <IconBriefcase /> },
  { id: 'standings', label: 'Table',    icon: <IconTable />     },
];

interface Props {
  active: TabId;
  onChange: (t: TabId) => void;
  onPlay: () => void;
}

export default function BottomNav({ active, onChange, onPlay }: Props) {
  const left  = TABS.slice(0, 2);
  const right = TABS.slice(2);
  return (
    <nav className={styles.nav} aria-label="Primary">
      {left.map(t => (
        <NavBtn key={t.id} tab={t} active={active === t.id} onClick={() => onChange(t.id)} />
      ))}
      <button
        className={styles.play}
        onClick={onPlay}
        aria-label="Simulate next match-day"
        data-coach="play-btn"
      >
        <IconPlay />
      </button>
      {right.map(t => (
        <NavBtn key={t.id} tab={t} active={active === t.id} onClick={() => onChange(t.id)} />
      ))}
    </nav>
  );
}

function NavBtn({ tab, active, onClick }: { tab: Tab; active: boolean; onClick: () => void }) {
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

/* ── Icons (Lucide-style, 22×22, 1.7 stroke) ── */
const sv = {
  width: 22, height: 22, fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};
function IconChart()     { return <svg viewBox="0 0 24 24" {...sv}><path d="M3 13l4-4 4 4 6-6 4 4" /></svg>; }
function IconCalendar()  { return <svg viewBox="0 0 24 24" {...sv}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>; }
function IconBriefcase() { return <svg viewBox="0 0 24 24" {...sv}><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3"/></svg>; }
function IconTable()     { return <svg viewBox="0 0 24 24" {...sv}><path d="M6 21V9l6-5 6 5v12"/><path d="M10 21v-6h4v6"/></svg>; }
function IconPlay()      { return <svg viewBox="0 0 24 24" fill="#000"><polygon points="6 4 20 12 6 20" /></svg>; }
