# OpenLaunch

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

OpenLaunch 是 **Launch as a Service / Launch OS** 原型平台：把一個產品想法轉成 landing page、waitlist、全網 launch copy、lead segments、investor one-pager 與 30 天持續跟進計劃。

## 快速開始

需要 Node.js 20+ 與 npm。

```bash
npm install
cp .env.example .env.local
# 編輯 .env.local 後啟動
npm run dev
npm run dev:api
```

開啟：<http://localhost:3000>

## 主要指令

| 指令 | 說明 |
|---|---|
| `npm run dev` | 啟動 Next.js dev server |
| `npm run dev:api` | 啟動 Node.js API server |
| `npm run build` | 建立 production build |
| `npm run typecheck` | TypeScript 檢查 |
| `npm run lint` | ESLint |
| `npm run docker:build` | Build web image |
| `npm run docker:build:api` | Build API image |
| `npm run docker:build:fast` | Build web image（BuildKit cache，最高速度） |
| `npm run docker:build:api:fast` | Build API image（BuildKit cache，最高速度） |
| `npm run docker:up` | Docker Compose 起服務（web + API） |
| `npm run docker:down` | Docker Compose 停止 |
| `npm run docker:smoke:wait <url>` | 等候 HTTP health endpoint |
| `npm run k8s:build:local` | Render K8s local manifests |
| `npm run k8s:build:dev` | Render K8s dev manifests |
| `npm run k8s:build:prod` | Render K8s prod manifests |
| `npm run k8s:build:split-api` | Render split API architecture |

## 部署方式

### ① Docker Compose（最快，適合開發 / Demo）

```bash
npm run docker:up          # build + run web (3000) + api (4000)
npm run docker:down        # 停止
npm run docker:build:fast  # 快速 build web image
npm run docker:build:api:fast  # 快速 build API image
npm run docker:smoke:wait http://127.0.0.1:3000/api/health
npm run docker:smoke:wait http://127.0.0.1:4000/api/health
```

### ② Docker Buildx Bake（CI / 正式 build，支援 BuildKit cache）

```bash
docker buildx bake --load
```

一次 build 兩個 image（web + API）。第二次 build 極快，因為 npm cache 會保留。

### ③ Kind + K8s 本地演練（模擬真實 K8s 部署）

```bash
# 預備：安裝 kind、kubectl、docker
./scripts/kind-local-demo.sh                 # web 模式
./scripts/kind-local-demo.sh MODE=split      # split API 模式（Web + 獨立 API pod）
```

也可逐步執行：

```bash
kind create cluster --name openlaunch-local --config deploy/k8s/kind.yaml
docker build -t openlaunch:local .
docker build -f Dockerfile.api -t openlaunch-api:local .
kind load docker-image openlaunch:local --name openlaunch-local
kind load docker-image openlaunch-api:local --name openlaunch-local
kubectl apply -k deploy/k8s/overlays/local
kubectl -n openlaunch-local port-forward svc/openlaunch-web 3000:80
```

### ④ Kubernetes 正式部署（多租戶 / Production）

```bash
# 1. Build image
docker build -t ghcr.io/highl0516b-stack/openlaunch:prod .
docker build -f Dockerfile.api -t ghcr.io/highl0516b-stack/openlaunch-api:prod .

# 2. Push
docker push ghcr.io/highl0516b-stack/openlaunch:prod
docker push ghcr.io/highl0516b-stack/openlaunch-api:prod

# 3. 修改 K8s overlay 的 image tag
#    deploy/k8s/overlays/prod/kustomization.yaml 中把 image tag 改為 prod

# 4. Deploy（需事先安裝 cert-manager + ingress-nginx + metrics-server）
kubectl apply -k deploy/k8s/overlays/prod
kubectl -n openlaunch-prod rollout status deploy/openlaunch-web
kubectl -n openlaunch-prod rollout status deploy/openlaunch-api
```

## 產品定位

