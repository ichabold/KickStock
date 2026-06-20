'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { buildGroupStandingsUI, buildLiveR32Pool, R32_DAY_SLICES } from '@kickstock/game-engine';
import type { LiveR32Slot } from '@kickstock/game-engine';
import { useGameStore } from '@/stores/gameStore';
import { deriveDynamicKey } from '@/lib/bootstrap';
import NationDetailOverlay from '@/components/shared/NationDetailOverlay';
import MatchDetailOverlay from '@/components/shared/MatchDetailOverlay';
import StandingsCard from '@/components/shared/StandingsCard';
import type { StoredMatchResult, TeamMeta, BootstrapData } from '@kickstock/types';
import styles from './StandingsTab.module.css';

function formatR32SlotLabel(slot: LiveR32Slot): string {
  if (slot.slotType === 'winner') return `1er Gr. ${slot.group}`;
  if (slot.slotType === 'runner') return `2e Gr. ${slot.group}`;
  return `3e (${slot.candidates?.join('/') ?? '?'})`;
}

type KoPhase = 'R32' | 'R16' | 'QF' | 'SF' | 'Final' | '3rd';
type KoLabelKey = 'r32' | 'r16' | 'quarterFinals' | 'semiFinals' | 'final' | 'thirdPlace';

const koLabelKeys: Record<KoPhase, KoLabelKey> = {
  R32: 'r32', R16: 'r16', QF: 'quarterFinals', SF: 'semiFinals', Final: 'final', '3rd': 'thirdPlace',
};

