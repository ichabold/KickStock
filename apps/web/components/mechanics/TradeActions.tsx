'use client';

import { useTranslations } from 'next-intl';
import type { Nation } from '@kickstock/types';
import { useGameStore } from '@/stores/gameStore';

interface Props {
  nation: Nation;
  onBuy:  () => void;
  onSell: () => void;
  /** className for the wrapper div (stopPropagation applied) */
  wrapClassName?: string;
  /** className for the BUY button */
  buyClassName?: string;
  /** className for the SELL button */
  sellClassName?: string;
  /** Label overrides — defaults to "BUY" / "SELL" */
  buyLabel?:  string;
  sellLabel?: string;
}

/**
 * MECHANIC COMPONENT — BUY / SELL button pair.
 *
 * Shared verbatim between MobileShell and BrowserShell.
 * Guarantees that disabled-state logic is identical on both platforms:
 *   BUY  disabled when nation is eliminated
 *   SELL disabled when player holds 0 shares
 *
 * Returns null (renders nothing) when nation is eliminated — both shells
 * must show the eliminated state themselves via their own UI.
 *
 * Do NOT add shell-specific logic here.
 * Style via className props — this component owns no CSS.
 */
export function TradeActions({
  nation,
  onBuy,
  onSell,
  wrapClassName,
  buyClassName,
  sellClassName,
  buyLabel,
  sellLabel,
}: Props) {
  const t      = useTranslations('trade');
  const held   = useGameStore(s => s.portfolio[nation.id] ?? 0);
  const isElim = useGameStore(s => s.eliminated.includes(nation.id));
  const locked = useGameStore(s => s.lockedTeams.has(nation.id));

  if (isElim) return null;

  if (locked) {
    return (
      <div className={wrapClassName} onClick={e => e.stopPropagation()}>
        <button className={buyClassName} disabled aria-label={t('locked')}>
          {t('lockedBadge')}
        </button>
      </div>
    );
  }

  return (
    <div className={wrapClassName} onClick={e => e.stopPropagation()}>
      <button
        className={buyClassName}
        onClick={onBuy}
        aria-label={`Acheter ${nation.name}`}
      >
        {buyLabel ?? t('buy')}
      </button>
      <button
        className={sellClassName}
        onClick={onSell}
        disabled={held === 0}
        aria-label={`Vendre ${nation.name}`}
      >
        {sellLabel ?? t('sell')}
      </button>
    </div>
  );
}
