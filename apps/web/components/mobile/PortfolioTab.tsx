'use client';

import { useState } from 'react';
import { NATIONS } from '@kickstock/constants';
import { fmt, pctOf } from '@kickstock/game-engine';
import { useGameStore } from '@/stores/gameStore';
import { usePortfolioTotals } from '@/components/mechanics';
import TradeModal from '@/components/shared/TradeModal';
import NationDetailOverlay from '@/components/shared/NationDetailOverlay';
import type { Nation, TradeMode } from '@kickstock/types';
import styles from './PortfolioTab.module.css';

export default function PortfolioTab() {
  const [modal,    setModal]    = useState<{ nation: Nation; mode: TradeMode } | null>(null);
  const [nationId, setNationId] = useState<string | null>(null);

  // usePortfolioTotals — mechanic hook, same formula as BrowserShell PortfolioView
  const { cash, portVal, invested, totalVal: totVal, pl: totalPL, plPct: totalPLPct, bestScore } = usePortfolioTotals();

  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);
  const avgCost   = useGameStore(s => s.avgCost);
  const eliminated = useGameStore(s => s.eliminated);
  const txLog     = useGameStore(s => s.txLog);

  const holdings = Object.entries(portfolio)
    .filter(([, q]) => q > 0)
    .map(([id, qty]) => {
      const nation  = NATIONS.find(n => n.id === id);
      const price   = prices[id] ?? 0;
      const avg     = avgCost[id] ?? nation?.p ?? 0;
      const value   = price * qty;
      const invested = avg * qty;
      const pl      = value - invested;
      const chPct   = avg > 0 ? pctOf(price, avg) : 0;
      const isElim  = eliminated.includes(id);
      return { id, nation, qty, price, avg, value, invested, pl, chPct, isElim };
    })
    .sort((a, b) => b.value - a.value);

  const hasElimHeld = holdings.some(h => h.isElim);

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className={styles.hero}>
        <div className={styles.heroLbl}>VALEUR TOTALE</div>
        <div className={styles.heroVal}>{fmt(totVal)} KC</div>
        {invested > 0 && (
          <div className={`${styles.heroPL} ${totalPL >= 0 ? styles.gain : styles.loss}`}>
            {totalPL >= 0 ? '▲ +' : '▼ '}{fmt(Math.abs(totalPL))} KC
            <span className={styles.heroPLPct}> ({totalPL >= 0 ? '+' : ''}{totalPLPct}%)</span>
          </div>
        )}
      </div>

      {/* ── Stats row ────────────────────────────────────────────────────── */}
      <div className={styles.statsRow}>
        <div className={styles.statBox}>
          <div className={styles.statLbl}>CASH</div>
          <div className={styles.statVal}>{fmt(cash)}</div>
        </div>
        <div className={styles.statBox}>
          <div className={styles.statLbl}>INVESTI</div>
          <div className={styles.statVal}>{fmt(invested)}</div>
        </div>
        <div className={`${styles.statBox} ${totalPL >= 0 ? styles.statGain : styles.statLoss}`}>
          <div className={styles.statLbl}>P&amp;L</div>
          <div className={`${styles.statVal} ${totalPL >= 0 ? styles.gain : styles.loss}`}>
            {totalPL >= 0 ? '+' : ''}{fmt(totalPL)}
          </div>
        </div>
      </div>

      {/* ── Best score ───────────────────────────────────────────────────── */}
      {bestScore !== null && (
        <div className={styles.best}>🏆 MEILLEUR SCORE: {fmt(bestScore)} KC</div>
      )}

      {/* ── Eliminated notice (liquidation is automatic server-side) ──────── */}
      {hasElimHeld && (
        <div className={styles.liquidateBtn} style={{ cursor: 'default' }}>
          💀 Nations éliminées — liquidation automatique
        </div>
      )}

      {/* ── Holdings ─────────────────────────────────────────────────────── */}
      {holdings.length === 0 ? (
        <div className={styles.empty}>
          <div style={{ fontSize: 40 }}>📊</div>
          <div>Portefeuille vide</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Achetez des actions dans l&apos;onglet MARKET
          </div>
        </div>
      ) : (
        <div className={styles.holdings}>
          {holdings.map(h => (
            <div
              key={h.id}
              className={`${styles.holding} ${h.isElim ? styles.holdElim : ''}`}
              onClick={() => setNationId(h.id)}
            >
              <div className={styles.holdTop}>
                <span className={styles.holdFlag}>{h.nation?.flag}</span>
                <div className={styles.holdInfo}>
                  <div className={styles.holdName}>
                    {h.nation?.name?.toUpperCase()}
                    {h.isElim && <span className={styles.elimBadge}>💀 ÉLIMINÉ</span>}
                  </div>
                  <div className={styles.holdSub}>
                    {h.qty}x ·{' '}
                    <span style={{ color: 'var(--dim)' }}>{fmt(h.avg)}</span>
                    {' → '}
                    <span style={{ color: h.chPct >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                      {fmt(h.price)} KC
                    </span>
                    <span className={`${styles.holdChg} ${h.chPct >= 0 ? styles.gain : styles.loss}`}>
                      {' '}{h.chPct >= 0 ? '▲' : '▼'}{Math.abs(h.chPct)}%
                    </span>
                  </div>
                </div>
                <div className={styles.holdRight}>
                  <div className={styles.holdValue}>{fmt(h.value)} KC</div>
                  <div className={`${styles.holdPl} ${h.pl >= 0 ? styles.gain : styles.loss}`}>
                    {h.pl >= 0 ? '+' : ''}{fmt(h.pl)} KC
                  </div>
                </div>
              </div>
              <div className={styles.sellHint}>Appuyer pour détails →</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Trade history ────────────────────────────────────────────────── */}
      {txLog.length > 0 && (
        <div className={styles.txSection}>
          <div className={styles.txTitle}>HISTORIQUE DES TRANSACTIONS</div>
          {txLog.slice(0, 20).map((tx, i) => (
            <div key={i} className={styles.txRow}>
              <span className={`${styles.txDir} ${tx.dir === 'buy' ? styles.txBuy : styles.txSell}`}>
                {tx.dir === 'buy' ? 'ACH' : 'VTE'}
              </span>
              <span className={styles.txFlag}>{tx.flag}</span>
              <span className={styles.txName}>{tx.name}</span>
              <span className={styles.txQty}>{tx.qty}x</span>
              <span className={styles.txPrice}>{fmt(tx.price)} KC</span>
              <span className={styles.txDay}>J{tx.day + 1}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Trade modal ──────────────────────────────────────────────────── */}
      {modal && (
        <TradeModal
          nation={modal.nation}
          initMode={modal.mode}
          onClose={() => setModal(null)}
        />
      )}

      {/* ── Nation detail ────────────────────────────────────────────────── */}
      {nationId && (
        <NationDetailOverlay
          nationId={nationId}
          onClose={() => setNationId(null)}
        />
      )}
    </div>
  );
}
