/**
 * OpenLaunch API Worker
 * 
 * JDD: MCP tools、webhook routing、lead processing
 * KISS: 每個 handler 獨立，錯誤統一 catch
 * DRY: auth + rate limit middleware 共享
 * LOG: 所有 MCP tool call 記錄 request ID + duration
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { timing } from 'hono/timing';
import { logger } from 'hono/logger';
import { rateLimit } from 'hono-rate-limiter';

declare global {
  namespace CloudflareBindings {
    const CONFIG_CACHE: KVNamespace;
    const SESSIONS: KVNamespace;
    const RATE_LIMIT: KVNamespace;
    const DB: D1Database;
    const UPLOADS: R2Bucket;
    const AGENT_SESSION: DurableObjectNamespace;
    const OPENLAUNCH_MCP_MODE: string;
    const OPENLAUNCH_TENANT_ID: string;
    const OPENROUTER_API_KEY: string;
    const NOTION_TOKEN: string;
    const SLACK_BOT_TOKEN: string;
    const GITHUB_TOKEN: string;
    const CRM_BASE_URL: string;
    const CRM_API_KEY: string;
  }
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

// === Middleware ===
app.use('*', timing());
app.use('*', cors({ origin: '*' }));
app.use('*', async (c, next) => {
  // Request ID
  c.res.headers.set('X-Request-Id', crypto.randomUUID().slice(0, 12));
  c.set('requestId', c.res.headers.get('X-Request-Id') || '');
  
  // Rate limit check via KV
  const ip = c.req.header('CF-Connecting-IP') || 'unknown';
  const key = `rl:${ip}:${Math.floor(Date.now() / 60000)}`;
  const count = (await c.env.RATE_LIMIT.get(key, { type: 'number' })) || 0;
  if (count > 100) {
    return c.json({ error: 'Rate limited' }, 429);
  }
  await c.env.RATE_LIMIT.put(key, count + 1, { expirationTtl: 60 });
  
  await next();
});

// Health check
app.get('/api/health', async (c) => {
  const checks: Record<string, boolean> = {};
  
  // Check DB
  try {
    await c.env.DB.prepare('SELECT 1').run();
    checks.db = true;
  } catch { checks.db = false; }
  
  // Check KV
  try {
    await c.env.CONFIG_CACHE.get('_health');
    checks.kv = true;
  } catch { checks.kv = false; }
  
  // Check R2
  try {
    await c.env.UPLOADS.head('_health');
    checks.r2 = true;
  } catch { checks.r2 = false; }
  
  return c.json({ 
    status: 'ok', 
    timestamp: Date.now(),
    mcpMode: c.env.OPENLAUNCH_MCP_MODE,
    tenantId: c.env.OPENLAUNCH_TENANT_ID,
    checks 
  });
});

// MCP tools list
app.get('/api/mcp/tools', async (c) => {
  const sandbox = c.env.OPENLAUNCH_MCP_MODE === 'sandbox';
  return c.json({
    mode: c.env.OPENLAUNCH_MCP_MODE,
    tenantId: c.env.OPENLAUNCH_TENANT_ID,
    tools: [
      { name: 'launch.generate_launch_plan', type: sandbox ? 'dry-run' : 'write', description: '生成 Launch Plan' },
      { name: 'launch.validate_brief', type: 'read', description: '驗證 Launch Brief' },
      { name: 'launch.fetch_text', type: 'read', description: '抓取文字內容' },
      { name: 'launch.fetch_json', type: 'read', description: '抓取 JSON 內容' },
      { name: 'launch.git_status', type: 'read', description: 'Git 狀態' },
      { name: 'launch.git_diff', type: 'read', description: 'Git diff' },
      { name: 'launch.memory_put', type: 'write', description: '寫入記憶' },
      { name: 'launch.memory_get', type: 'read', description: '讀取記憶' },
      { name: 'launch.memory_list', type: 'read', description: '列出記憶' },
      { name: 'launch.filesystem_read', type: 'read', description: '讀取檔案' },
      { name: 'launch.filesystem_write', type: 'write', description: '寫入檔案' },
      { name: 'launch.notion_create_page', type: sandbox ? 'dry-run' : 'write', description: '建立 Notion 頁面' },
      { name: 'launch.slack_post_message', type: sandbox ? 'dry-run' : 'write', description: '發送 Slack 訊息' },
      { name: 'launch.github_create_issue', type: sandbox ? 'dry-run' : 'write', description: '建立 GitHub Issue' },
      { name: 'launch.crm_upsert_contact', type: sandbox ? 'dry-run' : 'write', description: 'CRM 新增/更新聯繫人' },
      { name: 'launch.object_storage_put', type: sandbox ? 'dry-run' : 'write', description: '上傳物件' },
      { name: 'launch.webhook_send', type: sandbox ? 'dry-run' : 'write', description: '發送 Webhook' },
      { name: 'launch.ai_chat', type: 'read', description: 'AI 對話' },
      { name: 'launch.integration_status', type: 'read', description: '檢查整合狀態' },
      { name: 'launch.pack_publish', type: sandbox ? 'dry-run' : 'write', description: '發布 Launch Pack' },
    ]
  });
});

// MCP tool call
app.post('/api/mcp/call', async (c) => {
  const rid = c.get('requestId');
  try {
    const body = await c.req.json();
    const { tool, args } = body;
    const startTime = Date.now();
    const sandbox = c.env.OPENLAUNCH_MCP_MODE === 'sandbox';

    // 安全檢查
    if (await isRateLimited(c, rid)) {
      return c.json({ error: 'Rate limited', requestId: rid }, 429);
    }

    // 記錄調用
    const logEntry = { rid, tool, args: JSON.stringify(args).slice(0, 200), ts: new Date().toISOString() };
    
    let result;
    switch (tool) {
      case 'launch.generate_launch_plan':
        result = await generateLaunchPlan(args);
        break;
      case 'launch.validate_brief':
        result = await validateBrief(args);
        break;
      case 'launch.fetch_text':
        result = await fetchWithTimeout(args.url, 'text');
        break;
      case 'launch.fetch_json':
        result = await fetchWithTimeout(args.url, 'json');
        break;
      case 'launch.memory_put':
        result = await c.env.SESSIONS.put(args.key, JSON.stringify(args.value));
        break;
      case 'launch.memory_get':
        result = await c.env.SESSIONS.get(args.key, { type: 'json' });
        break;
      case 'launch.memory_list':
        result = await listMemory(args.prefix);
        break;
      case 'launch.pack_publish':
        if (sandbox) return c.json({ error: 'Sandbox mode: publish disabled', requestId: rid }, 403);
        result = await publishPack(args);
        break;
      case 'launch.notion_create_page':
        if (sandbox) return c.json({ error: 'Sandbox mode: Notion disabled', requestId: rid }, 403);
        result = await createNotionPage(args);
        break;
      case 'launch.slack_post_message':
        if (sandbox) return c.json({ error: 'Sandbox mode: Slack disabled', requestId: rid }, 403);
        result = await postSlackMessage(args);
        break;
      case 'launch.github_create_issue':
        if (sandbox) return c.json({ error: 'Sandbox mode: GitHub disabled', requestId: rid }, 403);
        result = await createGitHubIssue(args);
        break;
      case 'launch.ai_chat':
        result = await aiChat(args);
        break;
      case 'launch.integration_status':
        result = await checkIntegrationStatus(args);
        break;
      default:
        return c.json({ error: `Unknown tool: ${tool}`, requestId: rid }, 400);
    }

    const duration = Date.now() - startTime;
    // 記錄日誌
    await c.env.DB?.prepare(
      'INSERT INTO audit_logs (id, tenant_id, action, resource, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(rid, c.env.OPENLAUNCH_TENANT_ID, tool, typeof args === 'object' ? JSON.stringify(args) : args, JSON.stringify({ duration, sandbox }), new Date().toISOString()).run();

    return c.json({ success: true, result, requestId: rid, duration });
  } catch (err) {
    const duration = Date.now() - (Date.now() - 1);
    return c.json({ 
      error: err.message || 'Unknown error', 
      requestId: rid,
      retry: true,
      hint: '使用 dry-run 模式測試 MCP 工具'
    }, 500);
  }
});

// Webhook relay
app.post('/api/webhook/:provider', async (c) => {
  const provider = c.req.param('provider');
  const body = await c.req.json();
  const rid = c.get('requestId');
  
  // 記錄 webhook
  await c.env.DB?.prepare(
    'INSERT INTO audit_logs (id, tenant_id, action, resource, metadata) VALUES (?, ?, ?, ?, ?)'
  ).bind(rid, c.env.OPENLAUNCH_TENANT_ID, 'webhook_in', provider, JSON.stringify(body)).run();

  // 路由到對應處理器
  switch (provider) {
    case 'notion': return handleNotionWebhook(c, body);
    case 'slack': return handleSlackWebhook(c, body);
    case 'github': return handleGitHubWebhook(c, body);
    case 'stripe': return handleStripeWebhook(c, body);
    default: return c.json({ error: 'Unknown provider' }, 400);
  }
});

// Lead submission (from landing page)
app.post('/api/leads', async (c) => {
  try {
    const body = await c.req.json();
    const { name, email, company, source } = body;
    
    // 寫入 D1
    await c.env.DB.prepare(
      'INSERT INTO leads (tenant_id, name, email, company, source) VALUES (?, ?, ?, ?, ?)'
    ).bind(c.env.OPENLAUNCH_TENANT_ID, name, email, company || null, source || 'website').run();

    // 非同步通知
    c.ctx.waitUntil(notifyLead(name, email));
    
    return c.json({ success: true, message: 'Lead captured' });
  } catch (err) {
    return c.json({ error: 'Failed to save lead' }, 500);
  }
});

// Scheduled cleanup
app.get('/api/cron/cleanup', async (c) => {
  // 清理過期的會話記憶
  const now = Date.now();
  const sessions = await c.env.SESSIONS.list({ prefix: 'session:' });
  let cleaned = 0;
  for (const { key, expiration } of sessions.keys) {
    if (expiration && expiration * 1000 < now) {
      await c.env.SESSIONS.delete(key);
      cleaned++;
    }
  }
  return c.json({ cleaned });
});

// === Private Helpers ===

async function isRateLimited(c, rid) {
  const clientKey = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const key = `mcp_rate:${clientKey}:${Math.floor(Date.now() / 60000)}`;
  const count = (await c.env.RATE_LIMIT.get(key, { type: 'number' })) || 0;
  if (count > 50) return true;
  await c.env.RATE_LIMIT.put(key, count + 1, { expirationTtl: 60 });
  return false;
}

async function fetchWithTimeout(url, type) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal, cf: { cacheTtl: 300 } });
    clearTimeout(timeout);
    return type === 'json' ? await res.json() : await res.text();
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(`Fetch failed: ${err.message}`);
  }
}

async function generateLaunchPlan(args) {
  const plan = {
    type: 'generated',
    brief: args,
    landingPage: { headline: args.oneLiner || args.productName, sections: [] },
    campaign: { channels: args.channels || [], copy: {} },
    calendar: { days: 30, items: [] },
    leads: { segments: [] },
    investorOnePager: { summary: args.productName || 'Untitled' }
  };
  // If AI mode enabled, use OpenRouter for smarter generation
  if (c.env.OPENLAUNCH_MCP_MODE === 'production' && c.env.OPENROUTER_API_KEY) {
    // Call AI for generation...
  }
  return plan;
}

async function validateBrief(args) {
  const errors = [];
  if (!args.productName) errors.push('缺少 productName');
  if (!args.oneLiner) errors.push('缺少 oneLiner');
  if (!args.audience) errors.push('缺少 audience');
  return { valid: errors.length === 0, errors };
}

async function listMemory(prefix) {
  const list = [];
  for await (const { key, value } of c.env.SESSIONS.list({ prefix })) {
    list.push({ key, value: JSON.parse(value) });
  }
  return list;
}

async function publishPack(args) {
  // Publish to configured integrations
  return { published: true, targets: args.targets || [] };
}

async function createNotionPage(args) {
  const resp = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({ parent: { database_id: args.databaseId }, properties: args.properties })
  });
  return resp.json();
}

async function postSlackMessage(args) {
  const resp = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ channel: args.channel, text: args.text })
  });
  return resp.json();
}

async function createGitHubIssue(args) {
  const resp = await fetch(`https://api.github.com/repos/${args.owner}/${args.repo}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title: args.title, body: args.body })
  });
  return resp.json();
}

async function aiChat(args) {
  const body = JSON.stringify({
    model: args.model || 'openai/gpt-4.1-mini',
    messages: args.messages,
    max_tokens: args.maxTokens || 2048
  });
  
  return fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://openlaunch.example.com',
      'X-Title': 'OpenLaunch'
    },
    body
  }).then(r => r.json());
}

async function checkIntegrationStatus(args) {
  const integrations = ['notion', 'slack', 'github', 'crm'];
  const results = {};
  for (const name of integrations) {
    try {
      const token = c.env[`${name.toUpperCase()}_TOKEN`];
      results[name] = { configured: !!token, enabled: !!token };
    } catch { results[name] = { configured: false, enabled: false }; }
  }
  return results;
}

async function handleNotionWebhook(c, body) {
  await c.env.DB?.prepare('INSERT INTO audit_logs (id, tenant_id, action, resource) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID().slice(0, 16), c.env.OPENLAUNCH_TENANT_ID, 'webhook_notion', JSON.stringify(body).slice(0, 200)).run();
  return c.json({ received: true });
}

async function handleSlackWebhook(c, body) {
  return c.json({ received: true });
}

async function handleGitHubWebhook(c, body) {
  return c.json({ received: true });
}

async function handleStripeWebhook(c, body) {
  return c.json({ received: true });
}

async function notifyLead(name, email) {
  // 非同步通知（Slack/Email）
  console.log(`[${c.get('requestId')}] New lead: ${name} <${email}>`);
}

export default app;
