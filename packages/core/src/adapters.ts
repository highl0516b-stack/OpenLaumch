import { execFile } from "node:child_process";
import { Buffer } from "node:buffer";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { generateLaunchPlan } from "./generateLaunchPlan.js";
import type { LaunchBrief, LaunchPlan, ThirdPartyIntegrationConfig } from "./types.js";

export interface StorageAdapter {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list?(prefix?: string): Promise<string[]>;
  clear?(): Promise<void>;
}

export interface QueueAdapter<T> {
  send(message: T): Promise<void>;
  drain?(): Promise<T[]>;
  size?(): Promise<number>;
}

export interface AiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export interface AiChatResponse {
  model: string;
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  raw?: unknown;
}

export type AiProviderName = "openai" | "openrouter" | "cloudflare_gateway" | "custom";

export interface AiProviderConfig {
  provider: AiProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
}

type OpenAiCompatibleChatResponse = {
  id?: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    message?: { content?: string };
    text?: string;
  }>;
};

export interface AiProviderAdapter {
  generateLaunchPlan(prompt: string): Promise<unknown>;
  chat(messages: AiMessage[]): Promise<AiChatResponse>;
}

export interface DeploymentTarget {
  id: "cloudflare" | "vercel" | "kubernetes" | "docker" | (string & {});
  name: string;
  deploy(plan: Record<string, unknown>, context?: AdapterContext): Promise<{ url?: string; status: string; metadata?: Record<string, unknown> }>;
}

export type AdapterCapability =
  | "ai"
  | "crm"
  | "delete"
  | "deployment"
  | "filesystem"
  | "git"
  | "memory"
  | "messaging"
  | "network"
  | "read"
  | "search"
  | "storage"
  | "write";

export interface AdapterContext {
  tenantId: string;
  mode?: "sandbox" | "production";
  capabilities?: AdapterCapability[];
  allowedPaths?: string[];
  env?: Record<string, string | undefined>;
}

export interface AdapterOperation<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  capabilities: AdapterCapability[];
  handler: (input: TInput, context: AdapterContext) => Promise<TOutput>;
}

export interface AdapterOperationDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  capabilities: AdapterCapability[];
}

export interface RateLimitConfig {
  maxCalls: number;
  windowMs: number;
}

export interface LaunchAdapterOptions {
  mode?: "sandbox" | "production";
  tenantId?: string;
  storage?: StorageAdapter;
  rateLimit?: RateLimitConfig;
  operationRateLimits?: Record<string, RateLimitConfig>;
  allowedPaths?: string[];
  env?: Record<string, string | undefined>;
}

export interface HttpRequestOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  body?: T;
}

interface RateLimitBucket {
  calls: number[];
}

const launchGoals = ["waitlist", "funding", "partnership", "sales", "community"] as const;
const channelKeys = [
  "x", "linkedin", "xiaohongshu", "youtube_shorts", "discord", "telegram",
  "product_hunt", "hacker_news", "indie_hackers", "email", "bluesky", "threads",
  "reddit", "tiktok", "wechat", "substack", "medium", "youtube", "press",
] as const;

function defaultAiBaseUrl(provider: AiProviderName): string {
  switch (provider) {
    case "openrouter": return "https://openrouter.ai/api/v1";
    case "cloudflare_gateway": return "https://gateway.ai.cloudflare.com/v1";
    default: return "https://api.openai.com/v1";
  }
}

function defaultAiModel(provider: AiProviderName): string {
  switch (provider) {
    case "openrouter": return "openai/gpt-4.1-mini";
    default: return "gpt-4.1-mini";
  }
}

function openRouterHeaders(provider: AiProviderName): Record<string, string> {
  if (provider !== "openrouter") return {};
  const appUrl = process.env.OPENLAUNCH_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const appName = process.env.OPENLAUNCH_APP_NAME ?? "OpenLaunch";
  return { "HTTP-Referer": appUrl ?? "https://openlaunch.local", "X-Title": appName };
}

function normalizeAiChatResponse(body: OpenAiCompatibleChatResponse | undefined, fallbackModel: string): AiChatResponse {
  const choice = body?.choices?.[0];
  return {
    model: body?.model ?? fallbackModel,
    content: choice?.message?.content ?? choice?.text ?? "",
    usage: body?.usage
      ? { promptTokens: body.usage.prompt_tokens, completionTokens: body.usage.completion_tokens, totalTokens: body.usage.total_tokens }
      : undefined,
    raw: body,
  };
}

export function createMemoryStorageAdapter(): StorageAdapter {
  const store = new Map<string, unknown>();
  return {
    async get(key: string) { return store.get(key); },
    async put(key: string, value: unknown) { store.set(key, value); },
    async delete(key: string) { store.delete(key); },
    async list(prefix = "") { return Array.from(store.keys()).filter((key) => key.startsWith(prefix)); },
    async clear() { store.clear(); },
  };
}

export function createInMemoryQueueAdapter<T>(): QueueAdapter<T> {
  const messages: T[] = [];
  return {
    async send(message: T) { messages.push(message); },
    async drain() { return messages.splice(0, messages.length); },
    async size() { return messages.length; },
  };
}

export function createOpenAiCompatibleAiAdapter(options: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  provider?: AiProviderName;
  timeoutMs?: number;
}): AiProviderAdapter {
  const provider = options.provider ?? "openai";
  const baseUrl = trimTrailingSlash(options.baseUrl ?? defaultAiBaseUrl(provider));
  const model = options.model ?? defaultAiModel(provider);

  return {
    async generateLaunchPlan(prompt: string) {
      return this.chat([
        { role: "system", content: "You are a Launch-as-a-Service strategist. Return a structured launch plan with landing page, channels, calendar, lead segments, investor one-pager and metrics." },
        { role: "user", content: prompt },
      ]);
    },
    async chat(messages: AiMessage[]) {
      const response = await requestJson<OpenAiCompatibleChatResponse>(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            ...openRouterHeaders(options.provider ?? provider),
          },
          body: JSON.stringify({ model, temperature: 0.2, messages }),
        },
        { timeoutMs: options.timeoutMs ?? 30_000 },
      );
      return normalizeAiChatResponse(response.body, model);
    },
  };
}

export function createOpenRouterAiAdapter(options: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}): AiProviderAdapter {
  return createOpenAiCompatibleAiAdapter({ ...options, provider: "openrouter" });
}

export function createCloudflareAiGatewayAiAdapter(options: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}): AiProviderAdapter {
  return createOpenAiCompatibleAiAdapter({ ...options, provider: "cloudflare_gateway" });
}

export function createWebhookDeploymentTarget(options: {
  id?: string;
  name?: string;
  url: string;
  timeoutMs?: number;
}): DeploymentTarget {
  const url = assertHttpUrl(options.url, "deployment webhook url");
  return {
    id: options.id ?? "webhook",
    name: options.name ?? "Webhook Deployment Target",
    async deploy(plan, context: AdapterContext = { tenantId: "local" }) {
      assertProduction(context);
      const response = await requestJson<{ url?: string; status?: string; metadata?: Record<string, unknown> }>(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        },
        { timeoutMs: options.timeoutMs ?? 30_000 },
      );
      return { url: response.body?.url, status: response.body?.status ?? "deployed", metadata: response.body?.metadata };
    },
  };
}

export function createNoopDeploymentTarget(): DeploymentTarget {
  return {
    id: "noop",
    name: "No-op Deployment Target",
    async deploy(plan) {
      return { status: "planned", metadata: { planKeys: Object.keys(plan) } };
    },
  };
}
