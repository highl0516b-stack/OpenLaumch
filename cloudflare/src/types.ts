// =============================================================================
// TypeScript 類型定義 - OpenLaunch API Gateway
// =============================================================================

export interface Env {
  API_KEY?: string;
  BEARER_TOKEN?: string;
  CF_ACCESS_JWT_AUD?: string;

  CACHE: KVNamespace;
  AI?: Fetcher;

  ENVIRONMENT?: string;
  NODE_ENV?: string;
  ALLOWED_ORIGINS?: string;

  RATE_LIMIT_MAX_REQUESTS?: string;
  RATE_LIMIT_WINDOW_MS?: string;

  MCP_CURSOR_APP_CONTROL_URL?: string;
  MCP_CURSOR_IDE_BROWSER_URL?: string;
  MCP_PLUGIN_SLACK_URL?: string;

  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_BASE_URL?: string;
  OLLAMA_URL?: string;
}

export interface HealthReport {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  services: Record<string, string>;
  version: string;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface CacheEntry<T = unknown> {
  data: T;
  expiresAt: number;
  createdAt: string;
}

export interface LogEntry {
  requestId: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  clientIp: string;
  upstream: string;
}

export interface AiRequestLog {
  requestId: string;
  provider: string;
  path: string;
  clientIp: string;
  timestamp: string;
  responseStatus: number;
  model: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  totalCost?: number;
}

export interface LaunchPack {
  landingPageCopy: string;
  campaignCopy: Record<string, string>;
  launchCalendar: string[];
  leadSegments: string[];
  investorOnePager: string;
  launchMetrics: Record<string, number>;
  nextActions: string[];
}
