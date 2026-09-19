# CYVRA Mobile ops hosts (G7)

**Superseded 10 Sep 2026 (D-2026-09-10-CYVORIQ-DOMAIN).** The 9 Sep freeze
that put Mobile ops on Erase `admin.cyvra.co.in` is cancelled. Follow
[cyvoriq-migration-audit.txt](../../cyvoriq-migration-audit.txt).

| Host | Role |
|---|---|
| https://admin.cyvoriq.co.in/ | Mobile ops (new Pages `cyvoriq-admin`) |
| https://accounts.cyvoriq.co.in/ | Mobile accounts (new Pages `cyvoriq-accounts`) |
| Super admin | `ceo@cyvoriq.com` |

Do **not** add a CYVRA Mobile section on Erase `admin.cyvra.co.in`. Do not copy
Windows licence tables. Do not point mobile customers at `api.cyvra.co.in`.
Serial records live in Neon `floral-art-02749206` via Worker `cyvra-mobile-api`.

## This repo

`GET/POST /admin/serials` and issue/revoke live on `cyvra-mobile-api`.
Auth is `ADMIN_API_TOKEN` + `X-Admin-Email: ceo@cyvoriq.com`.
Contract: [g7-freeze.md](./g7-freeze.md). Local: `bash scripts/run-local-admin-serials.sh`.

Do not deploy until Neon has `0004` and `wrangler secret put ADMIN_API_TOKEN`.
Customer preview stays on `mobile.cyvra.co.in` until `www.cyvoriq.co.in` is proven.
CORS still allowlists Erase admin/accounts until Phase 5 of the audit, then
those origins are removed.
