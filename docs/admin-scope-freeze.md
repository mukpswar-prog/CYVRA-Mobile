# admin.cyvoriq.co.in — scope freeze (11 Sep 2026)

Governing law: [GUIDELINE.md](../GUIDELINE.md). Resume: [resume-g8-freeze.md](./resume-g8-freeze.md).  
API history: [g7-freeze.md](./g7-freeze.md).

This file freezes **what lives on the ops host**. Public www stays frozen separately.

---

## How it is connected (do not redo)

| Piece | Frozen value |
|---|---|
| Host | `https://admin.cyvoriq.co.in/` |
| UI | Same Vite bundle as `cyvoriq-www`. Hostname gate `isAdminHost()` → `AdminApp` |
| Look | Erase-admin layout family, **graphite + CYVRA orange `#FF7A00`**. Not Erase teal. Not Fraunces `cyvoriq-admin.pages.dev` |
| API | `https://api.cyvoriq.co.in` (`VITE_API_URL`) |
| Database | Neon `floral-art-02749206` tables `mobile_serials`, `staff_operators`, `staff_otp_challenges`, `staff_sessions` |
| Super admin | `ceo@cyvoriq.com` (always allowed; does not need a staff row) |
| Staff login | OTP to a **nominated `@cyvoriq.com` inbox**. Phone is not used |
| Token bootstrap | Worker secret `ADMIN_API_TOKEN` + `X-Admin-Email` for scripts only. Never Pages, never Git, never chat |
| CORS | Origin `https://admin.cyvoriq.co.in` is allowed. Erase www is not |

**Do not** move the custom domain onto `https://cyvoriq-admin.pages.dev/` while that project still serves Fraunces **CYVRA Admin** (not this repo).

---

## Licence key policy (locked)

Format (slab and kind are readable from the key itself):

```
CYVRA{dd}{mm}{yyyy}{kind}{hex4}-1-{max}
```

Example: `CYVRA11092026SA3F1-1-5`

| Piece | Meaning |
|---|---|
| `CYVRA` | Product |
| `ddmmyyyy` | Create date UTC |
| `S` or `B` | SINGLE user or BULK licence |
| 4 hex | Uniqueness |
| `1-3` / `1-5` / `1-7` / `1-25` | Device slab |

Same key may be used on devices of the **same brand** up to `max`. Not a Windows Erase licence. Not IMEI.

Approve emails the key to the **customer’s verified email only**. Send is tracked (`emailedAt`, `emailMessageId`, `emailError`).

---

## Inside this host

1. Staff OTP sign-in (`ceo@cyvoriq.com`, or another `@cyvoriq.com` nominated by the CEO).
2. **Generate PENDING** — customer snapshot + brand scope + slab + human `paymentNoted`.
3. **Approve & email** — issue once; replay keeps `issuedAt`. Production will not issue if email fails.
4. **Revoke**. Replay keeps `revokedAt`.
5. **Staff** — CEO nominates / revokes operators.
6. **Reports** — from date / to date, every stored customer and licence field, download CSV or Excel (`.xls`), print to PDF.
7. Honest copy: payment noted is a human attestation. This is not a payment gateway. This is not Erase admin.

## Outside this host (frozen out)

Do not add these to `admin.cyvoriq.co.in`:

- Public marketing, Get Started, customer OTP register / sign-in
- Customer dashboard, Report 1 viewer, evidence ingest
- Windows Erase licences, `cyvoriq_admin_session`, `admin.cyvra.co.in`
- Payment gateway / UPI / Stripe
- `accounts.cyvoriq.co.in` (later, separate Pages)
- Station, Knox, sanitization authorization
- Serials UI on `www.cyvoriq.co.in` via `/#ops` or `/ops`

---

## Advance check

| Check | Result |
|---|---|
| Browser on admin host shows **CYVRA Mobile ops** + licence console | Required after Pages rebuild |
| www still shows Know the Device / Get Started | Must stay true (do not polish marketing) |
| `cyvoriq-admin.pages.dev` is a different Fraunces app | Fail if used as custom-domain target — do not attach |
| Unauth `GET /admin/serials` | HTTP 401 `Admin token required.` |
| Gmail staff OTP | HTTP 403 |
| Token in Pages | Forbidden — not present |
| Dummy payment Create PENDING on production | Forbidden |

---

## Human proof still open

CEO requests an ops code at `https://admin.cyvoriq.co.in/` (do not paste the code in chat).  
Do **not** Create PENDING with dummy payment text on the live Worker.
