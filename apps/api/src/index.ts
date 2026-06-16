import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  McpGateway,
  defaultToolDefinitions,
  generateLaunchPlan,
  redactSecrets,
  type ChannelKey,
  type LaunchBrief,
} from "@openlaunch/core";

const PORT = Number.parseInt(process.env.PORT ?? process.env.API_PORT ?? "4000", 10);
const HOSTNAME = process.env.HOSTNAME ?? "0.0.0.0";
const DEFAULT_TENANT_ID = process.env.OPENLAUNCH_TENANT_ID ?? "default";
const DEFAULT_MODE = process.env.OPENLAUNCH_MCP_MODE === "production" ? "production" : "sandbox";
const RATE_LIMIT_WINDOW_MS = Number.parseInt(process.env.API_RATE_LIMIT_WINDOW_MS ?? "60000", 10);
const RATE_LIMIT_MAX_CALLS = Number.parseInt(process.env.API_RATE_LIMIT_MAX_CALLS ?? "60", 10);
const MAX_BODY_BYTES = Number.parseInt(process.env.API_MAX_BODY_BYTES ?? "1000000", 10);

type LeadStatus = "new" | "contacted" | "qualified" | "converted";
type Mode = "sandbox" | "production";

interface LeadRecord {
  id: string;
  name: string;
  email: string;
  source: string;
  score: number;
  status: LeadStatus;
  createdAt: string;
}

interface RequestContext {
  tenantId: string;
  mode: Mode;
}

interface ApiError extends Error {
  statusCode?: number;
}

const seedLeads: LeadRecord[] = [
  { id: "lead_001", name: "Early User Alpha", email: "alpha@example.com", source: "product_hunt", score: 82, status: "new", createdAt: new Date().toISOString() },
  { id: "lead_002", name: "Partner Beta", email: "beta@example.com", source: "linkedin", score: 74, status: "contacted", createdAt: new Date().toISOString() },
  { id: "lead_003", name: "Angel Advisor", email: "advisor@example.com", source: "email", score: 91, status: "qualified", createdAt: new Date().toISOString() },
];

const leads = new Map<string, LeadRecord>(seedLeads.map((lead) => [lead.id, lead]));
const rateLimitBuckets = new Map<string, number[]>();
const allowedPaths = process.env.OPENLAUNCH_ALLOWED_PATHS?.split(",").map((path) => path.trim()).filter(Boolean);

const gateway = new McpGateway({
  mode: DEFAULT_MODE,
  tenantId: DEFAULT_TENANT_ID,
  env: process.env as Record<string, string | undefined>,
  allowedPaths,
  rateLimit: {
    maxCalls: RATE_LIMIT_MAX_CALLS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  },
});

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    sendError(response, error);
  }
});

