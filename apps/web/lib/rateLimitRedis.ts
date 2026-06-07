import { Ratelimit } from '@upstash/ratelimit';
import { Redis }     from '@upstash/redis';

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL) return null;
  if (!redis) redis = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
  });
  return redis;
}

const LIMITS = {
  trade:   { requests: 30,  window: '1 m'  },
  advance: { requests: 10,  window: '1 m'  },
  state:   { requests: 120, window: '1 m'  },
  auth:       { requests: 5,   window: '10 m' },
  reset:      { requests: 5,   window: '1 m'  }, // réinitialiser un portfolio est une action rare
  checkEmail: { requests: 10,  window: '10 m' }, // anti-énumération d'emails
} as const;

type Endpoint = keyof typeof LIMITS;

const limiters: Partial<Record<Endpoint, Ratelimit>> = {};

function getLimiter(endpoint: Endpoint): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;

  if (!limiters[endpoint]) {
    const cfg = LIMITS[endpoint];
    limiters[endpoint] = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(cfg.requests, cfg.window),
      prefix: `ks:rl:${endpoint}`,
    });
  }
  return limiters[endpoint]!;
}

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  reset: number;
}

export async function checkRateLimit(
  endpoint: Endpoint,
  identifier: string,
): Promise<RateLimitResult> {
  const limiter = getLimiter(endpoint);

  if (!limiter) {
    return { limited: false, remaining: 999, reset: 0 };
  }

  const { success, remaining, reset } = await limiter.limit(identifier);
  return { limited: !success, remaining, reset };
}
