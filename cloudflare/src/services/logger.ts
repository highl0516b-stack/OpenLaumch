// =============================================================================
// 結構化日誌 (LOG 原則)
// =============================================================================

import type { Env } from "../types";

export interface LogEntry {
  ts: string; // ISO timestamp
  reqId: string; // X-Request-ID
  method: string;
  path: string;
  upstream: string;
  status: number;
  ms: number; // duration ms
  ip: string;
  err?: string;
  extra?: Record<string, unknown>;
}

// 控制台輸出 + KV 異步存儲 (不阻塞請求)
export function log(env: Env, entry: LogEntry): void {
  const line = JSON.stringify(entry);
  console.log(line);
  const key = `log:${entry.ts.split("T")[0]}:${entry.reqId}`;
  env.CACHE.put(key, line, { expirationTtl: CACHE_TTL.LOG }).catch(() => {});
}

// 從 config.ts 引用
const CACHE_TTL = { LOG: 7 * 86400 };

export function makeReqId(): string {
  return crypto.randomUUID();
}

export function timer(): () => number {
  const t = Date.now();
  return () => Date.now() - t;
}
