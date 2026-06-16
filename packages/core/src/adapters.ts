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
  "x",
  "linkedin",
  "xiaohongshu",
  "youtube_shorts",
  "discord",
  "telegram",
  "product_hunt",
  "hacker_news",
  "indie_hackers",
  "email",
  "bluesky",
  "threads",
  "reddit",
  "tiktok",
  "wechat",
  "substack",
  "medium",
  "youtube",
  "press",
] as const;

function defaultAiBaseUrl(provider: AiProviderName): string {
  switch (provider) {
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "cloudflare_gateway":
      return "https://gateway.ai.cloudflare.com/v1";
    default:
      return "https://api.openai.com/v1";
  }
}

function defaultAiModel(provider: AiProviderName): string {
  switch (provider) {
    case "openrouter":
      return "openai/gpt-4.1-mini";
    default:
      return "gpt-4.1-mini";
  }
}

function openRouterHeaders(provider: AiProviderName): Record<string, string> {
  if (provider !== "openrouter") {
    return {};
  }
  const appUrl = process.env.OPENLAUNCH_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const appName = process.env.OPENLAUNCH_APP_NAME ?? "OpenLaunch";
  const headers: Record<string, string> = {
    "HTTP-Referer": appUrl ?? "https://openlaunch.local",
    "X-Title": appName,
  };
  return headers;
}

function normalizeAiChatResponse(body: OpenAiCompatibleChatResponse | undefined, fallbackModel: string): AiChatResponse {
  const choice = body?.choices?.[0];
  return {
    model: body?.model ?? fallbackModel,
    content: choice?.message?.content ?? choice?.text ?? "",
    usage: body?.usage
      ? {
          promptTokens: body.usage.prompt_tokens,
          completionTokens: body.usage.completion_tokens,
          totalTokens: body.usage.total_tokens,
        }
      : undefined,
    raw: body,
  };
}

export function createMemoryStorageAdapter(): StorageAdapter {
  const store = new Map<string, unknown>();
  return {
    async get(key: string) {
      return store.get(key);
    },
    async put(key: string, value: unknown) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(prefix = "") {
      return Array.from(store.keys()).filter((key) => key.startsWith(prefix));
    },
    async clear() {
      store.clear();
    },
  };
}

export function createInMemoryQueueAdapter<T>(): QueueAdapter<T> {
  const messages: T[] = [];
  return {
    async send(message: T) {
      messages.push(message);
    },
    async drain() {
      return messages.splice(0, messages.length);
    },
    async size() {
      return messages.length;
    },
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
        {
          role: "system",
          content: "You are a Launch-as-a-Service strategist. Return a structured launch plan with landing page, channels, calendar, lead segments, investor one-pager and metrics.",
        },
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
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages,
          }),
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
      return {
        url: response.body?.url,
        status: response.body?.status ?? "deployed",
        metadata: response.body?.metadata,
      };
    },
  };
}

export function createNoopDeploymentTarget(): DeploymentTarget {
  return {
    id: "noop",
    name: "No-op Deployment Target",
    async deploy(plan) {
      return {
        status: "planned",
        metadata: { planKeys: Object.keys(plan) },
      };
    },
  };
}

export class AdapterRegistry {
  private readonly mode: "sandbox" | "production";
  private readonly tenantId: string;
  private readonly env: Record<string, string | undefined>;
  private readonly allowedPaths?: string[];
  private readonly storage: StorageAdapter;
  private readonly operations = new Map<string, AdapterOperation>();
  private readonly operationRateLimits = new Map<string, RateLimitConfig>();
  private readonly operationRateLimiters = new Map<string, SlidingRateLimiter>();
  private readonly globalRateLimiter?: SlidingRateLimiter;

  constructor(options: LaunchAdapterOptions = {}) {
    this.mode = options.mode ?? "sandbox";
    this.tenantId = options.tenantId ?? "default";
    this.env = options.env ?? {};
    this.allowedPaths = options.allowedPaths;
    this.storage = options.storage ?? createMemoryStorageAdapter();
    this.globalRateLimiter = options.rateLimit ? new SlidingRateLimiter(options.rateLimit) : undefined;
    for (const [name, config] of Object.entries(options.operationRateLimits ?? {})) {
      this.operationRateLimits.set(name, config);
      this.operationRateLimiters.set(name, new SlidingRateLimiter(config));
    }
  }

  registerOperation(operation: AdapterOperation): void {
    this.operations.set(operation.name, operation);
  }

  hasOperation(name: string): boolean {
    return this.operations.has(name);
  }

  getOperation(name: string): AdapterOperation | undefined {
    return this.operations.get(name);
  }

  listOperations(): AdapterOperationDefinition[] {
    return Array.from(this.operations.values()).map((operation) => ({
      name: operation.name,
      description: operation.description,
      inputSchema: operation.inputSchema,
      capabilities: operation.capabilities,
    }));
  }

