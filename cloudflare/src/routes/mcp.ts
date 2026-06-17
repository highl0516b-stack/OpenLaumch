// =============================================================================
// MCP Server 代理路由 (KISS: 共享 proxy service)
// =============================================================================

import type { Env } from "../types";
import type { McpRouteConfig } from "../config";
import { proxy } from "../services/proxy";
import { CACHE_TTL } from "../config";

function resolveUpstream(route: McpRouteConfig, env: Env): string {
  return (
    (env[route.upstreamEnv as keyof Env] as string | undefined)?.trim() ||
    route.defaultUpstream
  );
}

function joinUpstream(baseUrl: string, path: string, search: string): string {
  const suffix = path || "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${suffix.replace(/^\//, "")}${search}`;
}

function buildForwardHeaders(
  req: Request,
  routeName: string,
): Record<string, string> {
  const headers = new Headers(req.headers);
  headers.set(
    "x-forwarded-for",
    req.headers.get("CF-Connecting-IP") ||
      req.headers.get("X-Forwarded-For") ||
      "unknown",
  );
  headers.set("x-request-id", req.headers.get("X-Request-ID") || "unknown");
  headers.set("user-agent", "OpenLaunch-GW/1.0");
  headers.set("x-openlaunch-route", routeName);
  headers.delete("host");
  return Object.fromEntries(headers);
}

export async function handleMcp(
  route: McpRouteConfig,
  path: string,
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const upstreamBase = resolveUpstream(route, env);
  if (!upstreamBase) {
    return new Response(
      JSON.stringify({
        error: "MCP upstream not configured",
        name: route.name,
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const url = new URL(req.url);
  const upstreamPath = path.slice(route.path.length);
  const upstream = joinUpstream(upstreamBase, upstreamPath, url.search);
  const body = ["GET", "HEAD"].includes(req.method) ? null : await req.text();

  try {
    const result = await proxy(env, ctx, {
      url: upstream,
      method: req.method,
      headers: buildForwardHeaders(req, route.name),
      body,
      timeoutMs: 30_000,
      cacheKey:
        req.method === "GET"
          ? `cache:mcp:${route.name}:${url.pathname}`
          : undefined,
      cacheTTL: CACHE_TTL.MCP_GET,
    });

    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: {
        ...result.headers,
        "x-upstream": upstreamBase,
        "x-request-id": req.headers.get("X-Request-ID") || "unknown",
        "x-openlaunch-route": route.name,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    return new Response(
      JSON.stringify({ error: `MCP error (${route.name}): ${msg}` }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
