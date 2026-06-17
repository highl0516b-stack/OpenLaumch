// =============================================================================
// AI Gateway 路由 (KISS: 共享 proxy + auth + usage tracking)
// =============================================================================

import type { Env } from "../types";
import type { AiProviderConfig } from "../config";
import { proxy } from "../services/proxy";
import { aiCacheKey, setCached } from "../services/cache";
import { AI_PROVIDERS, CACHE_TTL } from "../config";
import { jsonResponse } from "../lib/utils";

function resolveUpstream(provider: AiProviderConfig, env: Env): string {
  return (
    (env[provider.upstreamEnv as keyof Env] as string | undefined)?.trim() ||
    provider.defaultUpstream
  );
}

function missingSecret(provider: AiProviderConfig, env: Env): string | null {
  if (!provider.secretEnv) return null;
  return env[provider.secretEnv as keyof Env] ? null : provider.secretEnv;
}

function authHeaders(
  provider: AiProviderConfig,
  env: Env,
): Record<string, string> {
  if (provider.name === "openai") {
    return { Authorization: `Bearer ${env.OPENAI_API_KEY}` };
  }
  if (provider.name === "anthropic") {
    return {
      "x-api-key": env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    };
  }
  return {};
}

function parseUsage(body: string): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  try {
    const parsed = JSON.parse(body);
    const promptTokens = Number(parsed.usage?.prompt_tokens || 0);
    const completionTokens = Number(parsed.usage?.completion_tokens || 0);
    return {
      promptTokens,
      completionTokens,
      totalTokens: Number(
        parsed.usage?.total_tokens || promptTokens + completionTokens,
      ),
    };
  } catch {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
}

function estimateCost(
  provider: AiProviderConfig,
  usage: { promptTokens: number; completionTokens: number },
): number {
  return (
    usage.promptTokens * provider.inputCost +
    usage.completionTokens * provider.outputCost
  );
}

function buildUpstreamUrl(
  provider: AiProviderConfig,
  env: Env,
  subPath: string,
  search: string,
): string {
  const baseUrl = resolveUpstream(provider, env);
  const suffix = subPath || "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const upstream = new URL(
    `${suffix.replace(/^\//, "")}${search}`,
    normalizedBase,
  );

  if (provider.name === "google" && env.GOOGLE_API_KEY) {
    upstream.searchParams.set("key", env.GOOGLE_API_KEY);
  }

  return upstream.toString();
}

function forwardHeaders(
  req: Request,
  provider: AiProviderConfig,
  env: Env,
): Record<string, string> {
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("authorization");
  headers.delete("x-api-key");
  headers.set("content-type", "application/json");
  headers.set("user-agent", "OpenLaunch-GW/1.0");
  headers.set("x-openlaunch-ai-provider", provider.name);
  return { ...Object.fromEntries(headers), ...authHeaders(provider, env) };
}

export async function handleAi(
  provider: AiProviderConfig,
  subPath: string,
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const secret = missingSecret(provider, env);
  if (secret) {
    return jsonResponse(
      {
        error: "AI provider secret not configured",
        provider: provider.name,
        secretEnv: secret,
      },
      503,
    );
  }

  const upstream = resolveUpstream(provider, env);
  if (!upstream) {
    return jsonResponse(
      {
        error: "AI upstream not configured",
        provider: provider.name,
        upstreamEnv: provider.upstreamEnv,
      },
      503,
    );
  }

  const url = new URL(req.url);
  const body = ["GET", "HEAD"].includes(req.method) ? null : await req.text();
  const cacheKey =
    req.method === "POST" && body ? aiCacheKey(provider.name, body) : undefined;
  const startedAt = Date.now();

  try {
    const result = await proxy(env, ctx, {
      url: buildUpstreamUrl(provider, env, subPath, url.search),
      method: req.method,
      headers: forwardHeaders(req, provider, env),
      body,
      timeoutMs: 120_000,
      cacheKey,
      cacheTTL: CACHE_TTL.AI,
    });

    const usage = parseUsage(result.body);
    const cost = estimateCost(provider, usage);

    if (req.method === "POST" && body && cacheKey) {
      ctx.waitUntil(setCached(env.CACHE, cacheKey, result.body, CACHE_TTL.AI));
    }

    ctx.waitUntil(
      env.CACHE.put(
        `log:ai:${startedAt}:${crypto.randomUUID()}`,
        JSON.stringify({
          provider: provider.name,
          model: provider.model,
          path: subPath,
          status: result.status,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          estimatedCost: cost,
          latencyMs: Date.now() - startedAt,
          ip:
            req.headers.get("CF-Connecting-IP") ||
            req.headers.get("X-Forwarded-For") ||
            "unknown",
          ts: new Date().toISOString(),
        }),
        { expirationTtl: CACHE_TTL.LOG },
      ).catch(() => {}),
    );

    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: {
        ...result.headers,
        "x-ai-provider": provider.name,
        "x-ai-model": provider.model,
        "x-prompt-tokens": String(usage.promptTokens),
        "x-completion-tokens": String(usage.completionTokens),
        "x-total-tokens": String(usage.totalTokens),
        "x-estimated-cost": String(cost),
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonResponse(
      { error: `AI proxy error (${provider.name}): ${msg}` },
      502,
    );
  }
}

export function listModels(): Response {
  const data = Object.values(AI_PROVIDERS).map((provider) => ({
    id: provider.model,
    provider: provider.name,
    pathPrefix: provider.pathPrefix,
  }));

  return jsonResponse({ object: "list", data });
}
