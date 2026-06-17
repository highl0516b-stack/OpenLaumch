# OpenLaunch 白皮書 v0.1

## 1. 執行摘要

OpenLaunch 是一個 **AI-native Launch-as-a-Service 平台**，目標係將一個產品想法，快速轉化成完整 launch campaign：定位、landing page copy、全網渠道文案、候客名單策略、30 日 launch calendar、投資人 one-pager、lead segment、指標與下一步行動。

項目定位唔係單純 AI copywriter，而係一個 **launch command center**：先幫 founder / operator 生成 launch pack，再透過 MCP adapters 連接 Git、Filesystem、Notion、Slack、CRM、Webhook、Object Storage、AI Gateway 與部署系統，最後形成可執行、可追蹤、可擴展嘅 launch 工作流。

目前技術方向採用：

- **Cloudflare Workers / AI Gateway**：低成本邊緣 API、認證、CORS、速率限制、AI proxy、KV 日誌。
- **OpenRouter**：統一 OpenAI-compatible AI model API，做多模型、多 provider、成本與 fallback 控制。
- **Node.js API**：核心 launch generation、MCP gateway、lead/webhook API。
- **Next.js Web**：客戶入口與產品化 UI。
- **Kubernetes**：當 API、agent workers、queue、多租戶與 GPU 工作負載增長時，承接可擴展後端。
- **MCP-ready adapters**：將外部工具標準化，避免 lock-in。

## 2. OpenLaunch 係咩項目

OpenLaunch 係一個面向 founder、產品團隊、社群运营、活動主辦、投資路演與早期創業團隊嘅 launch 自動化平台。

佢解決嘅核心問題係：

1. 好多團隊有產品 idea，但唔識拆解成 launch strategy。
2. 文案、landing page、社群貼文、投资人材料、候客名單通常分散喺唔同工具。
3. founder 要同時做定位、渠道、內容、跟進、數據追蹤，容易失焦。
4. AI 可以生成內容，但如果冇 workflow、adapter、部署與成本控制，就好難變成真正可交付產品。

OpenLaunch 嘅價值主張：

> 用一句產品描述，生成一套可執行 launch system，並預留工具生態，讓 AI agent 可以幫團隊持續 launch、跟進、分發與迭代。

## 3. 目前已实现功能

### 3.1 Launch Pack 生成

核心位於 `packages/core/src/generateLaunchPlan.ts`。

輸入一個 `LaunchBrief`，可生成：

- `landingPage`
  - eyebrow
  - hero title
  - hero subtitle
  - primary / secondary CTA
  - value bullets
  - FAQ
- `campaignCopy`
  - X / Twitter
  - LinkedIn
  - 小紅書
  - YouTube Shorts
  - Discord
  - Telegram
  - Product Hunt
  - Hacker News
  - Indie Hackers
  - Email
  - Bluesky
  - Threads
  - Reddit
  - TikTok
  - WeChat
  - Substack
  - Medium
  - YouTube
  - Press
- `calendar`
  - 30 日 launch 節奏
  - 每日 action
  - channel 分配
- `investorOnePager`
  - problem
  - solution
  - market
  - traction goal
  - ask
  - why now
- `leadSegments`
  - 高匹配早期用戶
  - 渠道合作夥伴
  - 潛在投資人 / advisor
- `nextActions`
- `metrics`

目前 generate 邏輯係 deterministic template engine，穩定、可測試、成本低，適合 MVP。下一步可以接入 OpenRouter，將 deterministic plan 變成 AI-enhanced plan。

### 3.2 API 服務

API 位於 `apps/api/src/index.ts`。

已實現 routes：

- `GET /health`
- `GET /api/health`
- `GET /api/mcp/tools`
- `POST /api/mcp/tools/call`
- `GET /api/integration-status`
- `POST /api/launch/generate`
- `GET /api/leads`
- `POST /api/leads`
- `POST /api/webhooks/*`

已實現能力：

- JSON request validation
- request body size limit
- tenant ID header
- mode header：sandbox / production
- in-memory rate limit
- seed leads
- webhook ingestion
- redacted error message

