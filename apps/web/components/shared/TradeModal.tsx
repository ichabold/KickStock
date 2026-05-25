'use client';

import { useState } from 'react';
import type { Nation, TradeMode } from '@kickstock/types';
import { calcTax, fmt } from '@kickstock/game-engine';
import { CALENDAR } from '@kickstock/constants';
import { useGameStore } from '@/stores/gameStore';
import styles from './TradeModal.module.css';

interface Props {
  nation: Nation;
  initMode: TradeMode;
  onClose: () => void;
}

export default function TradeModal({ nation, initMode, onClose }: Props) {
  const [mode, setMode] = useState<TradeMode>(initMode);
  const [qty, setQty] = useState(1);
  const [error, setError] = useState('');

  const cash      = useGameStore(s => s.cash);
  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);
  const dayIndex  = useGameStore(s => s.dayIndex);
  const trade     = useGameStore(s => s.trade);

  const price  = prices[nation.id] ?? nation.p;
  const held   = portfolio[nation.id] ?? 0;
  const isKO   = CALENDAR[dayIndex]?.isKO ?? false;
  const tax    = calcTax(price * qty, price, isKO);
  const total  = mode === 'buy' ? price * qty + tax : price * qty - tax;

  function confirm() {
    const err = trade(mode, nation.id, qty);
    if (err) { setError(err); return; }
    onClose();
  }

  return (
    <div className={styles.bg} onClick={onClose}>
      <div className={styles.sheet} onClick={e => e.stopPropagation()}>
        <div className={styles.hdr}>
          <span className={styles.flag}>{nation.flag}</span>
          <div>
            <div className={styles.title}>{nation.name}</div>
            <div className={styles.sub}>{nation.conf} · Groupe {nation.group}</div>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className={styles.modeRow}>
          <button
            className={`${styles.modeBtn} ${mode === 'buy' ? styles.modeBuy : ''}`}
            onClick={() => setMode('buy')}
          >BUY</button>
          <button
            className={`${styles.modeBtn} ${mode === 'sell' ? styles.modeSell : ''}`}
            onClick={() => setMode('sell')}
          >SELL</button>
        </div>

        <div className={styles.infoGrid}>
          <div className={styles.infoBox}>
            <div className={styles.infoLbl}>PRIX</div>
            <div className={styles.infoVal}>{fmt(price)} KC</div>
          </div>
          <div className={styles.infoBox}>
            <div className={styles.infoLbl}>CASH</div>
            <div className={styles.infoVal}>{fmt(cash)} KC</div>
          </div>
          <div className={styles.infoBox}>
            <div className={styles.infoLbl}>PORTEFEUILLE</div>
            <div className={styles.infoVal}>{held}x</div>
          </div>
        </div>

        <div className={styles.qtyRow}>
          <button className={styles.qtyBtn} onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
          <div className={styles.qtyVal}>{qty}</div>
          <button className={styles.qtyBtn} onClick={() => setQty(q => q + 1)}>+</button>
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <span>Montant</span>
            <span>{fmt(price * qty)} KC</span>
          </div>
          <div className={styles.summaryRow}>
            <span>Taxe ({isKO ? '5' : '10'}%)</span>
            <span className={styles.taxVal}>{fmt(tax)} KC</span>
          </div>
          <div className={`${styles.summaryRow} ${styles.totalRow}`}>
            <span>{mode === 'buy' ? 'TOTAL DÉBITÉ' : 'REÇU NET'}</span>
            <span className={mode === 'buy' ? styles.loss : styles.gain}>{fmt(total)} KC</span>
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <button
          className={`${styles.confirmBtn} ${mode === 'buy' ? styles.confirmBuy : styles.confirmSell}`}
          onClick={confirm}
        >
          CONFIRMER {mode === 'buy' ? 'ACHAT' : 'VENTE'}
        </button>
      </div>
    </div>
  );
}
