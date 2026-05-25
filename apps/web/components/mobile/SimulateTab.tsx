'use client';

import { useState } from 'react';
import { CALENDAR, NATIONS } from '@kickstock/constants';
import { useGameStore, fmt, buildMatchesForCurrentDay } from '@/stores/gameStore';
import type { StoredMatchResult } from '@kickstock/types';
import MatchAnimation from './MatchAnimation';
import styles from './PlayButton.module.css';

const gN = (id: string) => NATIONS.find(n => n.id === id);

interface Props {
  onDone: () => void;
}

type View = 'pre' | 'animating' | 'done';

export default function SimulateTab({ onDone }: Props) {
  const [view,    setView]    = useState<View>('pre');
  const [results, setResults] = useState<StoredMatchResult[]>([]);

  const dayIndex   = useGameStore(s => s.dayIndex);
  const advanceDay = useGameStore(s => s.advanceDay);
  const resetGame  = useGameStore(s => s.resetGame);
  const prices     = useGameStore(s => s.prices);
  const portfolio  = useGameStore(s => s.portfolio);
  const state      = useGameStore(s => s);

  const day     = CALENDAR[dayIndex];
  const matches = day ? buildMatchesForCurrentDay(state) : [];

  const exposure = matches.reduce((acc, m) =>
    acc + (portfolio[m.a] ?? 0) * (prices[m.a] ?? 0)
        + (portfolio[m.b] ?? 0) * (prices[m.b] ?? 0),
  0);

  // ── Tournament finished ────────────────────────────────────────────────────
  if (!day) {
    return (
      <div className={styles.wrap}>
        <div className={styles.trophy}>🏆</div>
        <div className={styles.title}>TOURNOI TERMINÉ</div>
        <button className={styles.resetBtn} onClick={resetGame}>NOUVELLE PARTIE</button>
      </div>
    );
  }

  // ── Match animation ────────────────────────────────────────────────────────
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

  // ── Post-simulate results ──────────────────────────────────────────────────
  if (view === 'done') {
    const divResults = results.filter(r => r.divCash > 0);
    return (
      <div className={styles.wrap}>
        <div className={styles.resultsTitle}>{day.label}</div>
        <div className={styles.results}>
          {results.map((r, i) => {
            const nA = gN(r.a);
            const nB = gN(r.b);
            return (
              <div key={i} className={`${styles.result} ${r.isUpset ? styles.upset : ''}`}>
                <span className={styles.rTeam} style={{ color: r.res === 'A' ? 'var(--gold)' : 'var(--muted)' }}>
                  {nA?.flag} {nA?.name?.toUpperCase()}
                </span>
                <span className={styles.rScore}>
                  {r.scoreA}–{r.scoreB}
                  {r.penWinner && <span className={styles.rExtra}> ({r.penA}–{r.penB} P)</span>}
                  {r.etRes && !r.penWinner && <span className={styles.rExtra}> AET</span>}
                </span>
                <span className={styles.rTeam} style={{ color: r.res === 'B' ? 'var(--gold)' : 'var(--muted)' }}>
                  {nB?.flag} {nB?.name?.toUpperCase()}
                </span>
                {r.elimId && <span className={styles.elimNote}>💀 {gN(r.elimId)?.name?.toUpperCase()} ÉLIMINÉ</span>}
                {r.isUpset && <span className={styles.upsetNote}>🚀 UPSET!</span>}
              </div>
            );
          })}
        </div>

        {divResults.length > 0 && (
          <div className={styles.divSection}>
            <div className={styles.divTitle}>🎁 DIVIDENDES REÇUS</div>
            {divResults.map((r, i) => (
              <div key={i} className={styles.divRow}>
                <span>{gN(r.winnerId ?? r.a)?.flag} {gN(r.winnerId ?? r.a)?.name?.toUpperCase()}</span>
                <span className={styles.divAmount}>+{fmt(r.divCash)} KC</span>
              </div>
            ))}
          </div>
        )}

        <button className={styles.doneBtn} onClick={() => { setView('pre'); onDone(); }}>
          VOIR LE CALENDRIER →
        </button>
      </div>
    );
  }

  // ── Pre-simulate view ──────────────────────────────────────────────────────
  function play() {
    const res = advanceDay();
    if (res && res.results.length > 0) {
      setResults(res.results);
      setView('animating');
    } else {
      setView('pre');
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.dayLabel}>{day.label}</div>
      <div className={styles.phase}>{day.phase}</div>

      {exposure > 0 && (
        <div className={styles.exposureBar}>
          <span className={styles.expLbl}>⚡ EXPOSITION</span>
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
                <span className={styles.mpName}>{nA?.name?.toUpperCase()}</span>
                <span className={styles.mpVs}>VS</span>
                <span className={styles.mpName}>{nB?.name?.toUpperCase()}</span>
                <span className={styles.mpFlag}>{nB?.flag}</span>
                {m.venue && <span className={styles.mpVenue}>📍 {m.venue}</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.matchCount}>Phase KO — matchs à venir</div>
      )}

      <button className={styles.playBtn} onClick={play}>
        ⚡ SIMULER CE JOUR
      </button>
    </div>
  );
}
