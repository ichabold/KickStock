'use client';

import { useState, useEffect, useMemo } from 'react';
import { useGameStore } from '@/stores/gameStore';
import { CALENDAR, NATIONS, GROUPS } from '@kickstock/constants';
import { fmt } from '@kickstock/game-engine';
import TradeModal from '@/components/shared/TradeModal';
import type { Nation, TradeMode } from '@kickstock/types';

// ─── types ────────────────────────────────────────────────────────────────────
type ViewId = 'home' | 'schedule' | 'market' | 'portfolio' | 'standings' | 'bracket' | 'ranking';
interface MatchResult { matchId:string; teamA:string; teamB:string; scoreA:number; scoreB:number; res:string; isUpset:boolean; elimId:string|null; }
interface DivResult { nationId:string; amount:number; }
interface SimResult { results:MatchResult[]; dividends:DivResult[]; }

const gN = (id:string) => NATIONS.find(n=>n.id===id);

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Spark({ history, up }: { history:number[]; up:boolean }) {
  if (history.length < 2) return <svg className="spk" viewBox="0 0 100 24" preserveAspectRatio="none"><line x1="0" y1="12" x2="100" y2="12" stroke="#333" strokeWidth="1" strokeDasharray="3,2"/></svg>;
  const mn = Math.min(...history), mx = Math.max(...history), rng = mx - mn || 1;
  const pts = history.map((v,i) => `${(i/(history.length-1))*100},${24-((v-mn)/rng)*22}`).join(' ');
  const col = up ? '#00FF87' : '#FF3B5C';
  const id = `sg${Math.random().toString(36).slice(2,6)}`;
  return (
    <svg className="spk" viewBox="0 0 100 24" preserveAspectRatio="none">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity=".25"/><stop offset="100%" stopColor={col} stopOpacity="0"/></linearGradient></defs>
      <polyline points={pts} fill="none" stroke={col} strokeWidth="1.5"/>
    </svg>
  );
}

// ─── StockTile ─────────────────────────────────────────────────────────────────
function StockTile({ nation, onBuy, onSell }: { nation:Nation; onBuy:()=>void; onSell:()=>void }) {
  const prices    = useGameStore(s=>s.prices);
  const history   = useGameStore(s=>s.priceHistory[nation.id]??[]);
  const portfolio = useGameStore(s=>s.portfolio);
  const eliminated= useGameStore(s=>s.eliminated);

  const price  = prices[nation.id]??nation.p;
  const held   = portfolio[nation.id]??0;
  const isElim = eliminated.includes(nation.id);
  const pct    = ((price-nation.p)/nation.p*100).toFixed(1);
  const up     = price >= nation.p;

  return (
    <div className={`stile${held>0?' held':''}${isElim?' elim':''}`}>
      <div className="st-top">
        <span className="st-flag">{nation.flag}</span>
        <span className="st-name">{nation.name}</span>
        {held>0 && <span className="st-held">×{held}</span>}
      </div>
      <div className="st-badges">
        <span className="bdg g">GR.{nation.group}</span>
        <span className="bdg c">{nation.conf}</span>
      </div>
      <div className="st-pr">
        <span className="st-price">{Math.round(price)}</span>
        <span className="st-kc">KC</span>
        <span className={`st-pct ${up?'up':'dn'}`}>{up?'▲+':'▼'}{Math.abs(Number(pct))}%</span>
      </div>
      <Spark history={history} up={up}/>
      {isElim
        ? <div className="bdis">💀 ÉLIMINÉ · 1 KC</div>
        : <div className="st-acts">
            <button className="bbuy" onClick={onBuy}>▲ BUY</button>
            <button className="bsell" onClick={onSell} disabled={held===0}>▼ SELL</button>
          </div>
      }
    </div>
  );
}