### 3.3 MCP Gateway

核心位於 `packages/core/src/mcp/gateway.ts` 與 `packages/core/src/adapters.ts`。

目前 MCP tools 包括：

- `launch.fetch_text`
- `launch.fetch_json`
- `launch.git_status`
- `launch.git_diff`
- `launch.memory_put`
- `launch.memory_get`
- `launch.memory_list`
- `launch.filesystem_read`
- `launch.filesystem_write`
- `launch.generate_launch_plan`
- `launch.validate_brief`
- `launch.notion_create_page`
- `launch.slack_post_message`
- `launch.github_create_issue`
- `launch.crm_upsert_contact`
- `launch.object_storage_put`
- `launch.webhook_send`
- `launch.ai_chat`
- `launch.integration_status`
- `launch.pack_publish`

MCP 設計重點：

- 每個 tool 都有 name、description、inputSchema、capabilities。
- sandbox mode 可以防止 write-capable tools 真正執行。
- production mode 可以接真實 credentials。
- adapter capability 可用作權限、審計、路由與成本控制。

### 3.4 Cloudflare AI Gateway

Cloudflare Worker 位於 `cloudflare/src/index.ts`。

已實現：

- API key / Bearer token / Cloudflare Access JWT auth
- CORS
- request ID
- client IP rate limiting
- AI route proxy
- MCP route proxy
- KV usage / AI log
- OpenRouter-compatible OpenAI proxy
- OpenAI / Anthropic / Google / Ollama provider config
- AI usage headers：
  - `X-AI-Provider`
  - `X-AI-Model`
  - `X-Prompt-Tokens`
  - `X-Completion-Tokens`
  - `X-Total-Tokens`
  - `X-Estimated-Cost`

已部署 Worker：

- `https://openlaunch-gateway.highl0516b.workers.dev`

### 3.5 Kubernetes Baseline

已加入：

- `deploy/k8s/base/`
- `Dockerfile.api`
- API Deployment
- API Service
- API Ingress
- ConfigMap
- Namespace
- Kustomization

K8S 目標：

- API 多副本
- readiness / liveness probe
- resource request / limit
- ingress 接入
- secret 外置
- 可擴展到 queue、worker、GPU、多租戶。

## 4. OpenRouter 在項目中的角色

OpenRouter 目前係 OpenLaunch 嘅 AI model router。

使用方式：

- Cloudflare Worker 將 `/ai/openai/*` 轉發到 OpenRouter。
- OpenRouter 使用 OpenAI-compatible `/chat/completions` API。
- OpenLaunch core adapter 支援 `openrouter` provider。
- 未來可以用 OpenRouter 做：
  - launch plan AI enhancement
  - AI chat
  - tool calling
  - structured output
  - model fallback
  - cost routing
  - streaming

OpenRouter 對 OpenLaunch 嘅價值：

1. **少接多個 provider API**：一個 endpoint 接多個模型。
2. **成本可控**：可用 cheap model 做普通生成，frontier model 做高價值任務。
3. **fallback**：模型或 provider 失敗時可自動轉第二選擇。
4. **agent-ready**：支援 tools、structured output、streaming。
5. **BYOK / provider routing**：未來可按地區、成本、速度、資料保留政策路由。

## 5. 視覺與產品體驗評估

目前 Web 入口位於 `apps/web/app/page.tsx`。

現有視覺方向：

- Hero section
- 產品一句話定位
- 兩個 CTA
- 三組核心 metric：
  - 10 min：從想法到 launch command center
  - 30 days：自動規劃持續跟進節奏
  - MCP：預留工具生態與 agent adapter
- Magic Moment section
- Architecture section
- Channel pills

產品訊息清晰，方向係現代 SaaS landing page，適合 founder / operator / investor demo。

但現時 UI 仍未完整：

