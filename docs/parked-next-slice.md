# Resume notes (after 9 Sep 2026 break)

Governing law: [GUIDELINE.md](./GUIDELINE.md). G7 was **amended** to match the
freeze plan: CYVRA Mobile ops is a **section** of existing
`admin.cyvra.co.in` / `accounts.cyvra.co.in`, not a new host.

**Save point (10 Sep 2026):** G6 Report 1 freeze is in this branch (local
Postgres). Live Neon still needs migration `0003` (`reports`,
`report_manifests`) before the Worker is redeployed. Do **not** start G7.

## Live G0–G3

| Piece | Value |
|---|---|
| Pages | https://cyvra-mobile.pages.dev and https://mobile.cyvra.co.in/ |
| Worker | https://cyvra-mobile-api.mukpswar.workers.dev |
| Hyperdrive | `cyvra-mobile-neon` → `db31fc8dafca49b29172da7046b97175` |
| Neon | `floral-art-02749206` |

## Registration (this slice)

Create-your-account collects **full name** (mandatory), company, two address
lines, **pincode** (mandatory), state, and **email**. Email is the Resend OTP
target. Resend domain `cyvra.co.in` is Verified and the Worker has
`RESEND_API_KEY`; `API_ENV` is still `preview` so `devCode` may appear until
production is flipped.
Dashboard steps for Neon, Resend, Worker secrets, and `mobile.cyvra.co.in`:
[dashboard-configure.md](./dashboard-configure.md). Resend domain `cyvra.co.in`
is **Verified**; Worker has `RESEND_API_KEY`. Keep `API_ENV=preview` until a
real OTP email is trusted. www nav must **link out** to mobile, not reuse Erase
OTP: [www-mobile-button.md](./www-mobile-button.md).

## Serial keys / admin UI

Tracked in [admin-mobile-section.md](./admin-mobile-section.md). Not built in
the Erase admin frontend yet. Payment-then-issue still pending.

## Codespaces leftover

`curl 127.0.0.1:8787/health` fails until local wrangler is running.
Use `bash scripts/run-local-evidence.sh` (starts Postgres + wrangler) or
`pnpm --filter @cyvra/api dev` after `bash scripts/start.sh`.
See [codespaces-g5.md](./codespaces-g5.md).
