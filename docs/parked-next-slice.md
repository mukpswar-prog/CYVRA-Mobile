# Parked: pause after G0–G3 (resume after break)

**Paused:** 9 September 2026  
**Branch:** `cursor/g0-g3-mobile-slice-7474`  
**Governing law:** [GUIDELINE.md](./GUIDELINE.md) — this file does **not** override it.

Do not write the next slice until a proper audit after the break. This note is
the handoff only.

---

## 1. What is already live (do not rebuild)

| Piece | Value |
|---|---|
| GitHub | `mukpswar-prog/CYVRA-Mobile`, private |
| Feature branch | `cursor/g0-g3-mobile-slice-7474` (ahead of `main`) |
| Cloudflare account | `5a3eeb2b3d42726a8ba08732464a0eda` |
| Pages | `cyvra-mobile` → https://cyvra-mobile.pages.dev |
| Worker | `cyvra-mobile-api` → https://cyvra-mobile-api.mukpswar.workers.dev |
| Hyperdrive | `cyvra-mobile-neon` → `db31fc8dafca49b29172da7046b97175` |
| Neon | project `floral-art-02749206`, database `neondb` |
| Auth slice | OTP `POST /auth/request` + `POST /auth/verify` + `/me` + logout |
| Preview OTP | `devCode` on screen when Resend is unset (`API_ENV=preview`) |

Never touch: Erase, `cyvra-www`, `cyvoriq-erase-api`, `cyvra-admin`,
`cyvra-approvals`, Station, Knox, S3, the Android app, `www.cyvra.co.in`.

Reference only (do **not** reuse the Windows app): https://admin.cyvra.co.in/

---

## 2. Where we got stuck (Codespaces)

Codespace: `https://supreme-umbrella-6v4rwwwxrwq524w4j.github.dev/`  
Path: `/workspaces/CYVRA-Mobile`

| Symptom | Cause | Resume action |
|---|---|---|
| `git push` non-fast-forward | Codespace was behind GitHub (Cloud Agent already pushed this branch) | `git fetch && git pull --rebase origin cursor/g0-g3-mobile-slice-7474`. No force-push. |
| Chrome `…-8787.app.github.dev` → Internal Server Error | That URL is the **API**, not the website. `GET /` is not a page; a 500 meant wrangler had no Postgres. | Do not open 8787 as a site. |
| `curl 127.0.0.1:8787/health` → connection refused | **wrangler is not running.** Nothing listens on 8787 until `pnpm --filter @cyvra/api dev`. | After break: `bash scripts/install.sh`, `bash scripts/start.sh`, start API, then curl `/health`, then web on **5173**. |

Full click-path: [codespaces-pages.md](./codespaces-pages.md).

Live preview that already works without Codespaces: https://cyvra-mobile.pages.dev

---

## 3. G0–G3 leftover (small, not the next product)

- Cloudflare dashboard: **Connect Git** on Pages **`cyvra-mobile` only** (Direct Upload cannot attach Git via API).
- Attach `mobile.cyvra.co.in` only when that DNS step is in scope.
- Rotate Neon password + Cloudflare API token that were pasted in chat; update Hyperdrive origin.
- GitHub repo description still `Mobile hardware scanner & reporting`.
- Resend domain + `RESEND_API_KEY` optional while preview OTP is enough.
- Draft PR #2 vs `main` — merge only after Codespaces or Pages checks are accepted.

---

## 4. Requested next slice (parked — not started)

Stated after the G3 pause:

1. **User registration** beyond email OTP (account as a first-class mobile customer).
2. **Serial key per user per device**, a **different pattern** from Windows so it is usable on a phone.
3. Serial key issued **only after payment has transferred**.
4. Serial key **approved by admin** before the device can use it.
5. **Separate admin panel** and **accounts panel** dedicated to the mobile product.
6. **Super admin** for both: `ceo@cyvoriq.com`.
7. **Separate subdomains** for those panels (not the Windows admin host).
8. UX/reference: https://admin.cyvra.co.in/ — copy the *idea* of an ops console, not the Erase codebase.

**Not implemented.** No new Pages, Workers, DNS, or schema for this yet.

---

## 5. Guideline conflicts to resolve before coding

[GUIDELINE.md](./GUIDELINE.md) currently says:

| Topic | Guideline today | Parked request |
|---|---|---|
| Customer origin | `mobile.cyvra.co.in` only | Keep + add more hosts |
| Ops UI | G7: `mobile.cyvra.co.in/ops`, **not** `admin.cyvra.co.in` | Separate admin + accounts **subdomains** |
| Forbidden hosts | Do not reuse `cyvra-admin` / Windows cookies / licence APIs | Use Windows admin only as visual reference |
| Next gates | G4 evidence schema → G5 Android S1 | Serial keys, payment, admin approval first |
| Payment | Not in G0–G3 | Serial only after money transferred |

After the break, **audit first**, then either:

- **A.** Keep the guideline: registration stays on `mobile.cyvra.co.in`; ops stays `/ops` on that origin; serial/payment is a new gate written into the guideline before code; or
- **B.** Explicitly amend the guideline (new hosts, super-admin, payment, serial pattern) **then** code.

Do not start B by creating `admin.cyvra.co.in` or editing `cyvra-admin`. Candidate **new** names only (examples, not created): `ops-mobile.cyvra.co.in`, `accounts-mobile.cyvra.co.in`, Worker still `cyvra-mobile-api` or a **new** `cyvra-mobile-ops-api`. Never `cyvoriq-erase-api`.

---

## 6. First questions for the post-break audit

1. Payment rail (who collects, which currency, webhook into the Worker)?
2. Serial format (length, charset, grouping for typing on a phone, one key per device vs seat)?
3. What “approved” means (manual CEO/admin click vs auto after settlement)?
4. Hosts: amend G7 to extra subdomains, or keep `/ops`?
5. Super admin `ceo@cyvoriq.com`: OTP like customers, or a break-glass allowlist?
6. Android app still waits for G5, or does serial bind start on web only?

---

## 7. Do not do during the break

- Force-push the feature branch
- Deploy or edit Erase / `cyvra-www` / `cyvra-admin`
- Attach `mobile.cyvra.co.in` unless asked
- Invent serial or payment tables before the audit