  async execute(name: string, input: Record<string, unknown>, context: AdapterContext = { tenantId: this.tenantId }): Promise<unknown> {
    const operation = this.operations.get(name);
    if (!operation) {
      throw new Error(`Unknown adapter operation: ${name}`);
    }

    const validationErrors = validateInput(input, operation.inputSchema);
    if (validationErrors.length > 0) {
      throw new Error(`Invalid input for ${name}: ${validationErrors.join("; ")}`);
    }

    const scopedContext: AdapterContext = {
      ...context,
      tenantId: context.tenantId || this.tenantId,
      mode: context.mode ?? this.mode,
      env: { ...this.env, ...context.env },
      allowedPaths: context.allowedPaths ?? this.allowedPaths,
    };

    const rateLimiter = this.operationRateLimiters.get(operation.name) ?? this.globalRateLimiter;
    await rateLimiter?.wait(operation.name);

    return operation.handler(input, scopedContext);
  }
}

export function createLaunchAdapter(options: LaunchAdapterOptions = {}): AdapterRegistry {
  const registry = new AdapterRegistry(options);
  const storage = options.storage ?? createMemoryStorageAdapter();

  registry.registerOperation({
    name: "launch.validate_brief",
    description: "Validate and normalize a Launch Brief before generating a launch pack.",
    inputSchema: objectSchema({
      brief: { type: "object" },
    }),
    capabilities: ["read", "ai"],
    handler: async (input) => ({ ok: true, brief: normalizeLaunchBrief(input) }),
  });

  registry.registerOperation({
    name: "launch.generate_launch_plan",
    description: "Generate a deterministic Launch-as-a-Service launch pack from a product brief.",
    inputSchema: objectSchema({
      brief: { type: "object" },
    }),
    capabilities: ["read", "ai"],
    handler: async (input) => {
      const plan = generateLaunchPlan(normalizeLaunchBrief(input));
      return { ok: true, plan, artifacts: planToArtifacts(plan) };
    },
  });

  registry.registerOperation({
    name: "launch.fetch_text",
    description: "Fetch public HTTP(S) text with timeout, byte limit and secret redaction.",
    inputSchema: objectSchema(
      {
        url: { type: "string" },
        timeoutMs: { type: "number" },
        maxBytes: { type: "number" },
      },
      ["url"],
    ),
    capabilities: ["read", "network"],
    handler: async (input) => fetchText(input),
  });

  registry.registerOperation({
    name: "launch.fetch_json",
    description: "Fetch public HTTP(S) JSON with timeout and secret redaction.",
    inputSchema: objectSchema(
      {
        url: { type: "string" },
        timeoutMs: { type: "number" },
      },
      ["url"],
    ),
    capabilities: ["read", "network"],
    handler: async (input) => fetchJson(input),
  });

  registry.registerOperation({
    name: "launch.git_status",
    description: "Inspect git status from an allowlisted repository path.",
    inputSchema: objectSchema({
      cwd: { type: "string" },
    }),
    capabilities: ["read", "git"],
    handler: async (input, context) => runGit(context, stringArg(input, "cwd") ?? ".", ["status", "--short", "--branch"]),
  });

  registry.registerOperation({
    name: "launch.git_diff",
    description: "Inspect git diff from an allowlisted repository path.",
    inputSchema: objectSchema(
      {
        cwd: { type: "string" },
        args: { type: "array" },
      },
      ["cwd"],
    ),
    capabilities: ["read", "git"],
    handler: async (input, context) => {
      const args = arrayArg(input, "args") ?? ["diff", "--stat"];
      return runGit(context, stringArg(input, "cwd") ?? ".", args.map(String));
    },
  });

  registry.registerOperation({
    name: "launch.memory_put",
    description: "Store a tenant-scoped memory entry.",
    inputSchema: objectSchema({
      key: { type: "string" },
      value: {},
    }),
    capabilities: ["write", "memory"],
    handler: async (input, context) => {
      const key = memoryKey(context, stringArg(input, "key") ?? "default");
      await storage.put(key, input.value);
      return { ok: true, tenantId: context.tenantId, key };
    },
  });

  registry.registerOperation({
    name: "launch.memory_get",
    description: "Read a tenant-scoped memory entry.",
    inputSchema: objectSchema({
      key: { type: "string" },
    }),
    capabilities: ["read", "memory"],
    handler: async (input, context) => {
      const key = memoryKey(context, stringArg(input, "key") ?? "default");
      return { ok: true, tenantId: context.tenantId, key, value: await storage.get(key) };
    },
  });

  registry.registerOperation({
    name: "launch.memory_list",
    description: "List tenant-scoped memory keys.",
    inputSchema: objectSchema({
      prefix: { type: "string" },
    }, []),
    capabilities: ["read", "memory"],
    handler: async (input, context) => {
      const prefix = memoryKey(context, stringArg(input, "prefix") ?? "");
      const keys = storage.list ? await storage.list(prefix) : [];
      return { ok: true, tenantId: context.tenantId, keys };
    },
  });

  registry.registerOperation({
    name: "launch.filesystem_read",
    description: "Read a file from an allowlisted local path.",
    inputSchema: objectSchema(
      {
        path: { type: "string" },
        maxBytes: { type: "number" },
      },
      ["path"],
    ),
    capabilities: ["read", "filesystem"],
    handler: async (input, context) => {
      const filePath = resolveAllowedPath(context, stringArg(input, "path") ?? ".");
      const text = await readFile(filePath, "utf8");
      return { ok: true, path: filePath, bytes: Buffer.byteLength(text), text: truncateText(redactSecrets(text), numberArg(input, "maxBytes") ?? 100_000) };
    },
  });

  registry.registerOperation({
    name: "launch.filesystem_write",
    description: "Write text or JSON to an allowlisted local path.",
    inputSchema: objectSchema({
      path: { type: "string" },
      content: { type: "string" },
      json: { type: "object" },
      mkdir: { type: "boolean" },
    }, []),
    capabilities: ["write", "filesystem"],
    handler: async (input, context) => {
      assertProduction(context);
      const filePath = resolveAllowedPath(context, stringArg(input, "path") ?? "openlaunch-output.json");
      const content = input.content !== undefined ? String(input.content) : JSON.stringify(input.json ?? null, null, 2);
      if (booleanArg(input, "mkdir") ?? true) {
        await mkdir(resolve(filePath, ".."), { recursive: true });
      }
      await writeFile(filePath, content, "utf8");
      const fileStat = await stat(filePath);
      return { ok: true, path: filePath, bytes: fileStat.size };
    },
  });

  registry.registerOperation({
    name: "launch.notion_create_page",
    description: "Create a Notion database page for a launch plan or research note.",
    inputSchema: objectSchema({
      databaseId: { type: "string" },
      title: { type: "string" },
      properties: { type: "object" },
      children: { type: "array" },
      token: { type: "string" },
    }, []),
    capabilities: ["write", "storage"],
    handler: async (input, context) => notionCreatePage(input, context),
  });

  registry.registerOperation({
    name: "launch.slack_post_message",
    description: "Post a launch update or lead summary to Slack.",
    inputSchema: objectSchema({
      channel: { type: "string" },
      text: { type: "string" },
      blocks: { type: "array" },
      token: { type: "string" },
    }, []),
    capabilities: ["write", "messaging"],
    handler: async (input, context) => slackPostMessage(input, context),
  });

  registry.registerOperation({
    name: "launch.github_create_issue",
    description: "Create a GitHub issue for launch tasks, bugs, or partner follow-up.",
    inputSchema: objectSchema({
      owner: { type: "string" },
      repo: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      labels: { type: "array" },
      token: { type: "string" },
    }, []),
    capabilities: ["write", "messaging"],
    handler: async (input, context) => githubCreateIssue(input, context),
  });

  registry.registerOperation({
    name: "launch.crm_upsert_contact",
    description: "Upsert a lead/contact into a CRM using a HubSpot-compatible endpoint.",
    inputSchema: objectSchema({
      baseUrl: { type: "string" },
      endpoint: { type: "string" },
      contact: { type: "object" },
      apiKey: { type: "string" },
    }, []),
    capabilities: ["write", "crm", "search"],
    handler: async (input, context) => crmUpsertContact(input, context),
  });

  registry.registerOperation({
    name: "launch.object_storage_put",
    description: "Upload launch assets to object storage using a presigned URL or compatible HTTP endpoint.",
    inputSchema: objectSchema({
      url: { type: "string" },
      key: { type: "string" },
      bucket: { type: "string" },
      body: {},
      text: { type: "string" },
      headers: { type: "object" },
      method: { type: "string" },
    }, []),
    capabilities: ["write", "storage"],
    handler: async (input, context) => objectStoragePut(input, context),
  });

  registry.registerOperation({
    name: "launch.webhook_send",
    description: "Send an HTTP(S) webhook for launch events, lead routing or deployment notifications.",
    inputSchema: objectSchema(
      {
        url: { type: "string" },
        method: { type: "string" },
        body: {},
        headers: { type: "object" },
        timeoutMs: { type: "number" },
      },
      ["url"],
    ),
    capabilities: ["write", "network"],
    handler: async (input, context) => webhookSend(input, context),
  });

  registry.registerOperation({
    name: "launch.ai_chat",
    description: "Call an OpenAI-compatible chat completion endpoint for launch strategy, copy or lead scoring.",
    inputSchema: objectSchema({
      prompt: { type: "string" },
      messages: { type: "array" },
      model: { type: "string" },
      temperature: { type: "number" },
      baseUrl: { type: "string" },
      apiKey: { type: "string" },
      provider: { type: "string" },
    }, []),
    capabilities: ["ai"],
    handler: async (input, context) => aiChat(input, context),
  });

  registry.registerOperation({
    name: "launch.integration_status",
    description: "Inspect which third-party integrations are configured and ready.",
    inputSchema: objectSchema({}),
    capabilities: ["read"],
    handler: async (_input, context) => ({ ok: true, integrations: integrationStatus(context) }),
  });

  registry.registerOperation({
    name: "launch.pack_publish",
    description: "Generate a launch pack and optionally publish summaries to Notion, Slack, GitHub, object storage or a webhook.",
    inputSchema: objectSchema(
      {
        brief: { type: "object" },
        destinations: { type: "object" },
      },
      ["brief"],
    ),
    capabilities: ["ai", "write", "storage", "messaging", "crm", "network"],
    handler: async (input, context) => publishLaunchPack(input, context),
  });

  return registry;
}

