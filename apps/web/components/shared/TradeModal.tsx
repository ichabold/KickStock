'use client';

import { useState, useMemo } from 'react';
import type { Nation, TradeMode } from '@kickstock/types';
import { calcTax, fmt, pctOf } from '@kickstock/game-engine';
import { CALENDAR } from '@kickstock/constants';
import { useGameStore } from '@/stores/gameStore';
import styles from './TradeModal.module.css';

interface Props {
  nation: Nation;
  initMode: TradeMode;
  onClose: () => void;
}

export default function TradeModal({ nation, initMode, onClose }: Props) {
  const [mode, setMode]   = useState<TradeMode>(initMode);
  const [qty, setQty]     = useState(1);
  const [error, setError] = useState('');

  const cash       = useGameStore(s => s.cash);
  const prices     = useGameStore(s => s.prices);
  const portfolio  = useGameStore(s => s.portfolio);
  const avgCost    = useGameStore(s => s.avgCost);
  const dayIndex   = useGameStore(s => s.dayIndex);
  const eliminated = useGameStore(s => s.eliminated);
  const trade      = useGameStore(s => s.trade);

  const price      = prices[nation.id] ?? nation.p;
  const held       = portfolio[nation.id] ?? 0;
  const isKO       = CALENDAR[dayIndex]?.isKO ?? false;
  const isCapPhase = ['Groups', 'R32'].includes(CALENDAR[dayIndex]?.phase ?? '');
  const isElim     = eliminated.includes(nation.id);
  const ch         = pctOf(price, nation.p);
  const avg        = avgCost[nation.id] ?? nation.p;

  // Total portfolio value (for 40% cap)
  const totVal = useMemo(() => {
    return cash + Object.entries(portfolio).reduce((a, [id, q]) => a + q * (prices[id] ?? 0), 0);
  }, [cash, portfolio, prices]);

  // Max quantities
  const maxBuyRaw = Math.max(0, Math.floor(cash / price));
  const maxBuyCap = isCapPhase
    ? Math.max(0, Math.floor((totVal * 0.40 - held * price) / price))
    : maxBuyRaw;
  const maxBuy    = isElim ? 0 : Math.min(maxBuyRaw, maxBuyCap);
  const maxSell   = held;
  const maxQty    = mode === 'buy' ? maxBuy : maxSell;
  const safeQty   = Math.max(1, Math.min(qty, Math.max(1, maxQty)));

  const gross      = price * safeQty;
  const fee        = mode === 'sell' ? calcTax(gross, price, isKO) : 0;
  const total      = mode === 'buy' ? gross : gross - fee;
  const cashAfter  = mode === 'buy' ? cash - total : cash + total;

  const sliderPct  = maxQty <= 1 ? 100 : ((safeQty - 1) / (maxQty - 1)) * 100;
  const sliderBg   = `linear-gradient(to right, var(--gold) ${sliderPct}%, #2A2A2A ${sliderPct}%)`;
  const concPct    = totVal > 0
    ? ((held + (mode === 'buy' ? safeQty : 0)) * price / totVal * 100).toFixed(1)
    : '0.0';

  function switchMode(m: TradeMode) { setMode(m); setQty(1); setError(''); }

  async function confirm() {
    const err = await trade(mode, nation.id, safeQty);
    if (err) { setError(err); return; }
    onClose();
  }

  return (
    <div className={styles.bg} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.sheet} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.hdr}>
          <span className={styles.flag}>{nation.flag}</span>
          <div>
            <div className={styles.title}>{nation.name.toUpperCase()}</div>
            <div className={styles.sub}>{nation.conf} · Gr.{nation.group} · {Math.round(price)} KC/action</div>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        {isElim && (
          <div className={styles.elimWarning}>💀 NATION ÉLIMINÉE — Achat impossible</div>
        )}

        {/* Info grid */}
        <div className={styles.infoGrid}>
          <div className={styles.infoBox}>
            <div className={styles.infoLbl}>PRIX</div>
            <div className={styles.infoVal}>{Math.round(price)}<span style={{ fontSize: 9, color: 'var(--dim)' }}> KC</span></div>
          </div>
          <div className={styles.infoBox}>
            <div className={styles.infoLbl}>VAR.</div>
            <div className={styles.infoVal} style={{ color: ch >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
              {ch >= 0 ? '▲' : '▼'}{Math.abs(ch)}%
            </div>
          </div>
          <div className={styles.infoBox}>
            <div className={styles.infoLbl}>DÉTENU</div>
            <div className={styles.infoVal} style={{ color: held > 0 ? 'var(--gain)' : 'var(--dim)' }}>{held}x</div>
          </div>
        </div>

        {/* Mode tabs */}
        <div className={styles.modeRow}>
          <button
            className={`${styles.modeBtn} ${mode === 'buy' ? styles.modeBuyOn : styles.modeBuy}`}
            onClick={() => switchMode('buy')}
          >BUY</button>
          <button
            className={`${styles.modeBtn} ${mode === 'sell' ? styles.modeSellOn : styles.modeSell}`}
            onClick={() => switchMode('sell')}
          >SELL</button>
        </div>

        {/* Stepper + MAX */}
        <div className={styles.stepperRow}>
          <button className={styles.stepBtn} aria-label="−" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
          <div className={styles.stepVal} aria-live="polite">{safeQty}</div>
          <button className={styles.stepBtn} aria-label="+" onClick={() => setQty(q => Math.min(maxQty, q + 1))}>+</button>
          <button className={styles.maxBtn} onClick={() => setQty(Math.max(1, maxQty))}>
            MAX {maxQty}
          </button>
        </div>

        {/* Slider */}
        <div className={styles.sliderWrap}>
          <input
            type="range"
            className={styles.slider}
            min={1}
            max={Math.max(1, maxQty)}
            value={safeQty}
            step={1}
            style={{ background: sliderBg }}
            aria-label="Quantité"
            onChange={e => setQty(+e.target.value)}
          />
        </div>

        {/* Summary */}
        <div className={styles.summary}>
          <div className={styles.sumRow}>
            <span className={styles.sumLbl}>{safeQty} × {Math.round(price)} KC</span>
            <span className={styles.sumVal}>{fmt(gross)} KC</span>
          </div>
          {mode === 'sell' && (
            <div className={styles.sumRow}>
              <span className={styles.sumLbl}>Taxe ({isKO ? '5' : '10'}%)</span>
              <span className={styles.sumVal} style={{ color: 'var(--dim)' }}>{fmt(fee)} KC</span>
            </div>
          )}
          {isCapPhase && mode === 'buy' && (
            <div className={styles.sumRow}>
              <span className={styles.sumLbl}>Concentration</span>
              <span className={styles.sumVal} style={{ color: 'var(--gold)' }}>{concPct}% / 40%</span>
            </div>
          )}
          <div className={`${styles.sumRow} ${styles.sumTotal}`}>
            <span className={styles.sumLbl}>{mode === 'buy' ? 'À PAYER' : 'NET REÇU'}</span>
            <span className={styles.sumVal} style={{ color: mode === 'buy' ? 'var(--loss)' : 'var(--gain)' }}>
              {mode === 'buy' ? `−${fmt(total)}` : `+${fmt(total)}`} KC
            </span>
          </div>
          <div className={styles.sumRow}>
            <span className={styles.sumLbl} style={{ fontSize: 9, color: 'var(--dim)' }}>Cash après</span>
            <span className={styles.sumVal} style={{ fontSize: 10, color: cashAfter < 0 ? 'var(--loss)' : 'var(--muted)' }}>
              {fmt(Math.max(0, cashAfter))} KC
            </span>
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <button
          className={`${styles.confirmBtn} ${mode === 'buy' ? styles.confirmBuy : styles.confirmSell}`}
          disabled={mode === 'buy' ? (isElim || total > cash || maxBuy === 0) : safeQty > held || held === 0}
          onClick={confirm}
        >
          CONFIRMER {mode === 'buy' ? 'ACHAT' : 'VENTE'}
        </button>
        <button className={styles.cancelBtn} onClick={onClose}>Annuler</button>
      </div>
    </div>
  );
}
