// =============================================================================
// 速率限制中間件 - OpenLaunch API Gateway
// =============================================================================

import type { KVNamespace } from "@cloudflare/workers-types";

// ---------- 令牌桶速率限制器 ----------

export class RateLimiter {
  private cache: KVNamespace;

  constructor(cache: KVNamespace) {
    this.cache = cache;
  }

  /**
   * 檢查是否允許請求
   * @param key 識別鍵（例如 IP 地址或用戶 ID）
   * @param maxRequests 最大請求數
   * @param windowMs 時間窗口（毫秒）
   */
  async isAllowed(
    key: string,
    maxRequests: number = 100,
    windowMs: number = 60000,
  ): Promise<RateLimitResult> {
    const cacheKey = `rl:${key}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      const record = normalizeRecord(
        await this.cache.get<RateLimitRecord | LegacyRateLimitRecord>(
          cacheKey,
          { type: "json" },
        ),
      );

      if (!record || record.resetTime < windowStart) {
        // 新窗口
        const newRecord: RateLimitRecord = {
          count: 1,
          resetTime: now + windowMs,
          firstRequestTime: now,
        };
        await this.cache.put(cacheKey, JSON.stringify(newRecord), {
          expirationTtl: Math.ceil(windowMs / 1000) + 10,
        });

        return {
          allowed: true,
          remaining: maxRequests - 1,
          resetTime: newRecord.resetTime,
          retryAfter: 0,
        };
      }

      if (record.count >= maxRequests) {
        // 超過限制
        const retryAfter = Math.ceil((record.resetTime - now) / 1000);
        return {
          allowed: false,
          remaining: 0,
          resetTime: record.resetTime,
          retryAfter,
        };
      }

      // 允許，更新計數
      record.count += 1;
      await this.cache.put(cacheKey, JSON.stringify(record), {
        expirationTtl: Math.ceil((record.resetTime - now) / 1000) + 10,
      });

      return {
        allowed: true,
        remaining: maxRequests - record.count,
        resetTime: record.resetTime,
        retryAfter: 0,
      };
    } catch (err) {
      // KV 失敗時允許請求，避免擋到正常流量
      console.error("RateLimiter error:", err);
      return { allowed: true, remaining: -1, resetTime: 0, retryAfter: 0 };
    }
  }

  /**
   * 批量檢查多個鍵
   */
  async isAllowedBatch(
    keys: string[],
    maxRequests: number = 100,
    windowMs: number = 60000,
  ): Promise<Record<string, RateLimitResult>> {
    const results: Record<string, RateLimitResult> = {};
    await Promise.all(
      keys.map(async (key) => {
        results[key] = await this.isAllowed(key, maxRequests, windowMs);
      }),
    );
    return results;
  }

  /**
   * 重置指定鍵的速率限制
   */
  async reset(key: string): Promise<void> {
    try {
      const cacheKey = `rl:${key}`;
      await this.cache.delete(cacheKey);
    } catch (err) {
      console.error("RateLimiter reset error:", err);
    }
  }
}

// ---------- 類型定義 ----------

export interface RateLimitRecord {
  count: number;
  resetTime: number;
  firstRequestTime: number;
}

interface LegacyRateLimitRecord {
  c: number;
  r: number;
}

function normalizeRecord(
  raw: RateLimitRecord | LegacyRateLimitRecord | null,
): RateLimitRecord | null {
  if (!raw) return null;
  if ("count" in raw && "resetTime" in raw) return raw;
  return {
    count: raw.c,
    resetTime: raw.r,
    firstRequestTime: raw.r,
  };
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter: number; // 秒
}

// ---------- 速率限制響應頭 ----------

export function rateLimitHeaders(
  result: RateLimitResult,
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.remaining + 1),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetTime / 1000)),
    ...(result.retryAfter > 0
      ? { "Retry-After": String(result.retryAfter) }
      : {}),
  };
}

// ---------- Key 生成工具 ----------

export function rateLimitKey(
  prefix: string,
  identifier: string,
  suffix: string = "",
): string {
  return `${prefix}:${identifier}${suffix ? `:${suffix}` : ""}`;
}
