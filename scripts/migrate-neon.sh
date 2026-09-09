#!/usr/bin/env bash
#
# Apply Drizzle migrations to live Neon floral-art-02749206 (direct URL only).
# Refuses localhost and Neon -pooler. Never prints the password.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/scripts/tooling-env.sh"

ENV_FILE="$ROOT/database/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "[neon] missing gitignored $ENV_FILE" >&2
  echo "[neon] copy database/.env.example then set DATABASE_URL_DIRECT to the Neon direct URL (pooled checkbox off, host has no -pooler)." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a

if [ -z "${DATABASE_URL_DIRECT:-}" ]; then
  echo "[neon] DATABASE_URL_DIRECT is empty in database/.env" >&2
  echo "[neon] migrate uses DATABASE_URL_DIRECT first. Editing only DATABASE_URL still hits local Postgres." >&2
  exit 1
fi

PY="$(cd "$(dirname "$0")" && pwd)/python"
HOST="$("$PY" - << 'PY'
import os
from urllib.parse import urlparse
raw = os.environ.get("DATABASE_URL_DIRECT", "")
host = (urlparse(raw).hostname or "").lower()
print(host)
PY
)"

echo "[neon] DATABASE_URL_DIRECT host: $HOST"

case "$HOST" in
  "" )
    echo "[neon] could not parse host from DATABASE_URL_DIRECT" >&2
    exit 1
    ;;
  127.0.0.1|localhost|::1 )
    echo "[neon] refusing local Postgres ($HOST)." >&2
    echo "[neon] nano database/.env and set DATABASE_URL_DIRECT to the Neon direct URL." >&2
    echo "[neon] start.sh seeded both URLs as 127.0.0.1 — changing only DATABASE_URL is not enough." >&2
    exit 1
    ;;
esac

if [[ "$HOST" == *"-pooler."* ]]; then
  echo "[neon] refusing Neon pooled host ($HOST)." >&2
  echo "[neon] Connect again with Pooled connection unchecked. Host must not contain -pooler." >&2
  exit 1
fi

if [[ "$HOST" != *.neon.tech ]]; then
  echo "[neon] host is not *.neon.tech ($HOST). Stop if this is not floral-art-02749206." >&2
  exit 1
fi

echo "[neon] applying migrations to Neon (not Hyperdrive, not local Postgres)"
pnpm --filter @cyvra/database migrate
echo "[neon] done. In Neon SQL Editor, public tables should now include"
echo "       device_lifecycles, processing_sessions, capability_profiles,"
echo "       evidence_records, evidence_batches."
echo "[neon] Leave books_to_read if it exists (not ours). Do not drop it from chat."
