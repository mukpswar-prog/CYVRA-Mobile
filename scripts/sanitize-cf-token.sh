#!/usr/bin/env bash
#
# Clean CLOUDFLARE_API_TOKEN for wrangler. Never prints the value.
# Source this file:  . scripts/sanitize-cf-token.sh
# Common paste mistakes: leading/trailing space, CR from Windows, quotes,
# "Bearer " prefix, a password-manager label with spaces.
set -euo pipefail

raw="${CLOUDFLARE_API_TOKEN-}"
token="$(printf '%s' "$raw" | tr -d '\r')"
token="${token#"${token%%[![:space:]]*}"}"
token="${token%"${token##*[![:space:]]}"}"
token="${token#\"}"
token="${token%\"}"
token="${token#\'}"
token="${token%\'}"
case "$token" in
  Bearer\ *|bearer\ *|BEARER\ *) token="${token#* }" ;;
esac
token="${token#"${token%%[![:space:]]*}"}"
token="${token%"${token##*[![:space:]]}"}"

len=${#token}
space=0
[[ "$token" == *" "* ]] && space=1
echo "[cf] token length=$len spaces=$space (value not printed)"

if [ "$len" -eq 0 ]; then
  echo "[cf] CLOUDFLARE_API_TOKEN is empty."
  echo "[cf] GitHub → Settings → Secrets → Actions → CLOUDFLARE_API_TOKEN"
  echo "[cf] Paste the cyvoriq-mobile *user* token only. Not ADMIN_API_TOKEN."
  exit 1
fi
if [ "$space" -eq 1 ] || [ "$len" -lt 30 ]; then
  echo "[cf] Token still has a space or is too short after cleaning."
  echo "[cf] You likely pasted a label, Bearer prefix leftover, or ADMIN_API_TOKEN."
  echo "[cf] Update the GitHub secret: one line, raw token, no quotes, no Bearer."
  echo "[cf] Create Token page: https://dash.cloudflare.com/profile/api-tokens"
  echo "[cf] Use the token named cyvoriq-mobile. Do not roll cyvra-erase-*."
  exit 1
fi
if ! printf '%s' "$token" | grep -Eq '^[A-Za-z0-9_-]+$'; then
  echo "[cf] Token has characters Cloudflare rejects in Authorization (6111)."
  echo "[cf] Re-copy one line from the password manager. No email, no URL."
  exit 1
fi

export CLOUDFLARE_API_TOKEN="$token"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-5a3eeb2b3d42726a8ba08732464a0eda}"
