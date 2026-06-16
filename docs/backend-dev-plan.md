# OpenLaunch 後端開發前流程、架構與技術棧總覽

本文用於後端正式開發前的架構對齊與任務拆解。目標是在不破壞現有 Next.js MVP 的前提下，把後端能力逐步拆成可測試、可部署、可觀測、可擴展的服務邊界。

## 1. 現況總覽

OpenLaunch 目前是一個 TypeScript monorepo：

```text
apps/web
  Next.js 前端與 Route Handlers
  ├─ Magic Moment：輸入產品 brief，生成 launch pack
  ├─ /api/launch/generate：呼叫 @openlaunch/core 的 deterministic generator
  ├─ /api/leads：候客名單 prototype，目前使用 in-memory seed data
  └─ /api/health：容器 healthcheck

packages/core
  共用 TypeScript core
  ├─ LaunchBrief / LaunchPlan / LeadSegment schema
  ├─ generateLaunchPlan：從 brief 生成 landing page、campaign、calendar、investor one-pager、metrics
  ├─ AdapterRegistry：MCP adapter registry、validation、rate limit、sandbox/production 分流
  └─ McpGateway：tools/list、tools/call、audit log、secret redaction

packages/mcp-servers/launch-server
  OpenLaunch reference MCP stdio server
  ├─ tools/list
  ├─ tools/call
  └─ 預設 sandbox，write-capable tools 需 production mode 與明確 credentials

deploy/k8s
  Kubernetes manifests、Kustomize overlays、Helm chart 與多架構部署範例
```

目前後端能力主要分為三層：

1. **Next.js Route Handlers**：適合 MVP、快速驗證、內建 SSR/SSG。
2. **@openlaunch/core**：業務邏輯、schema、generator、MCP adapter 的核心來源。
3. **MCP stdio server**：給 agent/MCP client 使用的工具層原型。

正式後端開發前，需要先決定哪些能力留在 Next.js，哪些能力拆到 standalone API、worker、queue、database 或 MCP service。

## 2. 後端開發前流程

### 2.1 需求與邊界定義

每個後端功能先回答以下問題：

- 這個功能是同步 API、非同步 worker、MCP tool，還是 webhook receiver？
- 是否需要 tenant isolation？
- 是否會寫入外部系統？若是，是否預設 sandbox / dry-run？
- 是否需要持久化？若需要，資料模型與保留策略是什麼？
- 是否有 rate limit、audit log、secret redaction、idempotency key？
- 是否能在 K8s 中水平擴展？

### 2.2 API Contract 先行

新增 endpoint 前先定義 contract：

```yaml
path: POST /api/launch-plans
summary: Create and persist a launch plan
request:
  tenantId: string
  brief: LaunchBrief
  idempotencyKey?: string
response:
  201:
    planId: string
    status: planned | generating | failed
    plan?: LaunchPlan
errors:
  400: invalid_brief
  409: duplicate_idempotency_key
  429: rate_limited
  500: generation_failed
observability:
  auditEvent: launch_plan.created
```

### 2.3 測試先行（TTD）

核心後端流程先補測試，再擴展功能。優先順序：

1. brief validation
2. launch plan generation
3. tenant-scoped persistence
4. lead create/list/status transition
5. MCP sandbox blocks write-capable tools
6. secret redaction
7. path allowlist
8. rate limit
9. integration status masking
10. webhook signature verification
11. audit log schema
12. K8s readiness/liveness health behavior

### 2.4 安全與合規檢查

後端功能上線前必須確認：

- Secret 永遠不寫入 audit log、response、metrics label。
- write-capable MCP tools 預設 sandbox。
- 外部 API token 使用 Kubernetes Secret / Vault / cloud secret manager。
- tenantId 必須來自認證上下文，不信任 client 直接傳入。
- 檔案/Git 操作必須限制在 allowlist path。
- webhook receiver 需要 signature verification 與 replay protection。
- 所有非同步任務需要 idempotency key 與 retry budget。
- 所有外部 HTTP 呼叫需要 timeout、byte limit、DNS/SSRF 防護策略。

