'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { fmt, pctOf } from '@kickstock/game-engine';
import { useGameStore } from '@/stores/gameStore';
import TradeModal from './TradeModal';
import type { Nation, TeamMeta, BootstrapData, TradeMode } from '@kickstock/types';
import styles from './NationDetailOverlay.module.css';

interface Props {
  nationId: string;
  onClose: () => void;
}

function Sparkline({ prices, color }: { prices: number[]; color: string }) {
  if (prices.length < 2) return null;
  const W = 320, H = 56, pad = 2;
  const mn = Math.min(...prices), mx = Math.max(...prices);
  const range = mx - mn || 1;
  const pts = prices.map((p, i) => {
    const x = pad + (i / (prices.length - 1)) * (W - pad * 2);
    const y = H - pad - ((p - mn) / range) * (H - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="ndGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`${pad},${H} ${pts.split(' ').join(' ')} ${W - pad},${H}`}
        fill="url(#ndGrad)"
      />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function NationDetailOverlay({ nationId, onClose }: Props) {
  const t = useTranslations('nationDetail');
  const [tradeMode, setTradeMode] = useState<TradeMode | null>(null);

  const prices       = useGameStore(s => s.prices);
  const portfolio    = useGameStore(s => s.portfolio);
  const avgCost      = useGameStore(s => s.avgCost);
  const eliminated   = useGameStore(s => s.eliminated);
  const matchResults = useGameStore(s => s.matchResults);
  const teams     = useGameStore(s => s._teams);
  const bootstrap = useGameStore(s => s._bootstrap);

  const teamMeta = (teams ?? []).find(t => t.id === nationId);
  if (!teamMeta) return null;

  // Build Nation-compatible object for TradeModal (which expects Nation type)
  const nation: Nation = { id: teamMeta.id, name: teamMeta.name, flag: teamMeta.flag, p: teamMeta.initialPrice, conf: teamMeta.confederation ?? '', str: teamMeta.strength, group: teamMeta.group };

  const price  = prices[nationId] ?? teamMeta.initialPrice;
  const held   = portfolio[nationId] ?? 0;
  const avg    = avgCost[nationId] ?? teamMeta.initialPrice;
  const isElim = eliminated.includes(nationId);
  const ch     = pctOf(price, teamMeta.initialPrice);
  const val    = held * price;
  const pnl    = (price - avg) * held;

  // Build price history from matchResults
  const history = useMemo(() => {
    const h: { label: string; price: number; delta: number; matchInfo: null | {
      opp: TeamMeta | undefined; scoreFor: number; scoreAgainst: number;
      isWin: boolean; isDraw: boolean; isUpset: boolean;
      etRes: string | null; penWinner: string | null;
      penFor: number; penAgainst: number;
    } }[] = [{ label: t('initialPrice'), price: teamMeta.initialPrice, delta: 0, matchInfo: null }];

    let lastP = teamMeta.initialPrice;
    Object.entries(matchResults)
      .sort(([a], [b]) => +a - +b)
      .forEach(([diStr, results]) => {
        const day = bootstrap?.days.find(d => d.day_index === Number(diStr)) ?? null;
        results.forEach(r => {
          if (r.a !== nationId && r.b !== nationId) return;
          const isA    = r.a === nationId;
          const newP   = isA ? r.newPA : r.newPB;
          const oppId  = isA ? r.b : r.a;
          const opp    = (teams ?? []).find(t => t.id === oppId);
          const isWin  = isA ? r.res === 'A' : r.res === 'B';
          const isDraw = r.res === 'draw';
          const scoreFor = isA ? r.scoreA : r.scoreB;
          const scoreAgainst = isA ? r.scoreB : r.scoreA;
          const penFor     = isA ? r.penA : r.penB;
          const penAgainst = isA ? r.penB : r.penA;
          h.push({
            label: day?.date_label || '',
            price: newP,
            delta: newP - lastP,
            matchInfo: {
              opp, scoreFor, scoreAgainst, isWin, isDraw,
              isUpset: r.isUpset, etRes: r.etRes, penWinner: r.penWinner,
              penFor, penAgainst,
            },
          });
          lastP = newP;
        });
      });
    return h;
  }, [matchResults, nationId, teamMeta.initialPrice, bootstrap, teams]);

  const sparkPrices = history.map(h => h.price);

  return (
    <div className={styles.bg} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.sheet} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.hdr}>
          <button className={styles.back} onClick={onClose} aria-label="Fermer">✕</button>
          <span className={styles.flag}>{nation.flag}</span>
          <div className={styles.hdrInfo}>
            <div className={styles.hdrName}>{nation.name.toUpperCase()}</div>
            <div className={styles.hdrSub}>{nation.conf} · GROUPE {nation.group}{isElim ? ' · 💀' : ''}</div>
          </div>
          <div className={styles.hdrPrice}>
            <div className={styles.hdrPriceVal}>{Math.round(price)} <span style={{ fontSize: 10, color: 'var(--dim)' }}>KC</span></div>
            <div className={styles.hdrPriceCh} style={{ color: ch >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
              {ch >= 0 ? '▲+' : '▼'}{Math.abs(ch)}%
            </div>
          </div>
        </div>

        {/* Sparkline */}
        {sparkPrices.length > 1 && (
          <div className={styles.chartBox}>
            <div className={styles.chartLbl}>PRICE CHART</div>
            <Sparkline prices={sparkPrices} color={ch >= 0 ? 'var(--gain)' : 'var(--loss)'} />
          </div>
        )}

        {/* Stats */}
        <div className={styles.statsGrid}>
          <div className={styles.statBox}>
            <div className={styles.statLbl}>PRIX ACTUEL</div>
            <div className={styles.statVal}>{Math.round(price)} KC</div>
          </div>
          <div className={styles.statBox}>
            <div className={styles.statLbl}>VARIATION</div>
            <div className={styles.statVal} style={{ color: ch >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
              {ch >= 0 ? '▲+' : '▼'}{ch}%
            </div>
          </div>
          <div className={styles.statBox}>
            <div className={styles.statLbl}>ACTIONS</div>
            <div className={styles.statVal} style={{ color: held > 0 ? 'var(--gain)' : 'var(--dim)' }}>×{held}</div>
          </div>
          <div className={styles.statBox}>
            <div className={styles.statLbl}>VALEUR</div>
            <div className={styles.statVal}>{fmt(val)} KC</div>
          </div>
          {held > 0 && (
            <>
              <div className={styles.statBox}>
                <div className={styles.statLbl}>COÛT MOY.</div>
                <div className={styles.statVal} style={{ color: 'var(--dim)' }}>{fmt(avg)} KC</div>
              </div>
              <div className={styles.statBox}>
                <div className={styles.statLbl}>P&amp;L RÉEL</div>
                <div className={styles.statVal} style={{ color: pnl >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                  {pnl >= 0 ? '+' : ''}{fmt(pnl)} KC
                </div>
              </div>
            </>
          )}
        </div>

        {/* Match history */}
        <div className={styles.histTitle}>HISTORIQUE DES PRIX</div>
        {history.length === 1 && (
          <div className={styles.histEmpty}>{t('noMatchesPlayed')}</div>
        )}
        {history.map((h, i) => (
          <div key={i} className={styles.histRow}>
            <div className={styles.histDot}
              style={{ background: h.delta > 0 ? 'var(--gain)' : h.delta < 0 ? 'var(--loss)' : 'var(--dim)' }}
            />
            <div className={styles.histInfo}>
              <div className={styles.histLbl}>{h.label}</div>
              {h.matchInfo && (
                <div className={styles.histMatch}>
                  {h.matchInfo.opp?.flag} {h.matchInfo.opp?.name?.toUpperCase()}{' '}
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontWeight: 700,
                    color: h.matchInfo.isWin ? 'var(--gold)' : h.matchInfo.isDraw ? 'var(--muted)' : 'var(--loss)',
                  }}>
                    {h.matchInfo.scoreFor}–{h.matchInfo.scoreAgainst}
                  </span>
                  {h.matchInfo.penWinner && (
                    <span style={{ fontSize: 8, color: 'var(--muted)' }}> (P {h.matchInfo.penFor}–{h.matchInfo.penAgainst})</span>
                  )}
                  {h.matchInfo.etRes && !h.matchInfo.penWinner && (
                    <span style={{ fontSize: 8, color: 'var(--gold)' }}> AET</span>
                  )}
                  {h.matchInfo.isUpset && (
                    <span style={{ fontSize: 8, color: 'var(--upset)', marginLeft: 4 }}>🚀 UPSET</span>
                  )}
                </div>
              )}
            </div>
            <div className={styles.histRight}>
              <div className={styles.histPrice}>{h.price}</div>
              <div className={styles.histDelta} style={{ color: h.delta > 0 ? 'var(--gain)' : h.delta < 0 ? 'var(--loss)' : 'var(--dim)' }}>
                {h.delta === 0 ? '—' : h.delta > 0 ? `▲ +${fmt(h.delta)}` : `▼ ${fmt(h.delta)}`}
              </div>
            </div>
          </div>
        ))}

        {/* Trade buttons */}
        <div className={styles.tradeBtns}>
          <button
            className={styles.buyBtn}
            disabled={isElim}
            onClick={() => setTradeMode('buy')}
          >
            + ACHETER
          </button>
          <button
            className={styles.sellBtn}
            disabled={held === 0}
            onClick={() => setTradeMode('sell')}
          >
            − VENDRE
          </button>
        </div>

        <div style={{ height: 16 }} />
      </div>

      {tradeMode && (
        <TradeModal
          nation={nation}
          initMode={tradeMode}
          onClose={() => setTradeMode(null)}
        />
      )}
    </div>
  );
}
