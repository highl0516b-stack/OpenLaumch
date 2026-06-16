# OpenLaunch Architecture

OpenLaunch 是 Launch-as-a-Service / Launch OS 原型，目標是把產品想法快速轉成 launch campaign、候客名單、全網文案、lead follow-up 與 investor room。

## 第一性原則

成功 launch 需要同時完成：

1. 敘事成型：定位、故事、pitch、資料室。
2. 流量匯聚：社群、媒體、KOL、搜尋、郵件、短影片。
3. 承諾轉化：waitlist、預約、預購、集資、投資意向。
4. 持續跟進：lead scoring、分眾溝通、自動化 nurture。
5. 資源升級：媒體、渠道、資方、合作夥伴。

現有工具分散，OpenLaunch 的缺口是 AI-native launch command center。

## 模組

```text
apps/web
└─ Next.js 前端與 Route Handlers
   ├─ Magic Moment：輸入產品 brief，生成 launch pack
   ├─ /api/launch/generate：本地 deterministic generator
   ├─ /api/leads：lead inbox 原型
   └─ /api/health：容器 healthcheck

packages/core
└─ 可共用 TypeScript core
   ├─ LaunchBrief / LaunchPlan schema
   ├─ generateLaunchPlan
   ├─ AdapterRegistry：MCP adapter registry
   └─ McpGateway：sandbox/production 分流、validation、audit、rate limit

packages/mcp-servers/launch-server
└─ 參考 MCP stdio server
   ├─ tools/list
   ├─ tools/call
   ├─ generate_launch_plan / validate_brief
   ├─ fetch_text / fetch_json
   ├─ git_status / git_diff
   ├─ memory_put / memory_get / memory_list
   ├─ filesystem_read / filesystem_write
   ├─ notion_create_page / slack_post_message / github_create_issue
   ├─ crm_upsert_contact / object_storage_put / webhook_send
   └─ ai_chat / integration_status / pack_publish
```

## 技術棧策略

- Cloudflare：Pages、Workers、D1、R2、KV、Queues、AI Gateway，用於低成本 edge layer。
- Vercel：Next.js SSR、preview deployment、團隊協作。
- Kubernetes：agent workers、queue workers、多租戶隔離、GPU workload。
- Docker：多階段 build、standalone runtime、non-root user、healthcheck。
- MCP：把 Fetch、Git、Memory、Filesystem、Notion、Slack、CRM、GitHub、Object Storage、Webhook、AI 與 Deployment 封裝成可控工具層。

## MCP Gateway 安全原則

1. tenant isolation：每個租戶只能呼叫自己的工具與資料。
2. tool allowlist：預設 sandbox，不允許任意外部工具。
3. token scoping：外部 MCP server 使用最小權限 token。
4. audit log：所有 tool call 記錄 tenant、tool、時間與結果。
5. prompt injection 防護：對 fetched text 做 redaction 與上下文隔離。
6. rate limit：對外部工具與分發渠道做限流。
7. adapter registry：所有工具都經 `AdapterRegistry` 註冊、驗證、審計與 sandbox/production 分流。

## MVP 客戶流程

客戶只需要輸入 product brief，系統就生成一份可審查的 Launch Pack。

```text
Product Brief
  → validate_brief
  → generate_launch_plan
  → review artifacts
  → integration_status
  → webhook_send
  → production publish / deployment
```

MVP 不應該預設自動 publish 到 Notion / Slack / GitHub / CRM。  
正確順序是：

1. 生成 launch pack
2. 讓客戶 review
3. 用 webhook 接到客戶自己的 automation
4. 客戶明確開啟 `OPENLAUNCH_MCP_MODE=production` 後，才允許 write-capable tools

## TTD / KISS / DRY / LOG

### TTD

核心流程先寫測試，再擴展功能。優先覆蓋：

- brief validation
- launch plan generation
- MCP `tools/list`
- MCP `tools/call`
- sandbox blocks write-capable tools
- secret redaction
- path allowlist
- rate limit
- integration status masking

### KISS

MVP 只做最關鍵路徑：

```text
brief → launch pack → review → webhook
```

第三方 publish 先做 dry-run / status / webhook，避免一開始就把 Notion、Slack、GitHub、CRM 全自動串進主流程。

### DRY

共用邏輯保持單一來源：

- `assertProduction`
- `assertHttpUrl`
- `redactSecrets`
- `headersToRecord`
- `normalizeBody`
- `recordArg`
- `arrayArg`
- `stringArg`
- `resolveAllowedPath`
- `memoryKey`

### LOG

每個 tool call 都要可觀測：

- tenant
- mode
- tool name
- duration
- result
- error code
- audit trail
- secret redaction

## 後續接入

- PostgreSQL / Neon / Supabase：核心業務資料。
- Redis / Upstash：queue、cache、rate limit。
- R2 / S3：pitch deck、data room、圖片資產。
- Notion / Slack / GitHub / CRM / Object Storage / Webhook MCP：協作、分發與事件路由。
- Cloudflare Workers：edge API gateway、rate limit、webhook receiver。
- Kubernetes Jobs / CronJobs：批量分發、lead enrichment、analytics aggregation。