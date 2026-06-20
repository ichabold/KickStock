'use client';

/**
 * StandingsCard — readable group standings card.
 * Replaces the inline-styled group rows in StandingsTab.tsx.
 */
import { pctOf } from '@kickstock/game-engine';
import { useGameStore } from '@/stores/gameStore';
import type { StandingRow } from '@kickstock/game-engine';
import styles from './StandingsCard.module.css';

interface Props {
  group: string;
  teams: StandingRow[];
  matchday: string;
  onNationClick: (id: string) => void;
}

export default function StandingsCard({ group, teams, matchday, onNationClick }: Props) {
  const portfolio    = useGameStore(s => s.portfolio);
  const priceHistory = useGameStore(s => s.priceHistory);

  return (
    <section className={styles.card} aria-label={`Group ${group} standings`}>
      <header className={styles.head}>
        <h3 className={styles.title}>Group {group}</h3>
        <span className={styles.md}>{matchday}</span>
      </header>

      <ol className={styles.list}>
        {teams.map((t, i) => {
          const hist    = priceHistory[t.id] ?? [];
          const rawPrev = hist.length >= 2 ? hist[hist.length - 2] : null;
          const prevP   = (rawPrev != null && rawPrev > 0) ? rawPrev : t.initP;
          const ch      = pctOf(t.price, prevP);
          const isQ    = i < 2;
          const held   = (portfolio[t.id] ?? 0) > 0;
          const upDown = ch >= 0 ? 'up' : 'dn';

          return (
            <li
              key={t.id}
              className={`${styles.row} ${isQ ? styles.qualified : ''} ${t.elim ? styles.eliminated : ''}`}
            >
              <span className={styles.pos}>{i + 1}</span>
              <span className={styles.flag} aria-hidden>{t.flag}</span>
              <button
                className={styles.name}
                onClick={() => onNationClick(t.id)}
              >
                <span>{t.name}{t.elim ? ' · OUT' : ''}</span>
                {held && !t.elim && <span className={styles.heldDot} title="In portfolio" />}
              </button>
              <span className={styles.record}>
                {t.w}·{t.d}·{t.l}
                <strong> {t.pts} pts</strong>
              </span>
              <span className={`${styles.price} ${styles[upDown]}`}>
                {Math.round(t.price)}
                <small> {ch === 0 ? '▶' : ch > 0 ? '▲' : '▼'}{Math.abs(ch)}%</small>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