export function validateInput(input: Record<string, unknown>, schema: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (schema.type === "object") {
    if (!isRecord(input)) {
      return ["Expected input to be an object."];
    }
    const required = schema.required;
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === "string" && !(key in input)) {
          errors.push(`Missing required field: ${key}`);
        }
      }
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!(key in input)) {
        continue;
      }
      errors.push(...validateValue(input[key], propertySchema, key));
    }
    return errors;
  }
  return validateValue(input, schema, "input");
}

export function redactSecrets(input: string): string {
  return input
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/g, "Bearer [REDACTED]")
    .replace(/(api[_-]?key|token|secret)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]");
}

export function truncateText(input: string, maxBytes = 100_000): string {
  if (Buffer.byteLength(input, "utf8") <= maxBytes) {
    return input;
  }
  const safeLength = Math.max(1, Math.floor(maxBytes * 0.9));
  return `${input.slice(0, safeLength)}… [truncated]`;
}

async function fetchText(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = assertHttpUrl(stringArg(input, "url") ?? "", "url");
  const controller = new AbortController();
  const timeoutMs = numberArg(input, "timeoutMs") ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "OpenLaunch-MCP/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }
    const text = Buffer.from(await response.arrayBuffer()).toString("utf8");
    const maxBytes = numberArg(input, "maxBytes") ?? 1_000_000;
    const safeText = truncateText(redactSecrets(text), maxBytes);
    return {
      ok: true,
      url,
      status: response.status,
      contentType: response.headers.get("content-type") ?? undefined,
      bytes: Buffer.byteLength(text, "utf8"),
      text: safeText,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = assertHttpUrl(stringArg(input, "url") ?? "", "url");
  const controller = new AbortController();
  const timeoutMs = numberArg(input, "timeoutMs") ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "OpenLaunch-MCP/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }
    const body = (await response.json()) as unknown;
    return {
      ok: true,
      url,
      status: response.status,
      contentType: response.headers.get("content-type") ?? undefined,
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runGit(context: AdapterContext, cwd: string, args: string[]): Promise<Record<string, unknown>> {
  const execFileAsync = await import("node:util").then(({ promisify }) => promisify(execFile));
  const repositoryPath = resolveAllowedPath(context, cwd);
  const result = (await execFileAsync("git", args, { cwd: repositoryPath })) as { stdout: string; stderr: string };
  return {
    ok: true,
    cwd: repositoryPath,
    args,
    stdout: redactSecrets(result.stdout),
    stderr: redactSecrets(result.stderr),
  };
}

async function notionCreatePage(input: Record<string, unknown>, context: AdapterContext): Promise<Record<string, unknown>> {
  assertProduction(context);
  const token = stringArg(input, "token") ?? context.env?.NOTION_TOKEN;
  const databaseId = stringArg(input, "databaseId") ?? context.env?.NOTION_DATABASE_ID;
  if (!token || !databaseId) {
    throw new Error("Notion integration requires NOTION_TOKEN and NOTION_DATABASE_ID, or token/databaseId input.");
  }

  const title = stringArg(input, "title") ?? "OpenLaunch plan";
  const response = await requestJson<{ id?: string; url?: string }>(
    "https://api.notion.com/v1/pages",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: recordArg(input, "properties") ?? {
          Name: {
            title: [{ text: { content: title } }],
          },
        },
        children: arrayArg(input, "children") ?? [],
      }),
    },
    { timeoutMs: 30_000 },
  );

  return { ok: true, status: response.status, id: response.body?.id, url: response.body?.url, body: response.body };
}