- 研討會、產品演練、演說集資、社群聚客、資方引進。
- 一鍵生成 launch pack，預留全網分發、CRM、MCP、資料室與投資者儀表板接口。
- Magic Moment：輸入一句話產品描述，10 分鐘內得到 launch command center。

## 目錄結構

```text
apps/web
  前端、Route Handlers、Magic Moment 頁面

apps/api
  Node.js API server：MCP tool proxy、launch plan dry-run、lead webhook prototype

packages/core
  LaunchBrief / LaunchPlan schema、launch generator、Adapter Registry、MCP Gateway

packages/mcp-servers/launch-server
  OpenLaunch reference MCP stdio server 原型

deploy/k8s
  Kubernetes base manifests、local/dev/prod overlays、split API architecture

docs/architecture.md
  長遠架構與技術棧說明

docs/k8s-architecture.md
  K8s 架構、安全基線與部署流程總覽

docs/backend-dev-plan.md
  後端開發前流程、MVP 邊界與任務拆解
```

## MVP 功能：客戶視線

MVP 的核心不是「功能最多」，而是讓客戶可以從一句產品 brief，快速得到可審查、可執行的 launch command center。

### 客戶輸入

客戶只需要提供：

- `productName`：產品名
- `oneLiner`：一句話定位
- `audience`：目標客群
- `problem`：要解決的問題
- `launchGoal`：waitlist / funding / partnership / sales / community
- `channels`：要優先使用的 launch channels

### 客戶拿到

系統會生成一份 `Launch Pack`：

- Landing page copy
- 多頻道 campaign copy
- 30 天 launch calendar
- Lead segments
- Investor one-pager
- Launch metrics
- Next actions

### MVP 必做

- Launch Brief Validator
- Launch Plan Generator
- MCP `tools/list` / `tools/call`
- Sandbox 模式
- Tenant-scoped Memory
- Integration Status
- Webhook routing
- Secret redaction
- Path allowlist
- Rate limit
- Structured audit / error log

### MVP 先做 dry-run，不預設自動 publish

MVP 階段建議先不要預設 publish 到 Notion / Slack / GitHub / CRM，而是：

1. 生成 launch pack
2. 讓客戶 review
3. 用 webhook 接到客戶自己的 n8n / Zapier / Make / CRM / Notion automation
4. 等客戶明確開啟 `OPENLAUNCH_MCP_MODE=production` 後，才允許 write-capable tools

## API Server

`apps/api` 是後端入口原型，提供 HTTP API 與 MCP proxy：

```bash
npm run dev:api
curl http://localhost:4000/api/health
curl http://localhost:4000/api/mcp/tools
curl -X POST http://localhost:4000/api/launch/generate \
  -H 'content-type: application/json' \
  -d '{"productName":"Demo","oneLiner":"AI launch copilot","audience":"indie hackers","problem":"launch is fragmented","launchGoal":"waitlist","channels":["product_hunt","x"]}'
```

## Kubernetes 部署

Kubernetes 設定放在 `deploy/k8s`：

```bash
npm run k8s:build:local   # base + local overlay
npm run k8s:build:dev     # dev overlay
npm run k8s:build:prod    # prod overlay
npm run k8s:build:split-api # web + split API architecture
```

詳細流程與架構請見 `docs/k8s-architecture.md` 與 `deploy/k8s/README.md`。

## MCP 開發與第三方整合

OpenLaunch 現在提供一個可擴展的 MCP adapter layer，預設 sandbox，寫入型工具需要 `OPENLAUNCH_MCP_MODE=production` 與明確 token 才會真正呼叫第三方 API。

```bash
OPENLAUNCH_MCP_MODE=sandbox OPENLAUNCH_TENANT_ID=demo npm run build -w @openlaunch/launch-server
node packages/mcp-servers/launch-server/dist/index.js
```

可用工具包含：

