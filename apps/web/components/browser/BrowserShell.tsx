'use client';

import { useState, useEffect, useMemo } from 'react';
import { useGameStore, fmt, pctOf, buildMatchesForCurrentDay } from '@/stores/gameStore';
import { CALENDAR, NATIONS, GROUPS } from '@kickstock/constants';
import { buildGroupStandingsUI } from '@kickstock/game-engine';
import TradeModal from '@/components/shared/TradeModal';
import NationDetailOverlay from '@/components/shared/NationDetailOverlay';
import MatchDetailOverlay from '@/components/shared/MatchDetailOverlay';
import MatchAnimation from '@/components/mobile/MatchAnimation';
import AuthWidget from '@/components/shared/AuthWidget';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { useAuth } from '@/hooks/useAuth';
import type { Nation, TradeMode, StoredMatchResult } from '@kickstock/types';

const gN = (id: string) => NATIONS.find(n => n.id === id);

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
  nation: Nation; onBuy: () => void; onSell: () => void; onCardClick?: () => void;
}) {
  const prices     = useGameStore(s => s.prices);
  const history    = useGameStore(s => s.priceHistory[nation.id] ?? []);
  const portfolio  = useGameStore(s => s.portfolio);
  const eliminated = useGameStore(s => s.eliminated);

  const price  = prices[nation.id] ?? nation.p;
  const held   = portfolio[nation.id] ?? 0;
  const isElim = eliminated.includes(nation.id);
  const pct    = ((price - nation.p) / nation.p * 100).toFixed(1);
  const up     = price >= nation.p;

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
        <span className="bdg c">{nation.conf}</span>
      </div>
      <div className="st-pr">
        <span className="st-price">{Math.round(price)}</span>
        <span className="st-kc">KC</span>
        <span className={`st-pct ${up ? 'up' : 'dn'}`}>{up ? '▲+' : '▼'}{Math.abs(Number(pct))}%</span>
      </div>
      <Spark history={history} up={up}/>
      {isElim
        ? <div className="bdis">💀 ÉLIMINÉ · 1 KC</div>
        : <div className="st-acts" onClick={e => e.stopPropagation()}>
            <button className="bbuy" onClick={onBuy}>▲ BUY</button>
            <button className="bsell" onClick={onSell} disabled={held === 0}>▼ SELL</button>
          </div>
      }
    </div>
  );
}

// ─── Shared: clickable team name ───────────────────────────────────────────────
function TeamName({ id, color, onNationClick }: { id: string; color?: string; onNationClick: (id: string) => void }) {
  const n = gN(id);
  return (
    <button
      onClick={() => onNationClick(id)}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        color: color ?? 'inherit', fontFamily: 'inherit', fontSize: 'inherit',
        fontWeight: 'inherit', textAlign: 'left',
      }}
    >
      {n?.flag} {n?.name?.toUpperCase()}
    </button>
  );
}

// ─── HomeView ─────────────────────────────────────────────────────────────────
function HomeView({ onTrade, onNationClick, onMatchClick }: {
  onTrade: (n: Nation, m: TradeMode) => void;
  onNationClick: (id: string) => void;
  onMatchClick: (r: StoredMatchResult, dayLabel: string) => void;
}) {
  const dayIndex     = useGameStore(s => s.dayIndex);
  const matchResults = useGameStore(s => s.matchResults);
  const state        = useGameStore(s => s);
  const curDay       = CALENDAR[dayIndex];
  const prevResults  = matchResults[dayIndex - 1] ?? [];
  const prevDay      = CALENDAR[dayIndex - 1];

  const todayMatches = useMemo(() => curDay ? buildMatchesForCurrentDay(state) : [], [curDay, state]);
  const todayNations = useMemo(() => {
    const ids = new Set<string>();
    todayMatches.forEach(m => { ids.add(m.a); ids.add(m.b); });
    return NATIONS.filter(n => ids.has(n.id));
  }, [todayMatches]);

  return (
    <div className="view-home">
      <div className="home-l">
        {prevResults.length > 0 && (
          <>
            <div className="day-hdr"><span className="dot" style={{background:'#555'}}/>JOURNÉE PRÉCÉDENTE · {prevDay?.label}</div>
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
                      onClick={() => onMatchClick(r, prevDay?.label ?? '')}
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
            <div className="day-hdr"><span className="dot" style={{background:'var(--gold)'}}/>JOURNÉE COURANTE · {curDay.label}</div>
            <div className="matches-scroll">
              {todayMatches.length > 0 ? todayMatches.map((m, i) => (
                <div key={i} className="mrow">
                  <div className="mteams">
                    <TeamName id={m.a} onNationClick={onNationClick}/>
                    <span className="vs"> vs </span>
                    <TeamName id={m.b} onNationClick={onNationClick}/>
                  </div>
                  {m.venue && <div className="mtime" style={{fontSize: 9, color: 'var(--di)'}}>{m.venue}</div>}
                  <div className="mbadge soon">À venir</div>
                </div>
              )) : <div style={{padding: '12px', fontSize: 11, color: 'var(--di)'}}>Phase KO — matchs déterminés dynamiquement</div>}
            </div>
          </>
        )}
        {!curDay && <div style={{padding: 24, textAlign: 'center', color: 'var(--gold)', fontFamily: 'Bebas Neue', fontSize: 28, letterSpacing: 4}}>🏆 TOURNOI TERMINÉ</div>}
      </div>
      <div className="home-r">
        <div className="hr2">ACTIONS · MATCHS DU JOUR</div>
        {todayNations.length > 0
          ? <div className="tiles-grid">
              {todayNations.map(n => <StockTile key={n.id} nation={n}
                onBuy={() => onTrade(n, 'buy')} onSell={() => onTrade(n, 'sell')}
                onCardClick={() => onNationClick(n.id)}
              />)}
            </div>
          : <div style={{padding: 40, textAlign: 'center', color: 'var(--di)', fontSize: 12}}>Aucun match aujourd&apos;hui ou phase KO</div>
        }
      </div>
    </div>
  );
}

