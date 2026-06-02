'use client';

import { useTranslations } from 'next-intl';
import { fmt, pctOf } from '@kickstock/game-engine';
import type { StoredMatchResult, TeamMeta } from '@kickstock/types';
import { useGameStore } from '@/stores/gameStore';
import styles from './MatchDetailOverlay.module.css';

interface Props {
  result: StoredMatchResult;
  dayLabel: string;
  onClose: () => void;
  onNationClick?: (id: string) => void;
}

export default function MatchDetailOverlay({ result, dayLabel, onClose, onNationClick }: Props) {
  const teams = useGameStore(s => s._teams);
  const gN = (id: string) => (teams ?? []).find(t => t.id === id);
  const t = useTranslations('matchDetail');
  const { scoreA, scoreB, res, res90, etRes, penWinner, penA, penB, isUpset, venue, goals = [] } = result;
  const nA     = gN(result.a);
  const nB     = gN(result.b);
  const isWinA = res === 'A';
  const isWinB = res === 'B';
  const isDraw = res === 'draw';

  const goalsA = goals.filter(g => g.team === 'A');
  const goalsB = goals.filter(g => g.team === 'B');

  const pctA = pctOf(result.newPA, result.pA);
  const pctB = pctOf(result.newPB, result.pB);

  return (
    <div className={styles.bg} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.sheet} onClick={e => e.stopPropagation()}>
        <div className={styles.topBar}>
          <div className={styles.dayLabel}>{dayLabel}</div>
          <button className={styles.closeBtn} onClick={onClose} aria-label={t('closeLabel')}>✕</button>
        </div>

        <div className={styles.scoreHero}>
          <div className={styles.teamSide}>
            <div className={styles.teamFlag}>{nA?.flag}</div>
            <button
              className={`${styles.teamName} ${isWinA ? styles.teamWin : isWinB ? styles.teamLoss : ''}`}
              onClick={() => onNationClick?.(result.a)}
            >
              {nA?.name?.toUpperCase()}
            </button>
          </div>
          <div className={styles.scoreCenter}>
            <div className={styles.scoreFinal} style={{ color: isDraw ? 'var(--muted)' : 'var(--gold)' }}>
              {scoreA}–{scoreB}
            </div>
            {res90 === 'draw' && etRes && !penWinner && (
              <div className={styles.scoreTag} style={{ color: 'var(--gold)' }}>{t('aet')}</div>
            )}
            {penWinner && (
              <div className={styles.scoreTag} style={{ color: 'var(--muted)' }}>
                {t('penalties', { penA, penB })}
              </div>
            )}
            {isDraw && !etRes && !penWinner && (
              <div className={styles.scoreTag} style={{ color: 'var(--muted)' }}>{t('draw')}</div>
            )}
            {isUpset && (
              <div className={styles.scoreTag} style={{ color: 'var(--upset)', fontWeight: 700 }}>{t('upset')}</div>
            )}
          </div>
          <div className={styles.teamSide}>
            <div className={styles.teamFlag}>{nB?.flag}</div>
            <button
              className={`${styles.teamName} ${isWinB ? styles.teamWin : isWinA ? styles.teamLoss : ''}`}
              onClick={() => onNationClick?.(result.b)}
            >
              {nB?.name?.toUpperCase()}
            </button>
          </div>
        </div>

        {goals.length > 0 ? (
          <div className={styles.goalsSection}>
            <div className={styles.goalsTitle}>{t('scorers')}</div>
            <div className={styles.goalsCols}>
              <div className={styles.goalsColA}>
                {goalsA.map((g, i) => (
                  <div key={i} className={styles.goalRow}>
                    <span className={styles.goalMin} style={{ color: g.min > 90 ? 'var(--gold)' : 'var(--muted)' }}>
                      {g.min}&apos;
                    </span>
                    <span className={styles.goalBall}>⚽</span>
                    <span className={styles.goalName} style={{ color: g.min > 90 ? 'var(--gold)' : 'var(--text)' }}>
                      {g.name}{g.min > 90 ? ' ⚡' : ''}
                    </span>
                  </div>
                ))}
              </div>
              <div className={styles.goalsColB}>
                {goalsB.map((g, i) => (
                  <div key={i} className={`${styles.goalRow} ${styles.goalRowRight}`}>
                    <span className={styles.goalName} style={{ color: g.min > 90 ? 'var(--gold)' : 'var(--text)' }}>
                      {g.min > 90 ? '⚡ ' : ''}{g.name}
                    </span>
                    <span className={styles.goalBall}>⚽</span>
                    <span className={styles.goalMin} style={{ color: g.min > 90 ? 'var(--gold)' : 'var(--muted)' }}>
                      {g.min}&apos;
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.noGoals}>{t('noScorers')}</div>
        )}

        <div className={styles.impactRow}>
          <div className={styles.impactBox}>
            <div className={styles.impactLbl}>{t('impact', { nation: result.a })}</div>
            <div className={styles.impactPct} style={{ color: pctA >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
              {pctA >= 0 ? '▲' : '▼'}{Math.abs(pctA)}%
            </div>
            <div className={styles.impactPrice}>{result.pA} → {result.newPA} KC</div>
          </div>
          <div className={styles.impactBox}>
            <div className={styles.impactLbl}>{t('impact', { nation: result.b })}</div>
            <div className={styles.impactPct} style={{ color: pctB >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
              {pctB >= 0 ? '▲' : '▼'}{Math.abs(pctB)}%
            </div>
            <div className={styles.impactPrice}>{result.pB} → {result.newPB} KC</div>
          </div>
        </div>

        {venue && <div className={styles.venue}>📍 {venue}</div>}
      </div>
    </div>
  );
}