async function slackPostMessage(input: Record<string, unknown>, context: AdapterContext): Promise<Record<string, unknown>> {
  assertProduction(context);
  const token = stringArg(input, "token") ?? context.env?.SLACK_BOT_TOKEN;
  const channel = stringArg(input, "channel") ?? context.env?.SLACK_CHANNEL_ID;
  if (!token || !channel) {
    throw new Error("Slack integration requires SLACK_BOT_TOKEN and SLACK_CHANNEL_ID, or token/channel input.");
  }

  const response = await requestJson<{ ok?: boolean; channel?: string; ts?: string; error?: string }>(
    "https://slack.com/api/chat.postMessage",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text: stringArg(input, "text") ?? "OpenLaunch update",
        blocks: arrayArg(input, "blocks") ?? undefined,
      }),
    },
    { timeoutMs: 30_000 },
  );

  if (response.body?.ok === false) {
    throw new Error(`Slack API error: ${response.body.error ?? "unknown"}`);
  }

  return { ok: true, status: response.status, channel: response.body?.channel, ts: response.body?.ts, body: response.body };
}

async function githubCreateIssue(input: Record<string, unknown>, context: AdapterContext): Promise<Record<string, unknown>> {
  assertProduction(context);
  const token = stringArg(input, "token") ?? context.env?.GITHUB_TOKEN;
  const owner = stringArg(input, "owner") ?? context.env?.GITHUB_OWNER;
  const repo = stringArg(input, "repo") ?? context.env?.GITHUB_REPO;
  if (!token || !owner || !repo) {
    throw new Error("GitHub integration requires GITHUB_TOKEN plus owner/repo input or GITHUB_OWNER/GITHUB_REPO env.");
  }

  const response = await requestJson<{ id?: number; html_url?: string; number?: number }>(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title: stringArg(input, "title") ?? "OpenLaunch task",
        body: stringArg(input, "body") ?? "",
        labels: arrayArg(input, "labels")?.map(String) ?? [],
      }),
    },
    { timeoutMs: 30_000 },
  );

  return { ok: true, status: response.status, number: response.body?.number, url: response.body?.html_url, body: response.body };
}

