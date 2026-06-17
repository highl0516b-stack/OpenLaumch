# OpenLaunch API Gateway

Cloudflare Workers 為基礎的統一 API Gateway，負責 MCP Server 代理、AI Gateway、速率限制、認證與快取。

## 設計原則

- **JDD**: 直接修正可部署問題，先讓真實環境跑起來。
- **KISS**: Worker 入口只做認證、CORS、速率限制與路由分派。
- **DRY**: MCP/AI 路由配置集中在 `src/config.ts`，轉發邏輯集中在 `src/services/proxy.ts`。

## 目錄結構

```text
cloudflare/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── types.ts
│   ├── lib/utils.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── cors.ts
│   │   ├── rate-limit.ts
│   │   └── rateLimit.ts
│   ├── services/
│   │   ├── proxy.ts
│   │   └── cache.ts
│   └── routes/
│       ├── health.ts
│       ├── mcp.ts
│       └── ai.ts
└── tests/
```

## 路由

| 路徑 | 功能 |
|------|------|
| `/health` | Worker 健康檢查 |
| `/api/status` | 網關狀態與路由清單 |
| `/mcp/cursor-app-control/*` | MCP: Cursor App Control |
| `/mcp/cursor-ide-browser/*` | MCP: IDE Browser |
| `/mcp/plugin-slack/*` | MCP: Slack 插件 |
| `/ai/openai/*` | AI: OpenAI 代理 |
| `/ai/anthropic/*` | AI: Anthropic 代理 |
| `/ai/google/*` | AI: Google Gemini 代理 |
| `/ai/ollama/*` | AI: Ollama 代理 |
| `/ai/models` | 列出可用 AI 模型 |

## 本地開發

```bash
cd cloudflare
npm install
npm run dev
```

## 真實 Cloudflare 部署

### 1. 建立 KV Namespace

```bash
cd cloudflare
npx wrangler kv:namespace create CACHE
```

把輸出的 `id` 貼到 `wrangler.toml` 的 `[[kv_namespaces]] id`。

### 2. 配置 MCP upstream

生產環境不能連 `localhost`。把 MCP 服務部署到 Cloudflare 可達的 URL，再設定：

```bash
npx wrangler secret put MCP_CURSOR_APP_CONTROL_URL
npx wrangler secret put MCP_CURSOR_IDE_BROWSER_URL
npx wrangler secret put MCP_PLUGIN_SLACK_URL
```

### 3. 配置 AI provider

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GOOGLE_API_KEY
```

可選 base URL：

```bash
npx wrangler secret put OPENAI_BASE_URL
npx wrangler secret put ANTHROPIC_BASE_URL
npx wrangler secret put GOOGLE_BASE_URL
npx wrangler secret put OLLAMA_URL
```

### 4. 配置認證

```bash
npx wrangler secret put API_KEY
npx wrangler secret put BEARER_TOKEN
```

未設定 `API_KEY` 或 `BEARER_TOKEN` 時會進入 dev-mode 放行，只適合開發。

### 5. 部署

```bash
npm run typecheck
npm test
npm run deploy:dry-run
npm run deploy
```

大規模流量建議在 Cloudflare Dashboard 建立 Rate Limiting Rules；Worker 內的 KV rate limiter 只作為輕量保護，不替代平台層限速。

## 安全性

- 生產環境必須配置 `API_KEY` 或 `BEARER_TOKEN`。
- 支持 Cloudflare Zero Trust `Cf-Access-Jwt-Assertion`。
- token/API key 只用於比對，不會寫入 KV。
- AI 用量、成本估算與請求摘要會寫入 KV，保留 7 天。
