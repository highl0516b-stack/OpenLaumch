// =============================================================================
// 認證中間件 - OpenLaunch API Gateway
// =============================================================================

import type { Env } from "../types";

export enum AuthMethod {
  API_KEY = "api-key",
  BEARER = "bearer",
  BEARER_TOKEN = "bearer",
  CF_JWT = "cf-jwt",
  NONE = "none",
}

export interface AuthResult {
  allowed: boolean;
  ok: boolean;
  method: AuthMethod;
  identity: string | null;
  reason?: string;
}

function authResult(
  allowed: boolean,
  method: AuthMethod,
  identity: string | null,
  reason?: string,
): AuthResult {
  return { allowed, ok: allowed, method, identity, reason };
}

export async function verifyAuth(
  request: Request,
  env: Env,
): Promise<AuthResult> {
  // 無密鑰模式（開發用）
  if (!env.API_KEY && !env.BEARER_TOKEN) {
    return authResult(true, AuthMethod.NONE, "dev-mode");
  }

  // 檢查 API Key
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey && apiKey === env.API_KEY) {
    return authResult(
      true,
      AuthMethod.API_KEY,
      `api-key:${apiKey.slice(0, 8)}...`,
    );
  }

  // 檢查 Bearer Token
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    if (token === env.BEARER_TOKEN) {
      return authResult(
        true,
        AuthMethod.BEARER,
        `bearer:${token.slice(0, 8)}...`,
      );
    }
  }

  // 檢查 CloudFlare Access JWT
  const cfJwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (cfJwt && env.CF_ACCESS_JWT_AUD) {
    if (cfJwt.length > 20) {
      return authResult(true, AuthMethod.CF_JWT, "cf-zero-trust");
    }
  }

  return authResult(
    false,
    AuthMethod.NONE,
    null,
    "Missing or invalid authentication. Provide X-API-Key or Authorization: Bearer <token>",
  );
}

// ---------- Token 工具 ----------

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.substring(7);
  return null;
}

export function extractApiKey(request: Request): string | null {
  return request.headers.get("X-API-Key");
}

// ---------- IP 白名喯/黑名喯 ----------

export class IpAllowlist {
  private cache: KVNamespace | null;
  constructor(cache: KVNamespace | null) {
    this.cache = cache;
  }

  async isAllowed(ip: string): Promise<boolean> {
    if (!this.cache) return true;
    try {
      const allowed = await this.cache.get<boolean>(`allowlist:${ip}`, {
        type: "json",
      });
      return allowed ?? true;
    } catch {
      return true;
    }
  }

  async addIp(ip: string, meta: Record<string, unknown> = {}): Promise<void> {
    if (!this.cache) return;
    await this.cache.put(
      `allowlist:${ip}`,
      JSON.stringify({
        allowed: true,
        ...meta,
        addedAt: new Date().toISOString(),
      }),
      { expirationTtl: 30 * 24 * 60 * 60 },
    );
  }

  async removeIp(ip: string): Promise<void> {
    if (!this.cache) return;
    await this.cache.delete(`allowlist:${ip}`);
  }
}

export class IpBlacklist {
  private cache: KVNamespace | null;
  constructor(cache: KVNamespace | null) {
    this.cache = cache;
  }

  async isBlocked(ip: string): Promise<boolean> {
    if (!this.cache) return false;
    try {
      return (
        (await this.cache.get(`blacklist:${ip}`, { type: "json" })) !== null
      );
    } catch {
      return false;
    }
  }

  async blockIp(
    ip: string,
    reason: string,
    durationSeconds: number = 3600,
  ): Promise<void> {
    if (!this.cache) return;
    await this.cache.put(
      `blacklist:${ip}`,
      JSON.stringify({ reason, blockedAt: new Date().toISOString() }),
      { expirationTtl: durationSeconds },
    );
  }

  async unblockIp(ip: string): Promise<void> {
    if (!this.cache) return;
    await this.cache.delete(`blacklist:${ip}`);
  }
}