async function crmUpsertContact(input: Record<string, unknown>, context: AdapterContext): Promise<Record<string, unknown>> {
  assertProduction(context);
  const baseUrl = trimTrailingSlash(stringArg(input, "baseUrl") ?? context.env?.CRM_BASE_URL ?? "");
  const apiKey = stringArg(input, "apiKey") ?? context.env?.CRM_API_KEY ?? context.env?.HUBSPOT_PRIVATE_APP_TOKEN;
  const endpoint = stringArg(input, "endpoint") ?? "/crm/v3/objects/contacts";
  if (!baseUrl || !endpoint.startsWith("/")) {
    throw new Error("CRM integration requires an absolute baseUrl and endpoint starting with '/'.");
  }

  const response = await requestJson<Record<string, unknown>>(
    `${baseUrl}${endpoint}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        properties: recordArg(input, "contact") ?? input,
      }),
    },
    { timeoutMs: 30_000 },
  );

  return { ok: true, status: response.status, body: response.body };
}

async function objectStoragePut(input: Record<string, unknown>, context: AdapterContext): Promise<Record<string, unknown>> {
  assertProduction(context);
  const url = stringArg(input, "url")
    ? assertHttpUrl(stringArg(input, "url") ?? "", "url")
    : buildObjectStorageUrl(input, context);
  const headers = headersToObject(recordArg(input, "headers"));
  if (!headers["content-type"] && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/octet-stream";
  }

  const response = await fetch(url, {
    method: (stringArg(input, "method") ?? "PUT").toUpperCase(),
    headers,
    body: normalizeBody(input.body ?? input.text ?? "{}"),
  });
  if (!response.ok) {
    throw new Error(`Object storage upload failed with status ${response.status}`);
  }

  return { ok: true, status: response.status, url };
}

async function webhookSend(input: Record<string, unknown>, context: AdapterContext): Promise<Record<string, unknown>> {
  assertProduction(context);
  const url = assertHttpUrl(stringArg(input, "url") ?? "", "url");
  const response = await fetch(url, {
    method: (stringArg(input, "method") ?? "POST").toUpperCase(),
    headers: headersToObject(recordArg(input, "headers")),
    body: normalizeBody(input.body ?? input.data),
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    url,
    body: text ? safeParseJson(text) : undefined,
  };
}

async function aiChat(input: Record<string, unknown>, context: AdapterContext): Promise<AiChatResponse> {
  const provider = resolveAiProvider(input, context);
  const apiKey = resolveAiApiKey(provider, input, context);
  if (!apiKey) {
    throw new Error(`AI integration requires ${apiKeyEnvHint(provider)} or apiKey input.`);
  }

  const baseUrl = resolveAiBaseUrl(provider, input, context);
  const model = resolveAiModel(provider, input, context);
  const messages = normalizeAiMessages(input);
  const timeoutMs = numberArg(input, "timeoutMs") ?? 30_000;
  const extra = recordArg(input, "extra") ?? {};

  const response = await requestJson<OpenAiCompatibleChatResponse>(
    `${baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...openRouterHeaders(provider),
      },
      body: JSON.stringify({
        model,
        temperature: numberArg(input, "temperature") ?? 0.2,
        messages,
        ...extra,
      }),
    },
    { timeoutMs },
  );

  return normalizeAiChatResponse(response.body, model);
}

