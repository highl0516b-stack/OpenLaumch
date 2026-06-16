#!/usr/bin/env node
import { McpGateway, defaultServers, type McpToolName } from "@openlaunch/core";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

const [server] = defaultServers();
if (!server) {
  throw new Error("OpenLaunch MCP server definition is missing.");
}
const mode = process.env.OPENLAUNCH_MCP_MODE === "production" ? "production" : "sandbox";
const gateway = new McpGateway({
  mode,
  tenantId: process.env.OPENLAUNCH_TENANT_ID ?? "local",
  env: process.env as Record<string, string | undefined>,
  allowedPaths: process.env.OPENLAUNCH_ALLOWED_PATHS?.split(",").map((path) => path.trim()).filter(Boolean),
});

async function main(): Promise<void> {
  const reader = process.stdin[Symbol.asyncIterator]();

  for await (const chunk of reader) {
    const lines = String(chunk).split("\n").filter(Boolean);
    for (const line of lines) {
      await handleLine(line);
    }
  }
}

async function handleLine(line: string): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch (error) {
    writeError(undefined, -32700, "Parse error");
    return;
  }

  try {
    const result = await handleRequest(request);
    writeResult(request.id, result);
  } catch (error) {
    writeError(request.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

async function handleRequest(request: JsonRpcRequest): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: server.name,
          version: "1.0.0",
        },
      };
    case "notifications/initialized":
      return {};
    case "tools/list":
      return { tools: gateway.listTools() };
    case "tools/call": {
      const name = String(request.params?.name ?? "");
      const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
      const result = await gateway.executeTool(name as McpToolName, args, {
        tenantId: process.env.OPENLAUNCH_TENANT_ID ?? "local",
        mode,
        env: process.env as Record<string, string | undefined>,
        allowedPaths: process.env.OPENLAUNCH_ALLOWED_PATHS?.split(",").map((path) => path.trim()).filter(Boolean),
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.ok,
      };
    }
    case "ping":
      return {};
    default:
      throw new Error(`Method not found: ${request.method}`);
  }
}

function writeResult(id: string | number | undefined, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function writeError(id: string | number | undefined, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

main().catch((error) => {
  writeError(undefined, -32603, error instanceof Error ? error.message : String(error));
  process.exit(1);
});