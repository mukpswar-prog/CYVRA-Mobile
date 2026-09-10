# Resume notes (after 9 Sep 2026 break)

Governing law: [GUIDELINE.md](./GUIDELINE.md). Decision 10 Sep 2026: Mobile
ops and public site move to **`cyvoriq.co.in`**, not a section of Erase
`admin.cyvra.co.in`. Resume: [resume-after-break.md](./resume-after-break.md).

**Save point (10 Sep 2026, break):** Zone `cyvoriq.co.in` is on Cloudflare
(`guy` / `sloan.ns.cloudflare.com`). `cyvra.co.in` NS unchanged. Apex has no
A/MX yet. Resume: [resume-after-break.md](./resume-after-break.md).
Cutover: [cyvoriq-co-in-cutover.txt](./cyvoriq-co-in-cutover.txt).

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

This repo: [g7-freeze.md](./g7-freeze.md), `POST /admin/serials`.
Erase `admin-frontend` button is not built. Payment stays a human note.

## Codespaces leftover

`curl 127.0.0.1:8787/health` fails until local wrangler is running.
Use `bash scripts/run-local-evidence.sh` (starts Postgres + wrangler) or
`pnpm --filter @cyvra/api dev` after `bash scripts/start.sh`.
See [codespaces-g5.md](./codespaces-g5.md).
