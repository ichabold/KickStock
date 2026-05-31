'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useGameStore, fmt, buildMatchesForCurrentDay } from '@/stores/gameStore';
import { SimulateButton } from '@/components/mechanics';
import type { StoredMatchResult, BootstrapData, BootstrapDay, TeamMeta } from '@kickstock/types';
import MatchAnimation from './MatchAnimation';
import styles from './PlayButton.module.css';

interface Props {
  onDone: () => void;
}

type View = 'pre' | 'animating' | 'done';

export default function SimulateTab({ onDone }: Props) {
  const t = useTranslations('simulate');
  const [view,    setView]    = useState<View>('pre');
  const [results, setResults] = useState<StoredMatchResult[]>([]);

  const dayIndex  = useGameStore(s => s.dayIndex);
  const resetGame = useGameStore(s => s.resetGame);
  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);
  const state     = useGameStore(s => s);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bootstrap = useGameStore(s => (s as any)._bootstrap) as BootstrapData | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teams     = useGameStore(s => (s as any)._teams)     as TeamMeta[];

  const gN = (id: string) => teams.find(t => t.id === id);

  const day: BootstrapDay | null = bootstrap?.days.find(d => d.day_index === dayIndex) ?? null;
  const matches = day ? buildMatchesForCurrentDay(state) : [];

  const exposure = matches.reduce((acc, m) =>
    acc + (portfolio[m.a] ?? 0) * (prices[m.a] ?? 0)
        + (portfolio[m.b] ?? 0) * (prices[m.b] ?? 0),
  0);

  // ── Tournament finished ─────────────────────────────────────────────────────
  if (!day) {
    return (
      <div className={styles.wrap}>
        <div className={styles.trophy}>🏆</div>
        <div className={styles.title}>{t('tournamentEndedTitle')}</div>
        <button className={styles.resetBtn} onClick={resetGame}>{t('newGameButton')}</button>
      </div>
    );
  }

  // ── Match animation ─────────────────────────────────────────────────────────
  if (view === 'animating') {
    return (
      <MatchAnimation
        results={results}
        portfolio={portfolio}
        prices={prices}
        onDone={() => setView('done')}
      />
    );
  }

  // ── Post-simulate results ───────────────────────────────────────────────────
  if (view === 'done') {
    const divResults = results.filter(r => r.divCash > 0);
    return (
      <div className={styles.wrap}>
        <div className={styles.resultsTitle}>{day.full_label}</div>
        <div className={styles.results}>
          {results.map((r, i) => {
            const nA = gN(r.a);
            const nB = gN(r.b);
            return (
              <div key={i} className={`${styles.result} ${r.isUpset ? styles.upset : ''}`}>
                <span className={styles.rTeam} style={{ color: r.res === 'A' ? 'var(--gold)' : 'var(--muted)' }}>
                  {nA?.flag} {nA?.name?.toUpperCase() ?? r.a}
                </span>
                <span className={styles.rScore}>
                  {r.scoreA}–{r.scoreB}
                  {r.penWinner && <span className={styles.rExtra}> ({r.penA}–{r.penB} P)</span>}
                  {r.etRes && !r.penWinner && <span className={styles.rExtra}> {t('aet')}</span>}
                </span>
                <span className={styles.rTeam} style={{ color: r.res === 'B' ? 'var(--gold)' : 'var(--muted)' }}>
                  {nB?.flag} {nB?.name?.toUpperCase() ?? r.b}
                </span>
                {r.elimId && <span className={styles.elimNote}>{t('eliminated', { nation: gN(r.elimId)?.name?.toUpperCase() ?? r.elimId })}</span>}
                {r.isUpset && <span className={styles.upsetNote}>{t('upset')}</span>}
              </div>
            );
          })}
        </div>

        {divResults.length > 0 && (
          <div className={styles.divSection}>
            <div className={styles.divTitle}>{t('dividendsReceived')}</div>
            {divResults.map((r, i) => (
              <div key={i} className={styles.divRow}>
                <span>{gN(r.winnerId ?? r.a)?.flag} {gN(r.winnerId ?? r.a)?.name?.toUpperCase()}</span>
                <span className={styles.divAmount}>+{fmt(r.divCash)} KC</span>
              </div>
            ))}
          </div>
        )}

        <button className={styles.doneBtn} onClick={() => { setView('pre'); onDone(); }}>
          {t('viewSchedule')}
        </button>
      </div>
    );
  }

  // ── Pre-simulate view ───────────────────────────────────────────────────────
  return (
    <div className={styles.wrap}>
      <div className={styles.dayLabel}>{day.full_label}</div>
      <div className={styles.phase}>{day.phase}</div>

      {exposure > 0 && (
        <div className={styles.exposureBar}>
          <span className={styles.expLbl}>{t('exposure')}</span>
          <span className={styles.expVal}>{fmt(exposure)} KC</span>
        </div>
      )}

      {matches.length > 0 ? (
        <div className={styles.matchList}>
          {matches.map((m, i) => {
            const nA = gN(m.a);
            const nB = gN(m.b);
            const hasA = (portfolio[m.a] ?? 0) > 0;
            const hasB = (portfolio[m.b] ?? 0) > 0;
            return (
              <div key={i} className={`${styles.matchPreview} ${hasA || hasB ? styles.exposed : ''}`}>
                <span className={styles.mpFlag}>{nA?.flag}</span>
                <span className={styles.mpName}>{nA?.name?.toUpperCase() ?? m.a}</span>
                <span className={styles.mpVs}>{t('vs')}</span>
                <span className={styles.mpName}>{nB?.name?.toUpperCase() ?? m.b}</span>
                <span className={styles.mpFlag}>{nB?.flag}</span>
                {m.venue && <span className={styles.mpVenue}>{t('venue', { venue: m.venue })}</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.matchCount}>{t('koUpcoming')}</div>
      )}

      <SimulateButton
        className={styles.playBtn}
        label={t('simulateButton')}
        onResults={res => { setResults(res); setView('animating'); }}
        onNoResults={() => setView('pre')}
      />
    </div>
  );
}
