'use client';

import type { Nation } from '@kickstock/types';
import { useGameStore } from '@/stores/gameStore';

interface Props {
  nation: Nation;
  /** className for the wrapper element */
  wrapClassName?: string;
  /** className for the price number */
  priceClassName?: string;
  /** className for the "KC" unit label */
  kcClassName?: string;
  /** className for the change indicator when price is up */
  changeUpClassName?: string;
  /** className for the change indicator when price is down */
  changeDnClassName?: string;
}

/**
 * MECHANIC COMPONENT — price + percentage change display.
 *
 * Shared verbatim between MobileShell and BrowserShell.
 * Guarantees that the price display formula is identical on both platforms:
 *   price  = prices[nation.id] ?? nation.p  (current price or IPO price)
 *   pct    = (price - nation.p) / nation.p * 100  (change since IPO)
 *   up     = price >= nation.p
 *
 * Do NOT add shell-specific logic here.
 * Style via className props — this component owns no CSS.
 */
export function PriceDisplay({
  nation,
  wrapClassName,
  priceClassName,
  kcClassName,
  changeUpClassName,
  changeDnClassName,
}: Props) {
  const price = useGameStore(s => s.prices[nation.id] ?? nation.p);
  const pct   = ((price - nation.p) / nation.p * 100).toFixed(1);
  const up    = price >= nation.p;

  return (
    <div className={wrapClassName}>
      <span className={priceClassName}>{Math.round(price)}</span>
      <span className={kcClassName}>KC</span>
      <span className={up ? changeUpClassName : changeDnClassName}>
        {up ? '▲ +' : '▼ '}{Math.abs(Number(pct))}%
      </span>
    </div>
  );
}
