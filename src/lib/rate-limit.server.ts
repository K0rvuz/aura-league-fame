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

  // Render documents x-forwarded-for as the client-IP source for web services.
  // Prefer Cloudflare's connecting IP when present, then Render's forwarded value.
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;

  const forwarded = request.headers.get("x-forwarded-for");
  const firstForwarded = forwarded?.split(",")[0]?.trim();
  if (firstForwarded) return firstForwarded;

  return request.headers.get("x-real-ip")?.trim() || "unknown";
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

  const ip = getClientIp();
  const bucketKey = `${key}:${ip}`;
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
