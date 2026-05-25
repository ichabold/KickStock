'use client';

// Legacy component — replaced by SimulateTab.tsx
// Kept for reference; not rendered in MobileShell.

import { useState } from 'react';
import { CALENDAR, NATIONS } from '@kickstock/constants';
import { fmt } from '@kickstock/game-engine';
import { useGameStore } from '@/stores/gameStore';
import type { StoredMatchResult } from '@kickstock/types';
import styles from './PlayButton.module.css';

interface Props {
  onDone: () => void;
}

const gN = (id: string) => NATIONS.find(n => n.id === id);

export default function PlayButton({ onDone }: Props) {
  const [results, setResults] = useState<StoredMatchResult[] | null>(null);
  const [loading, setLoading] = useState(false);

  const dayIndex   = useGameStore(s => s.dayIndex);
  const advanceDay = useGameStore(s => s.advanceDay);
  const resetGame  = useGameStore(s => s.resetGame);

  const day = CALENDAR[dayIndex];

  async function play() {
    setLoading(true);
    const res = await advanceDay();
    if (res) setResults(res.results);
    setLoading(false);
  }

  if (!day) {
    return (
      <div className={styles.wrap}>
        <div className={styles.trophy}>🏆</div>
        <div className={styles.title}>TOURNOI TERMINÉ</div>
        <button className={styles.resetBtn} onClick={resetGame}>NOUVELLE PARTIE</button>
      </div>
    );
  }

  if (results) {
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
                <span className={styles.rTeam}>{nA?.flag} {nA?.name}</span>
                <span className={styles.rScore}>{r.scoreA} — {r.scoreB}</span>
                <span className={styles.rTeam}>{nB?.flag} {nB?.name}</span>
                {r.elimId && <span className={styles.elimNote}>💀 {gN(r.elimId)?.name} éliminé</span>}
                {r.isUpset && <span className={styles.upsetNote}>⚡ UPSET!</span>}
              </div>
            );
          })}
        </div>
        {divResults.length > 0 && (
          <div className={styles.divSection}>
            <div className={styles.divTitle}>💰 DIVIDENDES REÇUS</div>
            {divResults.map((r, i) => (
              <div key={i} className={styles.divRow}>
                <span>{gN(r.winnerId ?? r.a)?.flag} {gN(r.winnerId ?? r.a)?.name}</span>
                <span className={styles.divAmount}>+{fmt(r.divCash)} KC</span>
              </div>
            ))}
          </div>
        )}
        <button className={styles.doneBtn} onClick={onDone}>VOIR LE MARCHÉ →</button>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.dayLabel}>{day.label}</div>
      <div className={styles.phase}>{day.phase}</div>
      <div className={styles.matchCount}>
        {day.matches.length > 0 ? `${day.matches.length} match${day.matches.length > 1 ? 's' : ''}` : 'Phase KO'}
      </div>
      <button className={styles.playBtn} onClick={play} disabled={loading}>
        {loading ? '⏳ SIMULATION…' : '▶ JOUER CE JOUR'}
      </button>
    </div>
  );
}
