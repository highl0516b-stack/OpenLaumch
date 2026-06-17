// =============================================================================
// HTTP 代理服務 (DRY - MCP 和 AI 共享同一套轉發邏輯)
// =============================================================================

import type { Env } from "../types";
import { getCached, setCached } from "./cache";

export interface ProxyOpts {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
  cacheKey?: string;
  cacheTTL?: number;
}

export interface ProxyResult {
  status: number;
  statusText: string;
  body: string;
  headers: Record<string, string>;
  cached?: boolean;
}

export async function proxy(
  env: Env,
  ctx: ExecutionContext,
  opts: ProxyOpts,
): Promise<ProxyResult> {
  // 1. 嘗試讀快取 (僅 GET)
  if (opts.method === "GET" && opts.cacheKey) {
    const cached = await getCached<string>(env.CACHE, opts.cacheKey);
    if (cached) {
      return {
        status: 200,
        statusText: "OK",
        body: cached,
        headers: { "Content-Type": "application/json" },
        cached: true,
      };
    }
  }

  // 2. 轉發請求（帶超時）
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), opts.timeoutMs);

  try {
    const resp = await fetch(opts.url, {
      method: opts.method,
      headers: opts.headers as Record<string, string>,
      body: opts.body,
      signal: ctrl.signal,
    });
    clearTimeout(tid);

    const body = await resp.text();

    // 提取安全的響應頭
    const safeHeaders: Record<string, string> = {};
    for (const [k, v] of resp.headers) {
      if (["content-type", "content-language", "retry-after"].includes(k)) {
        safeHeaders[k] = v;
      }
    }

    // 3. 寫快取 (僅 GET 且成功)
    if (opts.method === "GET" && resp.ok && opts.cacheKey) {
      ctx.waitUntil(
        setCached(env.CACHE, opts.cacheKey, body, opts.cacheTTL || 60),
      );
    }

    return {
      status: resp.status,
      statusText: resp.statusText,
      body,
      headers: safeHeaders,
      cached: false,
    };
  } catch (e: unknown) {
    clearTimeout(tid);
    const msg = e instanceof Error ? e.message : "unknown";
    throw new Error(`proxy error: ${msg}`);
  }
}

// 簡易重試
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  retries: number = 3,
  delayMs: number = 1000,
): Promise<Response> {
  let lastErr: Error | undefined;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, init);
      if (r.ok || (r.status >= 400 && r.status < 500)) return r;
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e : new Error("fetch failed");
    }
    if (i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  throw lastErr ?? new Error("fetchWithRetry exhausted");
}
