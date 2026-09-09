#!/usr/bin/env bash
#
# Idempotent dependency refresh for the CYVRA Mobile monorepo.
# Runs after checkout. Safe to run repeatedly.
set -euo pipefail
cd "$(dirname "$0")/.."

# Node 24 LTS (required by npm 12.0.2). See docs/tooling.md.
# /exec-daemon/node (22.14) must not win PATH — it cannot run npm 12.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
NODE_DIR=""
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  NODE_VERSION="$(tr -d '[:space:]' < .nvmrc)"
  nvm install "$NODE_VERSION"
  nvm use "$NODE_VERSION"
  nvm alias default "$NODE_VERSION" >/dev/null
  NODE_BIN="$(nvm which "$NODE_VERSION" | tail -n 1)"
  NODE_DIR="$(dirname "$NODE_BIN")"
fi

TOOLING_BIN="${HOME}/.local/bin"
mkdir -p "$TOOLING_BIN"
if [ -n "$NODE_DIR" ] && [ -x "$NODE_DIR/node" ]; then
  ln -sfn "$NODE_DIR/node" "$TOOLING_BIN/node"
  ln -sfn "$NODE_DIR/npm" "$TOOLING_BIN/npm"
  ln -sfn "$NODE_DIR/npx" "$TOOLING_BIN/npx"
  if [ -x "$NODE_DIR/corepack" ]; then
    ln -sfn "$NODE_DIR/corepack" "$TOOLING_BIN/corepack"
  fi
  if [ -x "$NODE_DIR/pnpm" ]; then
    ln -sfn "$NODE_DIR/pnpm" "$TOOLING_BIN/pnpm"
  fi
fi
export PATH="${TOOLING_BIN}${NODE_DIR:+:${NODE_DIR}}:${PATH}"
hash -r

# npm CLI 12.0.2 (current docs.npmjs.com CLI). Workspace lockfile is still pnpm-lock.yaml.
# Do not re-symlink from `command -v npm` — that would loop onto ~/.local/bin/npm.
npm install -g npm@12.0.2

# pnpm 12 via Corepack (packageManager field).
if command -v corepack >/dev/null 2>&1; then
  corepack enable
  corepack prepare pnpm@12.3.4 --activate
fi
if [ -n "$NODE_DIR" ] && [ -x "$NODE_DIR/pnpm" ]; then
  ln -sfn "$NODE_DIR/pnpm" "$TOOLING_BIN/pnpm"
fi

bash scripts/install-python.sh
bash scripts/local-postgres.sh install

# JS/TS workspace dependencies.
pnpm install --frozen-lockfile

echo "[install] node=$(node -v) npm=$(npm -v) pnpm=$(pnpm -v) python=$("$(dirname "$0")/python" --version 2>/dev/null || python3 --version)"
echo "[install] done"
