#!/usr/bin/env bash
# Production build script used by .replit [deployment] when artifact registration
# is unavailable. Sets PORT and BASE_PATH for each Vite frontend so
# createWorkspaceViteConfig() doesn't throw, then builds everything.
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
