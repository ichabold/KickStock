'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { Nation, TradeMode } from '@kickstock/types';
import { calcTax, fmt, pctOf } from '@kickstock/game-engine';
import type { BootstrapData } from '@kickstock/types';
import { useGameStore } from '@/stores/gameStore';
import styles from './TradeModal.module.css';

interface Props {
  nation: Nation;
  initMode: TradeMode;
  onClose: () => void;
}

const FIRST_TRADE_KEY = 'kickstock_first_trade_done';

export default function TradeModal({ nation, initMode, onClose }: Props) {
  const t = useTranslations('trade');
  const [mode, setMode]   = useState<TradeMode>(initMode);
  const [qty, setQty]     = useState(1);
  const [error, setError] = useState('');

  const cash       = useGameStore(s => s.cash);
  const prices     = useGameStore(s => s.prices);
  const portfolio  = useGameStore(s => s.portfolio);
  const dayIndex   = useGameStore(s => s.dayIndex);
  const eliminated = useGameStore(s => s.eliminated);
  const trade      = useGameStore(s => s.trade);

  const bootstrap = useGameStore(s => s._bootstrap);
  const currentDay = bootstrap?.days.find(d => d.day_index === dayIndex) ?? null;

  const price      = prices[nation.id] ?? nation.p;
  const held       = portfolio[nation.id] ?? 0;
  const isKO       = currentDay?.is_ko ?? false;
  const isCapPhase = ['Groups', 'R32'].includes(currentDay?.phase ?? '');
  const isElim     = eliminated.includes(nation.id);

  const totVal = useMemo(() =>
    cash + Object.entries(portfolio).reduce((a, [id, q]) => a + q * (prices[id] ?? 0), 0),
    [cash, portfolio, prices],
  );

  const maxBuyRaw = Math.max(0, Math.floor(cash / price));
  const maxBuyCap = isCapPhase
    ? Math.max(0, Math.floor((totVal * 0.40 - held * price) / price))
    : maxBuyRaw;
  const maxBuy  = isElim ? 0 : Math.min(maxBuyRaw, maxBuyCap);
  const maxSell = held;
  const maxQty  = mode === 'buy' ? maxBuy : maxSell;
  const safeQty = Math.max(1, Math.min(qty, Math.max(1, maxQty)));

  const gross     = price * safeQty;
  const fee       = mode === 'sell' ? calcTax(gross, price, isKO) : 0;
  const total     = mode === 'buy' ? gross : gross - fee;
  const cashAfter = mode === 'buy' ? cash - total : cash + total;
  const concPct   = totVal > 0
    ? ((held + (mode === 'buy' ? safeQty : 0)) * price / totVal * 100).toFixed(1)
    : '0.0';

  const ctaDisabled =
    mode === 'buy'  ? isElim || total > cash || maxBuy === 0
                    : safeQty > held || held === 0;

  async function confirm() {
    const err = await trade(mode, nation.id, safeQty);
    if (err) {
      setError(err);
      if ('vibrate' in navigator) navigator.vibrate(40);
      return;
    }
    if ('vibrate' in navigator) navigator.vibrate(8);
    if (mode === 'buy' && !localStorage.getItem(FIRST_TRADE_KEY)) {
      localStorage.setItem(FIRST_TRADE_KEY, '1');
      window.dispatchEvent(new Event('kickstock:first-trade'));
    }
    onClose();
  }

  function switchMode(m: TradeMode) { setMode(m); setQty(1); setError(''); }

  return (
    <div className={styles.bg} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={`Trade ${nation.name}`}>
        <header className={styles.head}>
          <span className={styles.flag} aria-hidden>{nation.flag}</span>
          <div style={{ flex: 1 }}>
            <h2 className={styles.title}>{nation.name}</h2>
            <p className={styles.sub}>
              {t('subtitle', { group: nation.group, held })}
            </p>
          </div>
          <button onClick={onClose} className={styles.close} aria-label={t('close')}>✕</button>
        </header>

        {isElim && (
          <div className={styles.elimWarn}>{t('eliminated')}</div>
        )}

        <div className={styles.modeRow} role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'buy'}
            className={`${styles.modeBtn} ${mode === 'buy' ? styles.modeOnBuy : ''}`}
            onClick={() => switchMode('buy')}
          >{t('buy')}</button>
          <button
            role="tab"
            aria-selected={mode === 'sell'}
            className={`${styles.modeBtn} ${mode === 'sell' ? styles.modeOnSell : ''}`}
            onClick={() => switchMode('sell')}
          >{t('sell')}</button>
        </div>

        <div className={styles.stepper}>
          <button aria-label="Decrease" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
          <div className={styles.qty} aria-live="polite">{safeQty}</div>
          <button aria-label="Increase" onClick={() => setQty(q => Math.min(maxQty, q + 1))}>+</button>
          <button className={styles.max} onClick={() => setQty(Math.max(1, maxQty))}>
            {t('max', { max: maxQty })}
          </button>
        </div>

        <input
          type="range"
          className={styles.slider}
          min={1}
          max={Math.max(1, maxQty)}
          value={safeQty}
          step={1}
          aria-label={t('quantity')}
          onChange={e => setQty(+e.target.value)}
        />

        <dl className={styles.summary}>
          <SummaryRow label={t('pricePerShare')} value={`${Math.round(price)} KC`} />
          <SummaryRow label={t('quantity')} value={`× ${safeQty}`} />
          {mode === 'sell' && (
            <SummaryRow label={isKO ? t('taxFive') : t('taxTen')} value={`${fmt(fee)} KC`} muted />
          )}
          {isCapPhase && mode === 'buy' && (
            <SummaryRow label={t('concentration')} value={`${concPct}% / 40%`} accent />
          )}
          <SummaryRow
            label={mode === 'buy' ? t('youllPay') : t('youllReceive')}
            value={`${fmt(total)} KC`}
            highlight
          />
          <SummaryRow
            label={t('cashAfter')}
            value={`${fmt(Math.max(0, cashAfter))} KC`}
            tone={cashAfter < 0 ? 'loss' : undefined}
          />
        </dl>

        {error && <div className={styles.error}>{error}</div>}

        <button
          className={`${styles.cta} ${mode === 'buy' ? styles.ctaBuy : styles.ctaSell}`}
          disabled={ctaDisabled}
          onClick={confirm}
        >
          {mode === 'buy' ? t('ctaBuy', { qty: safeQty }) : t('ctaSell', { qty: safeQty })}
        </button>
        <button className={styles.cancel} onClick={onClose}>{t('cancel')}</button>
      </div>
    </div>
  );
}

function SummaryRow({
  label, value, muted, accent, highlight, tone,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: boolean;
  highlight?: boolean;
  tone?: 'loss';
}) {
  const cls = [
    styles.row,
    muted && styles.rowMuted,
    accent && styles.rowAccent,
    highlight && styles.rowHl,
    tone === 'loss' && styles.rowLoss,
  ].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