// ─── HomeView ─────────────────────────────────────────────────────────────────
function HomeView({ onTrade }: { onTrade:(n:Nation,m:TradeMode)=>void }) {
  const dayIndex = useGameStore(s=>s.dayIndex);
  const prevDay  = CALENDAR[dayIndex-1];
  const curDay   = CALENDAR[dayIndex];

  const todayNations = useMemo(() => {
    const ids = new Set<string>();
    (curDay?.matches??[]).forEach(m=>{ ids.add(m.a); ids.add(m.b); });
    return NATIONS.filter(n=>ids.has(n.id));
  }, [curDay]);

  return (
    <div className="view-home">
      <div className="home-l">
        {prevDay && (
          <>
            <div className="day-hdr"><span className="dot" style={{background:'#555'}}/>JOURNÉE PRÉCÉDENTE · {prevDay.label}</div>
            <div className="matches-scroll">
              {prevDay.matches.map((m,i)=>(
                <div key={i} className="mrow">
                  <div className="mteams">{gN(m.a)?.flag} {gN(m.a)?.name} <span className="vs">vs</span> {gN(m.b)?.flag} {gN(m.b)?.name}</div>
                  <div className="mbadge done">FT</div>
                </div>
              ))}
            </div>
          </>
        )}
        {curDay && (
          <>
            <div className="day-hdr"><span className="dot" style={{background:'var(--gold)'}}/>JOURNÉE COURANTE · {curDay.label}</div>
            <div className="matches-scroll">
              {curDay.matches.length>0 ? curDay.matches.map((m,i)=>(
                <div key={i} className="mrow">
                  <div className="mteams">{gN(m.a)?.flag} {gN(m.a)?.name} <span className="vs">vs</span> {gN(m.b)?.flag} {gN(m.b)?.name}</div>
                  {m.venue && <div className="mtime" style={{fontSize:9,color:'var(--di)'}}>{m.venue}</div>}
                  <div className="mbadge soon">À venir</div>
                </div>
              )) : <div style={{padding:'12px',fontSize:11,color:'var(--di)'}}>Phase KO — matchs déterminés dynamiquement</div>}
            </div>
          </>
        )}
        {!curDay && <div style={{padding:24,textAlign:'center',color:'var(--gold)',fontFamily:'Bebas Neue',fontSize:28,letterSpacing:4}}>🏆 TOURNOI TERMINÉ</div>}
      </div>
      <div className="home-r">
        <div className="hr2">ACTIONS · MATCHS DU JOUR</div>
        {todayNations.length>0
          ? <div className="tiles-grid">
              {todayNations.map(n=><StockTile key={n.id} nation={n} onBuy={()=>onTrade(n,'buy')} onSell={()=>onTrade(n,'sell')}/>)}
            </div>
          : <div style={{padding:40,textAlign:'center',color:'var(--di)',fontSize:12}}>Aucun match aujourd'hui ou phase KO</div>
        }
      </div>
    </div>
  );
}

// ─── MarketView ───────────────────────────────────────────────────────────────
function MarketView({ onTrade }: { onTrade:(n:Nation,m:TradeMode)=>void }) {
  const [filter, setFilter] = useState('');
  const [group, setGroup]   = useState('ALL');
  const prices    = useGameStore(s=>s.prices);

  const filtered = useMemo(()=>
    NATIONS.filter(n=>
      (group==='ALL'||n.group===group) &&
      (filter===''||n.name.toLowerCase().includes(filter.toLowerCase())||n.id.toLowerCase().includes(filter.toLowerCase()))
    ).sort((a,b)=>a.name.localeCompare(b.name))
  , [filter, group]);

  return (
    <div className="mkt-wrap">
      <div className="mkt-controls">
        <input className="si" placeholder="🔍 Rechercher un pays..." value={filter} onChange={e=>setFilter(e.target.value)}/>
        {GROUPS.map(g=>(
          <button key={g} className={`fp${group===g?' on':''}`} onClick={()=>setGroup(g)}>{g}</button>
        ))}
      </div>
      <div className="mkt-grid-wrap">
        <div className="mkt-grid">
          {filtered.map(n=><StockTile key={n.id} nation={n} onBuy={()=>onTrade(n,'buy')} onSell={()=>onTrade(n,'sell')}/>)}
        </div>
      </div>
    </div>
  );
}