- `page.tsx` 匯入咗 `MagicMomentForm`、`Section`，但工作區未見對應檔案。
- `layout.tsx` 匯入 `./globals.css`，但工作區未見 CSS 檔案。
- Web build 可能因 missing imports / CSS 而失敗。
- 目前未有完整 design system、responsive layout、loading state、form interaction、generated result preview。

結論：

> OpenLaunch 嘅視覺概念係靚嘅，方向正確；但現時只係 landing page skeleton，未係完整可交付 UI。下一步應優先補 `globals.css`、`Section`、`MagicMomentForm`、launch result preview、empty state、error state 與 mobile layout。

## 6. 技術架構

### 6.1 分層架構

```text
Client / Web
  |
  v
Cloudflare AI Gateway
  |
  +--> OpenRouter / AI Providers
  +--> MCP Upstreams
  +--> KV Logs / Rate Limit
  |
  v
Node.js API
  |
  +--> @openlaunch/core
  +--> MCP Gateway
  +--> Launch Plan Engine
  +--> Leads / Webhooks
  |
  v
Kubernetes / Docker / External Integrations
```

### 6.2 Edge Layer

Cloudflare 負責：

- 全球低延遲入口
- auth
- CORS
- rate limit
- AI proxy
- MCP proxy
- usage logging
- cost headers
- 低成本邊緣處理

優點：

- 部署快
- 成本低
- 適合 API gateway
- 適合先承接真實流量

限制：

- 長任務不適合直接放 Worker
- KV rate limiter 非強一致
- 大量 agent workflow 應放 K8S / queue / worker

### 6.3 Core Layer

`@openlaunch/core` 負責：

- launch plan generation
- MCP tool definitions
- adapter execution
- storage adapter
- queue adapter
- AI provider adapter
- deployment target adapter
- redaction utility

Core 係整個系統嘅 domain engine，應該保持：

- framework-independent
- testable
- deterministic
- no UI dependency
- no deployment dependency

### 6.4 API Layer

Node.js API 負責：

- HTTP routes
- tenant context
- sandbox / production mode
- MCP tool call
- launch generation
- lead management
- webhook ingestion
- integration status

K8S 部署時，API 係第一批容器化服務。

### 6.5 Web Layer

Next.js Web 負責：

- landing page
- launch brief form
- generated launch pack preview
- channel copy preview
- calendar preview
- integration settings
- customer onboarding
- billing / plan UI（未來）

目前 Web 係最需要補完嘅客戶體驗層。

### 6.6 Infrastructure Layer

目前已有：

- Dockerfile.api
- K8S base manifests
- ConfigMap
- Ingress
- Secret reference

未來應加入：

- web Dockerfile
- GitHub Actions build/push
- K8S prod overlay
- Helm 或 Argo CD
- ingress TLS
- external secret manager
- observability
- HPA
- queue worker
- cron job

## 7. 安全與合規

已做：

- Cloudflare Worker API key / Bearer token
- Cloudflare Access JWT support
- secret redaction
- request body size limit
- rate limit headers
- KV log expiration
- K8S secret 外置

仍需補：

- GitHub token 不應寫入 repo
- OpenRouter key 不應寫入 repo
- Cloudflare token 不應寫入 repo
- K8S secret 應由 CI/CD 或 external secret manager 注入
- production mode 下 MCP write tools 必須有 explicit credentials
- audit log 要持久化，不應只放 memory / KV short-term
- 客戶數據要有 retention policy
- AI prompt / response logging 要做 PII redaction

## 8. 目前限制

1. Web UI 未完整，missing components / CSS。
2. K8S 未實際部署，本地缺少 `kubectl` / `docker`。
3. API Docker image 未 build / push 到 GHCR。
4. MCP upstreams 未接真實 Cursor / Slack server。
5. AI Gateway 只驗證到 OpenRouter upstream，但 model 受地區 / rate limit 影響。
6. KV rate limiter 不是強一致，高併發需 Cloudflare Rate Limiting Rules 或 Durable Object。
7. API lead storage 是 in-memory，重啟會丟失。
8. Launch plan generation 目前是 template-based，未真正用 AI 生成。
9. Web build 尚未完整驗證。
10. CI/CD 尚未建立。

