import * as Sentry from '@sentry/nextjs';

const SENSITIVE_KEYS = new Set([
  'device_id', 'deviceId', 'p_device_id',
  'user_id', 'userId', 'p_user_id',
  'cash', 'new_cash', 'balance',
  'password', 'token', 'secret', 'key',
  'portfolio', 'holdings', 'avg_cost', 'tx_log',
]);

function scrub(obj: unknown, depth = 0): unknown {
  if (depth > 4 || obj === null || typeof obj !== 'object') return obj;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : scrub(v, depth + 1);
  }
  return result;
}

export function captureApiException(
  err: unknown,
  context: { route: string; extra?: Record<string, unknown> },
): void {
  Sentry.captureException(err, {
    tags: { route: context.route },
    extra: context.extra ? (scrub(context.extra) as Record<string, unknown>) : undefined,
  });
}
