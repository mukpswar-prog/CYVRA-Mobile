# G7 freeze — mobile serials in this repo

Cross-repo map (admin / accounts / www / Station / Knox):
[cross-repo-next-gates.txt](./cross-repo-next-gates.txt). Plan only until F1–F5.

**Started 10 Sep 2026** after G6 preview went live.  
**Governing law:** [GUIDELINE.md](../GUIDELINE.md). Hosts: [admin-mobile-section.md](./admin-mobile-section.md).

G7 has two repos. This branch implements **only** the mobile SoT.

| Piece | Where | This slice |
|---|---|---|
| Serial records | Neon `floral-art-02749206` via `cyvra-mobile-api` | **Yes** |
| `ADMIN_API_TOKEN` gate | Worker secret (never Git, never Windows cookie) | **Yes** |
| CYVRA Mobile button / views | Erase `admin-frontend` on `admin.cyvra.co.in` / `accounts.cyvra.co.in` | **No** |
| Payment provider / Windows licence tables | Erase | **No** |
| G8 www nav, G9 Station, G10 Knox | Later | **No** |

## Approvals (10 Sep 2026)

| Item | Decision |
|---|---|
| **A** | G6 save accepted. Worker preview version `38ef01e5-8400-4452-87d1-e1e576e2e27a`. |
| **B** | First G7 coding is **this repo**: `mobile_serials` + `/admin/serials`. |
| **C** | No second admin host. No copy of Windows licence tables. |
| **D** | Admin calls use `ADMIN_API_TOKEN` + `X-Admin-Email: ceo@cyvoriq.com`. Never `cyvoriq_admin_session`. |
| **E** | Do not start G8 / G9 / G10, www, Station, Knox, or Erase frontend here. |

## Contract the Erase admin app will call later

Base: `https://cyvra-mobile-api.mukpswar.workers.dev` (not `api.cyvra.co.in`).

| Method | Path | Meaning |
|---|---|---|
| `GET` | `/admin/serials` | List mobile serials |
| `POST` | `/admin/serials` | Create `PENDING` after a human notes that payment transferred |
| `POST` | `/admin/serials/:id/issue` | Issue once. Replay keeps `issuedAt` |
| `POST` | `/admin/serials/:id/revoke` | Revoke |

Headers: `Authorization: Bearer <ADMIN_API_TOKEN>`, `X-Admin-Email: ceo@cyvoriq.com`, `Origin: https://admin.cyvra.co.in`.

`paymentNoted` is a human attestation, not a payment-gateway proof. Numbering `CYVRA-M-<YEAR>-<UNIQUE>`.

## Do not

- Put `ADMIN_API_TOKEN` in Git, Pages, or chat
- Flip `API_ENV=production`
- Deploy this Worker until Neon has `0004` and the secret is set with `wrangler secret put`
- Point customers at `api.cyvra.co.in`
