'use client';

/**
 * NationCard — unified tile component (replaces mobile NationCard + desktop StockTile).
 * Use density="compact" in the desktop 4-column grid.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { Nation } from '@kickstock/types';
import { useGameStore } from '@/stores/gameStore';
import { PriceDisplay } from '@/components/mechanics/PriceDisplay';
import { TradeActions } from '@/components/mechanics/TradeActions';
import styles from './NationCard.module.css';

type Density = 'comfortable' | 'compact';

interface Props {
  nation: Nation;
  onBuy: () => void;
  onSell: () => void;
  onCardClick?: () => void;
  density?: Density;
  flash?: 'up' | 'down' | '';
  coachTarget?: string;
}

function Sparkline({ history, up }: { history: number[]; up: boolean }) {
  if (history.length < 2) return null;
  const w = 100, h = 36;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const points = history.map((v, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return [x, y] as const;
  });
  const polyline = points.map(([x, y]) => `${x},${y}`).join(' ');
  // Anchor the fill area at the initial-price Y level instead of the bottom edge.
  // This makes the filled region grow toward the current price on the right side,
  // keeping it visible whether the stock rose or fell.
  const initY = points[0][1];
  const area  = `M0,${initY} L` + points.map(([x, y]) => `${x},${y}`).join(' L') + ` L${w},${initY} Z`;
  const color = up ? 'var(--gain)' : 'var(--loss)';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gradId = useMemo(() => `g${Math.random().toString(36).slice(2, 8)}`, []);
  // For declining stocks invert the gradient so opacity is highest near the
  // current (low) price at the bottom, making the descent clearly visible.
  const [y1, y2] = up ? ['0', '1'] : ['1', '0'];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={styles.spark} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1={y1} x2="0" y2={y2}>
          <stop offset="0%"   stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function NationCard({
  nation, onBuy, onSell, onCardClick, density = 'comfortable', flash, coachTarget,
}: Props) {
  const ts         = useTranslations('shell');
  const tt         = useTranslations('trade');
  const prices     = useGameStore(s => s.prices);
  const history    = useGameStore(s => s.priceHistory[nation.id] ?? []);
  const portfolio  = useGameStore(s => s.portfolio);
  const eliminated = useGameStore(s => s.eliminated);
  const lockedTeams = useGameStore(s => s.lockedTeams);

  const price  = prices[nation.id] ?? nation.p;
  const held   = portfolio[nation.id] ?? 0;
  const isElim = eliminated.includes(nation.id);
  const isLocked = lockedTeams.has(nation.id);
  // Use price before the last match (second-to-last history entry) for the ▲/▼ indicator.
  const prevP  = history.length >= 2 ? history[history.length - 2] : nation.p;
  const up     = price >= prevP;

  const cardClass = [
    styles.card,
    styles[density],
    held > 0 ? styles.held : '',
    isElim ? styles.elim : '',
    flash === 'up'   ? styles.flashUp : '',
    flash === 'down' ? styles.flashDn : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cardClass}
      onClick={onCardClick}
      style={{ cursor: onCardClick ? 'pointer' : undefined }}
      {...(coachTarget ? { 'data-coach': coachTarget } : {})}
    >
      <div className={styles.top}>
        <span className={styles.flag} aria-hidden>{nation.flag}</span>
        <div className={styles.info}>
          <div className={styles.name}>{nation.name}</div>
          <div className={styles.sub}>Grp {nation.group}</div>
        </div>
        {held > 0 && !isElim && (
          <span className={`${styles.tag} ${styles.tagHeld}`}>×{held}</span>
        )}
        {isElim && <span className={`${styles.tag} ${styles.tagOut}`}>{ts('elimOut')}</span>}
        {!isElim && isLocked && (
          <span className={`${styles.tag} ${styles.tagLocked}`}>{tt('lockedBadge')}</span>
        )}
      </div>

      <PriceDisplay
        nation={nation}
        wrapClassName={styles.priceRow}
        priceClassName={styles.price}
        kcClassName={styles.kc}
        changeUpClassName={`${styles.ch} ${styles.up}`}
        changeDnClassName={`${styles.ch} ${styles.dn}`}
      />

      <Sparkline history={history} up={up} />

      {isElim ? (
        <div className={styles.disabled}>{ts('eliminatedBadge')}</div>
      ) : (
        <TradeActions
          nation={nation}
          onBuy={onBuy}
          onSell={onSell}
          wrapClassName={styles.btns}
          buyClassName={styles.buy}
          sellClassName={styles.sell}
        />
      )}
    </div>
  );
}