async function publishLaunchPack(input: Record<string, unknown>, context: AdapterContext): Promise<Record<string, unknown>> {
  assertProduction(context);
  const plan: LaunchPlan = generateLaunchPlan(normalizeLaunchBrief(input));
  const destinations = recordArg(input, "destinations") ?? {};
  const results: Record<string, unknown> = { plan, destinations: {} };

  if (booleanArg(destinations, "notion") || booleanArg(destinations, "all")) {
    results.destinations = {
      ...(results.destinations as Record<string, unknown>),
      notion: await notionCreatePage(
        {
          title: `${plan.productName} launch plan`,
          properties: {
            Name: {
              title: [{ text: { content: `${plan.productName} launch plan` } }],
            },
          },
          children: [
            {
              object: "block",
              type: "heading_1",
              heading_1: { rich_text: [{ text: { content: plan.landingPage.heroTitle } }] },
            },
            {
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: [{ text: { content: plan.landingPage.heroSubtitle } }] },
            },
          ],
        },
        context,
      ),
    };
  }

  if (booleanArg(destinations, "slack") || booleanArg(destinations, "all")) {
    results.destinations = {
      ...(results.destinations as Record<string, unknown>),
      slack: await slackPostMessage(
        {
          text: `${plan.productName} launch pack is ready. Goal: ${plan.metrics[0]?.name ?? "traction"}; next action: ${plan.nextActions[0] ?? "publish landing page"}.`,
        },
        context,
      ),
    };
  }

  if (booleanArg(destinations, "github") || booleanArg(destinations, "all")) {
    results.destinations = {
      ...(results.destinations as Record<string, unknown>),
      github: await githubCreateIssue(
        {
          title: `${plan.productName} launch execution board`,
          body: `## Launch Plan\n\n${plan.landingPage.heroTitle}\n\n${plan.landingPage.heroSubtitle}\n\n## Next Actions\n\n${plan.nextActions.map((action) => `- ${action}`).join("\n")}`,
          labels: ["launch", "openlaunch"],
        },
        context,
      ),
    };
  }

  if (booleanArg(destinations, "webhook") || booleanArg(destinations, "all")) {
    const webhookUrl = stringArg(input, "webhookUrl") ?? context.env?.LAUNCH_PACK_WEBHOOK_URL;
    if (webhookUrl) {
      results.destinations = {
        ...(results.destinations as Record<string, unknown>),
        webhook: await webhookSend({ url: webhookUrl, body: { plan } }, context),
      };
    }
  }

  return results;
}

function planToArtifacts(plan: LaunchPlan): Array<{ kind: string; title: string; content: unknown }> {
  return [
    { kind: "landing_page", title: "Landing page copy", content: plan.landingPage },
    { kind: "campaign_copy", title: "Multi-channel campaign copy", content: plan.campaignCopy },
    { kind: "calendar", title: "30-day launch calendar", content: plan.calendar },
    { kind: "lead_segments", title: "Lead segments", content: plan.leadSegments },
    { kind: "investor_one_pager", title: "Investor one-pager", content: plan.investorOnePager },
    { kind: "metrics", title: "Launch metrics", content: plan.metrics },
  ];
}

function resolveAiProvider(input: Record<string, unknown>, context: AdapterContext): AiProviderName {
  const env = context.env ?? {};
  const raw = stringArg(input, "provider") ?? env.OPENLAUNCH_AI_PROVIDER ?? "openai";
  const normalized = raw.toLowerCase();
  if (normalized === "openrouter" || normalized === "open_router") {
    return "openrouter";
  }
  if (normalized === "cloudflare_gateway" || normalized === "cloudflare-gateway" || normalized === "cf_ai_gateway" || normalized === "gateway") {
    return "cloudflare_gateway";
  }
  if (normalized === "custom") {
    return "custom";
  }
  if (env.OPENROUTER_API_KEY && !env.OPENAI_API_KEY && !env.OPENLAUNCH_AI_API_KEY) {
    return "openrouter";
  }
  return "openai";
}

function resolveAiApiKey(provider: AiProviderName, input: Record<string, unknown>, context: AdapterContext): string | undefined {
  const env = context.env ?? {};
  switch (provider) {
    case "openrouter":
      return stringArg(input, "apiKey") ?? env.OPENROUTER_API_KEY ?? env.OPENLAUNCH_AI_API_KEY;
    case "cloudflare_gateway":
      return stringArg(input, "apiKey") ?? env.CLOUDFLARE_AI_GATEWAY_TOKEN ?? env.OPENLAUNCH_AI_API_KEY;
    case "custom":
      return stringArg(input, "apiKey") ?? env.OPENLAUNCH_AI_API_KEY ?? env.OPENAI_API_KEY;
    case "openai":
      return stringArg(input, "apiKey") ?? env.OPENAI_API_KEY ?? env.OPENLAUNCH_AI_API_KEY;
  }
}

function resolveAiBaseUrl(provider: AiProviderName, input: Record<string, unknown>, context: AdapterContext): string {
  const env = context.env ?? {};
  switch (provider) {
    case "openrouter":
      return trimTrailingSlash(stringArg(input, "baseUrl") ?? env.OPENROUTER_BASE_URL ?? env.OPENLAUNCH_AI_BASE_URL ?? defaultAiBaseUrl(provider));
    case "cloudflare_gateway":
      return trimTrailingSlash(stringArg(input, "baseUrl") ?? env.CLOUDFLARE_AI_GATEWAY_URL ?? env.OPENLAUNCH_AI_BASE_URL ?? env.OPENAI_BASE_URL ?? defaultAiBaseUrl(provider));
    case "custom":
      return trimTrailingSlash(stringArg(input, "baseUrl") ?? env.OPENLAUNCH_AI_BASE_URL ?? env.OPENAI_BASE_URL ?? defaultAiBaseUrl(provider));
    case "openai":
      return trimTrailingSlash(stringArg(input, "baseUrl") ?? env.OPENAI_BASE_URL ?? defaultAiBaseUrl(provider));
  }
}

