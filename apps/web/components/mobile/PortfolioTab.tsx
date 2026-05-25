'use client';

import { NATIONS } from '@kickstock/constants';
import { fmt } from '@kickstock/game-engine';
import { useGameStore } from '@/stores/gameStore';
import styles from './PortfolioTab.module.css';

export default function PortfolioTab() {
  const cash      = useGameStore(s => s.cash);
  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);
  const bestScore = useGameStore(s => s.bestScore);

  const holdings = Object.entries(portfolio)
    .filter(([, q]) => q > 0)
    .map(([id, qty]) => {
      const nation = NATIONS.find(n => n.id === id);
      const price  = prices[id] ?? 0;
      const value  = price * qty;
      const cost   = (nation?.p ?? 0) * qty;
      const pl     = value - cost;
      return { id, nation, qty, price, value, cost, pl };
    })
    .sort((a, b) => b.value - a.value);

  const portVal = holdings.reduce((a, h) => a + h.value, 0);
  const totVal  = cash + portVal;

  return (
    <div>
      <div className={styles.summary}>
        <div className={styles.summaryItem}>
          <div className={styles.summaryLbl}>CASH</div>
          <div className={styles.summaryVal}>{fmt(cash)} KC</div>
        </div>
        <div className={styles.summaryItem}>
          <div className={styles.summaryLbl}>PORTEFEUILLE</div>
          <div className={styles.summaryVal}>{fmt(portVal)} KC</div>
        </div>
        <div className={`${styles.summaryItem} ${styles.totalItem}`}>
          <div className={styles.summaryLbl}>TOTAL</div>
          <div className={`${styles.summaryVal} ${styles.gold}`}>{fmt(totVal)} KC</div>
        </div>
      </div>

      {bestScore !== null && (
        <div className={styles.best}>
          🏆 BEST SCORE: {fmt(bestScore)} KC
        </div>
      )}

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
            <div key={h.id} className={styles.holding}>
              <div className={styles.holdTop}>
                <span className={styles.holdFlag}>{h.nation?.flag}</span>
                <div className={styles.holdInfo}>
                  <div className={styles.holdName}>{h.nation?.name}</div>
                  <div className={styles.holdSub}>{h.qty}x · {fmt(h.price)} KC/action</div>
                </div>
                <div className={styles.holdRight}>
                  <div className={styles.holdValue}>{fmt(h.value)} KC</div>
                  <div className={`${styles.holdPl} ${h.pl >= 0 ? styles.gain : styles.loss}`}>
                    {h.pl >= 0 ? '▲ +' : '▼ '}{fmt(Math.abs(h.pl))} KC
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
