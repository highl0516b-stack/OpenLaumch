// =============================================================================
// KV 快取服務 (DRY - 所有快取邏輯統一在此)
// =============================================================================

import type { KVNamespace } from "@cloudflare/workers-types";

export async function getCached<T = unknown>(
  cache: KVNamespace,
  key: string,
  ttlCheck: boolean = true,
): Promise<T | null> {
  try {
    const raw = await cache.get<{ data: T; expiresAt?: number }>(key, {
      type: "json",
    });
    if (!raw) return null;
    if (ttlCheck && raw.expiresAt && Date.now() > raw.expiresAt) {
      cache.delete(key).catch(() => {});
      return null;
    }
    return raw.data as T;
  } catch {
    return null;
  }
}

export async function setCached(
  cache: KVNamespace,
  key: string,
  data: unknown,
  ttlSec: number = 300,
): Promise<void> {
  try {
    await cache.put(
      key,
      JSON.stringify({ data, expiresAt: Date.now() + ttlSec * 1000 }),
      { expirationTtl: ttlSec + 10 },
    );
  } catch (e) {
    console.error("cache write failed:", e);
  }
}

// AI 請求快取鍵 (簡易 hash)
export function aiCacheKey(provider: string, body: string): string {
  let h = 0;
  for (let i = 0; i < body.length; i++) {
    h = ((h << 5) - h + body.charCodeAt(i)) | 0;
  }
  return `ai:cache:${provider}:${Math.abs(h)}`;
}
