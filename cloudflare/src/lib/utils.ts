// =============================================================================
// 工具函數庫 - OpenLaunch API Gateway
// =============================================================================

import type { Env } from "../types";

// ---------- JSON 響應工具 ----------

export function jsonResponse<T = unknown>(
  data: T,
  status: number = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export function errorResponse(message: string, status: number = 500): Response {
  return jsonResponse(
    { error: message, timestamp: new Date().toISOString() },
    status,
  );
}

// ---------- Auth Header 提取 ----------

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.substring(7);
  return null;
}

export function extractApiKey(request: Request): string | null {
  return request.headers.get("X-API-Key");
}

// ---------- 重試邏輯 ----------

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  retries: number = 3,
  baseDelayMs: number = 1000,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.status >= 400 && response.status < 500) return response;
      if (response.ok) return response;
    } catch (err) {
      lastError = err as Error;
    }
    if (attempt < retries - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * Math.pow(2, attempt)),
      );
    }
  }
  throw (
    lastError ?? new Error(`fetchWithRetry: all ${retries} attempts failed`)
  );
}

// ---------- 請求體大小限制 ----------

export function assertPayloadSize(
  request: Request,
  maxBytes: number = 10 * 1024 * 1024,
): void {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (size > maxBytes)
      throw new Error(`Payload too large: ${size} bytes (max: ${maxBytes})`);
  }
}

// ---------- 安全讀取 Body ----------

export async function safeReadBody(
  request: Request,
  redactKeys: string[] = [],
): Promise<string> {
  try {
    const body = await request.text();
    if (redactKeys.length === 0) return body;
    let redacted = body;
    for (const key of redactKeys) {
      const regex = new RegExp(`("${key}"\\s*:\\s*)"[^"]+"`, "gi");
      redacted = redacted.replace(regex, `$1"***REDACTED***"`);
    }
    return redacted;
  } catch {
    return "";
  }
}

// ---------- Body 克隆 ----------

export async function cloneBody(response: Response): Promise<string> {
  return await response.text();
}

// ---------- 請求日誌記錄 ----------

export interface LogPayload {
  requestId: string;
  method: string;
  path: string;
  clientIp: string;
  upstream: string;
}

export async function logRequest(env: Env, payload: LogPayload): Promise<void> {
  try {
    const key = `log:req:${payload.requestId}`;
    await env.CACHE.put(
      key,
      JSON.stringify({ ...payload, timestamp: new Date().toISOString() }),
      {
        expirationTtl: 7 * 24 * 60 * 60,
      },
    );
  } catch (err) {
    console.error("logRequest error:", err);
  }
}

export interface ResponseLogPayload {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  clientIp: string;
  upstream: string;
  error?: string;
}

export async function logResponse(
  env: Env,
  payload: ResponseLogPayload,
): Promise<void> {
  try {
    const key = `log:resp:${payload.requestId}`;
    await env.CACHE.put(
      key,
      JSON.stringify({ ...payload, timestamp: new Date().toISOString() }),
      {
        expirationTtl: 7 * 24 * 60 * 60,
      },
    );
  } catch (err) {
    console.error("logResponse error:", err);
  }
}

// ---------- URL 工具 ----------

export function buildUpstreamUrl(
  baseUrl: string,
  path: string,
  search: string,
): string {
  return `${baseUrl}${path}${search}`;
}

// ---------- 格式化日誌 ----------

export function formatLogEntry(entry: {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  clientIp: string;
  upstream: string;
}): string {
  return `${entry.requestId} | ${entry.method} ${entry.path} -> ${entry.upstream} | ${entry.statusCode} | ${entry.durationMs}ms | ${entry.clientIp}`;
}