export default function StandingsTab({ activeView }: { activeView: 'groups' | 'ko' }) {
  const t = useTranslations('standings');
  const [nationId,    setNationId]    = useState<string | null>(null);
  const [matchDetail, setMatchDetail] = useState<{ result: StoredMatchResult; dayLabel: string } | null>(null);

  const prices       = useGameStore(s => s.prices);
  const eliminated   = useGameStore(s => s.eliminated);
  const matchResults = useGameStore(s => s.matchResults);
  const champion     = useGameStore(s => s.champion);
  const bootstrap = useGameStore(s => s._bootstrap);
  const teams     = useGameStore(s => s._teams);

  const gN = (id: string) => teams.find(t => t.id === id);

  const standings = useMemo(
    () => buildGroupStandingsUI(matchResults, prices, eliminated, teams),
    [matchResults, prices, eliminated, teams],
  );

  const liveR32Pool = useMemo(
    () => buildLiveR32Pool(matchResults, teams, eliminated),
    [matchResults, teams, eliminated],
  );

  const koResults = useMemo(() => {
    const r: Record<string, StoredMatchResult[]> = { R32: [], R16: [], QF: [], SF: [], Final: [], '3rd': [] };
    for (const [diStr, res] of Object.entries(matchResults)) {
      const bDay = bootstrap?.days.find(d => d.day_index === Number(diStr));
      if (!bDay?.is_ko) continue;
      const key = bDay.phase as string;
      if (r[key]) r[key] = [...r[key], ...res];
    }
    return r;
  }, [matchResults, bootstrap]);

  const groupDaysPlayed = Object.keys(matchResults).filter(di =>
    bootstrap?.days.find(d => d.day_index === Number(di))?.phase === 'Groups'
  ).length;

  return (
    <>
      <div>
        {activeView === 'groups' ? (
          /* ── Group Standings view ── */
          <>
            <div className={styles.groupsHeader}>{t('groupStandings')}</div>
            {Object.entries(standings).map(([g, groupTeams]) => {
              const matchday = t('matchday', { n: Math.min(groupDaysPlayed, 3), total: 3 });
              return (
                <StandingsCard
                  key={g}
                  group={g}
                  teams={groupTeams}
                  matchday={matchday}
                  onNationClick={id => setNationId(id)}
                />
              );
            })}
          </>
        ) : (
          /* ── KO Bracket view ── */
          <div className={styles.koSection}>
            {champion && (
              <div className={styles.champion}>
                <div className={styles.championFlag}>{gN(champion)?.flag}</div>
                <button className={styles.championName} onClick={() => setNationId(champion)}>
                  {t('champion', { nation: gN(champion)?.name?.toUpperCase() ?? '' })}
                </button>
              </div>
            )}

            {/* R32: played results + upcoming provisional/definitive slots */}
            <div className={styles.phaseLabel}>{t('r32')}</div>
            {bootstrap?.days.filter(d => d.phase === 'R32').map(day => {
              const di     = day.day_index;
              const played = matchResults[di];

              if (played) {
                return played.map((r, i) => {
                  const nA = gN(r.a), nB = gN(r.b);
                  const dayLabel = day.full_label;
                  return (
                    <div key={`${di}-${i}`} className={styles.koMatch}>
                      <div className={styles.koDayMeta}>{day.full_label}</div>
                      <div className={`${styles.koRow} ${r.res === 'A' ? styles.koWin : styles.koLose}`}>
                        <button className={styles.koTeamBtn} onClick={() => setNationId(r.a)}>
                          {nA?.flag} {nA?.name?.toUpperCase() ?? r.a}
                        </button>
                        <button className={styles.koScoreBtn} onClick={() => setMatchDetail({ result: r, dayLabel })}>
                          {r.scoreA}
                        </button>
                      </div>
                      <div className={`${styles.koRow} ${r.res === 'B' ? styles.koWin : styles.koLose}`}>
                        <button className={styles.koTeamBtn} onClick={() => setNationId(r.b)}>
                          {nB?.flag} {nB?.name?.toUpperCase() ?? r.b}
                        </button>
                        <button className={styles.koScoreBtn} onClick={() => setMatchDetail({ result: r, dayLabel })}>
                          {r.scoreB}
                        </button>
                      </div>
                      {r.penWinner && <div className={styles.koMeta}>Pens {r.penA}–{r.penB}</div>}
                      {r.etRes && !r.penWinner && <div className={`${styles.koMeta} ${styles.koMetaET}`}>{t('aet')}</div>}
                      {r.isUpset && <div className={`${styles.koMeta} ${styles.koMetaUpset}`}>{t('upset')}</div>}
                    </div>
                  );
                });
              }

              // Upcoming R32 day — show provisional/definitive slots
              if (!bootstrap) return null;
              const dynKey = deriveDynamicKey('R32', di, bootstrap);
              const slice  = R32_DAY_SLICES[dynKey];
              if (!slice) return null;
              const [s, e] = slice;
              const pairs: Array<[LiveR32Slot, LiveR32Slot]> = [];
              for (let i = s; i < e; i += 2) {
                if (liveR32Pool[i] !== undefined && liveR32Pool[i + 1] !== undefined) {
                  pairs.push([liveR32Pool[i], liveR32Pool[i + 1]]);
                }
              }
              if (pairs.length === 0) return null;
              return pairs.map(([slotA, slotB], mi) => {
                const nA = slotA.teamId ? gN(slotA.teamId) : null;
                const nB = slotB.teamId ? gN(slotB.teamId) : null;
                return (
                  <div key={`${di}-${mi}`} className={styles.koMatch}>
                    <div className={styles.koDayMeta}>{day.full_label}</div>
                    <div className={styles.koRow}>
                      <span
                        className={styles.koTeamBtn}
                        style={{ color: slotA.teamId ? (slotA.definitive ? undefined : 'var(--dim)') : 'var(--dim)' }}
                      >
                        {nA ? `${nA.flag} ${nA.name.toUpperCase()}` : formatR32SlotLabel(slotA)}
                      </span>
                    </div>
                    <div className={styles.koRow}>
                      <span
                        className={styles.koTeamBtn}
                        style={{ color: slotB.teamId ? (slotB.definitive ? undefined : 'var(--dim)') : 'var(--dim)' }}
                      >
                        {nB ? `${nB.flag} ${nB.name.toUpperCase()}` : formatR32SlotLabel(slotB)}
                      </span>
                    </div>
                  </div>
                );
              });
            })}

            {/* R16, QF, SF, 3rd, Final — played results */}
            {(['R16', 'QF', 'SF', 'Final', '3rd'] as KoPhase[]).map(phase => {
              const res = koResults[phase];
              if (!res?.length) return null;
              return (
                <div key={phase} className={styles.koPhase}>
                  <div className={styles.phaseLabel}>{t(koLabelKeys[phase])}</div>
                  {res.map((r, i) => {
                    const nA = gN(r.a), nB = gN(r.b);
                    const dayEntry = Object.entries(matchResults).find(([, results]) =>
                      results.some(x => x.a === r.a && x.b === r.b)
                    );
                    const bDay = dayEntry
                      ? bootstrap?.days.find(d => d.day_index === Number(dayEntry[0]))
                      : null;
                    const dayLabel = bDay?.full_label ?? '';
                    return (
                      <div key={i} className={styles.koMatch}>
                        <div className={`${styles.koRow} ${r.res === 'A' ? styles.koWin : styles.koLose}`}>
                          <button className={styles.koTeamBtn} onClick={() => setNationId(r.a)}>
                            {nA?.flag} {nA?.name?.toUpperCase() ?? r.a}
                          </button>
                          <button className={styles.koScoreBtn} onClick={() => setMatchDetail({ result: r, dayLabel })}>
                            {r.scoreA}
                          </button>
                        </div>
                        <div className={`${styles.koRow} ${r.res === 'B' ? styles.koWin : styles.koLose}`}>
                          <button className={styles.koTeamBtn} onClick={() => setNationId(r.b)}>
                            {nB?.flag} {nB?.name?.toUpperCase() ?? r.b}
                          </button>
                          <button className={styles.koScoreBtn} onClick={() => setMatchDetail({ result: r, dayLabel })}>
                            {r.scoreB}
                          </button>
                        </div>
                        {r.penWinner && <div className={styles.koMeta}>Pens {r.penA}–{r.penB}</div>}
                        {r.etRes && !r.penWinner && <div className={`${styles.koMeta} ${styles.koMetaET}`}>{t('aet')}</div>}
                        {r.isUpset && <div className={`${styles.koMeta} ${styles.koMetaUpset}`}>{t('upset')}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
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