function resolveAiModel(provider: AiProviderName, input: Record<string, unknown>, context: AdapterContext): string {
  const env = context.env ?? {};
  switch (provider) {
    case "openrouter":
      return stringArg(input, "model") ?? env.OPENROUTER_MODEL ?? env.OPENLAUNCH_AI_MODEL ?? defaultAiModel(provider);
    case "cloudflare_gateway":
      return stringArg(input, "model") ?? env.CLOUDFLARE_AI_GATEWAY_MODEL ?? env.OPENLAUNCH_AI_MODEL ?? env.OPENAI_MODEL ?? defaultAiModel(provider);
    case "custom":
      return stringArg(input, "model") ?? env.OPENLAUNCH_AI_MODEL ?? env.OPENAI_MODEL ?? defaultAiModel(provider);
    case "openai":
      return stringArg(input, "model") ?? env.OPENAI_MODEL ?? defaultAiModel(provider);
  }
}

function normalizeAiMessages(input: Record<string, unknown>): AiMessage[] {
  const messages = arrayArg(input, "messages") as AiMessage[] | undefined;
  if (messages?.length) {
    return messages;
  }
  return [{ role: "user", content: stringArg(input, "prompt") ?? "" }];
}

function apiKeyEnvHint(provider: AiProviderName): string {
  switch (provider) {
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "cloudflare_gateway":
      return "CLOUDFLARE_AI_GATEWAY_TOKEN";
    case "custom":
      return "OPENLAUNCH_AI_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
  }
}

function integrationStatus(context: AdapterContext): ThirdPartyIntegrationConfig[] {
  const env = context.env ?? {};
  const provider = resolveAiProvider({}, context);
  const aiEnabled = Boolean(env.OPENROUTER_API_KEY || env.CLOUDFLARE_AI_GATEWAY_TOKEN || env.OPENLAUNCH_AI_API_KEY || env.OPENAI_API_KEY);
  return [
    {
      id: "notion",
      name: "Notion",
      enabled: Boolean(env.NOTION_TOKEN && env.NOTION_DATABASE_ID),
      capabilities: ["write"],
      env: { NOTION_TOKEN: maskSecret(env.NOTION_TOKEN), NOTION_DATABASE_ID: env.NOTION_DATABASE_ID },
    },
    {
      id: "slack",
      name: "Slack",
      enabled: Boolean(env.SLACK_BOT_TOKEN && env.SLACK_CHANNEL_ID),
      capabilities: ["write"],
      env: { SLACK_BOT_TOKEN: maskSecret(env.SLACK_BOT_TOKEN), SLACK_CHANNEL_ID: env.SLACK_CHANNEL_ID },
    },
    {
      id: "github",
      name: "GitHub",
      enabled: Boolean(env.GITHUB_TOKEN && (env.GITHUB_OWNER || env.GITHUB_REPO)),
      capabilities: ["write"],
      env: { GITHUB_TOKEN: maskSecret(env.GITHUB_TOKEN), GITHUB_OWNER: env.GITHUB_OWNER, GITHUB_REPO: env.GITHUB_REPO },
    },
    {
      id: "crm",
      name: "CRM / HubSpot-compatible",
      enabled: Boolean(env.CRM_BASE_URL && (env.CRM_API_KEY || env.HUBSPOT_PRIVATE_APP_TOKEN)),
      capabilities: ["write", "search"],
      env: { CRM_BASE_URL: env.CRM_BASE_URL, CRM_API_KEY: maskSecret(env.CRM_API_KEY), HUBSPOT_PRIVATE_APP_TOKEN: maskSecret(env.HUBSPOT_PRIVATE_APP_TOKEN) },
    },
    {
      id: "ai",
      name: provider === "openrouter" ? "OpenRouter AI" : provider === "cloudflare_gateway" ? "Cloudflare AI Gateway" : "OpenAI-compatible AI",
      enabled: aiEnabled,
      capabilities: ["ai"],
      env: {
        OPENLAUNCH_AI_PROVIDER: provider,
        OPENROUTER_API_KEY: maskSecret(env.OPENROUTER_API_KEY),
        CLOUDFLARE_AI_GATEWAY_TOKEN: maskSecret(env.CLOUDFLARE_AI_GATEWAY_TOKEN),
        OPENAI_API_KEY: maskSecret(env.OPENAI_API_KEY),
        OPENLAUNCH_AI_API_KEY: maskSecret(env.OPENLAUNCH_AI_API_KEY),
        OPENROUTER_MODEL: env.OPENROUTER_MODEL,
        OPENLAUNCH_AI_MODEL: env.OPENLAUNCH_AI_MODEL,
        OPENAI_MODEL: env.OPENAI_MODEL,
        OPENLAUNCH_AI_BASE_URL: env.OPENLAUNCH_AI_BASE_URL,
      },
    },
  ];
}

function normalizeLaunchBrief(input: Record<string, unknown>): LaunchBrief {
  const brief = recordArg(input, "brief") ?? input;
  const productName = stringArg(brief, "productName") ?? "OpenLaunch";
  const oneLiner = stringArg(brief, "oneLiner") ?? "Turn one product idea into a complete launch campaign.";
  const audience = stringArg(brief, "audience") ?? "founders, operators and early adopters";
  const problem = stringArg(brief, "problem") ?? "fragmented launch execution";
  const channels = arrayArg(brief, "channels")?.filter((value): value is string => typeof value === "string") ?? ["email"];
  return {
    productName,
    oneLiner,
    audience,
    problem,
    launchGoal: asLaunchGoal(brief.launchGoal),
    channels: channels.map(asChannelKey),
    targetMarket: stringArg(brief, "targetMarket"),
    pricingHint: stringArg(brief, "pricingHint"),
    founderNote: stringArg(brief, "founderNote"),
  };
}