- `launch.generate_launch_plan` / `launch.validate_brief`：生成 deterministic launch pack。
- `launch.fetch_text` / `launch.fetch_json`：帶 timeout、byte limit、secret redaction 的公開 HTTP(S) 抓取。
- `launch.git_status` / `launch.git_diff`：allowlisted path 內的 Git 讀取。
- `launch.memory_put` / `launch.memory_get` / `launch.memory_list`：tenant-scoped memory。
- `launch.filesystem_read` / `launch.filesystem_write`：allowlisted local filesystem。
- `launch.notion_create_page`：Notion database page。
- `launch.slack_post_message`：Slack channel 更新。
- `launch.github_create_issue`：GitHub issue / launch task。
- `launch.crm_upsert_contact`：HubSpot-compatible CRM upsert。
- `launch.object_storage_put`：presigned URL 或 R2/S3-compatible endpoint 上傳。
- `launch.webhook_send`：HTTP webhook event routing。
- `launch.ai_chat`：OpenAI-compatible chat endpoint。
- `launch.integration_status`：檢查第三方整合是否已配置。
- `launch.pack_publish`：生成 launch pack 並可同步發布到 Notion / Slack / GitHub / webhook。

### MCP 工程規則

- **TTD**：先為核心流程補測試，再擴展功能。優先覆蓋 brief validation、launch plan generation、sandbox 阻擋 write、secret redaction、path allowlist、rate limit 與 integration status。
- **KISS**：MVP 只做 `brief → launch pack → review → webhook`，避免一開始把 Notion / Slack / GitHub / CRM 全自動 publish 做進主流程。
- **DRY**：把 `assertProduction`、`assertHttpUrl`、`redactSecrets`、`headersToRecord`、`normalizeBody`、`recordArg`、`arrayArg`、`resolveAllowedPath` 等 helper 保持單一來源。
- **LOG**：每次 tool call 都要可觀測：tenant、mode、tool、duration、result、error code、audit trail，並且所有 token / API key 都必須 redacted。

### 常用 env

```bash
OPENLAUNCH_MCP_MODE=sandbox|production
OPENLAUNCH_TENANT_ID=demo
OPENLAUNCH_ALLOWED_PATHS=/path/to/repo,/path/to/assets
NOTION_TOKEN=...
NOTION_DATABASE_ID=...
SLACK_BOT_TOKEN=...
SLACK_CHANNEL_ID=...
GITHUB_TOKEN=...
GITHUB_OWNER=...
GITHUB_REPO=...
CRM_BASE_URL=https://api.hubspot.com
CRM_API_KEY=...
HUBSPOT_PRIVATE_APP_TOKEN=...
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
OBJECT_STORAGE_BASE_URL=...
OBJECT_STORAGE_BUCKET=...
LAUNCH_PACK_WEBHOOK_URL=...
```

### 客戶體驗優化原則

- 預設 sandbox，避免誤 publish。
- 錯誤訊息要人話，例如提示缺少 `NOTION_TOKEN` / `NOTION_DATABASE_ID`。
- 第三方未配置時仍可生成 launch pack，只在 `integration_status` 顯示 disabled。
- Secret 永遠 redacted。
- 先給客戶可審查的 artifacts，再提供 publish / webhook。
- 所有 write-capable 操作都必須顯式 production mode。

## 長遠技術棧

- Cloudflare Pages / Workers / D1 / R2 / KV / Queues / AI Gateway
- Vercel SSR / Preview Deployment
- PostgreSQL / Redis / Object Storage
- Kubernetes for agent workers、queue workers、multi-tenant isolation
- Docker multi-stage build、standalone runtime、non-root user、healthcheck
- MCP Fetch / Git / Memory / Filesystem / Notion / Slack / GitHub / CRM / Object Storage / Webhook / AI adapters

## 開源策略

開源：landing page templates、Dockerfile、MCP connectors、launch template schema、SDK、CLI、deployment recipes。

閉源：lead scoring、investor matching、campaign optimization、商業模板庫、資方網絡與高價值 automation workflow。