## 3. 目標後端架構

### 3.1 MVP+ 架構

```text
Browser
  -> Ingress / LoadBalancer
  -> Next.js Web Service
      -> @openlaunch/core
      -> MCP Gateway
      -> External APIs (sandbox by default)
```

適合快速驗證 Magic Moment，不需要獨立 API 服務，部署簡單，單 image 即可。

### 3.2 Split API 架構

```text
Browser
  -> Ingress
      -> Web Service (Next.js SSR/static)
      -> API Service (Node/TypeScript)
          -> @openlaunch/core
          -> Storage Adapter
          -> Queue Adapter
          -> MCP Gateway
```

適合 API 需要獨立擴容、需要更嚴格的 rate limit / audit / persistence，且 Web 與 API 生命週期不同。

### 3.3 Agent / Worker 架構

```text
Browser / MCP Client
  -> API Service
  -> Queue
  -> Worker Pool
      -> Launch generation
      -> Lead enrichment
      -> Campaign publishing
      -> Analytics aggregation
      -> Webhook fan-out
```

適合生成 launch pack 變成非同步任務、需要 retry / dead-letter queue / 排程任務 / GPU 或高 CPU agent workload。

### 3.4 Production Hardening 架構

```text
Edge Gateway / WAF
  -> Kubernetes Ingress
  -> Web Service
  -> API Service
  -> Auth / Tenant Context
  -> PostgreSQL
  -> Redis
  -> Object Storage
  -> Queue
  -> Worker Pool
  -> Audit Log / Metrics / Tracing
  -> Secret Manager
```

適合正式多租戶、需要持久化、可觀測、可審計、HPA、PDB、NetworkPolicy、resource limits，以及外部 MCP tools 與第三方 publish。

## 4. 技術棧建議

### 4.1 現在已使用

- TypeScript strict mode
- Node.js 20+
- npm workspaces
- Next.js 15 Route Handlers
- React 19
- Docker multi-stage build
- Kubernetes / Kustomize / Helm 部署設定
- MCP stdio server prototype
- Deterministic launch generator

### 4.2 建議新增

| 層級 | 技術 | 用途 |
| --- | --- | --- |
| Database | PostgreSQL / Neon / Supabase | launch plans、leads、tenants、audit log、idempotency keys |
| Cache / Queue | Redis / Upstash | rate limit、job queue、temporary memory、distributed lock |
| Object Storage | R2 / S3 | pitch deck、data room、generated assets、exports |
| Auth | Clerk / Auth.js / custom JWT | tenant identity、RBAC、API key management |
| Observability | OpenTelemetry + OTLP exporter | traces、metrics、structured logs |
| Secret Management | Kubernetes Secret / External Secrets / Vault | MCP tokens、AI keys、CRM tokens |
| API Validation | zod / typebox | runtime request validation |
| Testing | vitest + supertest / Node test runner | core、API、MCP、integration tests |

### 4.3 Adapter 優先順序

1. StorageAdapter：memory → Postgres → Redis cache
2. QueueAdapter：memory → Redis Streams / BullMQ → cloud queue
3. AiProviderAdapter：local deterministic → OpenAI-compatible → AI Gateway
4. WebhookAdapter：signed webhook send/receive
5. ObjectStorageAdapter：R2/S3 presigned URL
6. CRM / Notion / Slack / GitHub adapters：全部 production gated
7. DeploymentTarget：Vercel / Cloudflare / Kubernetes dry-run first

## 5. 後端 MVP backlog

### Phase 1：可持久化核心資料

- [ ] Tenant schema
- [ ] LaunchPlan persistence
- [ ] Lead persistence
- [ ] Idempotency key support
- [ ] Basic audit log
- [ ] Health endpoint 包含 DB / Redis readiness

