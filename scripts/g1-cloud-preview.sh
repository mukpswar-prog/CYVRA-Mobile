#!/usr/bin/env bash
#
# G1–G3 cloud preview (run ONLY from a session logged into Cloudflare + Neon).
# Creates NEW resources only:
#   - Hyperdrive  cyvra-mobile-neon
#   - Worker      cyvra-mobile-api
#   - Pages       cyvra-mobile
#
# Required env (do not echo these; never commit them):
#   DATABASE_URL          Neon POOLED connection string for floral-art-02749206
#   DATABASE_URL_DIRECT   Neon DIRECT connection string (migrations only)
# Optional:
#   RESEND_API_KEY        sending-only key (transactional OTP). Empty = preview
#                         fallback (OTP returned in the API JSON, not emailed).
#   RESEND_FROM           must match a verified Resend domain when sending
#   SESSION_SECRET        Worker secret; generated if unset
#
# This script refuses to run unless `wrangler whoami` shows account
# 5a3eeb2b3d42726a8ba08732464a0eda. It never touches Erase / cyvra-www /
# cyvoriq-erase-api / cyvra-admin / cyvra-approvals.
set -euo pipefail
cd "$(dirname "$0")/.."

EXPECTED_ACCOUNT="5a3eeb2b3d42726a8ba08732464a0eda"
HYPERDRIVE_NAME="cyvra-mobile-neon"
WORKER_NAME="cyvra-mobile-api"
PAGES_NAME="cyvra-mobile"

if [[ -z "${DATABASE_URL:-}" || -z "${DATABASE_URL_DIRECT:-}" ]]; then
  echo "[g1] Set DATABASE_URL (pooled) and DATABASE_URL_DIRECT from Neon project floral-art-02749206." >&2
  echo "[g1] Do not create a second Neon project. Do not paste URLs into git." >&2
  exit 1
fi

echo "[g1] confirming Cloudflare account via wrangler whoami"
WHOAMI="$(pnpm --filter @cyvra/api exec wrangler whoami 2>&1 || true)"
if ! grep -q "$EXPECTED_ACCOUNT" <<<"$WHOAMI"; then
  echo "[g1] BLOCKED: wrangler is not authenticated as Cloudflare account $EXPECTED_ACCOUNT." >&2
  echo "[g1] Log in (wrangler login) on a machine that can complete the dashboard SSO, then retry." >&2
  echo "$WHOAMI" >&2
  exit 1
fi
echo "[g1] Cloudflare account matches $EXPECTED_ACCOUNT"

echo "[g1] applying Drizzle migrations with DATABASE_URL_DIRECT (not pooled, not Hyperdrive)"
pnpm --filter @cyvra/database migrate

echo "[g1] creating Hyperdrive $HYPERDRIVE_NAME (idempotent-ish: fails if the name exists — then list and reuse)"
set +e
HD_OUT="$(pnpm --filter @cyvra/api exec wrangler hyperdrive create "$HYPERDRIVE_NAME" --connection-string="$DATABASE_URL" 2>&1)"
HD_STATUS=$?
set -e
echo "$HD_OUT" | sed -E 's#postgres(ql)?://[^[:space:]]+#postgres://***redacted***#g'
if [[ $HD_STATUS -ne 0 ]]; then
  echo "[g1] create failed; listing existing Hyperdrive configs (look for $HYPERDRIVE_NAME)"
  pnpm --filter @cyvra/api exec wrangler hyperdrive list
  echo "[g1] Set HYPERDRIVE_ID to the existing id and re-run, or delete the conflicting name in the dashboard." >&2
  exit 1
fi

HYPERDRIVE_ID="$(grep -Eo '[0-9a-f]{32}' <<<"$HD_OUT" | head -n 1 || true)"
if [[ -z "$HYPERDRIVE_ID" ]]; then
  echo "[g1] could not parse Hyperdrive id from wrangler output" >&2
  exit 1
fi
echo "[g1] Hyperdrive id=$HYPERDRIVE_ID"

PY="$(cd "$(dirname "$0")" && pwd)/python"
HYPERDRIVE_ID="$HYPERDRIVE_ID" "$PY" - << 'PY'
import os
from pathlib import Path
hid = os.environ["HYPERDRIVE_ID"]
path = Path("services/api/wrangler.jsonc")
text = path.read_text()
needle = '"id": "00000000000000000000000000000000"'
repl = f'"id": "{hid}"'
if needle not in text:
    if hid in text:
        print("[g1] wrangler.jsonc already has this Hyperdrive id")
    else:
        raise SystemExit("placeholder Hyperdrive id not found in wrangler.jsonc")
else:
    path.write_text(text.replace(needle, repl, 1))
    print("[g1] wrote Hyperdrive id into services/api/wrangler.jsonc")
PY

SESSION_SECRET="${SESSION_SECRET:-$("$PY" -c 'import secrets; print(secrets.token_hex(32))')}"
WORKER_DIR="services/api"

echo "[g1] setting Worker secrets (values not printed)"
printf '%s' "$SESSION_SECRET" | pnpm --filter @cyvra/api exec wrangler secret put SESSION_SECRET
if [[ -n "${RESEND_API_KEY:-}" ]]; then
  printf '%s' "$RESEND_API_KEY" | pnpm --filter @cyvra/api exec wrangler secret put RESEND_API_KEY
  printf '%s' "${RESEND_FROM:-CYVRA Mobile <noreply@cyvra.co.in>}" | pnpm --filter @cyvra/api exec wrangler secret put RESEND_FROM
else
  echo "[g1] RESEND_API_KEY unset — preview OTP fallback stays on (code in JSON, no email)"
fi

echo "[g1] deploying Worker $WORKER_NAME with API_ENV=preview"
pnpm --filter @cyvra/api exec wrangler deploy --var API_ENV:preview

WORKER_URL="$(pnpm --filter @cyvra/api exec wrangler deployments list 2>/dev/null | head -n 20 || true)"
echo "[g1] recent Worker deployments:"
echo "$WORKER_URL"

echo "[g1] GET /health (set WORKER_HEALTH_URL if the default workers.dev guess is wrong)"
HEALTH_URL="${WORKER_HEALTH_URL:-https://cyvra-mobile-api.${CLOUDFLARE_WORKERS_SUBDOMAIN:-workers.dev}/health}"
echo "[g1] trying $HEALTH_URL"
curl -fsS "$HEALTH_URL" || echo "[g1] health curl failed — open the workers.dev URL from the deploy output"

echo "[g1] building Pages app"
if [[ -z "${VITE_API_URL:-}" ]]; then
  echo "[g1] Set VITE_API_URL to the Worker URL (https://cyvra-mobile-api.<subdomain>.workers.dev) and re-run the Pages half." >&2
  echo "[g1] Hyperdrive + Worker steps above still count; Pages needs the Worker URL baked into the Vite build." >&2
  exit 1
fi
export VITE_API_URL
pnpm --filter @cyvra/web build
# wrangler lives in services/api — do not add it to the web package just for deploy.
(
  cd services/api
  pnpm exec wrangler pages project create "$PAGES_NAME" --production-branch=main || true
  pnpm exec wrangler pages deploy ../../apps/web/dist --project-name="$PAGES_NAME" --branch=g0-g3-preview
)

echo "[g1] After Pages URL is known, set Worker APP_ORIGIN (a var, not a git-committed value):"
echo "  cd services/api && pnpm exec wrangler deploy --var API_ENV:preview --var APP_ORIGIN:https://<preview>.cyvra-mobile.pages.dev"
echo "[g1] then reopen the Pages preview and run the OTP registration flow."