## 9. 下一步產品路線

### Phase 1：可演示 MVP

- 補完 Web landing page
- 完成 Magic Moment form
- 連接 `/api/launch/generate`
- 展示 generated launch pack
- 支持 copy / export JSON / export Markdown
- 加入 loading / error / empty states
- 建立 GitHub Actions 自動 build/test

### Phase 2：AI-enhanced Launch Engine

- 用 OpenRouter 生成 launch brief improvement
- 用 structured output 生成 JSON launch plan
- 支持 model fallback
- 支持 streaming preview
- 支持 channel tone / audience / language 調整
- 支持保存版本歷史

### Phase 3：MCP Execution

- 接 Notion / Slack / GitHub / CRM
- 支持 launch task execution
- 支持 webhook publish
- 支持 object storage 保存 launch pack
- 支持 audit trail

### Phase 4：多租戶與生產化

- 用戶 / team / tenant
- API billing / quota
- persistent DB
- queue worker
- background jobs
- observability
- K8S production overlay
- secret manager
- HPA
- backup / restore

### Phase 5：Agent Launch Ops

- 自動監測 waitlist growth
- 自動生成每日 launch task
- 自動發 founder-led outreach draft
- 自動整理 investor update
- 自動生成社群內容
- 自動建議下一條最佳渠道

## 10. 技術決策

### 10.1 為什麼唔而家引入 LangChain

目前唔建議引入 LangChain，原因：

- OpenRouter API 已足夠處理 AI routing / fallback / tools。
- Cloudflare Worker edge runtime 對重型 agent framework 唔一定理想。
- OpenLaunch 目前最需要係穩定 MVP，而唔係複雜 agent orchestration。
- LangChain 會增加 dependency、延遲、成本與維護面。
- MCP adapters 已經提供工具標準化方向。

建議：

- 現階段用 OpenRouter + core adapters。
- 未來如果要做 multi-agent loop、memory、planner、tool registry，再考慮 LangChain / LangGraph。

### 10.2 為什麼用 Cloudflare + K8S 混合

Cloudflare 適合：

- edge API gateway
- AI proxy
- auth
- rate limit
- low-cost global access

K8S 適合：

- stateful / long-running workloads
- API containers
- queue workers
- GPU tasks
- multi-tenant isolation
- controlled scaling

混合架構可以令 OpenLaunch：

- 先用 Cloudflare 快速上線
- 用 K8S 承接核心業務
- 避免一開始就過度工程化
- 保留未來擴展空間

## 11. 成功指標

產品指標：

- 從 brief 到 launch pack 生成時間 < 10 秒
- 首 100 位測試用戶留存
- 每個 launch pack 平均修改次數
- 渠道文案 copy rate
- lead outreach reply rate
- waitlist conversion
- investor meeting conversion

技術指標：

- API p95 latency < 300ms for non-AI routes
- AI route p95 latency < 15s for streaming first token
- Worker error rate < 0.5%
- API error rate < 1%
- K8S API availability > 99.5%
- cost per launch pack < target budget
- secret leakage incidents = 0

## 12. 結論

OpenLaunch 已經有一個清晰產品定位同可執行技術架構：

- 產品層面：AI-native launch command center。
- 功能層面：launch pack generation、MCP gateway、AI gateway、K8S baseline。
- 技術層面：Cloudflare edge + Node API + OpenRouter + K8S。
- 商業層面：可服務 founder、社群、活動、投資路演、early-stage startup。

目前最大機會唔係再加一個 AI wrapper，而係將現有核心能力產品化：

1. 補完 Web UI。
2. 將 launch generation 變成可保存、可編輯、可導出。
3. 用 OpenRouter 增強 AI 生成。
4. 用 MCP 連接真實工具。
5. 用 K8S 承接生產後端。
6. 用 Cloudflare 控成本同保護邊緣入口。

OpenLaunch 嘅長期願景係成為 **launch operations OS**：從一句產品想法，到全網 launch campaign，再到持續跟進、數據反饋同下一次迭代。
