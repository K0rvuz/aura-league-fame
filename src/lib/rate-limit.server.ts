import { getRequest } from "@tanstack/react-start/server";

type Bucket = {
  count: number;
  resetAt: number;
};

const globalRateLimit = globalThis as typeof globalThis & {
  auraRateLimitBuckets?: Map<string, Bucket>;
  auraRateLimitSweepCounter?: number;
};

const buckets = globalRateLimit.auraRateLimitBuckets ?? new Map<string, Bucket>();
globalRateLimit.auraRateLimitBuckets = buckets;

function getClientIp(): string {
  const request = getRequest();

  // Render's public web services sit behind Cloudflare. Render documents
  // CF-Connecting-IP as the trusted real-client-IP header at this edge.
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;

  // Fallback for local development / alternate proxies.
  const forwarded = request.headers.get("x-forwarded-for");
  const fallbackIp = forwarded?.split(",").at(-1)?.trim();

  return fallbackIp || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function sweepExpired(now: number): void {
  globalRateLimit.auraRateLimitSweepCounter =
    (globalRateLimit.auraRateLimitSweepCounter ?? 0) + 1;

  if (globalRateLimit.auraRateLimitSweepCounter % 100 !== 0) return;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function assertRateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  sweepExpired(now);

  const bucketKey = `${key}:${getClientIp()}`;
  const current = buckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (current.count >= max) {
    const error = new Error("rate_limited") as Error & { statusCode: number };
    error.statusCode = 429;
    throw error;
  }

  current.count += 1;
}
