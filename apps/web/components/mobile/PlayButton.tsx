'use client';

import { useState } from 'react';
import { CALENDAR, NATIONS } from '@kickstock/constants';
import { useGameStore } from '@/stores/gameStore';
import styles from './PlayButton.module.css';

interface Props {
  onDone: () => void;
}

interface MatchSummary {
  matchId: string;
  teamA: string;
  teamB: string;
  scoreA: number;
  scoreB: number;
  res: string;
  isUpset: boolean;
  newPriceA: number;
  newPriceB: number;
  elimId: string | null;
}

const gN = (id: string) => NATIONS.find(n => n.id === id);

export default function PlayButton({ onDone }: Props) {
  const [results, setResults]   = useState<MatchSummary[] | null>(null);
  const [dividends, setDividends] = useState<{ nationId: string; amount: number }[]>([]);
  const [loading, setLoading]   = useState(false);

  const dayIndex   = useGameStore(s => s.dayIndex);
  const advanceDay = useGameStore(s => s.advanceDay);
  const resetGame  = useGameStore(s => s.resetGame);

  const day = CALENDAR[dayIndex];

  function play() {
    setLoading(true);
    setTimeout(() => {
      const res = advanceDay();
      if (res) {
        setResults(res.results);
        setDividends(res.dividends);
      }
      setLoading(false);
    }, 300);
  }

  if (!day) {
    return (
      <div className={styles.wrap}>
        <div className={styles.trophy}>🏆</div>
        <div className={styles.title}>TOURNOI TERMINÉ</div>
        <button className={styles.resetBtn} onClick={resetGame}>
          NOUVELLE PARTIE
        </button>
      </div>
    );
  }

  if (results) {
    return (
      <div className={styles.wrap}>
        <div className={styles.resultsTitle}>{day.label}</div>
        <div className={styles.results}>
          {results.map(r => {
            const nA = gN(r.teamA);
            const nB = gN(r.teamB);
            return (
              <div key={r.matchId} className={`${styles.result} ${r.isUpset ? styles.upset : ''}`}>
                <span className={styles.rTeam}>{nA?.flag} {nA?.name}</span>
                <span className={styles.rScore}>{r.scoreA} — {r.scoreB}</span>
                <span className={styles.rTeam}>{nB?.flag} {nB?.name}</span>
                {r.elimId && (
                  <span className={styles.elimNote}>
                    💀 {gN(r.elimId)?.name} éliminé
                  </span>
                )}
                {r.isUpset && <span className={styles.upsetNote}>⚡ UPSET!</span>}
              </div>
            );
          })}
        </div>

        {dividends.length > 0 && (
          <div className={styles.divSection}>
            <div className={styles.divTitle}>💰 DIVIDENDES REÇUS</div>
            {dividends.map(d => (
              <div key={d.nationId} className={styles.divRow}>
                <span>{gN(d.nationId)?.flag} {gN(d.nationId)?.name}</span>
                <span className={styles.divAmount}>+{Math.round(d.amount)} KC</span>
              </div>
            ))}
          </div>
        )}

        <button className={styles.doneBtn} onClick={onDone}>
          VOIR LE MARCHÉ →
        </button>
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
