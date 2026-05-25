'use client';

import { useState } from 'react';
import { CALENDAR, NATIONS } from '@kickstock/constants';
import { useGameStore, fmt, buildMatchesForCurrentDay } from '@/stores/gameStore';
import type { StoredMatchResult } from '@kickstock/types';
import styles from './PlayButton.module.css';

const gN = (id: string) => NATIONS.find(n => n.id === id);

interface Props {
  onDone: () => void;
}

export default function SimulateTab({ onDone }: Props) {
  const [results, setResults]   = useState<StoredMatchResult[] | null>(null);
  const [loading, setLoading]   = useState(false);

  const dayIndex   = useGameStore(s => s.dayIndex);
  const advanceDay = useGameStore(s => s.advanceDay);
  const resetGame  = useGameStore(s => s.resetGame);
  const prices     = useGameStore(s => s.prices);
  const portfolio  = useGameStore(s => s.portfolio);
  const state      = useGameStore(s => s);

  const day     = CALENDAR[dayIndex];
  const matches = day ? buildMatchesForCurrentDay(state) : [];

  // Exposure for today's matches
  const exposure = matches.reduce((acc, m) => {
    return acc + (portfolio[m.a] ?? 0) * (prices[m.a] ?? 0)
               + (portfolio[m.b] ?? 0) * (prices[m.b] ?? 0);
  }, 0);

  function play() {
    setLoading(true);
    setTimeout(() => {
      const res = advanceDay();
      setResults(res ? res.results : []);
      setLoading(false);
    }, 300);
  }

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

  // ── Results view ──────────────────────────────────────────────────────────
  if (results !== null) {
    const divResults = results.filter(r => r.divCash > 0);

    return (
      <div className={styles.wrap}>
        <div className={styles.resultsTitle}>{day.label}</div>
        <div className={styles.results}>
          {results.map(r => {
            const nA = gN(r.a);
            const nB = gN(r.b);
            return (
              <div key={`${r.a}-${r.b}`} className={`${styles.result} ${r.isUpset ? styles.upset : ''}`}>
                <span className={styles.rTeam}>{nA?.flag} {nA?.name}</span>
                <span className={styles.rScore}>
                  {r.scoreA} — {r.scoreB}
                  {r.penWinner && <span className={styles.rExtra}> ({r.penA}–{r.penB} P)</span>}
                  {r.etRes && !r.penWinner && <span className={styles.rExtra}> AET</span>}
                </span>
                <span className={styles.rTeam}>{nB?.flag} {nB?.name}</span>
                {r.elimId && (
                  <span className={styles.elimNote}>💀 {gN(r.elimId)?.name} éliminé</span>
                )}
                {r.isUpset && <span className={styles.upsetNote}>🚀 UPSET!</span>}
              </div>
            );
          })}
        </div>

        {divResults.length > 0 && (
          <div className={styles.divSection}>
            <div className={styles.divTitle}>🎁 DIVIDENDES REÇUS</div>
            {divResults.map(r => (
              <div key={r.a + r.b} className={styles.divRow}>
                <span>{gN(r.winnerId ?? r.a)?.flag} {gN(r.winnerId ?? r.a)?.name}</span>
                <span className={styles.divAmount}>+{fmt(r.divCash)} KC</span>
              </div>
            ))}
          </div>
        )}

        <button className={styles.doneBtn} onClick={() => { setResults(null); onDone(); }}>
          VOIR LE CALENDRIER →
        </button>
      </div>
    );
  }

  // ── Pre-simulate view ─────────────────────────────────────────────────────
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
                <span className={styles.mpName}>{nA?.name}</span>
                <span className={styles.mpVs}>VS</span>
                <span className={styles.mpName}>{nB?.name}</span>
                <span className={styles.mpFlag}>{nB?.flag}</span>
                {m.venue && <span className={styles.mpVenue}>📍 {m.venue}</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.matchCount}>Phase KO — matchs à venir</div>
      )}

      <button className={styles.playBtn} onClick={play} disabled={loading}>
        {loading ? '⏳ SIMULATION…' : '⚡ SIMULER CE JOUR'}
      </button>
    </div>
  );
}
