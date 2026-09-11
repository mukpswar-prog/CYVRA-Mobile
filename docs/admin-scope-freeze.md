# admin.cyvoriq.co.in — scope freeze (11 Sep 2026)

Governing law: [GUIDELINE.md](../GUIDELINE.md). Resume: [resume-g8-freeze.md](./resume-g8-freeze.md).  
API contract: [g7-freeze.md](./g7-freeze.md).

This file freezes **what lives on the ops host**. Public www stays frozen separately.

---

## How it is connected (do not redo)

| Piece | Frozen value |
|---|---|
| Host | `https://admin.cyvoriq.co.in/` |
| UI | Same Vite bundle as `cyvoriq-www`. Hostname gate `isAdminHost()` → `AdminApp` |
| API | `https://api.cyvoriq.co.in` (`VITE_API_URL`) |
| Serial routes | `GET/POST /admin/serials`, `POST /admin/serials/:id/issue`, `POST /admin/serials/:id/revoke` |
| Database | Neon `floral-art-02749206` table `mobile_serials` |
| Super admin | `ceo@cyvoriq.com` via `X-Admin-Email` |
| Token | Worker secret `ADMIN_API_TOKEN`. Typed in the browser. `sessionStorage` only |
| CORS | Origin `https://admin.cyvoriq.co.in` is allowed. Erase www is not |

**Do not** move the custom domain onto `https://cyvoriq-admin.pages.dev/` while that project still serves Fraunces **CYVRA Admin** (not this repo).

Dedicated Pages `cyvoriq-admin` is later hygiene. Not required for this freeze while hostname gating works.

---

## Inside this host (v1 — frozen)

Only mobile serial operations:

1. Paste `ADMIN_API_TOKEN` (password field). Never Pages env, never Git, never chat.
2. `X-Admin-Email` must be `ceo@cyvoriq.com`.
3. **Refresh list** — `GET /admin/serials`. Empty list is a pass.
4. **Create PENDING** — customer email + human `paymentNoted` (not a payment gateway). Number `CYVRA-M-<YEAR>-<UNIQUE>`.
5. **Issue** once. Replay keeps the original `issuedAt`.
6. **Revoke**. Replay keeps `revokedAt`.
7. Honest copy: payment noted is a human attestation. This is not Erase admin. This is not Windows licences.

## Outside this host (frozen out)

Do not add these to `admin.cyvoriq.co.in`:

- Public marketing, Get Started, OTP register / sign-in
- Customer dashboard, Report 1 viewer, evidence ingest
- Windows Erase licences, `cyvoriq_admin_session`, `admin.cyvra.co.in`
- Payment gateway / UPI / Stripe
- `accounts.cyvoriq.co.in` (later, separate Pages)
- Station, Knox, sanitization authorization
- Multi-user admin roles (only `ceo@cyvoriq.com` for v1)
- Serials UI on `www.cyvoriq.co.in` via `/#ops` or `/ops`

---

## Advance check (11 Sep 2026)

| Check | Result |
|---|---|
| Browser on admin host shows **CYVRA Mobile ops** + Mobile serials | Pass |
| www still shows Know the Device / Get Started | Pass |
| `cyvoriq-admin.pages.dev` is a different Fraunces app | Fail if used as custom-domain target — do not attach |
| CORS unit tests allow `https://admin.cyvoriq.co.in` | Pass (`pnpm --filter @cyvra/api test`) |
| Unauth `GET /admin/serials` | HTTP 401 `Admin token required.` |
| Token in Pages | Forbidden — not present |
| Public `/#ops` serials leak | Removed in this freeze (admin host only) |

---

## Human proof still open

Refresh list with the real Worker token (do not paste it in chat).  
Empty list is a pass. Do **not** Create PENDING with dummy payment text.
