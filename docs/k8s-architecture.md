# OpenLaunch Kubernetes 架構與部署總覽

本文件整理 OpenLaunch 的 Kubernetes 部署架構、Kustomize overlays、Helm chart 與後續 worker / MCP 擴充方式。

## 1. 部署架構矩陣

| 架構 | 使用情境 | 入口 | 服務 | 特點 |
| --- | --- | --- | --- | --- |
| Single Web Service | MVP / local / dev | Ingress -> web | web | 最簡單，Next.js Route Handlers 直接提供 API |
| Split API | 後端正式開發 | Ingress -> web + api | web、api | API 可獨立擴容、獨立 rate limit / audit |
| MCP Sidecar / Worker | agent 工具層 | MCP client / API | web、api、mcp worker | 後續把 stdio MCP server 轉成 HTTP/streamable transport |
| Edge + K8s Workers | 正式多租戶 | Edge/WAF -> K8s | web、api、worker、queue、db、redis | 多租戶、queue、GPU / CPU worker、object storage |

## 2. 目錄結構

```text
deploy/k8s
  base
    namespace.yaml
    configmap.yaml
    secret.yaml
    serviceaccount.yaml
    deployment-web.yaml
    service-web.yaml
    hpa-web.yaml
    pdb-web.yaml
    networkpolicy-web.yaml
    ingress.yaml
    kustomization.yaml
  overlays
    local
    dev
    prod
  architectures
    api-worker-split
  kind.yaml
  README.md

deploy/helm/openlaunch
  Chart.yaml
  values.yaml
  templates
  README.md
```

## 3. Kustomize 使用方式

### 3.1 Local / kind

```bash
npm run docker:build
kind create cluster --name openlaunch-local --config deploy/k8s/kind.yaml
kubectl apply -k deploy/k8s/overlays/local
kubectl -n openlaunch-local get pods
kubectl -n openlaunch-local port-forward svc/openlaunch-web 3000:80
```

開啟：<http://localhost:3000>

### 3.2 Dev overlay

```bash
docker build -t openlaunch:dev .
kubectl apply -k deploy/k8s/overlays/dev
kubectl -n openlaunch-dev get pods,svc,ingress,hpa,pdb
```

### 3.3 Prod overlay

```bash
docker build -t registry.example.com/openlaunch:prod .
docker push registry.example.com/openlaunch:prod
kubectl apply -k deploy/k8s/overlays/prod
kubectl -n openlaunch-prod get pods,svc,ingress,hpa,pdb,networkpolicy
```

Prod overlay 預設使用：

- `OPENLAUNCH_MCP_MODE=sandbox`
- TLS Ingress
- PDB
- HPA
- resource requests / limits
- NetworkPolicy
- non-root container
- readOnlyRootFilesystem
- `/tmp` emptyDir volume

## 4. Split API 架構

```bash
docker build -t openlaunch:dev .
docker build -f Dockerfile.api -t openlaunch-api:dev .
kubectl apply -k deploy/k8s/architectures/api-worker-split
kubectl -n openlaunch-dev get pods,svc,ingress
```

Ingress 路由：

```text
/api/* -> openlaunch-api
/*     -> openlaunch-web
```

## 5. Secret 與環境變數

K8s 中分為兩類：

- `openlaunch-config`：非敏感設定，例如 `NODE_ENV`、`PORT`、`OPENLAUNCH_MCP_MODE`、`NEXT_PUBLIC_APP_URL`。
- `openlaunch-secrets`：敏感 token，例如 `OPENAI_API_KEY`、`GITHUB_TOKEN`、`SLACK_BOT_TOKEN`。

注意：`NEXT_PUBLIC_APP_URL` 對 Next.js 來說通常是 build-time 環境變數。若 production domain 變更，需要重新 build image。

## 6. NetworkPolicy 原則

base NetworkPolicy 允許：

- Ingress controller 或任意 namespace 進入 web service。
- Pod 使用 DNS。
- Pod 呼叫外部 HTTP/HTTPS。

正式環境應改為更嚴格：

- 只允許 ingress-nginx namespace 進入 web/api。
- api 只允許 web namespace 進入。
- worker 只允許 redis/postgres namespace 進入。
- 禁止 MCP worker 直接訪問 metadata server。
- 禁止 filesystem/git tools 在 production 中掛載 repo volume。

## 7. Helm 使用方式

```bash
helm upgrade --install openlaunch ./deploy/helm/openlaunch \
  --namespace openlaunch \
  --create-namespace \
  --set ingress.enabled=true \
  --set ingress.host=dev.openlaunch.example.com
```

Production 示例：

```bash
helm upgrade --install openlaunch ./deploy/helm/openlaunch \
  --namespace openlaunch-prod \
  --create-namespace \
  -f deploy/helm/openlaunch/values-prod.yaml
```

可先 dry-run：

```bash
helm template openlaunch ./deploy/helm/openlaunch --namespace openlaunch
```

## 8. 後續 worker / MCP 擴充

目前 `packages/mcp-servers/launch-server` 是 stdio MCP server。若要部署到 K8s，建議下一步：

1. 新增 HTTP MCP transport，支援 `/mcp` streamable HTTP。
2. 新增 `Dockerfile.mcp`。
3. 新增 `deploy/k8s/architectures/mcp-http` overlay。
4. API service 透過內部 service name 呼叫 MCP service。
5. 所有 write-capable tools 仍由 `McpGateway` 強制 sandbox / production policy。

Worker 建議使用：

- Deployment：持續消費 queue。
- CronJob：每日 lead enrichment / analytics aggregation。
- Job：一次性 launch pack publish。
- HPA on CPU/custom metrics：針對 agent workload 擴容。

## 9. 完成定義

K8s 設定完成後需滿足：

- [ ] `kubectl kustomize deploy/k8s/overlays/local` 可 render
- [ ] `kubectl kustomize deploy/k8s/overlays/dev` 可 render
- [ ] `kubectl kustomize deploy/k8s/overlays/prod` 可 render
- [ ] `kubectl kustomize deploy/k8s/architectures/api-worker-split` 可 render
- [ ] Helm `helm template` 可 render
- [ ] Web service 有 liveness/readiness/startup probe
- [ ] Deployment 使用 non-root、readOnlyRootFilesystem、resource requests/limits
- [ ] Secret 不寫入 ConfigMap
- [ ] NetworkPolicy 有預設規則
- [ ] README 說明如何部署與 port-forward