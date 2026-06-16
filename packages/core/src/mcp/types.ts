export type McpToolName =
  | "launch.fetch_text"
  | "launch.fetch_json"
  | "launch.git_status"
  | "launch.git_diff"
  | "launch.memory_put"
  | "launch.memory_get"
  | "launch.memory_list"
  | "launch.filesystem_read"
  | "launch.filesystem_write"
  | "launch.generate_launch_plan"
  | "launch.validate_brief"
  | "launch.notion_create_page"
  | "launch.slack_post_message"
  | "launch.github_create_issue"
  | "launch.crm_upsert_contact"
  | "launch.object_storage_put"
  | "launch.webhook_send"
  | "launch.ai_chat"
  | "launch.integration_status"
  | "launch.pack_publish"
  | (string & {});

export type McpInputSchema = {
  type?: string;
  required?: string[];
  properties?: Record<string, McpInputSchema>;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  [key: string]: unknown;
};

export interface McpToolDefinition {
  name: McpToolName;
  description: string;
  inputSchema: McpInputSchema;
}

export interface McpToolContext {
  tenantId: string;
  mode?: "sandbox" | "production";
  allowedPaths?: string[];
  env?: Record<string, string | undefined>;
  capabilities?: string[];
}

export interface McpAuditEntry {
  tenantId: string;
  tool: McpToolName;
  executedAt: string;
  mode: "sandbox" | "production";
  status: "ok" | "error" | "sandbox";
  durationMs: number;
}

export interface McpToolResult<T = unknown> {
  ok: boolean;
  tool: McpToolName;
  data?: T;
  error?: string;
  audit: McpAuditEntry;
  warnings?: string[];
  metadata?: Record<string, unknown>;
}

export interface McpServerDefinition {
  id: string;
  name: string;
  transport: "stdio" | "sse" | "streamable-http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  tools: McpToolDefinition[];
}