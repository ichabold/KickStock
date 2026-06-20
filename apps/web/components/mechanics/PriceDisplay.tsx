'use client';

import type { Nation } from '@kickstock/types';
import { useGameStore } from '@/stores/gameStore';

interface Props {
  nation: Nation;
  /**
   * Reference price for the ▲/▼ percentage indicator.
   * Defaults to nation.p (IPO price = change since initial).
   * Pass priceHistory[id][length-2] to show the last-match movement instead.
   */
  prevPrice?: number;
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
 *   ref    = prevPrice ?? nation.p           (comparison baseline)
 *   pct    = (price - ref) / ref * 100
 *   up     = price >= ref
 *
 * Do NOT add shell-specific logic here.
 * Style via className props — this component owns no CSS.
 */
export function PriceDisplay({
  nation,
  prevPrice,
  wrapClassName,
  priceClassName,
  kcClassName,
  changeUpClassName,
  changeDnClassName,
}: Props) {
  const price = useGameStore(s => s.prices[nation.id] ?? nation.p);
  const ref   = prevPrice ?? nation.p;
  const pct   = Number(((price - ref) / ref * 100).toFixed(1));
  const up    = price >= ref;
  const flat  = pct === 0;
  const arrow = flat ? '▶ ' : up ? '▲ +' : '▼ ';

  return (
    <div className={wrapClassName}>
      <span className={priceClassName}>{Math.round(price)}</span>
      <span className={kcClassName}>KC</span>
      <span className={up ? changeUpClassName : changeDnClassName}>
        {arrow}{Math.abs(pct)}%
      </span>
    </div>
  );
}