// ─── ScheduleView ─────────────────────────────────────────────────────────────
function ScheduleView() {
  const dayIndex  = useGameStore(s=>s.dayIndex);
  const eliminated = useGameStore(s=>s.eliminated);

  const koPhases = [
    { label:'HUITIÈMES DE FINALE · R32', days: CALENDAR.filter(d=>d.phase==='R32') },
    { label:'QUARTS DE FINALE', days: CALENDAR.filter(d=>d.phase==='QF') },
    { label:'DEMI-FINALES', days: CALENDAR.filter(d=>d.phase==='SF') },
    { label:'TROISIÈME PLACE', days: CALENDAR.filter(d=>d.phase==='3rd') },
    { label:'🏆 FINALE', days: CALENDAR.filter(d=>d.phase==='Final') },
  ];

  return (
    <div className="view-sched">
      <div className="sched-l">
        <div className="day-hdr">TOUS LES MATCHS</div>
        <div className="matches-scroll">
          {CALENDAR.map((day,di)=>(
            day.matches.map((m,mi)=>(
              <div key={`${di}-${mi}`} className={`mrow${di===dayIndex?' cur':di<dayIndex?' past':''}`}>
                <div className="mtime">J·{di+1}</div>
                <div className="mteams">
                  {gN(m.a)?.flag} {gN(m.a)?.name} <span className="vs">vs</span> {gN(m.b)?.flag} {gN(m.b)?.name}
                </div>
                <div className={`mbadge ${di<dayIndex?'done':di===dayIndex?'soon':''}`}>
                  {di<dayIndex?'FT':di===dayIndex?'Prochain':'À venir'}
                </div>
              </div>
            ))
          ))}
        </div>
      </div>
      <div className="sched-r">
        {koPhases.map(phase=>(
          <div className="elim-section" key={phase.label}>
            <div className="es-hdr">{phase.label}</div>
            {phase.days.map((day,di)=>(
              <div key={di} className={`ko-match${day.matches.length===0?' tbd':''}`}>
                <div className="ko-date">{day.label}</div>
                {day.matches.length>0
                  ? day.matches.map((m,mi)=>(
                      <div key={mi} className="ko-teams">
                        {gN(m.a)?.flag} {gN(m.a)?.name} <span className="ko-vs">vs</span> {gN(m.b)?.flag} {gN(m.b)?.name}
                      </div>
                    ))
                  : <div className="ko-teams"><span className="tbd-t">À déterminer</span><span className="ko-vs">vs</span><span className="tbd-t">À déterminer</span></div>
                }
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PortfolioView ────────────────────────────────────────────────────────────
function PortfolioView({ onTrade }: { onTrade:(n:Nation,m:TradeMode)=>void }) {
  const cash      = useGameStore(s=>s.cash);
  const prices    = useGameStore(s=>s.prices);
  const portfolio = useGameStore(s=>s.portfolio);
  const bestScore = useGameStore(s=>s.bestScore);

  const holdings = Object.entries(portfolio)
    .filter(([,q])=>q>0)
    .map(([id,qty])=>{
      const n = gN(id);
      const price = prices[id]??0;
      const value = price*qty;
      const cost  = (n?.p??0)*qty;
      return { id, n, qty, price, value, cost, pl:value-cost };
    })
    .sort((a,b)=>b.value-a.value);

  const portVal    = holdings.reduce((a,h)=>a+h.value,0);
  const totalValue = cash+portVal;
  const totalPl    = holdings.reduce((a,h)=>a+h.pl,0);
  const invested   = holdings.reduce((a,h)=>a+h.cost,0);

  return (
    <div className="view-port">
      <div className="port-l">
        <div className="port-hdr">MES POSITIONS</div>
        <div className="port-sum">
          <div className="ps-item"><div className="ps-l">TOTAL</div><div className="ps-v g">{fmt(totalValue)} KC</div></div>
          <div className="ps-item"><div className="ps-l">P&amp;L</div><div className={`ps-v${totalPl>=0?' gn':' ls'}`}>{totalPl>=0?'+':''}{fmt(totalPl)} KC</div></div>
          <div className="ps-item"><div className="ps-l">CASH</div><div className="ps-v">{fmt(cash)} KC</div></div>
        </div>
        {bestScore!==null&&<div style={{marginBottom:12,padding:'8px 12px',background:'rgba(255,219,0,.06)',border:'1px solid var(--gold-dk)',borderRadius:6,fontSize:10,color:'var(--gold)',fontWeight:700,letterSpacing:1}}>🏆 MEILLEUR SCORE : {fmt(bestScore)} KC</div>}
        {holdings.length===0
          ? <div style={{textAlign:'center',padding:40,color:'var(--di)',fontSize:12}}>Aucune position ouverte</div>
          : holdings.map(h=>(
              <div key={h.id} className="pos-row" onClick={()=>h.n&&onTrade(h.n,'sell')}>
                <div className="pos-flag">{h.n?.flag}</div>
                <div className="pos-info">
                  <div className="pos-name">{h.n?.name}</div>
                  <div className="pos-qty">×{h.qty} · moy. {h.n?.p} KC</div>
                </div>
                <div className="pos-price">
                  <div className="pos-val">{fmt(h.value)} KC</div>
                  <div className={`pos-pnl${h.pl>=0?' up':' dn'}`}>{h.pl>=0?'▲ +':'▼ '}{fmt(Math.abs(h.pl))} KC</div>
                </div>
              </div>
            ))
        }
      </div>
      <div className="port-r">
        <div className="port-hdr">MARCHÉ · VOS NATIONS</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
          {holdings.map(h=>h.n&&<StockTile key={h.id} nation={h.n} onBuy={()=>h.n&&onTrade(h.n,'buy')} onSell={()=>h.n&&onTrade(h.n,'sell')}/>)}
        </div>
        {holdings.length===0&&<div style={{textAlign:'center',padding:60,color:'var(--di)',fontSize:12}}>Achetez des actions dans la vue MARKET</div>}
      </div>
    </div>
  );
}

// ─── StandingsView ────────────────────────────────────────────────────────────
function StandingsView() {
  const prices    = useGameStore(s=>s.prices);
  const eliminated = useGameStore(s=>s.eliminated);
  const dayIndex  = useGameStore(s=>s.dayIndex);
  const groupsPhase = dayIndex <= 17;

  const groupLetters = ['A','B','C','D','E','F','G','H','I','J','K','L'];

  return (
    <div className="std-wrap">
      {groupsPhase ? (
        <div className="std-grid">
          {groupLetters.map(g=>{
            const nations = NATIONS.filter(n=>n.group===g)
              .sort((a,b)=>(prices[b.id]??b.p)-(prices[a.id]??a.p));
            return (
              <div className="grp-card" key={g}>
                <div className="grp-hdr">GROUPE {g}</div>
                <table className="grp-table">
                  <thead><tr>
                    <th>Équipe</th><th className="mono">Prix KC</th><th className="mono">Var%</th>
                  </tr></thead>
                  <tbody>
                    {nations.map((n,i)=>{
                      const price = prices[n.id]??n.p;
                      const pct   = ((price-n.p)/n.p*100).toFixed(1);
                      const up    = price>=n.p;
                      const isEl  = eliminated.includes(n.id);
                      return (
                        <tr key={n.id} className={i<2&&!isEl?'q':''} style={isEl?{opacity:0.4}:{}}>
                          <td><div className="nm"><span className="fl">{n.flag}</span>{n.name}</div></td>
                          <td className="mono">{Math.round(price)}</td>
                          <td className={`mono ${up?'gn':'ls'}`}>{up?'+':''}{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          <div style={{fontFamily:'Bebas Neue',fontSize:16,letterSpacing:3,color:'var(--mu)',marginBottom:12}}>ÉQUIPES ENCORE EN COMPÉTITION</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
            {NATIONS.filter(n=>!eliminated.includes(n.id)).map(n=>{
              const price = prices[n.id]??n.p;
              const pct   = ((price-n.p)/n.p*100).toFixed(1);
              const up    = price>=n.p;
              return (
                <div key={n.id} style={{background:'var(--s1)',border:'1px solid var(--bd)',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                    <span style={{fontSize:20}}>{n.flag}</span>
                    <span style={{fontWeight:700,fontSize:12}}>{n.name}</span>
                  </div>
                  <div style={{fontFamily:'JetBrains Mono',fontSize:16,fontWeight:700}}>{Math.round(price)} KC</div>
                  <div style={{fontFamily:'JetBrains Mono',fontSize:10,color:up?'var(--gain)':'var(--loss)'}}>{up?'▲+':'▼'}{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BracketView ──────────────────────────────────────────────────────────────
function BracketView() {
  const phases = [
    { label:'HUITIÈMES DE FINALE · R32', key:'R32' },
    { label:'QUARTS DE FINALE', key:'QF' },
    { label:'DEMI-FINALES', key:'SF' },
    { label:'TROISIÈME PLACE', key:'3rd' },
    { label:'🏆 FINALE', key:'Final' },
  ];

  return (
    <div className="bkt-wrap">
      {phases.map(phase=>{
        const days = CALENDAR.filter(d=>d.phase===phase.key);
        const isFinal = phase.key==='Final';
        return (
          <div className="bkt-stage" key={phase.key}>
            <div className="bkt-stage-ttl">{phase.label}</div>
            <div className="bkt-row">
              {days.map((day,di)=>(
                day.matches.length>0
                  ? day.matches.map((m,mi)=>(
                      <div key={`${di}-${mi}`} className="bkt-m" style={isFinal?{background:'rgba(255,219,0,.03)',borderColor:'rgba(255,219,0,.35)'}:{}}>
                        <div className="bkt-meta">{day.label}</div>
                        <div className="bkt-t">{gN(m.a)?.flag} {gN(m.a)?.name}</div>
                        <div className="bkt-t">{gN(m.b)?.flag} {gN(m.b)?.name}</div>
                      </div>
                    ))
                  : <div key={di} className="bkt-m upcoming">
                      <div className="bkt-meta">{day.label}</div>
                      <div className="bkt-t"><span className="tbd">À déterminer</span></div>
                      <div className="bkt-t"><span className="tbd">À déterminer</span></div>
                    </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── RankingView ──────────────────────────────────────────────────────────────
function RankingView() {
  const cash      = useGameStore(s=>s.cash);
  const prices    = useGameStore(s=>s.prices);
  const portfolio = useGameStore(s=>s.portfolio);

  const portVal   = Object.entries(portfolio).reduce((a,[id,q])=>a+q*(prices[id]??0),0);
  const myTotal   = cash+portVal;

  const mockRanking = [
    { name:'GoldenBoot', country:'🇫🇷', positions:12, total:18420 },
    { name:'MarketKing', country:'🇪🇸', positions:9,  total:16300 },
    { name:'Toi',        country:'🌍', positions:Object.values(portfolio).filter(q=>q>0).length, total:myTotal, isMe:true },
    { name:'Klopp_Fan',  country:'🇩🇪', positions:7,  total:13200 },
    { name:'Messi_Out',  country:'🇦🇷', positions:5,  total:11800 },
  ].sort((a,b)=>b.total-a.total);

  return (
    <div className="rnk-wrap">
      <div className="rnk-tabs">
        <button className="rtab on">ALL</button>
        <button className="rtab">BY COUNTRY</button>
        <button className="rtab" style={{opacity:.5,cursor:'not-allowed'}} title="Phase 3">FRIENDS</button>
      </div>
      <div className="rnk-list">
        {mockRanking.map((p,i)=>(
          <div key={p.name} className={`rnk-row${p.isMe?' me':''}`}>
            <div className={`rnk-rank${i<3?' top':''}`}>{i+1}</div>
            <div className="rnk-av">{p.name[0]}</div>
            <div className="rnk-info">
              <div className="rnk-name">{p.name}</div>
              <div className="rnk-sub">{p.country} · {p.positions} positions</div>
            </div>
            <div className="rnk-val">{fmt(p.total)} KC</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SimulatePanel ────────────────────────────────────────────────────────────
function SimulatePanel({ onClose }: { onClose:(r:SimResult)=>void }) {
  const dayIndex   = useGameStore(s=>s.dayIndex);
  const advanceDay = useGameStore(s=>s.advanceDay);
  const [loading, setLoading] = useState(false);
  const day = CALENDAR[dayIndex];

  function play() {
    setLoading(true);
    setTimeout(()=>{
      const res = advanceDay();
      setLoading(false);
      if (res) onClose(res as SimResult);
    }, 400);
  }

  if (!day) return <div className="sim-panel"><div style={{color:'var(--gold)',fontFamily:'Bebas Neue',fontSize:22,letterSpacing:3}}>🏆 TOURNOI TERMINÉ</div></div>;
  return (
    <div className="sim-panel">
      <div className="sim-day">{day.label}</div>
      <div className="sim-phase">{day.phase}</div>
      <div className="sim-matches">{day.matches.length>0?`${day.matches.length} match${day.matches.length>1?'s':''}`:day.isKO?'Phase KO':'En attente'}</div>
      <button className="sim-btn" onClick={play} disabled={loading}>
        {loading?'⏳ SIMULATION…':'⚡ SIMULER CE JOUR'}
      </button>
    </div>
  );
}

// ─── ResultOverlay ────────────────────────────────────────────────────────────
function ResultOverlay({ result, onClose }: { result:SimResult; onClose:()=>void }) {
  return (
    <div className="res-overlay" onClick={onClose}>
      <div className="res-box" onClick={e=>e.stopPropagation()}>
        <div className="res-title">RÉSULTATS</div>
        <div className="res-matches">
          {result.results.map(r=>{
            const nA=gN(r.teamA), nB=gN(r.teamB);
            return (
              <div key={r.matchId} className={`res-match${r.isUpset?' upset':''}`}>
                <span>{nA?.flag} {nA?.name}</span>
                <span className="res-score">{r.scoreA} — {r.scoreB}</span>
                <span>{nB?.flag} {nB?.name}</span>
                {r.elimId&&<span className="res-elim">💀 {gN(r.elimId)?.name} éliminé</span>}
                {r.isUpset&&<span className="res-upbadge">⚡ UPSET!</span>}
              </div>
            );
          })}
        </div>
        {result.dividends.length>0&&(
          <div className="res-divs">
            <div className="res-divtitle">💰 DIVIDENDES REÇUS</div>
            {result.dividends.map(d=>(
              <div key={d.nationId} className="res-divrow">
                <span>{gN(d.nationId)?.flag} {gN(d.nationId)?.name}</span>
                <span className="res-divamt">+{fmt(d.amount)} KC</span>
              </div>
            ))}
          </div>
        )}
        <button className="res-close" onClick={onClose}>VOIR LE MARCHÉ →</button>
      </div>
    </div>
  );
}

// ─── TutorialOverlay ──────────────────────────────────────────────────────────
const TUT_STEPS = [
  { title:'Bienvenue sur KickStock !', text:'Investissez dans les équipes nationales comme des actions. Plus une équipe performe, plus son prix monte.', icon:'⚽' },
  { title:'Mouvements de prix', text:'Un résultat positif augmente le prix. Une défaite le fait chuter. Le gagnant absorbe 50% de la valeur du perdant.', icon:'📈' },
  { title:'Dividendes & Taxes', text:'Quand votre équipe se qualifie (R32, R16, QF, SF, Finale, Champion), vous recevez des dividendes en KC. Chaque trade est taxé (10% groupes, 5% KO).', icon:'💰' },
  { title:'Lock-up marché', text:"Le marché est gelé 15 min avant et 30 min après chaque match. Planifiez vos trades à l'avance !", icon:'🔒' },
];

function TutorialOverlay({ onClose }: { onClose:()=>void }) {
  const [step, setStep] = useState(0);
  const s = TUT_STEPS[step];
  return (
    <div className="tut-overlay" onClick={onClose}>
      <div className="tut-box" onClick={e=>e.stopPropagation()}>
        <button className="tut-x" onClick={onClose}>✕</button>
        <div className="tut-icon">{s.icon}</div>
        <div className="tut-title">{s.title}</div>
        <div className="tut-text">{s.text}</div>
        <div className="tut-dots">{TUT_STEPS.map((_,i)=><div key={i} className={`tut-dot${i===step?' on':''}`}/>)}</div>
        <div className="tut-btns">
          {step>0&&<button className="tut-btn sec" onClick={()=>setStep(s=>s-1)}>← RETOUR</button>}
          {step<TUT_STEPS.length-1
            ? <button className="tut-btn pri" onClick={()=>setStep(s=>s+1)}>SUIVANT →</button>
            : <button className="tut-btn pri" onClick={onClose}>COMMENCER ✓</button>
          }
        </div>
      </div>
    </div>
  );
}

// ─── Main BrowserShell ────────────────────────────────────────────────────────
export default function BrowserShell() {
  const [view, setView]   = useState<ViewId>('home');
  const [modal, setModal] = useState<{nation:Nation;mode:TradeMode}|null>(null);
  const [simResult, setSimResult] = useState<SimResult|null>(null);
  const [showTut, setShowTut]     = useState(false);

  useEffect(()=>{ useGameStore.persist.rehydrate(); }, []);

  const cash      = useGameStore(s=>s.cash);
  const prices    = useGameStore(s=>s.prices);
  const portfolio = useGameStore(s=>s.portfolio);
  const dayIndex  = useGameStore(s=>s.dayIndex);
  const resetGame = useGameStore(s=>s.resetGame);
  const champion  = useGameStore(s=>s.champion);

  const portVal   = Object.entries(portfolio).reduce((a,[id,q])=>a+q*(prices[id]??0),0);
  const totVal    = cash+portVal;
  const pl        = totVal-10000;
  const positions = Object.values(portfolio).filter(q=>q>0).length;
  const day       = CALENDAR[dayIndex];

  const SIDEBAR_MAIN = [
    { id:'home'      as ViewId, icon:'🏠', label:'HOME'    },
    { id:'schedule'  as ViewId, icon:'📅', label:'SCHED.'  },
    { id:'market'    as ViewId, icon:'📊', label:'MARKET'  },
    { id:'portfolio' as ViewId, icon:'💼', label:'PORTF.'  },
    { id:'standings' as ViewId, icon:'🏆', label:'STAND.'  },
    { id:'bracket'   as ViewId, icon:'🎯', label:'BRACKET' },
  ];

  function doTrade(n:Nation, m:TradeMode) { setModal({nation:n,mode:m}); }

  return (
    <div className="ks-browser">
      {/* SIDEBAR */}
      <nav className="sb">
        <div className="sb-logo"><span style={{fontSize:18}}>⚽</span><span className="sb-logotxt">KS</span></div>
        <div className="sb-nav">
          {SIDEBAR_MAIN.map(item=>(
            <button key={item.id} className={`ni${view===item.id?' on':''}`} onClick={()=>setView(item.id)}>
              <span style={{fontSize:18}}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="sb-bot">
          <button className={`ni-sm${view==='ranking'?' on':''}`} onClick={()=>setView('ranking')}>
            <span style={{fontSize:16}}>🥇</span><span>RANK.</span>
          </button>
          <button className="ni-sm" onClick={()=>setShowTut(true)}>
            <span style={{fontSize:16}}>❓</span><span>HELP</span>
          </button>
          <div className="av-btn" title="Mon profil">JR</div>
        </div>
      </nav>

      {/* MAIN */}
      <div className="ks-main">
        {/* TOPBAR */}
        <header className="topbar">
          <div className="tb-title">{view.toUpperCase()}</div>
          <div className="tb-stats">
            <div className="tbs"><div className="tbs-l">Portefeuille</div><div className="tbs-v g">{fmt(totVal)} KC</div></div>
            <div className="tbs"><div className="tbs-l">P&amp;L</div><div className={`tbs-v ${pl>=0?'gn':'ls'}`}>{pl>=0?'▲ +':'▼ '}{fmt(Math.abs(pl))}</div></div>
            <div className="tbs"><div className="tbs-l">Positions</div><div className="tbs-v">{positions}</div></div>
            <div className="tbs"><div className="tbs-l">Journée</div><div className="tbs-v">J·{dayIndex+1}</div></div>
          </div>
          <div className="tb-r">
            {champion&&<div style={{fontFamily:'Bebas Neue',fontSize:13,letterSpacing:2,color:'var(--gold)',background:'rgba(255,219,0,.1)',border:'1px solid var(--gold-dk)',padding:'4px 10px',borderRadius:5}}>🏆 {gN(champion)?.flag} {gN(champion)?.name}</div>}
            <button className="sim-inline-btn" onClick={()=>{ const r=useGameStore.getState().advanceDay(); if(r) setSimResult(r as SimResult); }}>
              {day?`⚡ ${day.label}`:'🔄 NOUVEAU JEU'}
            </button>
            {!day&&<button className="reset-btn" onClick={resetGame}>🔄 RESET</button>}
          </div>
        </header>

        {/* TICKER */}
        <div className="ticker-wrap">
          <div className="ticker-t">
            {[...NATIONS,...NATIONS].map((n,i)=>{
              const p=prices[n.id]??n.p; const up=p>=n.p;
              const pct=((p-n.p)/n.p*100).toFixed(1);
              return <span key={i} className="ti">{n.flag} {n.id} <span className={up?'up':'dn'}>{Math.round(p)} {up?'▲+':'▼'}{Math.abs(Number(pct))}%</span></span>;
            })}
          </div>
        </div>

        {/* CONTENT */}
        <div className="ks-content">
          {view==='home'      && <HomeView      onTrade={doTrade}/>}
          {view==='schedule'  && <ScheduleView  />}
          {view==='market'    && <MarketView    onTrade={doTrade}/>}
          {view==='portfolio' && <PortfolioView onTrade={doTrade}/>}
          {view==='standings' && <StandingsView />}
          {view==='bracket'   && <BracketView   />}
          {view==='ranking'   && <RankingView   />}
        </div>
      </div>

      {/* OVERLAYS */}
      {modal&&<TradeModal nation={modal.nation} initMode={modal.mode} onClose={()=>setModal(null)}/>}
      {simResult&&<ResultOverlay result={simResult} onClose={()=>{ setSimResult(null); setView('market'); }}/>}
      {showTut&&<TutorialOverlay onClose={()=>setShowTut(false)}/>}
    </div>
  );
}
