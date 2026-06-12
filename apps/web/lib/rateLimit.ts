const store = new Map<string, { count: number; resetAt: number }>();

const LIMIT     = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Returns true if the IP has exceeded the rate limit.
 * In-memory: resets per Vercel instance lifecycle, which is fine for burst protection.
 */
export function isRateLimited(ip: string): boolean {
  const now   = Date.now();
  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  if (entry.count >= LIMIT) return true;

  entry.count++;
  return false;
}
