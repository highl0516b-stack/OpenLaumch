# Kubernetes 部署手冊 - OpenLaunch

## 架構總覽

OpenLaunch 使用 **GitOps** 方式部署：
- **前端（Web）**：由 **ArgoCD** 管理（聲明式 GitOps UI）
- **後端（API）**：由 **Flux CD** 管理（自動化 GitOps）
- **共享基礎設施**：Helm 安裝（ingress-nginx、cert-manager、metrics-server）

## 環境對照

| 環境 | Namespace | 進入方式 | 管理者 |
|---|---|---|---|
| Local | `openlaunch-local` | `./scripts/kind-local-demo.sh` | 手動 / kustomize |
| Dev | `openlaunch-dev` | ArgoCD + Flux | ArgoCD 同步 Web |
| Prod | `openlaunch-prod` | Flux 自動同步 | Flux 自動 |

## 前置條件

- kubectl >= 1.28
- kind（本地測試）
- Docker（本地 + CI）
- kustomize（`kubectl kustomize`）

## 本地快速開始（Kind）

```bash
# 1. 建立 kind cluster
kind create cluster --name openlaunch-local --config deploy/k8s/kind.yaml

# 2. Build images
docker build -t openlaunch:local .
docker build -f Dockerfile.api -t openlaunch-api:local .

# 3. Load 到 kind cluster
kind load docker-image openlaunch:local --name openlaunch-local
kind load docker-image openlaunch-api:local --name openlaunch-local

# 4. 部署共享基礎設施
kubectl apply -k deploy/k8s/shared

# 5. 部署應用
kubectl create namespace openlaunch-local --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -k deploy/k8s/overlays/local

# 6. 檢查
kubectl -n openlaunch-local get pods -w
kubectl -n openlaunch-local port-forward svc/openlaunch-web 3000:80
```

## Kustomize 層級

```
base/
  ├── web/     ← Next.js Web（ArgoCD 管理）
  └── api/     ← Node.js API（Flux 管理）

overlays/
  ├── local/   ← local image tag + debug logging
  ├── dev/     ← staging image tag + ArgoCD sync
  └── prod/    ← prod image tag + Flux 自動同步
```

## 同步策略

| 組件 | 工具 | 觸發方式 | 自動回滾 |
|------|------|----------|----------|
| Web（前端） | ArgoCD | Webhook / 手動同步 | ✅ |
| API（後端） | Flux CD | Git push 自動 | ✅ |

## 原則

- **JDD**：每個 deploy 都有明確的 job 定義和 acceptance criteria
- **KISS**：一個 manifest 只做一件事，命名清晰
- **DRY**：共用 base overlay，overlay 之間只有 patch
- **LOG**：所有 pod 有統一 log format，輸出 JSON 帶 request ID