function asLaunchGoal(value: unknown): LaunchBrief["launchGoal"] {
  return launchGoals.includes(value as (typeof launchGoals)[number]) ? (value as LaunchBrief["launchGoal"]) : "waitlist";
}

function asChannelKey(value: string): (typeof channelKeys)[number] {
  return channelKeys.includes(value as (typeof channelKeys)[number]) ? (value as (typeof channelKeys)[number]) : "email";
}

function objectSchema(properties: Record<string, Record<string, unknown>>, required: string[] = Object.keys(properties)): Record<string, unknown> {
  return {
    type: "object",
    required,
    properties,
  };
}

function validateValue(value: unknown, schema: unknown, path: string): string[] {
  if (!isRecord(schema)) {
    return [];
  }
  const errors: string[] = [];
  const type = typeof schema.type === "string" ? schema.type : undefined;
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;

  if (enumValues && !enumValues.includes(value)) {
    errors.push(`${path} must be one of: ${enumValues.map(String).join(", ")}`);
  }

  if (!type) {
    return errors;
  }

  if (type === "string" && typeof value !== "string") {
    errors.push(`${path} must be a string.`);
  }
  if (type === "number" && typeof value !== "number") {
    errors.push(`${path} must be a number.`);
  }
  if (type === "boolean" && typeof value !== "boolean") {
    errors.push(`${path} must be a boolean.`);
  }
  if (type === "array" && !Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
  }
  if (type === "object" && !isRecord(value)) {
    errors.push(`${path} must be an object.`);
  }
  return errors;
}

function resolveAllowedPath(context: AdapterContext, requestedPath: string): string {
  const root = context.env?.OPENLAUNCH_FILE_ROOT ? resolve(context.env.OPENLAUNCH_FILE_ROOT) : process.cwd();
  const normalized = requestedPath.replace(/^~\//, "");
  const fullPath = resolve(root, normalized);
  const relativePath = relative(root, fullPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Path is outside allowlisted root: ${requestedPath}`);
  }
  return fullPath;
}

function memoryKey(context: AdapterContext, key: string): string {
  return `tenant:${context.tenantId}:memory:${key}`;
}

function assertProduction(context: AdapterContext): void {
  if ((context.mode ?? "sandbox") !== "production") {
    throw new Error("This operation is write-capable and is blocked in sandbox mode. Set OPENLAUNCH_MCP_MODE=production to execute.");
  }
}

function assertHttpUrl(value: string, label: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https.`);
  }
  return url.toString();
}

function buildObjectStorageUrl(input: Record<string, unknown>, context: AdapterContext): string {
  const baseUrl = trimTrailingSlash(stringArg(input, "baseUrl") ?? context.env?.OBJECT_STORAGE_BASE_URL ?? "");
  const bucket = stringArg(input, "bucket") ?? context.env?.OBJECT_STORAGE_BUCKET;
  const key = stringArg(input, "key");
  if (!baseUrl || !bucket || !key) {
    throw new Error("Object storage requires url input, or baseUrl/bucket/key from input or env.");
  }
  return `${baseUrl}/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`;
}

function normalizeBody(value: unknown): BodyInit | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function headersToObject(headers?: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).map(([key, value]) => [key, String(value)]));
}

function safeParseJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return input;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function stringArg(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberArg(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" ? value : undefined;
}

function booleanArg(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

function recordArg(input: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = input[key];
  return isRecord(value) ? value : undefined;
}

function arrayArg(input: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = input[key];
  return Array.isArray(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function maskSecret(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length <= 4 ? "****" : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return headersFromFetch(headers);
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }
  return headers as Record<string, string>;
}

function headersFromFetch(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export async function requestJson<T = unknown>(url: string, init: RequestInit = {}, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(options.headers ?? {}),
        ...headersToRecord(init.headers),
      },
    });
    const contentType = response.headers.get("content-type") ?? "";
    let body: T | undefined;
    if (contentType.includes("application/json")) {
      body = (await response.json()) as T;
    } else {
      const text = await response.text();
      body = text ? (safeParseJson(text) as T) : undefined;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    }

    return {
      status: response.status,
      headers: headersFromFetch(response.headers),
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

class SlidingRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(private readonly config: RateLimitConfig) {}

  async wait(operationName: string): Promise<void> {
    const now = Date.now();
    const bucket = this.buckets.get(operationName) ?? { calls: [] };
    bucket.calls = bucket.calls.filter((timestamp) => now - timestamp < this.config.windowMs);
    if (bucket.calls.length >= this.config.maxCalls) {
      const oldest = bucket.calls[0] ?? now;
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, this.config.windowMs - (now - oldest))));
      return this.wait(operationName);
    }
    bucket.calls.push(now);
    this.buckets.set(operationName, bucket);
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(`HTTP ${status}`);
  }
}