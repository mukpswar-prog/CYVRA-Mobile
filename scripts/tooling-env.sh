#!/usr/bin/env bash
# Put Node 24 LTS, npm 12, and pnpm 12 on PATH. Sourced by install/start.
#
# Cloud Agent injects /exec-daemon/node (22.14) near the front of PATH. npm 12
# requires Node ^22.22.2 || ^24.15.0, so 22.14 cannot run it. ~/.local/bin is
# prepended with symlinks to the .nvmrc Node binary.
#
# `nvm which` may print a "Found .nvmrc" line before the path — take the last line.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
NVM_BIN=""
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use >/dev/null 2>&1 || true
  _node="$(nvm which 2>/dev/null | tail -n 1 || true)"
  if [ -n "$_node" ] && [ -x "$_node" ]; then
    NVM_BIN="$(dirname "$_node")"
  fi
  unset _node
fi
export PATH="${HOME}/.local/bin${NVM_BIN:+:${NVM_BIN}}:${PATH}"
