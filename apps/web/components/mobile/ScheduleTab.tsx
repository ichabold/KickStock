'use client';

import { useState } from 'react';
import { CALENDAR, NATIONS } from '@kickstock/constants';
import { useGameStore, pctOf, buildMatchesForCurrentDay } from '@/stores/gameStore';
import type { StoredMatchResult } from '@kickstock/types';
import MatchDetailOverlay from '@/components/shared/MatchDetailOverlay';
import NationDetailOverlay from '@/components/shared/NationDetailOverlay';
import styles from './ScheduleTab.module.css';

const gN = (id: string) => NATIONS.find(n => n.id === id);

export default function ScheduleTab() {
  const [matchDetail, setMatchDetail] = useState<{ result: StoredMatchResult; dayLabel: string } | null>(null);
  const [nationId,    setNationId]    = useState<string | null>(null);

  const dayIndex     = useGameStore(s => s.dayIndex);
  const eliminated   = useGameStore(s => s.eliminated);
  const matchResults = useGameStore(s => s.matchResults);
  const state        = useGameStore(s => s);

  return (
    <>
      <div>
        {CALENDAR.map((day, di) => {
          const isPast    = di < dayIndex;
          const isCurrent = di === dayIndex;
          const played    = matchResults[di];

          const displayMatches = day.matches.length > 0
            ? day.matches
            : played
              ? played.map(r => ({ a: r.a, b: r.b, venue: r.venue }))
              : di >= dayIndex && day.dynamic
                ? buildMatchesForCurrentDay({ ...state, dayIndex: di } as typeof state)
                : [];

          return (
            <div key={di} className={`${styles.dayBlock} ${isCurrent ? styles.current : ''} ${isPast ? styles.past : ''}`}>
              <div className={styles.dayHeader}>
                <span className={styles.dayLabel}>{isCurrent ? '▶ ' : ''}{day.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isPast && played && <span style={{ fontSize: 8, color: 'var(--gain)', fontWeight: 700 }}>✓ JOUÉ</span>}
                  {isCurrent && <span style={{ fontSize: 8, color: 'var(--gold)', fontWeight: 700 }}>PROCHAIN</span>}
                  <span className={`${styles.phase} ${day.isKO ? styles.phaseKO : styles.phaseGroup}`}>
                    {day.phase}
                  </span>
                </div>
              </div>

              {displayMatches.length > 0 ? displayMatches.map((m, mi) => {
                const nA    = gN(m.a);
                const nB    = gN(m.b);
                const elimA = eliminated.includes(m.a);
                const elimB = eliminated.includes(m.b);

                const res = played?.find(r => r.a === m.a && r.b === m.b)
                         ?? played?.find(r => r.a === m.b && r.b === m.a);
                const flipped    = res && res.a === m.b;
                const canonResult: StoredMatchResult | undefined = flipped
                  ? { ...res!, a: m.a, b: m.b, scoreA: res!.scoreB, scoreB: res!.scoreA,
                      res: res!.res === 'A' ? 'B' : res!.res === 'B' ? 'A' : 'draw',
                      pA: res!.pB, pB: res!.pA, newPA: res!.newPB, newPB: res!.newPA }
                  : res;
                const sA   = flipped ? res!.scoreB : res?.scoreA;
                const sB   = flipped ? res!.scoreA : res?.scoreB;
                const pctA = res ? pctOf(flipped ? res.newPB : res.newPA, flipped ? res.pB : res.pA) : 0;
                const pctB = res ? pctOf(flipped ? res.newPA : res.newPB, flipped ? res.pA : res.pB) : 0;
                const resA = flipped
                  ? (res?.res === 'A' ? 'B' : res?.res === 'B' ? 'A' : 'draw')
                  : res?.res;

                return (
                  <div key={mi} className={`${styles.match} ${isCurrent ? styles.matchCurrent : ''} ${res ? styles.matchPlayed : ''}`}>
                    <span className={styles.flag}>{nA?.flag}</span>
                    <button
                      className={`${styles.team} ${styles.nameBtn} ${elimA ? styles.elimTeam : ''}`}
                      style={{ color: res ? (resA === 'A' ? 'var(--gold)' : resA !== 'draw' ? 'var(--muted)' : undefined) : undefined }}
                      onClick={() => setNationId(m.a)}
                    >
                      {nA?.name?.toUpperCase()}
                    </button>
                    <span className={styles.vs}>VS</span>
                    <button
                      className={`${styles.team} ${styles.nameBtn} ${elimB ? styles.elimTeam : ''}`}
                      style={{ color: res ? (resA === 'B' ? 'var(--gold)' : resA !== 'draw' ? 'var(--muted)' : undefined) : undefined }}
                      onClick={() => setNationId(m.b)}
                    >
                      {nB?.name?.toUpperCase()}
                    </button>
                    <span className={styles.flag}>{nB?.flag}</span>

                    {res ? (
                      <div style={{ marginLeft: 'auto', textAlign: 'right', minWidth: 52 }}>
                        <button
                          className={styles.scoreBtn}
                          style={{ color: resA === 'draw' ? 'var(--muted)' : 'var(--gold)' }}
                          onClick={() => canonResult && setMatchDetail({ result: canonResult, dayLabel: day.label })}
                        >
                          {sA}–{sB}
                        </button>
                        {res.penWinner && <div style={{ fontSize: 7, color: 'var(--muted)' }}>P {res.penA}–{res.penB}</div>}
                        {res.etRes && !res.penWinner && <div style={{ fontSize: 7, color: 'var(--gold)' }}>AET</div>}
                        <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)' }}>
                          <span style={{ color: pctA >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{pctA >= 0 ? '▲' : '▼'}{Math.abs(pctA)}%</span>
                          {' / '}
                          <span style={{ color: pctB >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{pctB >= 0 ? '▲' : '▼'}{Math.abs(pctB)}%</span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginLeft: 'auto', color: '#2a2a2a', fontFamily: 'var(--font-mono)' }}>–</div>
                    )}

                    {m.venue && !res && <span className={styles.venue}>{m.venue}</span>}
                  </div>
                );
              }) : (
                <div className={styles.dynamic}>
                  {day.isKO ? '🎯 Matchs déterminés dynamiquement' : 'Matchs à venir'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {matchDetail && (
        <MatchDetailOverlay
          result={matchDetail.result}
          dayLabel={matchDetail.dayLabel}
          onClose={() => setMatchDetail(null)}
          onNationClick={id => { setMatchDetail(null); setNationId(id); }}
        />
      )}

      {nationId && (
        <NationDetailOverlay
          nationId={nationId}
          onClose={() => setNationId(null)}
        />
      )}
    </>
  );
}
