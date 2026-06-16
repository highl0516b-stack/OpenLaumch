#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-openlaunch-local}"
IMAGE_WEB="${IMAGE_WEB:-openlaunch:local}"
IMAGE_API="${IMAGE_API:-openlaunch-api:local}"
MODE="${MODE:-web}"
WEB_PORT="${WEB_PORT:-3000}"
API_PORT="${API_PORT:-4000}"

if ! command -v kind >/dev/null 2>&1; then
  echo "kind is required. Install it first: https://kind.sigs.k8s.io/"
  exit 1
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required."
  exit 1
fi

if ! kind get clusters | grep -qx "$CLUSTER_NAME"; then
  kind create cluster --name "$CLUSTER_NAME" --config deploy/k8s/kind.yaml
fi

docker buildx bake --load \
  --set web.tags="$IMAGE_WEB" \
  --set api.tags="$IMAGE_API"

kind load docker-image "$IMAGE_WEB" --name "$CLUSTER_NAME"
kind load docker-image "$IMAGE_API" --name "$CLUSTER_NAME"

if [[ "$MODE" == "split" ]]; then
  kubectl apply -k deploy/k8s/architectures/api-worker-split
  kubectl -n openlaunch-dev rollout status deployment/openlaunch-web --timeout=180s
  kubectl -n openlaunch-dev rollout status deployment/openlaunch-api --timeout=180s
else
  kubectl apply -k deploy/k8s/overlays/local
  kubectl -n openlaunch-local rollout status deployment/openlaunch-web --timeout=180s
fi

echo ""
echo "Web service: http://localhost:${WEB_PORT}"
echo "API service: http://localhost:${API_PORT}"
echo ""
echo "Run in another terminal:"
echo "  kubectl -n openlaunch-local port-forward svc/openlaunch-web ${WEB_PORT}:80"
echo ""
echo "For split API mode:"
echo "  kubectl -n openlaunch-dev port-forward svc/openlaunch-api ${API_PORT}:80"
