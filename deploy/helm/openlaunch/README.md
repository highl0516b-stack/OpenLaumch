# OpenLaunch Helm Chart

Minimal Helm chart for the single-service OpenLaunch web deployment.

## Install

```bash
helm upgrade --install openlaunch ./deploy/helm/openlaunch \
  --namespace openlaunch \
  --create-namespace \
  --set image.repository=openlaunch \
  --set image.tag=local
```

## Dry run

```bash
helm template openlaunch ./deploy/helm/openlaunch --namespace openlaunch
```

## Production values

Use a separate values file for production and pass secrets through your secret manager or sealed secrets controller:

```bash
helm upgrade --install openlaunch ./deploy/helm/openlaunch \
  --namespace openlaunch-prod \
  --create-namespace \
  -f deploy/helm/openlaunch/values-prod.yaml
```

Recommended production settings:

- `ingress.host` 指向正式 domain。
- `ingress.tls=true`，並搭配 cert-manager。
- `autoscaling.enabled=true`。
- `secrets` 不要提交到 Git；改用 External Secrets、Sealed Secrets 或 Vault。
- `networkPolicy` 保持 enabled，並根據實際 cluster 調整 egress allowlist。