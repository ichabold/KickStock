'use client';

import { useMemo, useState } from 'react';
import { CALENDAR, NATIONS } from '@kickstock/constants';
import { buildGroupStandingsUI } from '@kickstock/game-engine';
import { useGameStore, fmt, pctOf } from '@/stores/gameStore';
import NationDetailOverlay from '@/components/shared/NationDetailOverlay';
import MatchDetailOverlay from '@/components/shared/MatchDetailOverlay';
import type { StoredMatchResult } from '@kickstock/types';
import styles from './ScheduleTab.module.css';

const gN = (id: string) => NATIONS.find(n => n.id === id);

export default function StandingsTab() {
  const [nationId,    setNationId]    = useState<string | null>(null);
  const [matchDetail, setMatchDetail] = useState<{ result: StoredMatchResult; dayLabel: string } | null>(null);

  const prices       = useGameStore(s => s.prices);
  const eliminated   = useGameStore(s => s.eliminated);
  const matchResults = useGameStore(s => s.matchResults);
  const dayIndex     = useGameStore(s => s.dayIndex);
  const r32Pool      = useGameStore(s => s.r32Pool);
  const champion     = useGameStore(s => s.champion);
  const portfolio    = useGameStore(s => s.portfolio);

  const standings = useMemo(
    () => buildGroupStandingsUI(matchResults, prices, eliminated),
    [matchResults, prices, eliminated],
  );

  const koResults = useMemo(() => {
    const r: Record<string, StoredMatchResult[]> = { R32: [], R16: [], QF: [], SF: [], Final: [], '3rd': [] };
    for (const [diStr, res] of Object.entries(matchResults)) {
      const day = CALENDAR[Number(diStr)];
      if (!day?.isKO) continue;
      const key = day.phase as string;
      if (r[key]) r[key] = [...r[key], ...res];
    }
    return r;
  }, [matchResults]);

  const isKO = dayIndex > 17 || !CALENDAR[dayIndex] || CALENDAR[dayIndex]?.phase !== 'Groups';

  const koPhases = ['R32', 'R16', 'QF', 'SF', 'Final', '3rd'] as const;
  const koLabels: Record<string, string> = {
    R32: 'HUITIÈMES · R32', R16: 'SEIZIÈMES · R16', QF: 'QUARTS DE FINALE',
    SF: 'DEMI-FINALES', Final: '🏆 FINALE', '3rd': '🥉 PETITE FINALE',
  };

  return (
    <>
      <div>
        {/* KO Results */}
        {isKO && (
          <div style={{ marginBottom: 12 }}>
            {champion && (
              <div style={{
                background: 'rgba(255,219,0,0.06)', border: '1px solid var(--gold-dk)',
                borderRadius: 9, padding: '12px 14px', marginBottom: 8, textAlign: 'center',
              }}>
                <div style={{ fontSize: 32 }}>{gN(champion)?.flag}</div>
                <button
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  onClick={() => setNationId(champion)}
                >
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, letterSpacing: 3, color: 'var(--gold)' }}>
                    {gN(champion)?.name?.toUpperCase()} — CHAMPION 🏆
                  </div>
                </button>
              </div>
            )}
            {koPhases.map(phase => {
              const res = koResults[phase];
              if (!res?.length) return null;
              return (
                <div key={phase} style={{ marginBottom: 10 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: 2, color: 'var(--gold)', marginBottom: 4 }}>
                    {koLabels[phase]}
                  </div>
                  {res.map((r, i) => {
                    const nA = gN(r.a), nB = gN(r.b);
                    const dayEntry = Object.entries(matchResults).find(([, results]) =>
                      results.some(x => x.a === r.a && x.b === r.b)
                    );
                    const dayLabel = dayEntry ? CALENDAR[Number(dayEntry[0])]?.label ?? '' : '';
                    return (
                      <div key={i} style={{
                        background: 'var(--s2)', border: '1px solid var(--border)',
                        borderRadius: 7, padding: 10, marginBottom: 4,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700,
                          color: r.res === 'A' ? 'var(--gold)' : 'var(--muted)' }}>
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', font: 'inherit', fontWeight: 700 }}
                            onClick={() => setNationId(r.a)}>
                            {nA?.flag} {nA?.name?.toUpperCase()}
                          </button>
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                            onClick={() => setMatchDetail({ result: r, dayLabel })}>
                            {r.scoreA}
                          </button>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700,
                          color: r.res === 'B' ? 'var(--gold)' : 'var(--muted)' }}>
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', font: 'inherit', fontWeight: 700 }}
                            onClick={() => setNationId(r.b)}>
                            {nB?.flag} {nB?.name?.toUpperCase()}
                          </button>
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                            onClick={() => setMatchDetail({ result: r, dayLabel })}>
                            {r.scoreB}
                          </button>
                        </div>
                        {r.penWinner && <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 2 }}>Pens {r.penA}–{r.penB}</div>}
                        {r.etRes && !r.penWinner && <div style={{ fontSize: 8, color: 'var(--gold)', marginTop: 2 }}>⚡ AET</div>}
                        {r.isUpset && <div style={{ fontSize: 8, color: 'var(--upset)', marginTop: 2 }}>🚀 UPSET!</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />
          </div>
        )}

        {/* Group Standings */}
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: 2, color: 'var(--dim)', marginBottom: 8 }}>
          CLASSEMENTS DE GROUPE
        </div>
        {Object.entries(standings).map(([g, teams]) => (
          <div key={g} style={{
            background: 'var(--s1)', border: '1px solid var(--border)',
            borderRadius: 9, padding: 10, marginBottom: 6,
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, letterSpacing: 2, color: 'var(--gold)', marginBottom: 6 }}>
              GROUPE {g}
            </div>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 22px 22px 22px 22px 54px', gap: 2,
              fontSize: 8, letterSpacing: 1, color: 'var(--dim)', fontWeight: 700,
              padding: '0 3px 4px', borderBottom: '1px solid var(--border)', marginBottom: 3 }}>
              <span>NATION</span>
              <span style={{ textAlign: 'center' }}>W</span>
              <span style={{ textAlign: 'center' }}>D</span>
              <span style={{ textAlign: 'center' }}>L</span>
              <span style={{ textAlign: 'center' }}>PTS</span>
              <span style={{ textAlign: 'right' }}>PRIX</span>
            </div>
            {teams.map((t, i) => {
              const ch = pctOf(t.price, t.initP);
              const isQ = i < 2 || r32Pool.includes(t.id);
              const held = (portfolio[t.id] ?? 0) > 0;
              return (
                <div key={t.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr 22px 22px 22px 22px 54px',
                  gap: 2, alignItems: 'center', padding: '4px 3px',
                  borderLeft: `3px solid ${isQ ? 'var(--gain-dk)' : 'transparent'}`,
                  opacity: t.elim ? 0.4 : 1,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 16 }}>{t.flag}</span>
                    <button
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        fontSize: 10, fontWeight: 700, color: 'var(--text)', fontFamily: 'inherit' }}
                      onClick={() => setNationId(t.id)}
                    >
                      {t.name?.toUpperCase()}
                    </button>
                    {held && !t.elim && (
                      <span style={{ fontSize: 7, color: 'var(--gain)', background: 'var(--gain-bg)',
                        border: '1px solid var(--gain-dk)', padding: '1px 3px', borderRadius: 2 }}>●</span>
                    )}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textAlign: 'center', color: 'var(--gain)' }}>{t.w}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textAlign: 'center', color: 'var(--muted)' }}>{t.d}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textAlign: 'center', color: 'var(--loss)' }}>{t.l}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textAlign: 'center', color: 'var(--gold)', fontWeight: 700 }}>{t.pts}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textAlign: 'right',
                    color: ch >= 0 ? 'var(--gain)' : 'var(--loss)', fontWeight: 600 }}>
                    {Math.round(t.price)}<span style={{ fontSize: 7 }}> {ch >= 0 ? '▲' : '▼'}{Math.abs(ch)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
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