### Phase 2：API 服務邊界

- [ ] Standalone API service
- [ ] Request validation
- [ ] Structured error response
- [ ] Rate limit middleware
- [ ] CORS / auth middleware
- [ ] OpenAPI contract
- [ ] API tests

### Phase 3：MCP Gateway 強化

- [ ] tools/list 穩定 schema
- [ ] tools/call audit log 持久化
- [ ] sandbox / production policy enforcement
- [ ] secret redaction unit tests
- [ ] path allowlist tests
- [ ] integration_status 不洩漏 secret 是否存在，只回 readiness 狀態

### Phase 4：非同步任務

- [ ] QueueAdapter interface
- [ ] Redis queue implementation
- [ ] Worker service
- [ ] Job retry / backoff
- [ ] Dead-letter queue
- [ ] Progress events / SSE or webhook callbacks

### Phase 5：多租戶與安全

- [ ] Tenant context middleware
- [ ] API key management
- [ ] RBAC
- [ ] Webhook signature verification
- [ ] SSRF protection for fetch/webhook
- [ ] NetworkPolicy 與 K8s secret rotation
- [ ] Audit log export

## 6. 建議 API endpoints

### Launch Plans

```text
POST   /api/launch/generate
GET    /api/launch-plans
POST   /api/launch-plans
GET    /api/launch-plans/:id
POST   /api/launch-plans/:id/review
POST   /api/launch-plans/:id/publish
```

### Leads

```text
GET    /api/leads
POST   /api/leads
GET    /api/leads/:id
PATCH  /api/leads/:id/status
POST   /api/leads/import
```

### MCP

```text
GET    /api/mcp/tools
POST   /api/mcp/tools/call
GET    /api/integration-status
```

### Webhooks

```text
POST   /api/webhooks/:provider
POST   /api/webhooks/launch-pack-delivered
POST   /api/webhooks/lead-created
```

### Health

```text
GET /health
GET /ready
GET /live
```

## 7. 資料模型初稿

```ts
interface Tenant {
  id: string;
  name: string;
  mode: "sandbox" | "production";
  createdAt: string;
  updatedAt: string;
}

interface LaunchPlanRecord {
  id: string;
  tenantId: string;
  brief: LaunchBrief;
  plan: LaunchPlan;
  status: "draft" | "reviewed" | "published" | "failed";
  createdAt: string;
  updatedAt: string;
}

interface LeadRecord {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  source: string;
  score: number;
  status: "new" | "contacted" | "qualified" | "converted";
  createdAt: string;
  updatedAt: string;
}

interface AuditEvent {
  id: string;
  tenantId: string;
  actor?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  status: "ok" | "error" | "sandbox";
  durationMs?: number;
  createdAt: string;
}
```

## 8. K8s 部署策略

- MVP：使用 `deploy/k8s/overlays/local` 或 Helm local values。
- Dev：使用 `deploy/k8s/overlays/dev`，開啟 Ingress、HPA、resource requests。
- Prod：使用 `deploy/k8s/overlays/prod`，開啟 PDB、嚴格 NetworkPolicy、TLS、resource limits。
- Split API：使用 `deploy/k8s/architectures/api-worker-split`，Web 與 API 分開部署。
- Worker：後續新增 worker Deployment / CronJob / Job 模板。

## 9. 完成定義（DoD）

後端功能完成前需滿足：

- [ ] TypeScript typecheck 通過
- [ ] 核心邏輯有單元測試
- [ ] API endpoint 有 contract test
- [ ] Secret redaction 有測試
- [ ] sandbox/production 分流有測試
- [ ] Health endpoint 符合 K8s liveness/readiness
- [ ] Audit log 不包含 secret
- [ ] Docker image 可 build
- [ ] K8s manifests / Helm chart 可 render
- [ ] README 或 docs 有使用方式