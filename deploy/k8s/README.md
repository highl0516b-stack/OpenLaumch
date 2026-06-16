# OpenLaunch Kubernetes 部署

## 快速開始：local / kind

```bash
npm run docker:build
kind create cluster --name openlaunch-local --config deploy/k8s/kind.yaml
kubectl apply -k deploy/k8s/overlays/local
kubectl -n openlaunch-local get pods
kubectl -n openlaunch-local port-forward svc/openlaunch-web 3000:80
```

開啟：<http://localhost:3000>

## Dev overlay

```bash
docker build -t openlaunch:dev .
kubectl apply -k deploy/k8s/overlays/dev
kubectl -n openlaunch-dev get pods,svc,ingress,hpa,pdb
```

## Prod overlay

```bash
docker build -t registry.example.com/openlaunch:prod .
docker push registry.example.com/openlaunch:prod
kubectl apply -k deploy/k8s/overlays/prod
kubectl -n openlaunch-prod get pods,svc,ingress,hpa,pdb,networkpolicy
```

## Split API overlay

需要先建立 `apps/api` image：

```bash
docker build -f Dockerfile.api -t openlaunch-api:dev .
kubectl apply -k deploy/k8s/architectures/api-worker-split
```

路由：

```text
/api/* -> openlaunch-api
/*     -> openlaunch-web
```

## 預設安全設定

- non-root container
- readOnlyRootFilesystem
- capabilities drop ALL
- `/tmp` emptyDir
- liveness/readiness/startup probes
- resource requests / limits
- HPA
- PDB
- NetworkPolicy
- Secret 與 ConfigMap 分離

## 注意事項

`NEXT_PUBLIC_APP_URL` 是 Next.js build-time 變數。若 production domain 變更，需要重新 build image。