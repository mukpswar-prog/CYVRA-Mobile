#!/usr/bin/env bash
#
# Make sure gitignored database/.env exists and open it in the Codespaces
# editor. Prints the DATABASE_URL_DIRECT host only (never the password).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/database/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT/database/.env.example" "$ENV_FILE"
  echo "[env] created database/.env from example (still local 127.0.0.1)"
fi

PY="$(cd "$(dirname "$0")" && pwd)/python"
HOST="$("$PY" - << 'PY'
import os
from pathlib import Path
from urllib.parse import urlparse
text = Path("database/.env").read_text()
host = ""
for raw in text.splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() != "DATABASE_URL_DIRECT":
        continue
    value = value.strip().strip("'").strip('"')
    host = (urlparse(value).hostname or "")
    break
print(host or "(missing)")
PY
)"

echo "[env] DATABASE_URL_DIRECT host: $HOST"
echo "[env] Edit database/.env in the editor. Change DATABASE_URL_DIRECT only."
echo "[env] Neon Connect → uncheck Pooled → host must not contain -pooler."
echo "[env] Do not paste the URL into chat. Do not git add this file."

if command -v code >/dev/null 2>&1; then
  code "$ENV_FILE"
  echo "[env] opened in the Codespaces editor"
else
  echo "[env] In the left file tree: database/.env"
  echo "[env] If you do not see it: Command Palette → Preferences: Open Settings"
  echo "[env] → search explorer.excludeGitIgnore → turn it OFF"
  echo "[env] Or Ctrl+P / Cmd+P and type database/.env"
fi
