import { createLaunchAdapter, type AdapterCapability, type AdapterContext, type AdapterOperationDefinition, type StorageAdapter } from "../adapters.js";
import type {
  McpInputSchema,
  McpServerDefinition,
  McpToolContext,
  McpToolDefinition,
  McpToolName,
  McpToolResult,
} from "./types.js";

export interface McpGatewayOptions {
  mode?: "sandbox" | "production";
  tenantId?: string;
  servers?: McpServerDefinition[];
  storage?: StorageAdapter;
  env?: Record<string, string | undefined>;
  allowedPaths?: string[];
  rateLimit?: {
    maxCalls: number;
    windowMs: number;
  };
  operationRateLimits?: Record<string, { maxCalls: number; windowMs: number }>;
}

export class McpGateway {
  private readonly mode: "sandbox" | "production";
  private readonly tenantId: string;
  private readonly env: Record<string, string | undefined>;
  private readonly allowedPaths?: string[];
  private readonly servers = new Map<string, McpServerDefinition>();
  private readonly tools = new Map<McpToolName, McpToolDefinition>();
  private readonly adapter: ReturnType<typeof createLaunchAdapter>;
  private readonly auditLog: McpToolResult[] = [];

  constructor(options: McpGatewayOptions = {}) {
    this.mode = options.mode ?? "sandbox";
    this.tenantId = options.tenantId ?? "default";
    this.env = options.env ?? {};
    this.allowedPaths = options.allowedPaths;
    this.adapter = createLaunchAdapter({
      mode: this.mode,
      tenantId: this.tenantId,
      storage: options.storage,
      env: this.env,
      allowedPaths: this.allowedPaths,
      rateLimit: options.rateLimit,
      operationRateLimits: options.operationRateLimits,
    });

    for (const operation of this.adapter.listOperations()) {
      this.registerOperationDefinition(operation);
    }

    for (const server of options.servers ?? defaultServers()) {
      this.registerServer(server);
    }
  }

  registerServer(server: McpServerDefinition): void {
    this.servers.set(server.id, server);
    for (const tool of server.tools) {
      this.tools.set(tool.name, tool);
    }
  }

  registerOperationDefinition(definition: AdapterOperationDefinition | McpToolDefinition): void {
    const tool: McpToolDefinition = {
      name: definition.name as McpToolName,
      description: definition.description,
      inputSchema: definition.inputSchema as McpInputSchema,
    };
    this.tools.set(tool.name, tool);
  }

  listServers(): McpServerDefinition[] {
    return Array.from(this.servers.values());
  }

  listTools(): McpToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getMode(): "sandbox" | "production" {
    return this.mode;
  }

  getAuditLog(): McpToolResult[] {
    return [...this.auditLog];
  }

  async executeTool<T = unknown>(
    tool: McpToolName,
    input: Record<string, unknown>,
    context: McpToolContext,
  ): Promise<McpToolResult<T>> {
    const definition = this.tools.get(tool);
    const operation = this.adapter.getOperation(tool);

    const startedAt = Date.now();

    if (!definition || !operation) {
      return this.fail(tool, context, `Unknown MCP tool: ${tool}`, startedAt);
    }

    const validationErrors = validateInput(input, operation.inputSchema);
    if (validationErrors.length > 0) {
      return this.fail(tool, context, `Invalid input: ${validationErrors.join("; ")}`, startedAt);
    }

    if (this.mode === "sandbox" && !operation.capabilities.includes("read")) {
      return this.sandboxResult<T>(tool, context, definition, startedAt);
    }

    try {
      const data = await this.adapter.execute(tool, input, this.scopedContext(context));
      const result: McpToolResult<T> = {
        ok: true,
        tool,
        data: data as T,
        audit: audit(tool, context, this.mode, "ok", startedAt),
      };
      this.auditLog.push(result);
      return result;
    } catch (error) {
      return this.fail(tool, context, error instanceof Error ? error.message : String(error), startedAt);
    }
  }

  private sandboxResult<T>(tool: McpToolName, context: McpToolContext, definition: McpToolDefinition, startedAt: number): McpToolResult<T> {
    const result: McpToolResult<T> = {
      ok: true,
      tool,
      data: {
        mode: "sandbox",
        message: `Tool ${tool} is registered but not executed in sandbox mode.`,
        dryRun: {
          description: definition.description,
          inputSchema: definition.inputSchema,
        },
      } as T,
      audit: audit(tool, context, "sandbox", "sandbox", startedAt),
      warnings: ["Sandbox mode blocks write-capable tools. Set OPENLAUNCH_MCP_MODE=production with explicit credentials to execute."],
    };
    this.auditLog.push(result);
    return result;
  }

  private fail<T>(tool: McpToolName, context: McpToolContext, error: string, startedAt = Date.now()): McpToolResult<T> {
    const result: McpToolResult<T> = {
      ok: false,
      tool,
      error,
      audit: audit(tool, context, this.mode, "error", startedAt),
    };
    this.auditLog.push(result);
    return result;
  }

  private scopedContext(context: McpToolContext): AdapterContext {
    return {
      tenantId: context.tenantId || this.tenantId,
      mode: context.mode ?? this.mode,
      allowedPaths: context.allowedPaths ?? this.allowedPaths,
      env: { ...this.env, ...context.env },
      capabilities: context.capabilities?.map((capability) => capability as AdapterCapability),
    };
  }
}

function validateInput(input: Record<string, unknown>, schema: McpInputSchema): string[] {
  const errors: string[] = [];
  if (schema.type === "object") {
    if (!isRecord(input)) {
      return ["Expected input to be an object."];
    }
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in input)) {
          errors.push(`Missing required field: ${key}`);
        }
      }
    }
    if (isRecord(schema.properties)) {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        if (!(key in input)) {
          continue;
        }
        errors.push(...validateValue(input[key], propertySchema, key));
      }
    }
    return errors;
  }
  return validateValue(input, schema, "input");
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

function audit(
  tool: McpToolName,
  context: McpToolContext,
  mode: "sandbox" | "production",
  status: "ok" | "error" | "sandbox",
  startedAt: number,
) {
  return {
    tenantId: context.tenantId,
    tool,
    executedAt: new Date().toISOString(),
    mode,
    status,
    durationMs: Date.now() - startedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function defaultToolDefinitions(): McpToolDefinition[] {
  return createLaunchAdapter().listOperations().map((operation) => ({
    name: operation.name as McpToolName,
    description: operation.description,
    inputSchema: operation.inputSchema as McpInputSchema,
  }));
}

export function defaultServers(): McpServerDefinition[] {
  return [
    {
      id: "openlaunch-launch-tools",
      name: "OpenLaunch Launch Tools",
      transport: "stdio",
      tools: defaultToolDefinitions(),
    },
  ];
}