// ─── MarketView ───────────────────────────────────────────────────────────────
function MarketView({ onTrade, onNationClick }: {
  onTrade: (n: Nation, m: TradeMode) => void;
  onNationClick: (id: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const [group, setGroup]   = useState('ALL');

  const filtered = useMemo(() =>
    NATIONS.filter(n =>
      (group === 'ALL' || n.group === group) &&
      (filter === '' || n.name.toLowerCase().includes(filter.toLowerCase()) || n.id.toLowerCase().includes(filter.toLowerCase()))
    ).sort((a, b) => a.name.localeCompare(b.name))
  , [filter, group]);

  return (
    <div className="mkt-wrap">
      <div className="mkt-controls">
        <input className="si" placeholder="🔍 Rechercher un pays..." value={filter} onChange={e => setFilter(e.target.value)}/>
        {GROUPS.map(g => (
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
  const dayIndex     = useGameStore(s => s.dayIndex);
  const matchResults = useGameStore(s => s.matchResults);
  const state        = useGameStore(s => s);

  return (
    <div className="view-sched">
      <div className="sched-l">
        <div className="day-hdr">TOUS LES MATCHS — PHASE DE GROUPES</div>
        <div className="matches-scroll">
          {CALENDAR.filter(d => !d.isKO).map((day, di) => {
            const played   = matchResults[di];
            const isPast   = di < dayIndex;
            const isCur    = di === dayIndex;
            return (
              <div key={di}>
                <div className="sched-day-lbl" style={{
                  padding: '4px 8px', fontSize: 9, fontWeight: 700, letterSpacing: 2,
                  color: isCur ? 'var(--gold)' : 'var(--mu)', marginTop: 6,
                }}>
                  {isCur ? '▶ ' : ''}{day.label} — {day.phase}
                </div>
                {day.matches.map((m, mi) => {
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
                    <div key={mi} className={`mrow${isCur ? ' cur' : isPast ? ' past' : ''}`}>
                      <div className="mtime">J·{di+1}</div>
                      <div className="mteams">
                        <TeamName id={m.a} color={res ? (resA === 'A' ? 'var(--gold)' : resA !== 'draw' ? 'var(--mu)' : undefined) : undefined} onNationClick={onNationClick}/>
                        <span className="vs"> vs </span>
                        <TeamName id={m.b} color={res ? (resA === 'B' ? 'var(--gold)' : resA !== 'draw' ? 'var(--mu)' : undefined) : undefined} onNationClick={onNationClick}/>
                      </div>
                      {res && canonResult ? (
                        <button
                          className="mscore"
                          style={{background:'none',border:'none',cursor:'pointer',color:'inherit',fontFamily:'JetBrains Mono',fontWeight:700,fontSize:13}}
                          onClick={() => onMatchClick(canonResult, day.label)}
                        >
                          {sA}–{sB}{res.penWinner ? ' P' : res.etRes ? ' AET' : ''}
                        </button>
                      ) : m.venue ? (
                        <div className="mtime" style={{fontSize: 9, color: 'var(--di)'}}>{m.venue}</div>
                      ) : null}
                      <div className={`mbadge ${isPast ? 'done' : isCur ? 'soon' : ''}`}>
                        {isPast ? 'FT' : isCur ? 'Prochain' : 'À venir'}
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
        <div className="day-hdr">PHASE KO</div>
        {(['R32','R16','QF','SF','3rd','Final'] as const).map(phase => {
          const phaseDays = CALENDAR.filter(d => d.phase === phase);
          if (!phaseDays.length) return null;
          const phaseLabels: Record<string, string> = {
            R32: 'HUITIÈMES · R32', R16: 'SEIZIÈMES · R16', QF: 'QUARTS DE FINALE',
            SF: 'DEMI-FINALES', '3rd': 'TROISIÈME PLACE', Final: '🏆 FINALE',
          };
          return (
            <div className="elim-section" key={phase}>
              <div className="es-hdr">{phaseLabels[phase]}</div>
              {phaseDays.map((day, pdi) => {
                const di = CALENDAR.indexOf(day);
                const played  = matchResults[di];
                const isCur   = di === dayIndex;
                const displayMatches = day.matches.length > 0
                  ? day.matches
                  : played
                    ? played.map(r => ({ a: r.a, b: r.b, venue: r.venue }))
                    : isCur
                      ? buildMatchesForCurrentDay({ ...state, dayIndex: di } as typeof state)
                      : [];

                return (
                  <div key={pdi} className={`ko-match${displayMatches.length === 0 ? ' tbd' : ''}`}>
                    <div className="ko-date">{day.label}{isCur ? ' ▶' : ''}</div>
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
                                onClick={() => onMatchClick(canonResult, day.label)}>
                                {sA}–{sB}{res.penWinner ? ' P' : res.etRes ? ' AET' : ''}
                              </button>
                            : <span className="ko-vs">vs</span>
                          }
                          <TeamName id={m.b} color={res ? (resA === 'B' ? 'var(--gold)' : 'var(--mu)') : undefined} onNationClick={onNationClick}/>
                        </div>
                      );
                    }) : (
                      <div className="ko-teams">
                        <span className="tbd-t">À déterminer</span>
                        <span className="ko-vs">vs</span>
                        <span className="tbd-t">À déterminer</span>
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
function PortfolioView({ onTrade, onNationClick }: {
  onTrade: (n: Nation, m: TradeMode) => void;
  onNationClick: (id: string) => void;
}) {
  const cash              = useGameStore(s => s.cash);
  const prices            = useGameStore(s => s.prices);
  const portfolio         = useGameStore(s => s.portfolio);
  const avgCost           = useGameStore(s => s.avgCost);
  const eliminated        = useGameStore(s => s.eliminated);
  const txLog             = useGameStore(s => s.txLog);
  const bestScore         = useGameStore(s => s.bestScore);
  const liquidateEliminated = useGameStore(s => s.liquidateEliminated);

  const holdings = Object.entries(portfolio)
    .filter(([, q]) => q > 0)
    .map(([id, qty]) => {
      const n       = gN(id);
      const price   = prices[id] ?? 0;
      const avg     = avgCost[id] ?? n?.p ?? 0;
      const value   = price * qty;
      const invested = avg * qty;
      const pl      = value - invested;
      const chPct   = avg > 0 ? pctOf(price, avg) : 0;
      const isElim  = eliminated.includes(id);
      return { id, n, qty, price, avg, value, invested, pl, chPct, isElim };
    })
    .sort((a, b) => b.value - a.value);

  const portVal   = holdings.reduce((a, h) => a + h.value, 0);
  const invested  = holdings.reduce((a, h) => a + h.invested, 0);
  const totalValue = cash + portVal;
  const totalPl   = portVal - invested;
  const hasElimHeld = holdings.some(h => h.isElim);

  return (
    <div className="view-port">
      <div className="port-l">
        <div className="port-hdr">MES POSITIONS</div>
        <div className="port-sum">
          <div className="ps-item"><div className="ps-l">TOTAL</div><div className="ps-v g">{fmt(totalValue)} KC</div></div>
          <div className="ps-item"><div className="ps-l">INVESTI</div><div className="ps-v">{fmt(invested)} KC</div></div>
          <div className="ps-item"><div className="ps-l">P&amp;L</div><div className={`ps-v${totalPl >= 0 ? ' gn' : ' ls'}`}>{totalPl >= 0 ? '+' : ''}{fmt(totalPl)} KC</div></div>
          <div className="ps-item"><div className="ps-l">CASH</div><div className="ps-v">{fmt(cash)} KC</div></div>
        </div>
        {bestScore !== null && (
          <div style={{marginBottom:12,padding:'8px 12px',background:'rgba(255,219,0,.06)',border:'1px solid var(--gold-dk)',borderRadius:6,fontSize:10,color:'var(--gold)',fontWeight:700,letterSpacing:1}}>
            🏆 MEILLEUR SCORE : {fmt(bestScore)} KC
          </div>
        )}
        {hasElimHeld && (
          <button onClick={liquidateEliminated} style={{width:'100%',padding:'8px',background:'rgba(255,60,60,.08)',border:'1px solid var(--loss-dk)',borderRadius:6,color:'var(--loss)',fontSize:11,fontWeight:700,letterSpacing:1,marginBottom:10}}>
            💀 LIQUIDER LES ÉLIMINÉS · 1 KC/action
          </button>
        )}
        {holdings.length === 0
          ? <div style={{textAlign:'center',padding:40,color:'var(--di)',fontSize:12}}>Aucune position ouverte</div>
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
            <div style={{fontSize:8,letterSpacing:2,color:'var(--di)',fontWeight:700,marginBottom:8}}>HISTORIQUE DES TRANSACTIONS</div>
            {txLog.slice(0, 15).map((tx, i) => (
              <div key={i} style={{display:'grid',gridTemplateColumns:'28px 18px 1fr 22px auto 20px',gap:4,alignItems:'center',padding:'4px 0',borderBottom:'1px solid rgba(255,255,255,.04)',fontSize:10}}>
                <span style={{fontSize:8,fontWeight:700,padding:'2px 4px',borderRadius:3,textAlign:'center',background:tx.dir==='buy'?'rgba(0,255,135,.12)':'rgba(255,60,60,.12)',color:tx.dir==='buy'?'var(--gain)':'var(--loss)'}}>
                  {tx.dir === 'buy' ? 'ACH' : 'VTE'}
                </span>
                <span style={{fontSize:13,textAlign:'center'}}>{tx.flag}</span>
                <span style={{fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tx.name}</span>
                <span style={{color:'var(--di)',textAlign:'right',fontFamily:'JetBrains Mono',fontSize:9}}>×{tx.qty}</span>
                <span style={{fontFamily:'JetBrains Mono',fontWeight:600,textAlign:'right'}}>{fmt(tx.price)} KC</span>
                <span style={{color:'var(--di)',fontSize:8,textAlign:'right',fontFamily:'JetBrains Mono'}}>J{tx.day + 1}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="port-r">
        <div className="port-hdr">MARCHÉ · VOS NATIONS</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
          {holdings.map(h => h.n && <StockTile key={h.id} nation={h.n}
            onBuy={() => h.n && onTrade(h.n, 'buy')}
            onSell={() => h.n && onTrade(h.n, 'sell')}
            onCardClick={() => onNationClick(h.id)}
          />)}
        </div>
        {holdings.length === 0 && <div style={{textAlign:'center',padding:60,color:'var(--di)',fontSize:12}}>Achetez des actions dans la vue MARKET</div>}
      </div>
    </div>
  );
}

// ─── StandingsView ────────────────────────────────────────────────────────────
function StandingsView({ onNationClick, onMatchClick }: {
  onNationClick: (id: string) => void;
  onMatchClick: (r: StoredMatchResult, dayLabel: string) => void;
}) {
  const prices       = useGameStore(s => s.prices);
  const eliminated   = useGameStore(s => s.eliminated);
  const matchResults = useGameStore(s => s.matchResults);
  const dayIndex     = useGameStore(s => s.dayIndex);
  const r32Pool      = useGameStore(s => s.r32Pool);
  const portfolio    = useGameStore(s => s.portfolio);
  const champion     = useGameStore(s => s.champion);

  const standings = useMemo(
    () => buildGroupStandingsUI(matchResults, prices, eliminated),
    [matchResults, prices, eliminated],
  );

  const isKO = dayIndex > 17 || !CALENDAR[dayIndex] || CALENDAR[dayIndex]?.phase !== 'Groups';

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

  const koPhases = ['R32', 'R16', 'QF', 'SF', 'Final', '3rd'] as const;
  const koLabels: Record<string,string> = {
    R32: 'HUITIÈMES · R32', R16: 'SEIZIÈMES · R16', QF: 'QUARTS DE FINALE',
    SF: 'DEMI-FINALES', Final: '🏆 FINALE', '3rd': '🥉 PETITE FINALE',
  };

  return (
    <div className="std-wrap">
      {/* KO results */}
      {isKO && (
        <div style={{marginBottom: 20}}>
          {champion && (
            <div style={{background:'rgba(255,219,0,.06)',border:'1px solid var(--gold-dk)',borderRadius:10,padding:'16px',marginBottom:12,textAlign:'center'}}>
              <div style={{fontSize:48}}>{gN(champion)?.flag}</div>
              <button
                style={{background:'none',border:'none',cursor:'pointer',padding:0}}
                onClick={() => onNationClick(champion)}
              >
                <div style={{fontFamily:'Bebas Neue',fontSize:22,letterSpacing:4,color:'var(--gold)'}}>
                  {gN(champion)?.name?.toUpperCase()} — CHAMPION 🏆
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
                    const dayLabel = dayEntry ? CALENDAR[Number(dayEntry[0])]?.label ?? '' : '';
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
      <div style={{fontFamily:'Bebas Neue',fontSize:14,letterSpacing:3,color:'var(--mu)',marginBottom:10}}>CLASSEMENTS DE GROUPE</div>
      <div className="std-grid">
        {Object.entries(standings).map(([g, teams]) => (
          <div className="grp-card" key={g}>
            <div className="grp-hdr">GROUPE {g}</div>
            <table className="grp-table">
              <thead><tr>
                <th>Équipe</th>
                <th className="mono" title="Victoires">V</th>
                <th className="mono" title="Nuls">N</th>
                <th className="mono" title="Défaites">D</th>
                <th className="mono" title="Points">Pts</th>
                <th className="mono">Prix KC</th>
              </tr></thead>
              <tbody>
                {teams.map((t, i) => {
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

// ─── BracketView ──────────────────────────────────────────────────────────────
function BracketView({ onNationClick, onMatchClick }: {
  onNationClick: (id: string) => void;
  onMatchClick: (r: StoredMatchResult, dayLabel: string) => void;
}) {
  const matchResults = useGameStore(s => s.matchResults);
  const dayIndex     = useGameStore(s => s.dayIndex);
  const state        = useGameStore(s => s);

  const phases = [
    { label: 'HUITIÈMES DE FINALE · R32', key: 'R32' },
    { label: 'QUARTS DE FINALE',          key: 'QF'  },
    { label: 'DEMI-FINALES',              key: 'SF'  },
    { label: 'TROISIÈME PLACE',           key: '3rd' },
    { label: '🏆 FINALE',                 key: 'Final' },
  ] as const;

  return (
    <div className="bkt-wrap">
      {phases.map(phase => {
        const days = CALENDAR.filter(d => d.phase === phase.key);
        const isFinal = phase.key === 'Final';
        return (
          <div className="bkt-stage" key={phase.key}>
            <div className="bkt-stage-ttl">{phase.label}</div>
            <div className="bkt-row">
              {days.map((day, pdi) => {
                const di = CALENDAR.indexOf(day);
                const played = matchResults[di];
                const isCur  = di === dayIndex;
                const displayMatches = day.matches.length > 0
                  ? day.matches
                  : played
                    ? played.map(r => ({ a: r.a, b: r.b }))
                    : isCur
                      ? buildMatchesForCurrentDay({ ...state, dayIndex: di } as typeof state)
                      : [];

                if (displayMatches.length === 0) {
                  return (
                    <div key={pdi} className="bkt-m upcoming" style={isFinal ? {background:'rgba(255,219,0,.03)',borderColor:'rgba(255,219,0,.35)'} : {}}>
                      <div className="bkt-meta">{day.label}{isCur ? ' ▶' : ''}</div>
                      <div className="bkt-t"><span className="tbd">À déterminer</span></div>
                      <div className="bkt-t"><span className="tbd">À déterminer</span></div>
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
                    <div key={`${pdi}-${mi}`} className={`bkt-m${!played ? ' upcoming' : ''}`}
                      style={isFinal ? {background:'rgba(255,219,0,.03)',borderColor:'rgba(255,219,0,.35)'} : {}}>
                      <div className="bkt-meta">{day.label}</div>
                      <div className="bkt-t" style={{color: res ? (resA === 'A' ? 'var(--gold)' : 'var(--mu)') : undefined}}>
                        <TeamName id={m.a} color={res ? (resA === 'A' ? 'var(--gold)' : 'var(--mu)') : undefined} onNationClick={onNationClick}/>
                        {res && <button style={{background:'none',border:'none',cursor:'pointer',fontFamily:'JetBrains Mono',marginLeft:6,fontSize:14,fontWeight:700,color:'var(--gold)'}}
                          onClick={() => canonResult && onMatchClick(canonResult, day.label)}>{sA}</button>}
                      </div>
                      <div className="bkt-t" style={{color: res ? (resA === 'B' ? 'var(--gold)' : 'var(--mu)') : undefined}}>
                        <TeamName id={m.b} color={res ? (resA === 'B' ? 'var(--gold)' : 'var(--mu)') : undefined} onNationClick={onNationClick}/>
                        {res && <button style={{background:'none',border:'none',cursor:'pointer',fontFamily:'JetBrains Mono',marginLeft:6,fontSize:14,fontWeight:700,color:'var(--gold)'}}
                          onClick={() => canonResult && onMatchClick(canonResult, day.label)}>{sB}</button>}
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
  const { entries, loading, refresh } = useLeaderboard(50);
  const { user, profile } = useAuth();
  const cash      = useGameStore(s => s.cash);
  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);
  const myBest    = useGameStore(s => s.bestScore);

  const portVal = Object.entries(portfolio).reduce((a, [id, q]) => a + q * (prices[id] ?? 0), 0);
  const myTotal = cash + portVal;

  const myRank = user ? entries.findIndex(e => e.id === user.id) + 1 : null;

  return (
    <div className="rnk-wrap">
      {/* My score card */}
      <div style={{background:'rgba(255,219,0,.04)',border:'1px solid var(--gold-dk)',borderRadius:9,padding:'12px 16px',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <div style={{fontSize:9,letterSpacing:2,color:'var(--dim)',fontWeight:700,marginBottom:3}}>MON SCORE EN COURS</div>
          <div style={{fontFamily:'var(--font-mono)',fontSize:20,fontWeight:700,color:'var(--gold)'}}>{fmt(myTotal)} KC</div>
          {myBest && <div style={{fontSize:9,color:'var(--muted)',marginTop:2}}>Meilleur : {fmt(myBest)} KC</div>}
        </div>
        {!user
          ? <a href="/login" style={{background:'rgba(255,219,0,.12)',border:'1px solid var(--gold-dk)',color:'var(--gold)',padding:'6px 14px',borderRadius:6,fontSize:11,fontWeight:700,letterSpacing:1,textDecoration:'none'}}>
              ⚽ SE CONNECTER
            </a>
          : myRank
            ? <div style={{fontFamily:'var(--font-display)',fontSize:32,letterSpacing:2,color:'var(--gold)'}}>#{myRank}</div>
            : <div style={{fontSize:10,color:'var(--dim)'}}>Finissez une partie pour apparaître</div>
        }
      </div>

      <div className="rnk-tabs">
        <button className="rtab on">MEILLEURS SCORES</button>
        <button className="rtab" style={{opacity:.5,cursor:'not-allowed'}} title="Phase 3">COMPÉTITION LIVE</button>
      </div>

      {loading && <div style={{padding:32,textAlign:'center',color:'var(--dim)',fontSize:11}}>Chargement…</div>}

      {!loading && entries.length === 0 && (
        <div style={{padding:32,textAlign:'center',color:'var(--dim)',fontSize:12}}>
          <div style={{fontSize:32,marginBottom:8}}>🏆</div>
          <div>Aucun score enregistré.</div>
          <div style={{marginTop:4,color:'#333',fontSize:10}}>Connecte-toi et joue une partie pour apparaître ici.</div>
        </div>
      )}

      <div className="rnk-list">
        {entries.map((p, i) => {
          const isMe = user?.id === p.id;
          return (
            <div key={p.id} className={`rnk-row${isMe ? ' me' : ''}`}>
              <div className={`rnk-rank${i < 3 ? ' top' : ''}`}>{i+1}</div>
              <div className="rnk-av" style={isMe ? {background:'var(--gold)',color:'#000'} : {}}>
                {p.username[0].toUpperCase()}
              </div>
              <div className="rnk-info">
                <div className="rnk-name">{p.username}{isMe ? ' 👤' : ''}</div>
                <div className="rnk-sub">{p.country ?? '🌍'}</div>
              </div>
              <div className="rnk-val">{fmt(p.best_score)} KC</div>
            </div>
          );
        })}

        {/* Guest row if not logged in */}
        {!user && (
          <div className="rnk-row" style={{opacity:.5,borderStyle:'dashed'}}>
            <div className="rnk-rank">?</div>
            <div className="rnk-av">?</div>
            <div className="rnk-info">
              <div className="rnk-name">Vous</div>
              <div className="rnk-sub">Connectez-vous pour apparaître</div>
            </div>
            <div className="rnk-val">{fmt(myTotal)} KC</div>
          </div>
        )}
      </div>

      <div style={{textAlign:'center',marginTop:12}}>
        <button onClick={refresh} style={{background:'none',border:'1px solid #222',color:'#444',padding:'5px 14px',borderRadius:5,fontSize:9,letterSpacing:1,cursor:'pointer',fontFamily:'var(--font-body)'}}>
          ↻ ACTUALISER
        </button>
        <div style={{fontSize:8,color:'#333',marginTop:6}}>Mise à jour auto toutes les 30s</div>
      </div>
    </div>
  );
}

// ─── RankingView (old mock — kept for reference) ──────────────────────────────
function _OldRankingView() {
  const cash      = useGameStore(s => s.cash);
  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);
  const portVal  = Object.entries(portfolio).reduce((a, [id, q]) => a + q * (prices[id] ?? 0), 0);
  const myTotal  = portVal + cash;
  const mockRanking = [
    { name: 'GoldenBoot', country: '🇫🇷', positions: 12, total: 18420 },
    { name: 'Toi',        country: '🌍',  positions: 0,  total: myTotal, isMe: true },
  ].sort((a, b) => b.total - a.total);
  return (
    <div className="rnk-wrap">
      <div className="rnk-list">
        {mockRanking.map((p, i) => (
          <div key={p.name} className={`rnk-row${p.isMe ? ' me' : ''}`}>
            <div className={`rnk-rank${i < 3 ? ' top' : ''}`}>{i+1}</div>
            <div className="rnk-av">{p.name[0]}</div>
            <div className="rnk-info">
              <div className="rnk-name">{p.name}</div>
              <div className="rnk-sub">{p.country}</div>
            </div>
            <div className="rnk-val">{fmt(p.total)} KC</div>
          </div>
        ))}
      </div>
    </div>
  );
} // end _OldRankingView

// ─── TutorialOverlay ──────────────────────────────────────────────────────────
const TUT_STEPS = [
  { title: 'Bienvenue sur KickStock !', text: 'Investissez dans les équipes nationales comme des actions. Plus une équipe performe, plus son prix monte.', icon: '⚽' },
  { title: 'Mouvements de prix', text: "Un résultat positif augmente le prix. Une défaite le fait chuter. Le gagnant absorbe 50% de la valeur du perdant.", icon: '📈' },
  { title: 'Dividendes & Taxes', text: "Quand votre équipe se qualifie (R32, R16, QF, SF, Finale, Champion), vous recevez des dividendes en KC. La taxe (10% groupes, 5% KO) s'applique uniquement à la vente.", icon: '💰' },
  { title: 'Lock-up marché', text: "Le marché est gelé 15 min avant et 30 min après chaque match. Planifiez vos trades à l'avance !", icon: '🔒' },
];

function TutorialOverlay({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const s = TUT_STEPS[step];
  return (
    <div className="tut-overlay" onClick={onClose}>
      <div className="tut-box" onClick={e => e.stopPropagation()}>
        <button className="tut-x" onClick={onClose}>✕</button>
        <div className="tut-icon">{s.icon}</div>
        <div className="tut-title">{s.title}</div>
        <div className="tut-text">{s.text}</div>
        <div className="tut-dots">{TUT_STEPS.map((_, i) => <div key={i} className={`tut-dot${i === step ? ' on' : ''}`}/>)}</div>
        <div className="tut-btns">
          {step > 0 && <button className="tut-btn sec" onClick={() => setStep(s => s-1)}>← RETOUR</button>}
          {step < TUT_STEPS.length - 1
            ? <button className="tut-btn pri" onClick={() => setStep(s => s+1)}>SUIVANT →</button>
            : <button className="tut-btn pri" onClick={onClose}>COMMENCER ✓</button>
          }
        </div>
      </div>
    </div>
  );
}

// ─── Main BrowserShell ────────────────────────────────────────────────────────
type ViewId = 'home' | 'schedule' | 'market' | 'portfolio' | 'standings' | 'bracket' | 'ranking';

export default function BrowserShell() {
  const [view,         setView]         = useState<ViewId>('home');
  const [modal,        setModal]        = useState<{nation: Nation; mode: TradeMode} | null>(null);
  const [simResults,   setSimResults]   = useState<StoredMatchResult[] | null>(null);
  const [showAnim,     setShowAnim]     = useState(false);
  const [animResults,  setAnimResults]  = useState<StoredMatchResult[]>([]);
  const [nationId,     setNationId]     = useState<string | null>(null);
  const [matchDetail,  setMatchDetail]  = useState<{ result: StoredMatchResult; dayLabel: string } | null>(null);
  const [showTut,      setShowTut]      = useState(false);

  useEffect(() => { useGameStore.persist.rehydrate(); }, []);

  const cash      = useGameStore(s => s.cash);
  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);
  const avgCost   = useGameStore(s => s.avgCost);
  const dayIndex  = useGameStore(s => s.dayIndex);
  const resetGame = useGameStore(s => s.resetGame);
  const champion  = useGameStore(s => s.champion);

  const portVal   = Object.entries(portfolio).reduce((a, [id, q]) => a + q * (prices[id] ?? 0), 0);
  const invested  = Object.entries(portfolio).reduce((a, [id, q]) => a + q * (avgCost[id] ?? 0), 0);
  const totVal    = cash + portVal;
  const pl        = portVal - invested;
  const positions = Object.values(portfolio).filter(q => q > 0).length;
  const day       = CALENDAR[dayIndex];

  const SIDEBAR_MAIN: { id: ViewId; icon: string; label: string }[] = [
    { id: 'home',       icon: '🏠', label: 'HOME'    },
    { id: 'schedule',   icon: '📅', label: 'SCHED.'  },
    { id: 'market',     icon: '📊', label: 'MARKET'  },
    { id: 'portfolio',  icon: '💼', label: 'PORTF.'  },
    { id: 'standings',  icon: '🏆', label: 'STAND.'  },
    { id: 'bracket',    icon: '🎯', label: 'BRACKET' },
  ];

  function doTrade(n: Nation, m: TradeMode) { setModal({nation: n, mode: m}); }
  function onNationClick(id: string) { setNationId(id); }
  function onMatchClick(r: StoredMatchResult, dayLabel: string) { setMatchDetail({ result: r, dayLabel }); }

  function simulate() {
    const r = useGameStore.getState().advanceDay();
    if (!r) return;
    if (r.results.length > 0) {
      setAnimResults(r.results);
      setShowAnim(true);
    } else {
      setView('market');
    }
  }

  return (
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
            <span style={{fontSize:16}}>❓</span><span>HELP</span>
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
            <div className="tbs"><div className="tbs-l">Portefeuille</div><div className="tbs-v g">{fmt(totVal)} KC</div></div>
            <div className="tbs"><div className="tbs-l">P&amp;L</div><div className={`tbs-v ${pl >= 0 ? 'gn' : 'ls'}`}>{pl >= 0 ? '▲ +' : '▼ '}{fmt(Math.abs(pl))}</div></div>
            <div className="tbs"><div className="tbs-l">Positions</div><div className="tbs-v">{positions}</div></div>
            <div className="tbs"><div className="tbs-l">Journée</div><div className="tbs-v">J·{dayIndex+1}</div></div>
          </div>
          <div className="tb-r">
            {champion && (
              <div style={{fontFamily:'Bebas Neue',fontSize:13,letterSpacing:2,color:'var(--gold)',background:'rgba(255,219,0,.1)',border:'1px solid var(--gold-dk)',padding:'4px 10px',borderRadius:5}}>
                🏆 {gN(champion)?.flag} {gN(champion)?.name?.toUpperCase()}
              </div>
            )}
            <button className="sim-inline-btn" onClick={simulate}>
              {day ? `⚡ ${day.label}` : '🔄 NOUVEAU JEU'}
            </button>
            {!day && <button className="reset-btn" onClick={resetGame}>🔄 RESET</button>}
          </div>
        </header>

        {/* TICKER */}
        <div className="ticker-wrap">
          <div className="ticker-t">
            {[...NATIONS, ...NATIONS].map((n, i) => {
              const p = prices[n.id] ?? n.p; const up = p >= n.p;
              const pct = ((p - n.p) / n.p * 100).toFixed(1);
              return <span key={i} className="ti">{n.flag} {n.id} <span className={up ? 'up' : 'dn'}>{Math.round(p)} {up ? '▲+' : '▼'}{Math.abs(Number(pct))}%</span></span>;
            })}
          </div>
        </div>

        {/* CONTENT */}
        <div className="ks-content">
          {view === 'home'      && <HomeView      onTrade={doTrade} onNationClick={onNationClick} onMatchClick={onMatchClick}/>}
          {view === 'schedule'  && <ScheduleView  onNationClick={onNationClick} onMatchClick={onMatchClick}/>}
          {view === 'market'    && <MarketView    onTrade={doTrade} onNationClick={onNationClick}/>}
          {view === 'portfolio' && <PortfolioView onTrade={doTrade} onNationClick={onNationClick}/>}
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
            <div className="res-title">RÉSULTATS</div>
            <div className="res-matches">
              {simResults.map((r, i) => (
                <div key={i} className={`res-match${r.isUpset ? ' upset' : ''}`}>
                  <button style={{background:'none',border:'none',cursor:'pointer',color:r.res==='A'?'var(--gold)':'var(--mu)',fontFamily:'inherit',fontSize:'inherit'}}
                    onClick={() => { setSimResults(null); onNationClick(r.a); }}>{gN(r.a)?.flag} {gN(r.a)?.name?.toUpperCase()}</button>
                  <button className="res-score" style={{background:'none',border:'none',cursor:'pointer',fontFamily:'JetBrains Mono',fontWeight:700,color:'inherit'}}
                    onClick={() => { setSimResults(null); onMatchClick(r, ''); }}>
                    {r.scoreA}–{r.scoreB}
                    {r.penWinner && <span style={{fontSize:10,color:'var(--mu)'}}> ({r.penA}–{r.penB} P)</span>}
                    {r.etRes && !r.penWinner && <span style={{fontSize:10,color:'var(--gold)'}}> AET</span>}
                  </button>
                  <button style={{background:'none',border:'none',cursor:'pointer',color:r.res==='B'?'var(--gold)':'var(--mu)',fontFamily:'inherit',fontSize:'inherit'}}
                    onClick={() => { setSimResults(null); onNationClick(r.b); }}>{gN(r.b)?.flag} {gN(r.b)?.name?.toUpperCase()}</button>
                  {r.elimId && <span className="res-elim">💀 {gN(r.elimId)?.name?.toUpperCase()} éliminé</span>}
                  {r.isUpset && <span className="res-upbadge">🚀 UPSET!</span>}
                </div>
              ))}
            </div>
            {simResults.filter(r => r.divCash > 0).length > 0 && (
              <div className="res-divs">
                <div className="res-divtitle">🎁 DIVIDENDES REÇUS</div>
                {simResults.filter(r => r.divCash > 0).map((r, i) => (
                  <div key={i} className="res-divrow">
                    <span>{gN(r.winnerId ?? r.a)?.flag} {gN(r.winnerId ?? r.a)?.name?.toUpperCase()}</span>
                    <span className="res-divamt">+{fmt(r.divCash)} KC</span>
                  </div>
                ))}
              </div>
            )}
            <button className="res-close" onClick={() => setSimResults(null)}>VOIR LE MARCHÉ →</button>
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
      {showTut && <TutorialOverlay onClose={() => setShowTut(false)}/>}
    </div>
  );
}
