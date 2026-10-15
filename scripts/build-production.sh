#!/usr/bin/env bash
# Manual all-app production build. Publishing uses each artifact.toml's own
# production build; do not also run this as a root deployment.build hook.
# Sets PORT and BASE_PATH for each Vite frontend, then builds everything once.
set -euo pipefail

echo "[build-production] Building API server…"
pnpm --filter @workspace/api-server run build

echo "[build-production] Building web (hub)…"
NODE_ENV=production PORT=22333 BASE_PATH=/ \
  pnpm --filter @workspace/web run build

echo "[build-production] Building modules…"
NODE_ENV=production PORT=25313 BASE_PATH=/modules/ \
  pnpm --filter @workspace/modules run build

echo "[build-production] Building elaine…"
NODE_ENV=production PORT=25669 BASE_PATH=/elaine/ \
  pnpm --filter @workspace/elaine run build

echo "[build-production] All builds complete."
