/**
 * Transaction tax:
 * - Group stage: 10% of amount, minimum 10 KC
 * - KO rounds: 5% of amount, minimum 10 KC
 * - Eliminated teams (price ≤ 1): 0
 */
export function calcTax(amount: number, price: number, isKO = false): number {
  if (price <= 1) return 0;
  return Math.max(amount * (isKO ? 0.05 : 0.10), 10);
}
