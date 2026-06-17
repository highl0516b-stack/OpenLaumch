export { RateLimiter, rateLimitHeaders, rateLimitKey } from "./rate-limit";
export type { RateLimitRecord, RateLimitResult } from "./rate-limit";

import type { KVNamespace } from "@cloudflare/workers-types";
import { RateLimiter } from "./rate-limit";
import type { RateLimitResult } from "./rate-limit";

export async function checkRateLimit(
  cache: KVNamespace,
  key: string,
  maxRequests: number = 100,
  windowMs: number = 60_000,
): Promise<RateLimitResult & { ok: boolean }> {
  const result = await new RateLimiter(cache).isAllowed(
    key,
    maxRequests,
    windowMs,
  );
  return { ...result, ok: result.allowed };
}
