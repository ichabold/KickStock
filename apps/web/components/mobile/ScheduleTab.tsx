'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useGameStore, pctOf, buildMatchesForCurrentDay } from '@/stores/gameStore';
import { buildLiveR32Pool, R32_DAY_SLICES } from '@kickstock/game-engine';
import type { LiveR32Slot } from '@kickstock/game-engine';
import type { StoredMatchResult, BootstrapData, TeamMeta } from '@kickstock/types';
import { deriveDynamicKey } from '@/lib/bootstrap';
import MatchDetailOverlay from '@/components/shared/MatchDetailOverlay';
import NationDetailOverlay from '@/components/shared/NationDetailOverlay';
import styles from './ScheduleTab.module.css';

function formatR32SlotLabel(slot: LiveR32Slot): string {
  if (slot.slotType === 'winner') return `1er Gr. ${slot.group}`;
  if (slot.slotType === 'runner') return `2e Gr. ${slot.group}`;
  return `3e (${slot.candidates?.join('/') ?? '?'})`;
}

export default function ScheduleTab({ activeView = 'groups' }: { activeView?: 'groups' | 'ko' }) {
  const t  = useTranslations('schedule');
  const tc = useTranslations('common');
  const tlive = useTranslations('live');
  const [matchDetail, setMatchDetail] = useState<{ result: StoredMatchResult; dayLabel: string } | null>(null);
  const [nationId,    setNationId]    = useState<string | null>(null);

  const dayIndex     = useGameStore(s => s.dayIndex);
  const eliminated   = useGameStore(s => s.eliminated);
  const matchResults = useGameStore(s => s.matchResults);
  const liveMatches  = useGameStore(s => s.liveMatches);
  const state        = useGameStore(s => s);
  const bootstrap = useGameStore(s => s._bootstrap);
  const teams     = useGameStore(s => s._teams);

  const liveR32Pool = useMemo(
    () => buildLiveR32Pool(matchResults, teams, eliminated),
    [matchResults, teams, eliminated],
  );

  const gN = (id: string) => teams.find(t => t.id === id);

  const currentDayRef = useRef<HTMLDivElement>(null);

  // Scroll to the right anchor whenever activeView changes too.
  useEffect(() => {
    currentDayRef.current?.scrollIntoView({ block: 'center' });
  }, [activeView]);

  if (!bootstrap) {
    return <div style={{ padding: 24, color: 'var(--muted)', textAlign: 'center' }}>{tc('loading')}</div>;
  }

  // Filter days by the active view: groups = non-KO days; ko = KO days.
  const visibleDays = bootstrap.days.filter(d =>
    activeView === 'groups' ? !d.is_ko : d.is_ko
  );

  // Scroll target:
  //  – groups view → last played day (dayIndex - 1) so the user sees yesterday's results
  //  – ko view     → current/next day
  const scrollTargetDi = activeView === 'groups' ? dayIndex - 1 : dayIndex;

  return (
    <>
      <div>
        {visibleDays.map((day) => {
          const di        = day.day_index;
          const isPast    = di < dayIndex;
          const isCurrent = di === dayIndex;
          const played    = matchResults[di];

          // Group fixtures for this day
          const groupFixtures = bootstrap.group_fixtures
            .filter(f => f.day_index === di)
            .map(f => ({ a: f.nation_a, b: f.nation_b, venue: f.venue ?? undefined }));

          // [BUG FIX] KO days can mix played and not-yet-played matches on the
          // same day_index (e.g. R16 day 26: USA-Belgium already played,
          // Argentina-Egypt / Switzerland-Colombia still upcoming). Picking
          // only `played` OR only the pool-based build hid whichever side
          // wasn't in that branch. buildMatchesForCurrentDay's pool slicing
          // already excludes eliminated teams, so it naturally omits pairs
          // that already have a result — concatenating both is safe and
          // duplicate-free.
          const playedMatches = played ? played.map(r => ({ a: r.a, b: r.b, venue: r.venue })) : [];
          const upcomingMatches = day.is_ko && di >= dayIndex
            ? buildMatchesForCurrentDay({ ...state, dayIndex: di } as typeof state)
            : [];
          const displayMatches = !day.is_ko && groupFixtures.length > 0
            ? groupFixtures
            : [...playedMatches, ...upcomingMatches];

          // For upcoming R32 days: build provisional/definitive pairs from live standings
          const liveR32Pairs: Array<[LiveR32Slot, LiveR32Slot]> = [];
          if (day.phase === 'R32' && !played && di >= dayIndex && displayMatches.length === 0) {
            const dynKey = deriveDynamicKey('R32', di, bootstrap);
            const slice  = R32_DAY_SLICES[dynKey];
            if (slice) {
              const [s, e] = slice;
              for (let i = s; i < e; i += 2) {
                if (liveR32Pool[i] !== undefined && liveR32Pool[i + 1] !== undefined) {
                  liveR32Pairs.push([liveR32Pool[i], liveR32Pool[i + 1]]);
                }
              }
            }
          }

          return (
            <div
              key={di}
              ref={di === scrollTargetDi ? currentDayRef : undefined}
              className={`${styles.dayBlock} ${isCurrent ? styles.current : ''} ${isPast ? styles.past : ''}`}
            >
              <div className={styles.dayHeader}>
                <span className={styles.dayLabel}>{isCurrent ? '▶ ' : ''}{day.full_label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isPast && played && <span style={{ fontSize: 8, color: 'var(--gain)', fontWeight: 700 }}>{t('played')}</span>}
                  {isCurrent && <span style={{ fontSize: 8, color: 'var(--gold)', fontWeight: 700 }}>{t('next')}</span>}
                  <span className={`${styles.phase} ${day.is_ko ? styles.phaseKO : styles.phaseGroup}`}>
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
                const flipped = res && res.a === m.b;
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

                // Live score / lock status from /api/game/live-matches (not yet processed into matchResults)
                const live = !res
                  ? liveMatches.find(lm => (lm.nation_a === m.a && lm.nation_b === m.b) || (lm.nation_a === m.b && lm.nation_b === m.a))
                  : undefined;
                const isLive = !!live && ['1H','HT','2H','ET','BT','P'].includes(live.api_status);
                const isDone = !!live && ['FT','AET','PEN'].includes(live.api_status);
                const lockUntil = live?.trade_lock_until ? new Date(live.trade_lock_until) : null;
                const locked = !!live && (!isDone || (!!lockUntil && lockUntil > new Date()));
                const liveFlipped = !!live && live.nation_a === m.b;
                const liveSA = liveFlipped ? live!.score_b : live?.score_a;
                const liveSB = liveFlipped ? live!.score_a : live?.score_b;

                return (
                  <div
                    key={mi}
                    className={`${styles.match} ${isCurrent ? styles.matchCurrent : ''} ${res ? styles.matchPlayed : ''}`}
                    {...(isCurrent && mi === 0 ? { 'data-coach': 'schedule-match' } : {})}
                  >
                    <span className={styles.flag}>{nA?.flag}</span>
                    <button
                      className={`${styles.team} ${styles.nameBtn} ${elimA ? styles.elimTeam : ''}`}
                      style={{ color: res ? (resA === 'A' ? 'var(--gold)' : resA !== 'draw' ? 'var(--muted)' : undefined) : undefined }}
                      onClick={() => setNationId(m.a)}
                    >
                      {nA?.name?.toUpperCase() ?? m.a}
                    </button>
                    <span className={styles.vs}>VS</span>
                    <button
                      className={`${styles.team} ${styles.nameBtn} ${elimB ? styles.elimTeam : ''}`}
                      style={{ color: res ? (resA === 'B' ? 'var(--gold)' : resA !== 'draw' ? 'var(--muted)' : undefined) : undefined }}
                      onClick={() => setNationId(m.b)}
                    >
                      {nB?.name?.toUpperCase() ?? m.b}
                    </button>
                    <span className={styles.flag}>{nB?.flag}</span>

                    {res ? (
                      <div style={{ marginLeft: 'auto', textAlign: 'right', minWidth: 52 }}>
                        <button
                          className={styles.scoreBtn}
                          style={{ color: resA === 'draw' ? 'var(--muted)' : 'var(--gold)' }}
                          onClick={() => canonResult && setMatchDetail({ result: canonResult, dayLabel: day.full_label })}
                        >
                          {sA}–{sB}
                        </button>
                        {res.penWinner && <div style={{ fontSize: 7, color: 'var(--muted)' }}>P {res.penA}–{res.penB}</div>}
                        {res.etRes && !res.penWinner && <div style={{ fontSize: 7, color: 'var(--gold)' }}>{t('aet')}</div>}
                        <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)' }}>
                          <span style={{ color: pctA >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{pctA >= 0 ? '▲' : '▼'}{Math.abs(pctA)}%</span>
                          {' / '}
                          <span style={{ color: pctB >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{pctB >= 0 ? '▲' : '▼'}{Math.abs(pctB)}%</span>
                        </div>
                      </div>
                    ) : live && (isLive || isDone) ? (
                      <div style={{ marginLeft: 'auto', textAlign: 'right', minWidth: 52 }}>
                        <div className={styles.scoreBtn} style={{ color: isLive ? 'var(--gain)' : 'var(--muted)' }}>
                          {liveSA}–{liveSB}
                        </div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: isLive ? 'var(--gain)' : 'var(--dim)' }}>
                          {isLive ? `${tlive('inPlay')}${locked ? ' 🔒' : ''}` : `FT${locked ? ' 🔒' : ''}`}
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginLeft: 'auto', color: '#2a2a2a', fontFamily: 'var(--font-mono)' }}>–</div>
                    )}

                    {m.venue && !res && <span className={styles.venue}>{m.venue}</span>}
                  </div>
                );
              }) : liveR32Pairs.length > 0 ? liveR32Pairs.map(([slotA, slotB], mi) => {
                const nA = slotA.teamId ? gN(slotA.teamId) : null;
                const nB = slotB.teamId ? gN(slotB.teamId) : null;
                return (
                  <div key={mi} className={`${styles.match} ${isCurrent ? styles.matchCurrent : ''}`}>
                    <span className={styles.flag}>{nA?.flag ?? ''}</span>
                    <span
                      className={styles.team}
                      style={{ color: slotA.teamId ? (slotA.definitive ? undefined : 'var(--dim)') : 'var(--dim)', fontStyle: slotA.teamId ? undefined : 'italic' }}
                    >
                      {nA ? nA.name.toUpperCase() : formatR32SlotLabel(slotA)}
                    </span>
                    <span className={styles.vs}>VS</span>
                    <span
                      className={styles.team}
                      style={{ color: slotB.teamId ? (slotB.definitive ? undefined : 'var(--dim)') : 'var(--dim)', fontStyle: slotB.teamId ? undefined : 'italic' }}
                    >
                      {nB ? nB.name.toUpperCase() : formatR32SlotLabel(slotB)}
                    </span>
                    <span className={styles.flag}>{nB?.flag ?? ''}</span>
                    <div style={{ marginLeft: 'auto', color: '#2a2a2a', fontFamily: 'var(--font-mono)' }}>–</div>
                  </div>
                );
              }) : (
                <div className={styles.dynamic}>
                  {day.is_ko ? t('dynamicKO') : t('upcoming')}
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
