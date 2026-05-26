/**
 * mechanics/ — Shared atomic mechanic components and hooks.
 *
 * These are used VERBATIM in both MobileShell and BrowserShell.
 * They guarantee that game mechanics (prices, trade actions, portfolio
 * calculations, simulation) behave identically on both platforms, ensuring
 * cross-platform play between mobile and browser players.
 *
 * CONTRACT:
 *   - Do NOT add shell-specific logic inside these files.
 *   - Browser enrichment (charts, history, stats) wraps these — never replaces them.
 *   - If a mechanic changes (e.g. fee formula), update here once → both shells updated.
 */

export { PriceDisplay }        from './PriceDisplay';
export { TradeActions }        from './TradeActions';
export { SimulateButton }      from './SimulateButton';
export { usePortfolioTotals }  from './usePortfolioTotals';
export type { PortfolioTotals } from './usePortfolioTotals';
