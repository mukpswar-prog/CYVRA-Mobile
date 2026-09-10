#!/usr/bin/env bash
#
# Apply Drizzle migrations to live Neon floral-art-02749206 (direct URL only).
# Parses database/.env in Python (never `source`s it — comments and passwords
# can contain '(' '$' which break bash). Never prints the password.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/scripts/tooling-env.sh"

ENV_FILE="$ROOT/database/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "[neon] missing gitignored $ENV_FILE" >&2
  echo "[neon] bash scripts/open-db-env.sh  then set DATABASE_URL_DIRECT" >&2
  exit 1
fi

PY="$(cd "$(dirname "$0")" && pwd)/python"
URL_FILE="$(mktemp)"
chmod 600 "$URL_FILE"
cleanup() { rm -f "$URL_FILE"; }
trap cleanup EXIT

HOST="$("$PY" - "$ENV_FILE" "$URL_FILE" << 'PY'
from pathlib import Path
from urllib.parse import urlparse
import sys

env_path = Path(sys.argv[1])
url_path = Path(sys.argv[2])
direct = ""
for raw in env_path.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() != "DATABASE_URL_DIRECT":
        continue
    value = value.strip()
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        value = value[1:-1]
    direct = value
    break

if not direct:
    print("", end="")
    sys.exit(0)

url_path.write_text(direct, encoding="utf-8")
host = (urlparse(direct).hostname or "").lower()
print(host)
PY
)"

if [ -z "$HOST" ]; then
  echo "[neon] DATABASE_URL_DIRECT is empty in database/.env" >&2
  echo "[neon] migrate uses DATABASE_URL_DIRECT first. Editing only DATABASE_URL still hits local Postgres." >&2
  exit 1
fi

echo "[neon] DATABASE_URL_DIRECT host: $HOST"

case "$HOST" in
  127.0.0.1|localhost|::1 )
    echo "[neon] refusing local Postgres ($HOST)." >&2
    echo "[neon] Edit DATABASE_URL_DIRECT only (leave DATABASE_URL as 127.0.0.1)." >&2
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

export DATABASE_URL_DIRECT="$(cat "$URL_FILE")"

echo "[neon] applying migrations to Neon (not Hyperdrive, not local Postgres)"
pnpm --filter @cyvra/database migrate
echo "[neon] done. In Neon SQL Editor, public tables should now include"
echo "       device_lifecycles, processing_sessions, capability_profiles,"
echo "       evidence_records, evidence_batches, reports, report_manifests."
echo "[neon] Leave books_to_read if it exists (not ours). Do not drop it from chat."
