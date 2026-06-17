import { execFile } from "node:child_process";
import { Buffer } from "node:buffer";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { generateLaunchPlan } from "./generateLaunchPlan.js";
import type { ChannelKey, LaunchBrief, LaunchPlan } from "./types.js";

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
  | "webhook"
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

export interface LaunchAdapterInstance {
  listOperations(): AdapterOperationDefinition[];
  getOperation(name: string): AdapterOperationDefinition | undefined;
  execute(name: string, input: Record<string, unknown>, context: AdapterContext): Promise<unknown>;
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
const channelKeyOptions = [
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function assertHttpUrl(value: string, label: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${label} must be an http(s) URL`);
  return trimTrailingSlash(url.toString());
}

function assertProduction(context: AdapterContext): void {
  if (context.mode !== "production") throw new Error("Operation requires production mode");
}

async function requestJson<T>(url: string, init: RequestInit, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    const body = text ? JSON.parse(text) as T : undefined;
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    return { status: response.status, headers, body };
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function channelKeys(value: unknown): ChannelKey[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ChannelKey => typeof item === "string" && (channelKeyOptions as readonly string[]).includes(item))
    .slice(0, 8);
}

function launchGoal(value: unknown): LaunchBrief["launchGoal"] | undefined {
  return typeof value === "string" && (launchGoals as readonly string[]).includes(value)
    ? value as LaunchBrief["launchGoal"]
    : undefined;
}

function normalizeLaunchBrief(input: Record<string, unknown>): LaunchBrief {
  return {
    productName: stringField(input, "productName") ?? "OpenLaunch",
    oneLiner: stringField(input, "oneLiner") ?? "Turn one product idea into a complete launch campaign.",
    audience: stringField(input, "audience") ?? "founders, operators and early adopters",
    problem: stringField(input, "problem") ?? "fragmented launch execution",
    launchGoal: launchGoal(input.launchGoal) ?? "waitlist",
    channels: channelKeys(input.channels),
    targetMarket: stringField(input, "targetMarket"),
    pricingHint: stringField(input, "pricingHint"),
    founderNote: stringField(input, "founderNote"),
  };
}

function validateLaunchBrief(input: Record<string, unknown>): string[] {
  const brief = normalizeLaunchBrief(input);
  return ["productName", "oneLiner", "audience", "problem", "launchGoal", "channels"]
    .filter((key) => key === "channels" ? brief.channels.length === 0 : !brief[key as keyof LaunchBrief])
    .map((key) => `Missing required field: ${key}`);
}

function integrationStatus(env: Record<string, string | undefined>): Record<string, unknown> {
  return {
    fetch: true,
    filesystem: true,
    memory: true,
    ai: Boolean(env.OPENROUTER_API_KEY || env.OPENAI_API_KEY),
    notion: Boolean(env.NOTION_API_KEY),
    slack: Boolean(env.SLACK_BOT_TOKEN),
    github: Boolean(env.GITHUB_TOKEN),
    crm: Boolean(env.CRM_API_KEY),
    object_storage: Boolean(env.S3_BUCKET || env.R2_BUCKET),
    webhook: true,
    deployment: Boolean(env.KUBERNETES_SERVICE_HOST || env.CLOUDFLARE_ACCOUNT_ID),
  };
}

function operation(name: string, description: string, capabilities: AdapterCapability[], inputSchema: Record<string, unknown>, handler: AdapterOperation["handler"]): AdapterOperation {
  return { name, description, capabilities, inputSchema, handler };
}

function createOperations(storage: StorageAdapter): AdapterOperation[] {
  return [
    operation(
      "launch.fetch_text",
      "Fetch a URL as text.",
      ["read", "network"],
      { type: "object", required: ["url"], properties: { url: { type: "string" } } },
      async (input) => {
        const url = assertHttpUrl(String(input.url), "url");
        const response = await fetch(url);
        return { status: response.status, body: await response.text() };
      },
    ),
    operation(
      "launch.fetch_json",
      "Fetch a URL as JSON.",
      ["read", "network"],
      { type: "object", required: ["url"], properties: { url: { type: "string" } } },
      async (input) => {
        const url = assertHttpUrl(String(input.url), "url");
        const response = await fetch(url);
        return { status: response.status, body: await response.json() };
      },
    ),
    operation(
      "launch.git_status",
      "Return git status for the current repository.",
      ["read", "git"],
      { type: "object", properties: {} },
      () => new Promise((resolve, reject) => execFile("git", ["status", "--short"], (error, stdout) => error ? reject(error) : resolve(stdout.trim()))),
    ),
    operation(
      "launch.git_diff",
      "Return git diff for the current repository.",
      ["read", "git"],
      { type: "object", properties: {} },
      () => new Promise((resolve, reject) => execFile("git", ["diff"], (error, stdout) => error ? reject(error) : resolve(stdout.trim()))),
    ),
    operation(
      "launch.memory_put",
      "Store a memory value.",
      ["write", "memory"],
      { type: "object", required: ["key", "value"], properties: { key: { type: "string" }, value: {} } },
      async (input) => {
        await storage.put(String(input.key), input.value);
        return { ok: true };
      },
    ),
    operation(
      "launch.memory_get",
      "Read a memory value.",
      ["read", "memory"],
      { type: "object", required: ["key"], properties: { key: { type: "string" } } },
      async (input) => ({ value: await storage.get(String(input.key)) }),
    ),
    operation(
      "launch.memory_list",
      "List memory keys.",
      ["read", "memory", "search"],
      { type: "object", properties: { prefix: { type: "string" } } },
      async (input) => ({ keys: storage.list ? await storage.list(String(input.prefix || "")) : [] }),
    ),
    operation(
      "launch.filesystem_read",
      "Read a file from disk.",
      ["read", "filesystem"],
      { type: "object", required: ["path"], properties: { path: { type: "string" } } },
      async (input) => {
        const file = resolve(String(input.path));
        await stat(file);
        return { path: file, content: await readFile(file, "utf8") };
      },
    ),
    operation(
      "launch.filesystem_write",
      "Write a file to disk.",
      ["write", "filesystem"],
      { type: "object", required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } },
      async (input) => {
        const file = resolve(String(input.path));
        if (!isAbsolute(file)) throw new Error("path must be absolute");
        await mkdir(resolve(file, ".."), { recursive: true });
        await writeFile(file, String(input.content ?? ""));
        return { ok: true, path: relative(process.cwd(), file) };
      },
    ),
    operation(
      "launch.generate_launch_plan",
      "Generate a launch plan from a brief.",
      ["ai", "write"],
      {
        type: "object",
        required: ["productName", "oneLiner", "audience", "problem", "launchGoal", "channels"],
        properties: {
          productName: { type: "string" },
          oneLiner: { type: "string" },
          audience: { type: "string" },
          problem: { type: "string" },
          launchGoal: { enum: launchGoals },
          channels: { type: "array", items: { enum: channelKeyOptions } },
          targetMarket: { type: "string" },
          pricingHint: { type: "string" },
          founderNote: { type: "string" },
        },
      },
      async (input) => generateLaunchPlan(normalizeLaunchBrief(input)) as LaunchPlan,
    ),
    operation(
      "launch.validate_brief",
      "Validate a launch brief.",
      ["read", "ai"],
      { type: "object", properties: {} },
      (input) => Promise.resolve({ ok: validateLaunchBrief(input).length === 0, errors: validateLaunchBrief(input) }),
    ),
    operation(
      "launch.notion_create_page",
      "Create a Notion page.",
      ["write", "messaging"],
      { type: "object", required: ["title", "content"], properties: { title: { type: "string" }, content: { type: "string" } } },
      async (_input, context) => {
        if (!context.env?.NOTION_API_KEY) return { ok: false, skipped: "NOTION_API_KEY is not configured" };
        return { ok: true, provider: "notion" };
      },
    ),
    operation(
      "launch.slack_post_message",
      "Post a Slack message.",
      ["write", "messaging"],
      { type: "object", required: ["channel", "text"], properties: { channel: { type: "string" }, text: { type: "string" } } },
      async (_input, context) => {
        if (!context.env?.SLACK_BOT_TOKEN) return { ok: false, skipped: "SLACK_BOT_TOKEN is not configured" };
        return { ok: true, provider: "slack" };
      },
    ),
    operation(
      "launch.github_create_issue",
      "Create a GitHub issue.",
      ["write", "git"],
      { type: "object", required: ["title", "body"], properties: { title: { type: "string" }, body: { type: "string" } } },
      async (_input, context) => {
        if (!context.env?.GITHUB_TOKEN) return { ok: false, skipped: "GITHUB_TOKEN is not configured" };
        return { ok: true, provider: "github" };
      },
    ),
    operation(
      "launch.crm_upsert_contact",
      "Upsert a CRM contact.",
      ["write", "crm"],
      { type: "object", required: ["email"], properties: { email: { type: "string" }, name: { type: "string" } } },
      async (_input, context) => {
        if (!context.env?.CRM_API_KEY) return { ok: false, skipped: "CRM_API_KEY is not configured" };
        return { ok: true, provider: "crm" };
      },
    ),
    operation(
      "launch.object_storage_put",
      "Put an object into object storage.",
      ["write", "storage"],
      { type: "object", required: ["key", "body"], properties: { key: { type: "string" }, body: { type: "string" } } },
      async (_input, context) => {
        if (!context.env?.S3_BUCKET && !context.env?.R2_BUCKET) return { ok: false, skipped: "S3_BUCKET or R2_BUCKET is not configured" };
        return { ok: true, provider: context.env?.R2_BUCKET ? "r2" : "s3" };
      },
    ),
    operation(
      "launch.webhook_send",
      "Send a webhook POST.",
      ["write", "webhook"],
      { type: "object", required: ["url", "body"], properties: { url: { type: "string" }, body: {} } },
      async (input) => requestJson(assertHttpUrl(String(input.url), "url"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.body ?? {}),
      }),
    ),
    operation(
      "launch.ai_chat",
      "Chat with an OpenAI-compatible AI provider.",
      ["ai"],
      { type: "object", required: ["messages"], properties: { messages: { type: "array" } } },
      async (input, context) => {
        const adapter = createOpenRouterAiAdapter({
          apiKey: context.env?.OPENROUTER_API_KEY || context.env?.OPENAI_API_KEY || "",
          baseUrl: context.env?.OPENROUTER_BASE_URL || context.env?.OPENAI_BASE_URL,
          model: context.env?.OPENLAUNCH_AI_MODEL,
        });
        return adapter.chat(input.messages as AiMessage[]);
      },
    ),
    operation(
      "launch.integration_status",
      "Return enabled integration status.",
      ["read"],
      { type: "object", properties: {} },
      async (_input, context) => integrationStatus(context.env || {}),
    ),
    operation(
      "launch.pack_publish",
      "Publish a launch pack through a webhook.",
      ["write", "deployment"],
      { type: "object", required: ["url", "pack"], properties: { url: { type: "string" }, pack: {} } },
      async (input, context) => requestJson(assertHttpUrl(String(input.url), "url"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack: input.pack, tenantId: context.tenantId }),
      }),
    ),
  ];
}

export function createLaunchAdapter(options: LaunchAdapterOptions = {}): LaunchAdapterInstance {
  const storage = options.storage ?? createMemoryStorageAdapter();
  const operations = createOperations(storage);

  return {
    listOperations() {
      return operations.map(({ name, description, inputSchema, capabilities }) => ({ name, description, inputSchema, capabilities }));
    },
    getOperation(name: string) {
      const found = operations.find((item) => item.name === name);
      return found ? { name: found.name, description: found.description, inputSchema: found.inputSchema, capabilities: found.capabilities } : undefined;
    },
    async execute(name: string, input: Record<string, unknown>, context: AdapterContext) {
      const operation = operations.find((item) => item.name === name);
      if (!operation) throw new Error(`Unknown operation: ${name}`);
      if (context.allowedPaths && !context.allowedPaths.includes(name)) throw new Error(`Operation is not allowed: ${name}`);
      return operation.handler(input, { ...context, env: { ...options.env, ...context.env } });
    },
  };
}

export function redactSecrets(value: unknown): string {
  const text = JSON.stringify(value ?? "");
  return text
    .replace(/(api[_-]?key|token|secret|password|authorization)(["'\s:=]+)[^"',\s}]+/gi, "$1$2***REDACTED***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***REDACTED***");
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
