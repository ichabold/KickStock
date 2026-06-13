'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useGameStore, fmt, pctOf, buildMatchesForCurrentDay } from '@/stores/gameStore';
import { buildGroupStandingsUI } from '@kickstock/game-engine';
import TradeModal from '@/components/shared/TradeModal';
import NationDetailOverlay from '@/components/shared/NationDetailOverlay';
import MatchDetailOverlay from '@/components/shared/MatchDetailOverlay';
import MatchAnimation from '@/components/mobile/MatchAnimation';
import { Suspense } from 'react';
import AuthWidget from '@/components/shared/AuthWidget';
import GuestModal from '@/components/auth/GuestModal';
import WelcomeModal from '@/components/auth/WelcomeModal';
import RankingPanel from '@/components/shared/RankingPanel';
import { PriceDisplay, TradeActions, SimulateButton, usePortfolioTotals } from '@/components/mechanics';
import { useGameMode } from '@/hooks/useGameMode';
import CoachMarkOverlay from '@/components/shared/CoachMarkOverlay';
import FirstTradeUpsellModal from '@/components/shared/FirstTradeUpsellModal';
import { useValidateMechanics } from '@/hooks/useValidateMechanics';
import { useAuth } from '@/hooks/useAuth';
import type { Nation, TradeMode, StoredMatchResult, BootstrapData, TeamMeta } from '@kickstock/types';

function teamToNation(t: TeamMeta): Nation {
  return { id: t.id, name: t.name, flag: t.flag, p: t.initialPrice, conf: t.confederation ?? '', str: t.strength, group: t.group };
}

function getDynamicKey(bootstrap: BootstrapData, phase: string, dayIndex: number): string {
  const phaseDays = bootstrap.days.filter(d => d.phase === phase).sort((a, b) => a.day_index - b.day_index);
  const pos = phaseDays.findIndex(d => d.day_index === dayIndex);
  if (phase === 'R32')   return (['r32_28','r32_29','r32_30','r32_1','r32_2','r32_3'])[pos]  ?? 'r32_1';
  if (phase === 'R16')   return (['r16_1','r16_2','r16_3','r16_4'])[pos]                      ?? 'r16_1';
  if (phase === 'QF')    return pos === 0 ? 'qf_1' : 'qf_2';
  if (phase === 'SF')    return pos === 0 ? 'sf_1' : 'sf_2';
  if (phase === '3rd')   return '3rd';
  if (phase === 'Final') return 'final';
  return phase.toLowerCase();
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Spark({ history, up }: { history: number[]; up: boolean }) {
  if (history.length < 2) return <svg className="spk" viewBox="0 0 100 24" preserveAspectRatio="none"><line x1="0" y1="12" x2="100" y2="12" stroke="#333" strokeWidth="1" strokeDasharray="3,2"/></svg>;
  const mn = Math.min(...history), mx = Math.max(...history), rng = mx - mn || 1;
  const pts = history.map((v,i) => `${(i/(history.length-1))*100},${24-((v-mn)/rng)*22}`).join(' ');
  const col = up ? '#00FF87' : '#FF3B5C';
  const id  = `sg${Math.random().toString(36).slice(2,6)}`;
  return (
    <svg className="spk" viewBox="0 0 100 24" preserveAspectRatio="none">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity=".25"/><stop offset="100%" stopColor={col} stopOpacity="0"/></linearGradient></defs>
      <polyline points={pts} fill="none" stroke={col} strokeWidth="1.5"/>
    </svg>
  );
}

// ─── StockTile ─────────────────────────────────────────────────────────────────
function StockTile({ nation, onBuy, onSell, onCardClick }: {
  nation: TeamMeta; onBuy: () => void; onSell: () => void; onCardClick?: () => void;
}) {
  const ts = useTranslations('shell');
  const legacyNation = teamToNation(nation);
  const history  = useGameStore(s => s.priceHistory[nation.id] ?? []);
  const held     = useGameStore(s => s.portfolio[nation.id] ?? 0);
  const isElim   = useGameStore(s => s.eliminated.includes(nation.id));
  // price + up needed locally for Sparkline gradient colour
  const price    = useGameStore(s => s.prices[nation.id] ?? nation.initialPrice);
  const up       = price >= nation.initialPrice;

  return (
    <div
      className={`stile${held > 0 ? ' held' : ''}${isElim ? ' elim' : ''}`}
      onClick={onCardClick}
      style={{ cursor: onCardClick ? 'pointer' : undefined }}
    >
      <div className="st-top">
        <span className="st-flag">{nation.flag}</span>
        <span className="st-name">{nation.name.toUpperCase()}</span>
        {held > 0 && <span className="st-held">×{held}</span>}
      </div>
      <div className="st-badges">
        <span className="bdg g">GR.{nation.group}</span>
        <span className="bdg c">{nation.confederation}</span>
      </div>

      {/* PriceDisplay — mechanic atom, same formula as NationCard */}
      <PriceDisplay
        nation={legacyNation}
        wrapClassName="st-pr"
        priceClassName="st-price"
        kcClassName="st-kc"
        changeUpClassName="st-pct up"
        changeDnClassName="st-pct dn"
      />

      <Spark history={history} up={up}/>

      {isElim
        ? <div className="bdis">{ts('eliminatedBadge')}</div>
        : /* TradeActions — mechanic atom, same disabled logic as NationCard */
          <TradeActions
            nation={legacyNation}
            onBuy={onBuy}
            onSell={onSell}
            wrapClassName="st-acts"
            buyClassName="bbuy"
            sellClassName="bsell"
          />
      }
    </div>
  );
}

// ─── Shared: clickable team name ───────────────────────────────────────────────
function TeamName({ id, color, onNationClick }: { id: string; color?: string; onNationClick: (id: string) => void }) {
  const teams = useGameStore(s => s._teams);
  const n = teams.find(t => t.id === id);
  return (
    <button
      onClick={() => onNationClick(id)}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        color: color ?? 'inherit', fontFamily: 'inherit', fontSize: 'inherit',
        fontWeight: 'inherit', textAlign: 'left',
      }}
    >
      {n?.flag} {n?.name?.toUpperCase() ?? id}
    </button>
  );
}

