export type RateLimitKey = string;

export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
}

type RateLimitBucket = {
  count: number;
  expiresAt: number;
};

const buckets = new Map<RateLimitKey, RateLimitBucket>();

export function checkRateLimit(key: RateLimitKey, options: RateLimitOptions) {
  const { maxRequests, windowMs } = options;
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.expiresAt < now) {
    buckets.set(key, { count: 1, expiresAt: now + windowMs });
    return true;
  }

  if (existing.count < maxRequests) {
    existing.count += 1;
    return true;
  }

  return false;
}