server.listen(PORT, HOSTNAME, () => {
  console.log(`OpenLaunch API listening on http://${HOSTNAME}:${PORT}`);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const method = request.method ?? "GET";

  if (method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if ((url.pathname === "/health" || url.pathname === "/api/health") && method === "GET") {
    sendJson(response, 200, healthPayload(request));
    return;
  }

  if (url.pathname === "/api/mcp/tools" && method === "GET") {
    sendJson(response, 200, { ok: true, tools: gateway.listTools() });
    return;
  }

  if (url.pathname === "/api/integration-status" && method === "GET") {
    const result = await gateway.executeTool("launch.integration_status", {}, requestContext(request));
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/mcp/tools/call" && method === "POST") {
    const body = await readJson(request);
    const record = isRecord(body) ? body : {};
    const name = stringField(record, "name");
    const args = isRecord(record.arguments) ? record.arguments : {};
    if (!name) {
      sendJson(response, 400, { ok: false, error: "Missing MCP tool name." });
      return;
    }
    const result = await gateway.executeTool(name, args, requestContext(request));
    sendJson(response, result.ok ? 200 : 400, result);
    return;
  }

  if (url.pathname === "/api/launch/generate" && method === "POST") {
    const context = requestContext(request);
    if (!checkRateLimit(context.tenantId)) {
      sendJson(response, 429, { ok: false, error: "Rate limit exceeded.", tenantId: context.tenantId });
      return;
    }

    const startedAt = Date.now();
    const body = await readJson(request);
    const brief = normalizeLaunchBrief(body);
    const missing = validateLaunchBrief(brief);
    if (missing.length > 0) {
      sendJson(response, 400, { ok: false, error: "Missing required fields", missing });
      return;
    }

    const plan = generateLaunchPlan(brief);
    sendJson(response, 200, {
      ok: true,
      plan,
      audit: {
        tenantId: context.tenantId,
        mode: context.mode,
        action: "launch.generate",
        durationMs: Date.now() - startedAt,
      },
    });
    return;
  }

  if (url.pathname === "/api/leads" && method === "GET") {
    sendJson(response, 200, { leads: Array.from(leads.values()) });
    return;
  }

  if (url.pathname === "/api/leads" && method === "POST") {
    const body = await readJson(request);
    const lead = createLead(body);
    leads.set(lead.id, lead);
    sendJson(response, 201, { lead });
    return;
  }

  if (url.pathname.startsWith("/api/webhooks/") && method === "POST") {
    const body = await readJson(request);
    sendJson(response, 202, {
      ok: true,
      event: url.pathname.replace("/api/webhooks/", ""),
      tenantId: requestContext(request).tenantId,
      receivedAt: new Date().toISOString(),
      bodyPreview: safePreview(body),
    });
    return;
  }

  sendJson(response, 404, { ok: false, error: "Not found", path: url.pathname });
}

function healthPayload(request: IncomingMessage) {
  const context = requestContext(request);
  return {
    ok: true,
    service: "openlaunch-api",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    tenantId: context.tenantId,
    mode: context.mode,
    mcpTools: defaultToolDefinitions().length,
  };
}

function requestContext(request: IncomingMessage): RequestContext {
  const tenantId = firstStringHeader(request.headers["x-openlaunch-tenant"], request.headers["x-tenant-id"]) ?? DEFAULT_TENANT_ID;
  const modeHeader = firstStringHeader(request.headers["x-openlaunch-mode"]);
  const mode = modeHeader === "production" ? "production" : DEFAULT_MODE;
  return { tenantId, mode };
}

function normalizeLaunchBrief(body: unknown): LaunchBrief {
  if (!isRecord(body)) {
    return {
      productName: "",
      oneLiner: "",
      audience: "",
      problem: "",
      launchGoal: "waitlist",
      channels: [],
    };
  }

  return {
    productName: stringField(body, "productName") ?? "",
    oneLiner: stringField(body, "oneLiner") ?? "",
    audience: stringField(body, "audience") ?? "",
    problem: stringField(body, "problem") ?? "",
    launchGoal: launchGoal(body.launchGoal) ?? "waitlist",
    channels: channelKeys(body.channels),
    targetMarket: stringField(body, "targetMarket"),
    pricingHint: stringField(body, "pricingHint"),
    founderNote: stringField(body, "founderNote"),
  };
}

function validateLaunchBrief(brief: LaunchBrief): string[] {
  const required: Array<keyof LaunchBrief> = ["productName", "oneLiner", "audience", "problem", "launchGoal", "channels"];
  return required.filter((field) => {
    const value = brief[field];
    return Array.isArray(value) ? value.length === 0 : !value;
  });
}

function createLead(body: unknown): LeadRecord {
  const record = isRecord(body) ? body : {};
  const status = leadStatus(record.status) ?? "new";
  return {
    id: `lead_${Date.now().toString(36)}`,
    name: stringField(record, "name") ?? "Anonymous lead",
    email: stringField(record, "email") ?? "",
    source: stringField(record, "source") ?? "manual",
    score: numberField(record, "score") ?? 50,
    status,
    createdAt: new Date().toISOString(),
  };
}

async function readJson(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      const error = new Error("Request body too large") as ApiError;
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }

  if (totalBytes === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    const error = new Error("Invalid JSON body") as ApiError;
    error.statusCode = 400;
    throw error;
  }
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = (rateLimitBuckets.get(key) ?? []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  if (bucket.length >= RATE_LIMIT_MAX_CALLS) {
    rateLimitBuckets.set(key, bucket);
    return false;
  }
  bucket.push(now);
  rateLimitBuckets.set(key, bucket);
  return true;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  if (response.headersSent) {
    return;
  }
  const body = statusCode === 204 ? "" : `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type,x-openlaunch-tenant,x-tenant-id,x-openlaunch-mode",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendError(response: ServerResponse, error: unknown): void {
  const apiError = error as ApiError;
  const statusCode = typeof apiError.statusCode === "number" ? apiError.statusCode : 500;
  const message = apiError instanceof Error ? apiError.message : String(error);
  sendJson(response, statusCode, {
    ok: false,
    error: {
      code: statusCode === 400 ? "bad_request" : statusCode === 404 ? "not_found" : statusCode === 413 ? "payload_too_large" : statusCode === 429 ? "rate_limited" : "internal_error",
      message: redactSecrets(message),
    },
  });
}

function safePreview(value: unknown, maxBytes = 500): unknown {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const safeText = redactSecrets(text).slice(0, maxBytes);
  try {
    return JSON.parse(safeText) as unknown;
  } catch {
    return safeText;
  }
}

function launchGoal(value: unknown): LaunchBrief["launchGoal"] | undefined {
  return value === "waitlist" || value === "funding" || value === "partnership" || value === "sales" || value === "community" ? value : undefined;
}

function leadStatus(value: unknown): LeadStatus | undefined {
  return value === "new" || value === "contacted" || value === "qualified" || value === "converted" ? value : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function channelKeys(value: unknown): ChannelKey[] {
  const valid = new Set<ChannelKey>([
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
  ]);
  return Array.isArray(value) ? value.map(String).filter((channel): channel is ChannelKey => valid.has(channel as ChannelKey)) : [];
}

function firstStringHeader(...headers: Array<string | string[] | undefined>): string | undefined {
  for (const header of headers) {
    if (typeof header === "string" && header.length > 0) {
      return header;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}