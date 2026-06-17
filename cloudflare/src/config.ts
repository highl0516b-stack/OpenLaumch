// =============================================================================
// 統一配置 (DRY) - 所有路由、提供商、常量集中管理
// =============================================================================

export const APP_VERSION = "1.0.0";
export const APP_NAME = "openlaunch-gateway";

export interface McpRouteConfig {
  name: string;
  path: string;
  upstreamEnv: string;
  defaultUpstream: string;
  description: string;
}

export const MCP_ROUTES = [
  {
    name: "cursor-app-control",
    path: "/mcp/cursor-app-control",
    upstreamEnv: "MCP_CURSOR_APP_CONTROL_URL",
    defaultUpstream: "http://localhost:3001",
    description: "Cursor 應用控制 MCP - 項目管理、工作區切換",
  },
  {
    name: "cursor-ide-browser",
    path: "/mcp/cursor-ide-browser",
    upstreamEnv: "MCP_CURSOR_IDE_BROWSER_URL",
    defaultUpstream: "http://localhost:3002",
    description: "Cursor IDE 瀏覽器 MCP - 瀏覽器自動化",
  },
  {
    name: "plugin-slack-slack",
    path: "/mcp/plugin-slack",
    upstreamEnv: "MCP_PLUGIN_SLACK_URL",
    defaultUpstream: "http://localhost:3003",
    description: "Slack 插件 MCP - 團隊通訊集成",
  },
] as const;

export type ProviderName = "openai" | "anthropic" | "google" | "ollama";

export interface AiProviderConfig {
  name: ProviderName;
  pathPrefix: string;
  upstreamEnv: string;
  defaultUpstream: string;
  model: string;
  secretEnv?: string;
  inputCost: number;
  outputCost: number;
}

export const AI_PROVIDERS = {
  openai: {
    name: "openai" as ProviderName,
    pathPrefix: "/ai/openai",
    upstreamEnv: "OPENAI_BASE_URL",
    defaultUpstream: "https://api.openai.com/v1",
    model: "gpt-4o",
    secretEnv: "OPENAI_API_KEY",
    inputCost: 0.0025,
    outputCost: 0.01,
  },
  anthropic: {
    name: "anthropic" as ProviderName,
    pathPrefix: "/ai/anthropic",
    upstreamEnv: "ANTHROPIC_BASE_URL",
    defaultUpstream: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
    secretEnv: "ANTHROPIC_API_KEY",
    inputCost: 0.003,
    outputCost: 0.015,
  },
  google: {
    name: "google" as ProviderName,
    pathPrefix: "/ai/google",
    upstreamEnv: "GOOGLE_BASE_URL",
    defaultUpstream: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.0-flash",
    secretEnv: "GOOGLE_API_KEY",
    inputCost: 0.000125,
    outputCost: 0.0005,
  },
  ollama: {
    name: "ollama" as ProviderName,
    pathPrefix: "/ai/ollama",
    upstreamEnv: "OLLAMA_URL",
    defaultUpstream: "",
    model: "llama3.1",
    inputCost: 0,
    outputCost: 0,
  },
} as const;

export const RATE_LIMIT = {
  MAX_REQUESTS: 100,
  WINDOW_MS: 60_000,
} as const;

export const CACHE_TTL = {
  AI: 300,
  MCP_GET: 60,
  LOG: 7 * 86400,
} as const;
