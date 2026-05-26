'use client';

import { useMemo } from 'react';
import type { Nation } from '@kickstock/types';
import { useGameStore } from '@/stores/gameStore';
import { PriceDisplay } from '@/components/mechanics/PriceDisplay';
import { TradeActions }  from '@/components/mechanics/TradeActions';
import styles from './NationCard.module.css';

interface Props {
  nation: Nation;
  onBuy: () => void;
  onSell: () => void;
  onCardClick?: () => void;
  flash?: 'fu' | 'fd' | '';
}

function Sparkline({ history, color }: { history: number[]; color: string }) {
  if (history.length < 2) return null;
  const w = 100, h = 22;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const pts = history.map((v, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={styles.spark} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function NationCard({ nation, onBuy, onSell, onCardClick, flash }: Props) {
  const prices     = useGameStore(s => s.prices);
  const history    = useGameStore(s => s.priceHistory[nation.id] ?? []);
  const portfolio  = useGameStore(s => s.portfolio);
  const eliminated = useGameStore(s => s.eliminated);

  const price  = prices[nation.id] ?? nation.p;
  const held   = portfolio[nation.id] ?? 0;
  const isElim = eliminated.includes(nation.id);
  const pct    = ((price - nation.p) / nation.p * 100).toFixed(1);
  const up     = price >= nation.p;

  const cardClass = [
    styles.card,
    held > 0 ? styles.held : '',
    isElim ? styles.elim : '',
    flash === 'fu' ? styles.flashUp : '',
    flash === 'fd' ? styles.flashDn : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClass} onClick={onCardClick} style={{ cursor: onCardClick ? 'pointer' : undefined }}>
      <div className={styles.top}>
        <span className={styles.flag}>{nation.flag}</span>
        <div className={styles.info}>
          <div className={styles.name}>{nation.name?.toUpperCase()}</div>
          <div className={styles.sub}>{nation.conf} · Grp {nation.group}</div>
        </div>
        {held > 0 && <span className={`${styles.badge} ${styles.badgeHeld}`}>{held}x</span>}
        {isElim && <span className={`${styles.badge} ${styles.badgeDead}`}>OUT</span>}
      </div>

      {/* PriceDisplay — mechanic atom, shared with BrowserShell */}
      <PriceDisplay
        nation={nation}
        wrapClassName={styles.priceRow}
        priceClassName={styles.price}
        kcClassName={styles.kc}
        changeUpClassName={`${styles.ch} ${styles.up}`}
        changeDnClassName={`${styles.ch} ${styles.dn}`}
      />

      <div className={styles.strBar}>
        <div
          className={styles.strFill}
          style={{
            width: `${nation.str}%`,
            background: up ? 'var(--gain)' : 'var(--loss)',
          }}
        />
      </div>

      <Sparkline history={history} color={up ? 'var(--gain)' : 'var(--loss)'} />

      {/* TradeActions — mechanic atom, shared with BrowserShell */}
      <TradeActions
        nation={nation}
        onBuy={onBuy}
        onSell={onSell}
        wrapClassName={styles.btns}
        buyClassName={styles.buy}
        sellClassName={styles.sell}
      />

      {isElim && (
        <div className={styles.elimOverlay}>
          <span>💀</span>
          <span className={styles.elimText}>ÉLIMINÉ · {Math.round(price)} KC</span>
        </div>
      )}
    </div>
  );
}