// ─── HomeView ─────────────────────────────────────────────────────────────────
function HomeView({ onTrade, onNationClick, onMatchClick }: {
  onTrade: (n: TeamMeta, m: TradeMode) => void;
  onNationClick: (id: string) => void;
  onMatchClick: (r: StoredMatchResult, dayLabel: string) => void;
}) {
  const ts   = useTranslations('shell');
  const tsch = useTranslations('schedule');
  const dayIndex     = useGameStore(s => s.dayIndex);
  const matchResults = useGameStore(s => s.matchResults);
  const state        = useGameStore(s => s);
  const bootstrap = useGameStore(s => s._bootstrap);
  const teams     = useGameStore(s => s._teams);
  const curDay    = bootstrap?.days.find(d => d.day_index === dayIndex) ?? null;
  const prevDay   = bootstrap?.days.find(d => d.day_index === dayIndex - 1) ?? null;
  const prevResults  = matchResults[dayIndex - 1] ?? [];

  const todayMatches = useMemo(() => curDay ? buildMatchesForCurrentDay(state) : [], [curDay, state]);
  const todayResults = matchResults[dayIndex] ?? [];
  const todayNations = useMemo(() => {
    const ids = new Set<string>();
    todayMatches.forEach(m => { ids.add(m.a); ids.add(m.b); });
    return teams.filter(t => ids.has(t.id));
  }, [todayMatches, teams]);

  return (
    <div className="view-home">
      <div className="home-l">
        {prevResults.length > 0 && (
          <>
            <div className="day-hdr"><span className="dot" style={{background:'var(--muted)'}}/>{ts('previousMatchday', { label: prevDay?.full_label ?? '' })}</div>
            <div className="matches-scroll">
              {prevResults.map((r, i) => {
                const winA = r.res === 'A', winB = r.res === 'B';
                return (
                  <div key={i} className="mrow past">
                    <div className="mteams">
                      <TeamName id={r.a} color={winA ? 'var(--gold)' : winB ? 'var(--mu)' : undefined} onNationClick={onNationClick}/>
                      <span className="vs"> vs </span>
                      <TeamName id={r.b} color={winB ? 'var(--gold)' : winA ? 'var(--mu)' : undefined} onNationClick={onNationClick}/>
                    </div>
                    <button
                      className="mscore"
                      style={{background:'none',border:'none',cursor:'pointer',color:'inherit',fontFamily:'inherit',fontWeight:'inherit',fontSize:'inherit'}}
                      onClick={() => onMatchClick(r, prevDay?.full_label ?? '')}
                    >
                      {r.scoreA}–{r.scoreB}{r.penWinner ? ' P' : r.etRes ? ' AET' : ''}
                    </button>
                    <div className="mbadge done">FT</div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {curDay && (
          <>
            <div className="day-hdr"><span className="dot" style={{background:'var(--gold)'}}/>{ts('currentMatchday', { label: curDay.full_label })}</div>
            <div className="matches-scroll">
              {todayMatches.length > 0 ? todayMatches.map((m, i) => {
                const res = todayResults.find(r => (r.a === m.a && r.b === m.b) || (r.a === m.b && r.b === m.a));
                const flipped = res && res.a === m.b;
                const sA = flipped ? res!.scoreB : res?.scoreA;
                const sB = flipped ? res!.scoreA : res?.scoreB;
                const resA = flipped ? (res?.res === 'A' ? 'B' : res?.res === 'B' ? 'A' : 'draw') : res?.res;
                const canonResult: StoredMatchResult | undefined = flipped
                  ? { ...res!, a: m.a, b: m.b, scoreA: res!.scoreB, scoreB: res!.scoreA,
                      res: res!.res === 'A' ? 'B' : res!.res === 'B' ? 'A' : 'draw',
                      pA: res!.pB, pB: res!.pA, newPA: res!.newPB, newPB: res!.newPA }
                  : res;
                const winA = resA === 'A', winB = resA === 'B';
                return (
                  <div key={i} className={`mrow${res ? ' past' : ''}`}>
                    <div className="mteams">
                      <TeamName id={m.a} color={res ? (winA ? 'var(--gold)' : winB ? 'var(--mu)' : undefined) : undefined} onNationClick={onNationClick}/>
                      <span className="vs"> vs </span>
                      <TeamName id={m.b} color={res ? (winB ? 'var(--gold)' : winA ? 'var(--mu)' : undefined) : undefined} onNationClick={onNationClick}/>
                    </div>
                    {res && canonResult ? (
                      <button
                        className="mscore"
                        style={{background:'none',border:'none',cursor:'pointer',color:'inherit',fontFamily:'inherit',fontWeight:'inherit',fontSize:'inherit'}}
                        onClick={() => onMatchClick(canonResult, curDay?.full_label ?? '')}
                      >
                        {sA}–{sB}{res.penWinner ? ' P' : res.etRes ? ' AET' : ''}
                      </button>
                    ) : (
                      m.venue && <div className="mtime" style={{fontSize: 9, color: 'var(--di)'}}>{m.venue}</div>
                    )}
                    <div className={`mbadge ${res ? 'done' : 'soon'}`}>{res ? 'FT' : tsch('upcomingBadge')}</div>
                  </div>
                );
              }) : <div style={{padding: '12px', fontSize: 11, color: 'var(--di)'}}>Phase KO — matchs déterminés dynamiquement</div>}
            </div>
          </>
        )}
        {!curDay && <div style={{padding: 24, textAlign: 'center', color: 'var(--gold)', fontFamily: 'Bebas Neue', fontSize: 28, letterSpacing: 4}}>{ts('tournamentEnded')}</div>}
      </div>
      <div className="home-r">
        <div className="hr2">{ts('todayMatchesHeader')}</div>
        {todayNations.length > 0
          ? <div className="tiles-grid">
              {todayNations.map(n => <StockTile key={n.id} nation={n}
                onBuy={() => onTrade(n, 'buy')} onSell={() => onTrade(n, 'sell')}
                onCardClick={() => onNationClick(n.id)}
              />)}
            </div>
          : <div style={{padding: 40, textAlign: 'center', color: 'var(--di)', fontSize: 12}}>{ts('noMatchToday')}</div>
        }
      </div>
    </div>
  );
}

// ─── MarketView ───────────────────────────────────────────────────────────────
function MarketView({ onTrade, onNationClick }: {
  onTrade: (n: TeamMeta, m: TradeMode) => void;
  onNationClick: (id: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const [group, setGroup]   = useState('ALL');

  const teams  = useGameStore(s => s._teams);
  const groups = useMemo(() => ['ALL', ...[...new Set(teams.map(t => t.group).filter(Boolean))].sort()], [teams]);

  const filtered = useMemo(() =>
    teams.filter(n =>
      (group === 'ALL' || n.group === group) &&
      (filter === '' || n.name.toLowerCase().includes(filter.toLowerCase()) || n.id.toLowerCase().includes(filter.toLowerCase()))
    ).sort((a, b) => a.name.localeCompare(b.name))
  , [teams, filter, group]);

  return (
    <div className="mkt-wrap">
      <div className="mkt-controls">
        <input className="si" placeholder="🔍 Rechercher un pays..." value={filter} onChange={e => setFilter(e.target.value)}/>
        {groups.map(g => (
          <button key={g} className={`fp${group === g ? ' on' : ''}`} onClick={() => setGroup(g)}>{g}</button>
        ))}
      </div>
      <div className="mkt-grid-wrap">
        <div className="mkt-grid">
          {filtered.map(n => <StockTile key={n.id} nation={n}
            onBuy={() => onTrade(n, 'buy')} onSell={() => onTrade(n, 'sell')}
            onCardClick={() => onNationClick(n.id)}
          />)}
        </div>
      </div>
    </div>
  );
}

// ─── ScheduleView ─────────────────────────────────────────────────────────────
function ScheduleView({ onNationClick, onMatchClick }: {
  onNationClick: (id: string) => void;
  onMatchClick: (r: StoredMatchResult, dayLabel: string) => void;
}) {
  const tsch = useTranslations('schedule');
  const tst  = useTranslations('standings');
  const dayIndex     = useGameStore(s => s.dayIndex);
  const matchResults = useGameStore(s => s.matchResults);
  const state        = useGameStore(s => s);
  const bootstrap = useGameStore(s => s._bootstrap);

  return (
    <div className="view-sched">
      <div className="sched-l">
        <div className="day-hdr">{tsch('allGroupMatches')}</div>
        <div className="matches-scroll">
          {bootstrap?.days.filter(d => !d.is_ko).map((day) => {
            const di       = day.day_index;
            const played   = matchResults[di];
            const isPast   = di < dayIndex;
            const isCur    = di === dayIndex;
            return (
              <div key={di}>
                <div className="sched-day-lbl" style={{
                  padding: '4px 8px', fontSize: 9, fontWeight: 700, letterSpacing: 2,
                  color: isCur ? 'var(--gold)' : 'var(--mu)', marginTop: 6,
                }}>
                  {isCur ? '▶ ' : ''}{day.full_label} — {day.phase}
                </div>
                {(bootstrap.group_fixtures ?? []).filter(f => f.day_index === di).map((m, mi) => {
                  const res = played?.find(r => (r.a === m.nation_a && r.b === m.nation_b) || (r.a === m.nation_b && r.b === m.nation_a));
                  const flipped = res && res.a === m.nation_b;
                  const sA = flipped ? res!.scoreB : res?.scoreA;
                  const sB = flipped ? res!.scoreA : res?.scoreB;
                  const resA = flipped ? (res?.res === 'A' ? 'B' : res?.res === 'B' ? 'A' : 'draw') : res?.res;
                  const canonResult: StoredMatchResult | undefined = flipped
                    ? { ...res!, a: m.nation_a, b: m.nation_b, scoreA: res!.scoreB, scoreB: res!.scoreA,
                        res: res!.res === 'A' ? 'B' : res!.res === 'B' ? 'A' : 'draw',
                        pA: res!.pB, pB: res!.pA, newPA: res!.newPB, newPB: res!.newPA }
                    : res;
                  return (
                    <div
                      key={mi}
                      className={`mrow${isCur ? ' cur' : isPast ? ' past' : ''}`}
                      {...(isCur && mi === 0 ? { 'data-coach': 'schedule-match' } : {})}
                    >
                      <div className="mtime">J·{di+1}</div>
                      <div className="mteams">
                        <TeamName id={m.nation_a} color={res ? (resA === 'A' ? 'var(--gold)' : resA !== 'draw' ? 'var(--mu)' : undefined) : undefined} onNationClick={onNationClick}/>
                        <span className="vs"> vs </span>
                        <TeamName id={m.nation_b} color={res ? (resA === 'B' ? 'var(--gold)' : resA !== 'draw' ? 'var(--mu)' : undefined) : undefined} onNationClick={onNationClick}/>
                      </div>
                      {res && canonResult ? (
                        <button
                          className="mscore"
                          style={{background:'none',border:'none',cursor:'pointer',color:'inherit',fontFamily:'JetBrains Mono',fontWeight:700,fontSize:13}}
                          onClick={() => onMatchClick(canonResult, day.full_label)}
                        >
                          {sA}–{sB}{res.penWinner ? ' P' : res.etRes ? ' AET' : ''}
                        </button>
                      ) : m.venue ? (
                        <div className="mtime" style={{fontSize: 9, color: 'var(--di)'}}>{m.venue}</div>
                      ) : null}
                      <div className={`mbadge ${isPast ? 'done' : isCur ? 'soon' : ''}`}>
                        {isPast ? 'FT' : isCur ? tsch('next') : tsch('upcomingBadge')}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="sched-r">
        <div className="day-hdr">{tsch('koPhase')}</div>
        {(['R32','R16','QF','SF','3rd','Final'] as const).map(phase => {
          const phaseDays = bootstrap?.days.filter(d => d.phase === phase) ?? [];
          if (!phaseDays.length) return null;
          const phaseLabels: Record<string, string> = {
            R32: tst('r32'), R16: tst('r16'), QF: tst('quarterFinals'),
            SF: tst('semiFinals'), '3rd': tst('thirdPlace'), Final: tst('final'),
          };
          return (
            <div className="elim-section" key={phase}>
              <div className="es-hdr">{phaseLabels[phase]}</div>
              {phaseDays.map((day) => {
                const di = day.day_index;
                const played  = matchResults[di];
                const isCur   = di === dayIndex;
                const displayMatches = played
                  ? played.map(r => ({ a: r.a, b: r.b, venue: r.venue }))
                  : di >= dayIndex
                    ? buildMatchesForCurrentDay({ ...state, dayIndex: di } as typeof state)
                    : [];

                return (
                  <div key={di} className={`ko-match${displayMatches.length === 0 ? ' tbd' : ''}`}>
                    <div className="ko-date">{day.full_label}{isCur ? ' ▶' : ''}</div>
                    {displayMatches.length > 0 ? displayMatches.map((m, mi) => {
                      const res = played?.find(r => (r.a === m.a && r.b === m.b) || (r.a === m.b && r.b === m.a));
                      const flipped = res && res.a === m.b;
                      const sA = flipped ? res!.scoreB : res?.scoreA;
                      const sB = flipped ? res!.scoreA : res?.scoreB;
                      const resA = flipped ? (res?.res === 'A' ? 'B' : res?.res === 'B' ? 'A' : 'draw') : res?.res;
                      const canonResult: StoredMatchResult | undefined = flipped
                        ? { ...res!, a: m.a, b: m.b, scoreA: res!.scoreB, scoreB: res!.scoreA,
                            res: res!.res === 'A' ? 'B' : res!.res === 'B' ? 'A' : 'draw',
                            pA: res!.pB, pB: res!.pA, newPA: res!.newPB, newPB: res!.newPA }
                        : res;
                      return (
                        <div key={mi} className="ko-teams">
                          <TeamName id={m.a} color={res ? (resA === 'A' ? 'var(--gold)' : 'var(--mu)') : undefined} onNationClick={onNationClick}/>
                          {res && canonResult
                            ? <button className="ko-vs" style={{background:'none',border:'none',cursor:'pointer',fontFamily:'JetBrains Mono',fontWeight:700,color:'var(--gold)'}}
                                onClick={() => onMatchClick(canonResult, day.full_label)}>
                                {sA}–{sB}{res.penWinner ? ' P' : res.etRes ? ' AET' : ''}
                              </button>
                            : <span className="ko-vs">vs</span>
                          }
                          <TeamName id={m.b} color={res ? (resA === 'B' ? 'var(--gold)' : 'var(--mu)') : undefined} onNationClick={onNationClick}/>
                        </div>
                      );
                    }) : (
                      <div className="ko-teams">
                        <span className="tbd-t">{tsch('tbd')}</span>
                        <span className="ko-vs">vs</span>
                        <span className="tbd-t">{tsch('tbd')}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PortfolioView ────────────────────────────────────────────────────────────
function PortfolioView({ onTrade, onNationClick, onGoToSchedule }: {
  onTrade: (n: TeamMeta, m: TradeMode) => void;
  onNationClick: (id: string) => void;
  onGoToSchedule: () => void;
}) {
  const ts = useTranslations('shell');
  const tp = useTranslations('portfolio');
  // usePortfolioTotals — mechanic hook, same formula as MobileShell PortfolioTab
  const { cash, portVal, invested, totalVal: totalValue, pl: totalPl, bestScore } = usePortfolioTotals();

  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);
  const avgCost   = useGameStore(s => s.avgCost);
  const eliminated = useGameStore(s => s.eliminated);
  const txLog     = useGameStore(s => s.txLog);
  const teams = useGameStore(s => s._teams);

  const holdings = Object.entries(portfolio)
    .filter(([, q]) => q > 0)
    .map(([id, qty]) => {
      const n       = teams.find(t => t.id === id);
      const price   = prices[id] ?? 0;
      const avg     = avgCost[id] ?? n?.initialPrice ?? 0;
      const value   = price * qty;
      const invested = avg * qty;
      const pl      = value - invested;
      const chPct   = avg > 0 ? pctOf(price, avg) : 0;
      const isElim  = eliminated.includes(id);
      return { id, n, qty, price, avg, value, invested, pl, chPct, isElim };
    })
    .sort((a, b) => b.value - a.value);

  const hasElimHeld = holdings.some(h => h.isElim);

  return (
    <div className="view-port">
      <div className="port-l">
        <div className="port-hdr">{ts('myPositions')}</div>
        <div className="port-sum">
          <div className="ps-item"><div className="ps-l">{ts('total')}</div><div className="ps-v g">{fmt(totalValue)} KC</div></div>
          <div className="ps-item"><div className="ps-l">{tp('invested')}</div><div className="ps-v">{fmt(invested)} KC</div></div>
          <div className="ps-item"><div className="ps-l">{tp('pnl')}</div><div className={`ps-v${totalPl >= 0 ? ' gn' : ' ls'}`}>{totalPl >= 0 ? '+' : ''}{fmt(totalPl)} KC</div></div>
          <div className="ps-item"><div className="ps-l">{ts('cash')}</div><div className="ps-v">{fmt(cash)} KC</div></div>
        </div>
        {bestScore !== null && (
          <div style={{marginBottom:12,padding:'8px 12px',background:'rgba(255,219,0,.06)',border:'1px solid var(--gold-dk)',borderRadius:6,fontSize:10,color:'var(--gold)',fontWeight:700,letterSpacing:1}}>
            {tp('bestScore', { score: fmt(bestScore!) })}
          </div>
        )}
        {hasElimHeld && (
          <div style={{width:'100%',padding:'8px',background:'rgba(255,60,60,.08)',border:'1px solid var(--loss-dk)',borderRadius:6,color:'var(--loss)',fontSize:11,fontWeight:700,letterSpacing:1,marginBottom:10,textAlign:'center'}}>
            {tp('eliminatedNotice')}
          </div>
        )}
        {holdings.length === 0
          ? (
            <div style={{textAlign:'center',padding:'40px 20px',color:'var(--di)',fontSize:12,display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
              <div style={{fontSize:40}}>{tp('emptyIcon')}</div>
              <div>{tp('emptyTitle')}</div>
              <div style={{fontSize:11,color:'var(--muted)'}}>{tp('emptyHint')}</div>
              <button
                onClick={onGoToSchedule}
                style={{marginTop:6,minHeight:'var(--tap-min)',padding:'0 24px',background:'var(--gold)',color:'#000',border:'none',borderRadius:9,fontFamily:'var(--font-display)',fontSize:13,letterSpacing:2,cursor:'pointer'}}
              >
                {tp('emptyCta')}
              </button>
            </div>
          )
          : holdings.map(h => (
              <div key={h.id} className="pos-row" style={{opacity: h.isElim ? 0.5 : 1, cursor: 'pointer'}}
                onClick={() => onNationClick(h.id)}
              >
                <div className="pos-flag">{h.n?.flag}</div>
                <div className="pos-info">
                  <div className="pos-name">
                    {h.n?.name?.toUpperCase()}
                    {h.isElim && <span style={{fontSize:9,color:'var(--loss)',marginLeft:5}}>💀</span>}
                  </div>
                  <div className="pos-qty">
                    ×{h.qty} · moy. <span style={{fontFamily:'JetBrains Mono'}}>{fmt(h.avg)}</span>
                    {' → '}
                    <span style={{color: h.chPct >= 0 ? 'var(--gain)' : 'var(--loss)', fontFamily:'JetBrains Mono'}}>
                      {fmt(h.price)} KC
                    </span>
                    <span style={{color: h.chPct >= 0 ? 'var(--gain)' : 'var(--loss)'}}>
                      {' '}{h.chPct >= 0 ? '▲' : '▼'}{Math.abs(h.chPct)}%
                    </span>
                  </div>
                </div>
                <div className="pos-price">
                  <div className="pos-val">{fmt(h.value)} KC</div>
                  <div className={`pos-pnl${h.pl >= 0 ? ' up' : ' dn'}`}>{h.pl >= 0 ? '▲ +' : '▼ '}{fmt(Math.abs(h.pl))} KC</div>
                </div>
              </div>
            ))
        }

        {/* Tx log */}
        {txLog.length > 0 && (
          <div style={{marginTop: 16, borderTop: '1px solid var(--bd)', paddingTop: 12}}>
            <div style={{fontSize:8,letterSpacing:2,color:'var(--di)',fontWeight:700,marginBottom:8}}>{tp('txHistory')}</div>
            {txLog.slice(0, 15).map((tx, i) => (
              <div key={i} style={{display:'grid',gridTemplateColumns:'28px 18px 1fr 22px auto 20px',gap:4,alignItems:'center',padding:'4px 0',borderBottom:'1px solid rgba(255,255,255,.04)',fontSize:10}}>
                <span style={{fontSize:8,fontWeight:700,padding:'2px 4px',borderRadius:3,textAlign:'center',background:tx.dir==='buy'?'rgba(0,255,135,.12)':'rgba(255,60,60,.12)',color:tx.dir==='buy'?'var(--gain)':'var(--loss)'}}>
                  {tx.dir === 'buy' ? tp('txBuy') : tp('txSell')}
                </span>
                <span style={{fontSize:13,textAlign:'center'}}>{tx.flag}</span>
                <span style={{fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tx.name}</span>
                <span style={{color:'var(--di)',textAlign:'right',fontFamily:'JetBrains Mono',fontSize:9}}>×{tx.qty}</span>
                <span style={{fontFamily:'JetBrains Mono',fontWeight:600,textAlign:'right'}}>{fmt(tx.price)} KC</span>
                <span style={{color:'var(--di)',fontSize:8,textAlign:'right',fontFamily:'JetBrains Mono'}}>{tp('txDay', { day: tx.day + 1 })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="port-r">
        <div className="port-hdr">{ts('marketHeader')}</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
          {holdings.map(h => h.n && <StockTile key={h.id} nation={h.n}
            onBuy={() => h.n && onTrade(h.n, 'buy')}
            onSell={() => h.n && onTrade(h.n, 'sell')}
            onCardClick={() => onNationClick(h.id)}
          />)}
        </div>
      </div>
    </div>
  );
}

// ─── StandingsView ────────────────────────────────────────────────────────────
function StandingsView({ onNationClick, onMatchClick }: {
  onNationClick: (id: string) => void;
  onMatchClick: (r: StoredMatchResult, dayLabel: string) => void;
}) {
  const tst = useTranslations('standings');
  const prices       = useGameStore(s => s.prices);
  const eliminated   = useGameStore(s => s.eliminated);
  const matchResults = useGameStore(s => s.matchResults);
  const dayIndex     = useGameStore(s => s.dayIndex);
  const r32Pool      = useGameStore(s => s.r32Pool);
  const portfolio    = useGameStore(s => s.portfolio);
  const champion     = useGameStore(s => s.champion);
  const bootstrap = useGameStore(s => s._bootstrap);
  const teams     = useGameStore(s => s._teams);

  const standings = useMemo(
    () => buildGroupStandingsUI(matchResults, prices, eliminated, teams),
    [matchResults, prices, eliminated, teams],
  );

  const currentDay = bootstrap?.days.find(d => d.day_index === dayIndex);
  const isKO = !currentDay || currentDay.phase !== 'Groups';

  const koResults = useMemo(() => {
    const r: Record<string, StoredMatchResult[]> = { R32: [], R16: [], QF: [], SF: [], Final: [], '3rd': [] };
    for (const [diStr, res] of Object.entries(matchResults)) {
      const bDay = bootstrap?.days.find(d => d.day_index === Number(diStr));
      if (!bDay?.is_ko) continue;
      const key = bDay.phase as string;
      if (r[key]) r[key] = [...r[key], ...res];
    }
    return r;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchResults, bootstrap]);

  const koPhases = ['R32', 'R16', 'QF', 'SF', 'Final', '3rd'] as const;
  const koLabels: Record<string,string> = {
    R32: tst('r32'), R16: tst('r16'), QF: tst('quarterFinals'),
    SF: tst('semiFinals'), Final: tst('final'), '3rd': tst('thirdPlace'),
  };

  return (
    <div className="std-wrap">
      {/* KO results */}
      {isKO && (
        <div style={{marginBottom: 20}}>
          {champion && (
            <div style={{background:'rgba(255,219,0,.06)',border:'1px solid var(--gold-dk)',borderRadius:10,padding:'16px',marginBottom:12,textAlign:'center'}}>
              <div style={{fontSize:48}}>{teams.find(t => t.id === champion)?.flag}</div>
              <button
                style={{background:'none',border:'none',cursor:'pointer',padding:0}}
                onClick={() => onNationClick(champion)}
              >
                <div style={{fontFamily:'Bebas Neue',fontSize:22,letterSpacing:4,color:'var(--gold)'}}>
                  {teams.find(t => t.id === champion)?.name?.toUpperCase()} — CHAMPION 🏆
                </div>
              </button>
            </div>
          )}
          {koPhases.map(phase => {
            const res = koResults[phase];
            if (!res?.length) return null;
            return (
              <div key={phase} style={{marginBottom:12}}>
                <div style={{fontFamily:'Bebas Neue',fontSize:15,letterSpacing:3,color:'var(--gold)',marginBottom:6}}>{koLabels[phase]}</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:6}}>
                  {res.map((r, i) => {
                    const dayEntry = Object.entries(matchResults).find(([, results]) =>
                      results.some(x => x.a === r.a && x.b === r.b)
                    );
                    const dayLabel = dayEntry ? bootstrap?.days.find(d => d.day_index === Number(dayEntry[0]))?.full_label ?? '' : '';
                    return (
                      <div key={i} style={{background:'var(--s2)',border:'1px solid var(--bd)',borderRadius:7,padding:'8px 12px'}}>
                        <div style={{display:'flex',justifyContent:'space-between',fontSize:12,fontWeight:700,color:r.res==='A'?'var(--gold)':'var(--mu)'}}>
                          <TeamName id={r.a} color={r.res==='A'?'var(--gold)':'var(--mu)'} onNationClick={onNationClick}/>
                          <button style={{background:'none',border:'none',cursor:'pointer',fontFamily:'JetBrains Mono',fontWeight:700,color:'inherit'}}
                            onClick={() => onMatchClick(r, dayLabel)}>{r.scoreA}</button>
                        </div>
                        <div style={{display:'flex',justifyContent:'space-between',fontSize:12,fontWeight:700,color:r.res==='B'?'var(--gold)':'var(--mu)'}}>
                          <TeamName id={r.b} color={r.res==='B'?'var(--gold)':'var(--mu)'} onNationClick={onNationClick}/>
                          <button style={{background:'none',border:'none',cursor:'pointer',fontFamily:'JetBrains Mono',fontWeight:700,color:'inherit'}}
                            onClick={() => onMatchClick(r, dayLabel)}>{r.scoreB}</button>
                        </div>
                        {r.penWinner && <div style={{fontSize:8,color:'var(--mu)',marginTop:2}}>Pens {r.penA}–{r.penB}</div>}
                        {r.etRes && !r.penWinner && <div style={{fontSize:8,color:'var(--gold)',marginTop:2}}>⚡ AET</div>}
                        {r.isUpset && <div style={{fontSize:8,color:'var(--upset)',marginTop:2}}>🚀 UPSET!</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div style={{borderTop:'1px solid var(--bd)',margin:'16px 0'}}/>
        </div>
      )}

      {/* Group standings */}
      <div style={{fontFamily:'Bebas Neue',fontSize:14,letterSpacing:3,color:'var(--mu)',marginBottom:10}}>{tst('groupStandings')}</div>
      <div className="std-grid">
        {Object.entries(standings).map(([g, standTeams]) => (
          <div className="grp-card" key={g}>
            <div className="grp-hdr">{tst('groupHeader', { group: g })}</div>
            <table className="grp-table">
              <thead><tr>
                <th>{tst('colTeam')}</th>
                <th className="mono" title={tst('colWTitle')}>{tst('colW')}</th>
                <th className="mono" title={tst('colNTitle')}>{tst('colN')}</th>
                <th className="mono" title={tst('colLTitle')}>{tst('colL')}</th>
                <th className="mono" title={tst('colPtsTitle')}>{tst('colPts')}</th>
                <th className="mono">{tst('colPrice')}</th>
              </tr></thead>
              <tbody>
                {standTeams.map((t, i) => {
                  const ch    = pctOf(t.price, t.initP);
                  const up    = ch >= 0;
                  const isQ   = i < 2 || r32Pool.includes(t.id);
                  const held  = (portfolio[t.id] ?? 0) > 0;
                  return (
                    <tr key={t.id} className={isQ && !t.elim ? 'q' : ''} style={t.elim ? {opacity:0.4} : {}}>
                      <td>
                        <div className="nm">
                          <span className="fl">{t.flag}</span>
                          <button
                            style={{background:'none',border:'none',cursor:'pointer',color:'inherit',fontFamily:'inherit',fontSize:'inherit',fontWeight:'inherit',padding:0}}
                            onClick={() => onNationClick(t.id)}
                          >
                            {t.name?.toUpperCase()}
                          </button>
                          {held && !t.elim && <span style={{fontSize:8,color:'var(--gain)',marginLeft:4}}>●</span>}
                        </div>
                      </td>
                      <td className="mono" style={{color:'var(--gain)',textAlign:'center'}}>{t.w}</td>
                      <td className="mono" style={{color:'var(--mu)',textAlign:'center'}}>{t.d}</td>
                      <td className="mono" style={{color:'var(--loss)',textAlign:'center'}}>{t.l}</td>
                      <td className="mono" style={{color:'var(--gold)',fontWeight:700,textAlign:'center'}}>{t.pts}</td>
                      <td className="mono" style={{textAlign:'right'}}>
                        {Math.round(t.price)}{' '}
                        <span style={{color: up ? 'var(--gain)' : 'var(--loss)', fontSize:9}}>{up ? '▲+' : '▼'}{Math.abs(ch)}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── BracketView constants ────────────────────────────────────────────────────

const R32_SLICES: Record<string, [number, number]> = {
  r32_28: [0, 4],   r32_29: [4, 10],  r32_30: [10, 16],
  r32_1:  [16, 22], r32_2:  [22, 26], r32_3:  [26, 32],
};

// Seeding labels for 16 R32 matches (M1–M16), matching buildR32Pool order
const R32_SEEDING_LABELS: [string, string][] = [
  ['1er Gr. A', '3e (C/E/F/H/I)'],
  ['1er Gr. B', '3e (E/F/G/I/J)'],
  ['2e Gr. A',  '2e Gr. B'],
  ['1er Gr. C', '2e Gr. F'],
  ['1er Gr. D', '3e (B/E/F/I/J)'],
  ['1er Gr. E', '3e (A/B/C/D/F)'],
  ['2e Gr. C',  '1er Gr. F'],
  ['2e Gr. D',  '2e Gr. G'],
  ['2e Gr. E',  '2e Gr. I'],
  ['1er Gr. G', '3e (A/E/H/I/J)'],
  ['1er Gr. H', '2e Gr. J'],
  ['2e Gr. K',  '2e Gr. L'],
  ['1er Gr. I', '3e (C/D/F/G/H)'],
  ['1er Gr. J', '2e Gr. H'],
  ['1er Gr. K', '3e (D/E/I/J/L)'],
  ['1er Gr. L', '3e (E/H/I/J/K)'],
];

// ─── BracketView ──────────────────────────────────────────────────────────────
function BracketView({ onNationClick, onMatchClick }: {
  onNationClick: (id: string) => void;
  onMatchClick: (r: StoredMatchResult, dayLabel: string) => void;
}) {
  const tst = useTranslations('standings');
  const tsch = useTranslations('schedule');
  const matchResults = useGameStore(s => s.matchResults);
  const dayIndex     = useGameStore(s => s.dayIndex);
  const r32Pool      = useGameStore(s => s.r32Pool);
  const state        = useGameStore(s => s);
  const bootstrap = useGameStore(s => s._bootstrap);

  const phases: { label: string; key: 'R32' | 'R16' | 'QF' | 'SF' | '3rd' | 'Final' }[] = [
    { label: tst('r32'),           key: 'R32'   },
    { label: tst('r16'),           key: 'R16'   },
    { label: tst('quarterFinals'), key: 'QF'    },
    { label: tst('semiFinals'),    key: 'SF'    },
    { label: tst('thirdPlace'),    key: '3rd'   },
    { label: tst('final'),         key: 'Final' },
  ];

  return (
    <div className="bkt-wrap">
      {phases.map(phase => {
        const days = bootstrap?.days.filter(d => d.phase === phase.key) ?? [];
        const isFinal = phase.key === 'Final';
        return (
          <div className="bkt-stage" key={phase.key}>
            <div className="bkt-stage-ttl">{phase.label}</div>
            <div className="bkt-row">
              {days.map((day) => {
                const di = day.day_index;
                const played = matchResults[di];
                const isCur  = di === dayIndex;
                const displayMatches = played
                  ? played.map(r => ({ a: r.a, b: r.b }))
                  : di >= dayIndex
                    ? buildMatchesForCurrentDay({ ...state, dayIndex: di } as typeof state)
                    : [];

                if (displayMatches.length === 0) {
                  // R32: show actual teams (if group stage done) or seeding labels
                  const dynamicKey = bootstrap ? getDynamicKey(bootstrap, phase.key, di) : null;
                  if (phase.key === 'R32' && dynamicKey) {
                    const slice = R32_SLICES[dynamicKey];
                    if (slice) {
                      const [s, e] = slice;
                      if (r32Pool.length >= e) {
                        // Group stage complete — show actual qualified teams
                        const poolPairs: Array<{a: string; b: string}> = [];
                        for (let i = s; i < e; i += 2) {
                          if (r32Pool[i] && r32Pool[i + 1]) poolPairs.push({ a: r32Pool[i], b: r32Pool[i + 1] });
                        }
                        return poolPairs.map((m, mi) => (
                          <div key={`${di}-${mi}`} className="bkt-m upcoming">
                            <div className="bkt-meta">{day.full_label}{isCur ? ' ▶' : ''}</div>
                            <div className="bkt-t"><TeamName id={m.a} onNationClick={onNationClick}/></div>
                            <div className="bkt-t"><TeamName id={m.b} onNationClick={onNationClick}/></div>
                          </div>
                        ));
                      }
                      // Group stage still in progress — show seeding labels
                      const seedPairs: [string, string][] = [];
                      for (let i = s; i < e; i += 2) {
                        seedPairs.push(R32_SEEDING_LABELS[i / 2] ?? ['?', '?']);
                      }
                      return seedPairs.map(([la, lb], mi) => (
                        <div key={`${di}-${mi}`} className="bkt-m upcoming">
                          <div className="bkt-meta">{day.full_label}</div>
                          <div className="bkt-t"><span className="tbd">{la}</span></div>
                          <div className="bkt-t"><span className="tbd">{lb}</span></div>
                        </div>
                      ));
                    }
                  }
                  return (
                    <div key={di} className="bkt-m upcoming" style={isFinal ? {background:'rgba(255,219,0,.03)',borderColor:'rgba(255,219,0,.35)'} : {}}>
                      <div className="bkt-meta">{day.full_label}{isCur ? ' ▶' : ''}</div>
                      <div className="bkt-t"><span className="tbd">{tsch('tbd')}</span></div>
                      <div className="bkt-t"><span className="tbd">{tsch('tbd')}</span></div>
                    </div>
                  );
                }

                return displayMatches.map((m, mi) => {
                  const res = played?.find(r => (r.a === m.a && r.b === m.b) || (r.a === m.b && r.b === m.a));
                  const flipped = res && res.a === m.b;
                  const sA = flipped ? res!.scoreB : res?.scoreA;
                  const sB = flipped ? res!.scoreA : res?.scoreB;
                  const resA = flipped ? (res?.res === 'A' ? 'B' : res?.res === 'B' ? 'A' : 'draw') : res?.res;
                  const canonResult: StoredMatchResult | undefined = flipped
                    ? { ...res!, a: m.a, b: m.b, scoreA: res!.scoreB, scoreB: res!.scoreA,
                        res: res!.res === 'A' ? 'B' : res!.res === 'B' ? 'A' : 'draw',
                        pA: res!.pB, pB: res!.pA, newPA: res!.newPB, newPB: res!.newPA }
                    : res;
                  return (
                    <div key={`${di}-${mi}`} className={`bkt-m${!played ? ' upcoming' : ''}`}
                      style={isFinal ? {background:'rgba(255,219,0,.03)',borderColor:'rgba(255,219,0,.35)'} : {}}>
                      <div className="bkt-meta">{day.full_label}</div>
                      <div className="bkt-t" style={{color: res ? (resA === 'A' ? 'var(--gold)' : 'var(--mu)') : undefined}}>
                        <TeamName id={m.a} color={res ? (resA === 'A' ? 'var(--gold)' : 'var(--mu)') : undefined} onNationClick={onNationClick}/>
                        {res && <button style={{background:'none',border:'none',cursor:'pointer',fontFamily:'JetBrains Mono',marginLeft:6,fontSize:14,fontWeight:700,color:'var(--gold)'}}
                          onClick={() => canonResult && onMatchClick(canonResult, day.full_label)}>{sA}</button>}
                      </div>
                      <div className="bkt-t" style={{color: res ? (resA === 'B' ? 'var(--gold)' : 'var(--mu)') : undefined}}>
                        <TeamName id={m.b} color={res ? (resA === 'B' ? 'var(--gold)' : 'var(--mu)') : undefined} onNationClick={onNationClick}/>
                        {res && <button style={{background:'none',border:'none',cursor:'pointer',fontFamily:'JetBrains Mono',marginLeft:6,fontSize:14,fontWeight:700,color:'var(--gold)'}}
                          onClick={() => canonResult && onMatchClick(canonResult, day.full_label)}>{sB}</button>}
                      </div>
                      {res?.penWinner && <div style={{fontSize:8,color:'var(--mu)',marginTop:2}}>Pens {res.penA}–{res.penB}</div>}
                      {res?.etRes && !res.penWinner && <div style={{fontSize:8,color:'var(--gold)',marginTop:2}}>AET</div>}
                      {res?.isUpset && <div style={{fontSize:8,color:'var(--upset)',marginTop:2}}>🚀 UPSET</div>}
                    </div>
                  );
                });
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── RankingView ──────────────────────────────────────────────────────────────
function RankingView() {
  return <RankingPanel />;
}

// ─── Main BrowserShell ────────────────────────────────────────────────────────
type ViewId = 'home' | 'schedule' | 'market' | 'portfolio' | 'standings' | 'bracket' | 'ranking';

export default function BrowserShell() {
  const ts  = useTranslations('shell');
  const tsi = useTranslations('simulate');
  const [view,         setView]         = useState<ViewId>('home');
  const [modal,        setModal]        = useState<{nation: Nation; mode: TradeMode} | null>(null);
  const [simResults,   setSimResults]   = useState<StoredMatchResult[] | null>(null);
  const [showAnim,     setShowAnim]     = useState(false);
  const [animResults,  setAnimResults]  = useState<StoredMatchResult[]>([]);
  const [nationId,     setNationId]     = useState<string | null>(null);
  const [matchDetail,  setMatchDetail]  = useState<{ result: StoredMatchResult; dayLabel: string } | null>(null);
  const [showTut,      setShowTut]      = useState(false);
  const [showUpsell,   setShowUpsell]   = useState(false);
  const { user: browserUser }           = useAuth();
  const { mode: gameMode }              = useGameMode();

  useEffect(() => {
    useGameStore.getState().startSync();
    return () => useGameStore.getState().stopSync();
  }, []);

  // Auto-open coach marks on first guest creation — P0 fix
  useEffect(() => {
    function handleShowTut() {
      localStorage.setItem('kickstock_seen_tutorial', '1');
      setView('schedule'); // tutorial anchors on the Schedule view
      setShowTut(true);
    }
    window.addEventListener('kickstock:show-tutorial', handleShowTut);
    return () => window.removeEventListener('kickstock:show-tutorial', handleShowTut);
  }, []);

  // After a guest's first buy, offer to link a Google account
  useEffect(() => {
    function handleFirstTrade() {
      if (!browserUser) setShowUpsell(true);
    }
    window.addEventListener('kickstock:first-trade', handleFirstTrade);
    return () => window.removeEventListener('kickstock:first-trade', handleFirstTrade);
  }, [browserUser]);

  // Cross-device sync: load server state when a registered user logs in
  const syncUser = useGameStore(s => (s as { syncFromServer?: () => Promise<void> }).syncFromServer);
  useEffect(() => {
    if (browserUser) syncUser?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserUser?.id]);

  // Pattern 3 — validate at mount that this shell covers all required mechanics
  useValidateMechanics({
    canViewNationPrice: true,
    canBuy:             true,
    canSell:            true,
    canViewPortfolio:   true,
    canViewCash:        true,
    canViewPnL:         true,
    canSimulate:        true,
    canViewStandings:   true,
    canViewSchedule:    true,
  }, 'BrowserShell');

  // usePortfolioTotals — mechanic hook, same formula as MobileShell
  const { cash, totalVal: totVal, pl, positions } = usePortfolioTotals();

  // Still needed for MatchAnimation props and the Ticker price display
  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);

  const dayIndex  = useGameStore(s => s.dayIndex);
  const matchResults = useGameStore(s => s.matchResults);
  const gameState     = useGameStore(s => s);
  const resetGame = useGameStore(s => s.resetGame);
  const champion  = useGameStore(s => s.champion);

  const bootstrap = useGameStore(s => s._bootstrap);
  const teams     = useGameStore(s => s._teams);

  const day = bootstrap?.days.find(d => d.day_index === dayIndex) ?? null;

  const SIDEBAR_MAIN: { id: ViewId; icon: string; label: string }[] = [
    { id: 'home',       icon: '🏠', label: 'HOME'    },
    { id: 'schedule',   icon: '📅', label: 'SCHED.'  },
    { id: 'market',     icon: '📊', label: 'MARKET'  },
    { id: 'portfolio',  icon: '💼', label: 'PORTF.'  },
    { id: 'standings',  icon: '🏆', label: 'STAND.'  },
    { id: 'bracket',    icon: '🎯', label: 'BRACKET' },
  ];

  // Ticker: teams involved in the last played matchday + today's matches.
  const tickerTeams = useMemo(() => {
    const ids = new Set<string>();
    const prevResults = matchResults[dayIndex - 1] ?? [];
    prevResults.forEach(r => { ids.add(r.a); ids.add(r.b); });
    buildMatchesForCurrentDay(gameState).forEach(m => { ids.add(m.a); ids.add(m.b); });
    const filtered = teams.filter(team => ids.has(team.id));
    return filtered.length > 0 ? filtered : teams;
  }, [teams, matchResults, dayIndex, gameState]);

  function doTrade(n: TeamMeta, m: TradeMode) { setModal({nation: teamToNation(n), mode: m}); }
  function onNationClick(id: string) { setNationId(id); }
  function onMatchClick(r: StoredMatchResult, dayLabel: string) { setMatchDetail({ result: r, dayLabel }); }

  return (
    <>
    <GuestModal onDone={() => {}} />
    <Suspense><WelcomeModal /></Suspense>
    <div className="ks-browser">
      {/* SIDEBAR */}
      <nav className="sb">
        <div className="sb-logo"><span style={{fontSize:18}}>⚽</span><span className="sb-logotxt">KS</span></div>
        <div className="sb-nav">
          {SIDEBAR_MAIN.map(item => (
            <button key={item.id} className={`ni${view === item.id ? ' on' : ''}`} onClick={() => setView(item.id)}>
              <span style={{fontSize:18}}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="sb-bot">
          <button className={`ni-sm${view === 'ranking' ? ' on' : ''}`} onClick={() => setView('ranking')}>
            <span style={{fontSize:16}}>🥇</span><span>RANK.</span>
          </button>
          <button className="ni-sm" onClick={() => setShowTut(true)}>
            <span style={{fontSize:16}}>❓</span><span>{ts('help')}</span>
          </button>
          <div style={{padding: '8px 0'}}>
            <AuthWidget />
          </div>
        </div>
      </nav>

      {/* MAIN */}
      <div className="ks-main">
        {/* TOPBAR */}
        <header className="topbar">
          <div className="tb-title">{view.toUpperCase()}</div>
          <div className="tb-stats">
            <div className="tbs"><div className="tbs-l">{ts('portfolioValue')}</div><div className="tbs-v g">{fmt(totVal)} KC</div></div>
            <div className="tbs"><div className="tbs-l">{ts('cashAvailable')}</div><div className="tbs-v">{fmt(cash)} KC</div></div>
            <div className="tbs"><div className="tbs-l">P&amp;L</div><div className={`tbs-v ${pl >= 0 ? 'gn' : 'ls'}`}>{pl >= 0 ? '▲ +' : '▼ '}{fmt(Math.abs(pl))}</div></div>
            <div className="tbs"><div className="tbs-l">{ts('positions')}</div><div className="tbs-v">{positions}</div></div>
            <div className="tbs"><div className="tbs-l">{ts('matchdayLabel')}</div><div className="tbs-v">J·{dayIndex+1}</div></div>
          </div>
          <div className="tb-r">
            {champion && (
              <div style={{fontFamily:'Bebas Neue',fontSize:13,letterSpacing:2,color:'var(--gold)',background:'rgba(255,219,0,.1)',border:'1px solid var(--gold-dk)',padding:'4px 10px',borderRadius:5}}>
                🏆 {teams.find(t => t.id === champion)?.flag} {teams.find(t => t.id === champion)?.name?.toUpperCase()}
              </div>
            )}
            {/* SimulateButton — only in offline mode */}
            {gameMode === 'offline' && (
              <SimulateButton
                className="sim-inline-btn"
                onResults={results => { setAnimResults(results); setShowAnim(true); }}
                onNoResults={() => setView('market')}
              />
            )}
          </div>
        </header>

        {/* TICKER */}
        <div className="ticker-wrap">
          <div className="ticker-t">
            {[...tickerTeams, ...tickerTeams].map((n, i) => {
              const p = prices[n.id] ?? n.initialPrice; const up = p >= n.initialPrice;
              const pct = ((p - n.initialPrice) / n.initialPrice * 100).toFixed(1);
              return <span key={i} className="ti">{n.flag} {n.id} <span className={up ? 'up' : 'dn'}>{Math.round(p)} {up ? '▲+' : '▼'}{Math.abs(Number(pct))}%</span></span>;
            })}
          </div>
        </div>

        {/* CONTENT */}
        <div className="ks-content">
          {view === 'home'      && <HomeView      onTrade={doTrade} onNationClick={onNationClick} onMatchClick={onMatchClick}/>}
          {view === 'schedule'  && <ScheduleView  onNationClick={onNationClick} onMatchClick={onMatchClick}/>}
          {view === 'market'    && <MarketView    onTrade={doTrade} onNationClick={onNationClick}/>}
          {view === 'portfolio' && <PortfolioView onTrade={doTrade} onNationClick={onNationClick} onGoToSchedule={() => setView('schedule')}/>}
          {view === 'standings' && <StandingsView onNationClick={onNationClick} onMatchClick={onMatchClick}/>}
          {view === 'bracket'   && <BracketView   onNationClick={onNationClick} onMatchClick={onMatchClick}/>}
          {view === 'ranking'   && <RankingView   />}
        </div>
      </div>

      {/* OVERLAYS — order matters: MatchAnimation on top */}
      {showAnim && (
        <MatchAnimation
          results={animResults}
          portfolio={portfolio}
          prices={prices}
          teams={teams}
          onDone={() => {
            setShowAnim(false);
            setSimResults(animResults);
            setView('market');
          }}
        />
      )}
      {modal       && <TradeModal nation={modal.nation} initMode={modal.mode} onClose={() => setModal(null)}/>}
      {simResults  && !showAnim && (
        <div className="res-overlay" onClick={() => setSimResults(null)}>
          <div className="res-box" onClick={e => e.stopPropagation()}>
            <div className="res-title">{tsi('simulateButton')}</div>
            <div className="res-matches">
              {simResults.map((r, i) => {
                const tA = teams.find(t => t.id === r.a);
                const tB = teams.find(t => t.id === r.b);
                const tElim = r.elimId ? teams.find(t => t.id === r.elimId) : undefined;
                const tWinner = r.winnerId ? teams.find(t => t.id === r.winnerId) : undefined;
                const tDivTeam = tWinner ?? tA;
                return (
                  <div key={i} className={`res-match${r.isUpset ? ' upset' : ''}`}>
                    <button style={{background:'none',border:'none',cursor:'pointer',color:r.res==='A'?'var(--gold)':'var(--mu)',fontFamily:'inherit',fontSize:'inherit'}}
                      onClick={() => { setSimResults(null); onNationClick(r.a); }}>{tA?.flag} {tA?.name?.toUpperCase()}</button>
                    <button className="res-score" style={{background:'none',border:'none',cursor:'pointer',fontFamily:'JetBrains Mono',fontWeight:700,color:'inherit'}}
                      onClick={() => { setSimResults(null); onMatchClick(r, ''); }}>
                      {r.scoreA}–{r.scoreB}
                      {r.penWinner && <span style={{fontSize:10,color:'var(--mu)'}}> ({r.penA}–{r.penB} P)</span>}
                      {r.etRes && !r.penWinner && <span style={{fontSize:10,color:'var(--gold)'}}> AET</span>}
                    </button>
                    <button style={{background:'none',border:'none',cursor:'pointer',color:r.res==='B'?'var(--gold)':'var(--mu)',fontFamily:'inherit',fontSize:'inherit'}}
                      onClick={() => { setSimResults(null); onNationClick(r.b); }}>{tB?.flag} {tB?.name?.toUpperCase()}</button>
                    {r.elimId && <span className="res-elim">{tsi('eliminated', { nation: tElim?.name?.toUpperCase() ?? r.elimId })}</span>}
                    {r.isUpset && <span className="res-upbadge">🚀 UPSET!</span>}
                  </div>
                );
              })}
            </div>
            {simResults.filter(r => r.divCash > 0).length > 0 && (
              <div className="res-divs">
                <div className="res-divtitle">{tsi('dividendsReceived')}</div>
                {simResults.filter(r => r.divCash > 0).map((r, i) => {
                  const divTeam = teams.find(t => t.id === (r.winnerId ?? r.a));
                  return (
                    <div key={i} className="res-divrow">
                      <span>{divTeam?.flag} {divTeam?.name?.toUpperCase()}</span>
                      <span className="res-divamt">+{fmt(r.divCash)} KC</span>
                    </div>
                  );
                })}
              </div>
            )}
            <button className="res-close" onClick={() => setSimResults(null)}>{tsi('viewMarket')}</button>
          </div>
        </div>
      )}
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
      {showTut && <CoachMarkOverlay shell="browser" onDone={() => setShowTut(false)} />}
      {showUpsell && <FirstTradeUpsellModal onClose={() => setShowUpsell(false)} />}
    </div>
    </>
  );
}
