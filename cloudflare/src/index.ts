// =============================================================================
// CloudFlare Workers - OpenLaunch API Gateway
// 真實部署版：KISS + DRY，單一入口只做認證、CORS、路由分派。
// =============================================================================

import type { Env } from "./types";
import { jsonResponse } from "./lib/utils";
import { verifyAuth } from "./middleware/auth";
import {
  RateLimiter,
  rateLimitHeaders,
  rateLimitKey,
} from "./middleware/rate-limit";
import { handleMcp } from "./routes/mcp";
import { handleAi, listModels } from "./routes/ai";
import {
  APP_NAME,
  APP_VERSION,
  MCP_ROUTES,
  AI_PROVIDERS,
  RATE_LIMIT,
} from "./config";

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") || "*";
  const extra = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowedOrigins = ["*", ...extra];
  const allowOrigin =
    allowedOrigins.includes(origin) || allowedOrigins.includes("*")
      ? origin
      : allowedOrigins[0] || "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key, X-Request-ID, X-Client-Version, X-Client-Platform",
    "Access-Control-Expose-Headers":
      "X-Request-ID, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Openlaunch-Route, X-Ai-Provider, X-Ai-Model, Retry-After",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
  };
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function withRequestId(request: Request): Request {
  const headers = new Headers(request.headers);
  if (!headers.has("X-Request-ID"))
    headers.set("X-Request-ID", crypto.randomUUID());
  if (!headers.has("X-Request-Time"))
    headers.set("X-Request-Time", new Date().toISOString());
  return new Request(request, { headers });
}

function numberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function applyRateLimit(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const limiter = new RateLimiter(env.CACHE);
  const maxRequests = numberEnv(
    env.RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT.MAX_REQUESTS,
  );
  const windowMs = numberEnv(env.RATE_LIMIT_WINDOW_MS, RATE_LIMIT.WINDOW_MS);
  const result = await limiter.isAllowed(
    rateLimitKey("ip", clientIp(request), request.method),
    maxRequests,
    windowMs,
  );

  if (!result.allowed) {
    return jsonResponse(
      { error: "Rate limit exceeded" },
      429,
      rateLimitHeaders(result),
    );
  }

  return null;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const inbound = withRequestId(request);
    const url = new URL(inbound.url);
    const path = url.pathname;

    if (inbound.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), inbound, env);
    }

    const rateLimitResponse = await applyRateLimit(inbound, env);
    if (rateLimitResponse) return withCors(rateLimitResponse, inbound, env);

    const authResult = await verifyAuth(inbound, env);
    if (!authResult.allowed) {
      return withCors(
        jsonResponse(
          {
            error: authResult.reason || "未授權的請求",
            timestamp: new Date().toISOString(),
          },
          401,
        ),
        inbound,
        env,
      );
    }

    if (path === "/" || path === "/health" || path === "/api/health") {
      return withCors(
        jsonResponse({
          status: "ok",
          service: APP_NAME,
          version: APP_VERSION,
          timestamp: new Date().toISOString(),
          mcpRoutes: MCP_ROUTES.map((route) => ({
            name: route.name,
            path: route.path,
            upstreamEnv: route.upstreamEnv,
          })),
          aiProviders: Object.values(AI_PROVIDERS).map((provider) => ({
            name: provider.name,
            pathPrefix: provider.pathPrefix,
            model: provider.model,
            upstreamEnv: provider.upstreamEnv,
          })),
        }),
        inbound,
        env,
      );
    }

    if (path === "/api/status") {
      return withCors(
        jsonResponse({
          status: "running",
          version: APP_VERSION,
          timestamp: new Date().toISOString(),
          mcpRoutes: MCP_ROUTES.map((route) => ({
            name: route.name,
            path: route.path,
            description: route.description,
            upstreamEnv: route.upstreamEnv,
          })),
          aiProviders: Object.values(AI_PROVIDERS).map((provider) => ({
            name: provider.name,
            pathPrefix: provider.pathPrefix,
            upstream: provider.defaultUpstream,
            upstreamEnv: provider.upstreamEnv,
            model: provider.model,
          })),
        }),
        inbound,
        env,
      );
    }

    if (path === "/ai/models") {
      return withCors(listModels(), inbound, env);
    }

    for (const provider of Object.values(AI_PROVIDERS)) {
      if (path.startsWith(provider.pathPrefix)) {
        const subPath = path.slice(provider.pathPrefix.length) || "/";
        return withCors(
          await handleAi(provider, subPath, inbound, env, ctx),
          inbound,
          env,
        );
      }
    }

    for (const route of MCP_ROUTES) {
      if (path.startsWith(route.path)) {
        return withCors(
          await handleMcp(route, path, inbound, env, ctx),
          inbound,
          env,
        );
      }
    }

    return withCors(
      jsonResponse(
        { error: "找不到路由", path, timestamp: new Date().toISOString() },
        404,
      ),
      inbound,
      env,
    );
  },
};
