// =============================================================================
// CORS 配置 - OpenLaunch API Gateway
// =============================================================================

import type { Env } from "../types";

export interface CorsConfig {
  origins: string[];
  methods: string[];
  headers: string[];
  exposeHeaders: string[];
  credentials: boolean;
  maxAge: number;
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key, X-Request-ID",
    "Access-Control-Max-Age": "86400",
  };
}

export function getCorsConfig(env: Env): CorsConfig {
  const isProd = env.ENVIRONMENT === "production";
  const origins: string[] = isProd
    ? [
        "https://openlaunch.ai",
        "https://www.openlaunch.ai",
        "https://app.openlaunch.ai",
      ]
    : [
        "http://localhost:3000",
        "http://localhost:4000",
        "http://127.0.0.1:3000",
      ];

  const extra =
    env.ALLOWED_ORIGINS?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) || [];

  return {
    origins: [...origins, ...extra],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    headers: [
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-Request-ID",
      "X-Client-Version",
      "X-Client-Platform",
      "Content-Language",
      "Accept",
      "Accept-Language",
    ],
    exposeHeaders: [
      "X-Request-ID",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
      "X-Auth-Method",
      "X-Auth-Identity",
      "Retry-After",
    ],
    credentials: true,
    maxAge: 86400,
  };
}

export function isOriginAllowed(
  requestOrigin: string,
  config: CorsConfig,
): boolean {
  return config.origins.includes(requestOrigin) || config.origins.includes("*");
}
