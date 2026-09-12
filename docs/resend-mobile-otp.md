# G7 — Activate Mobile Resend (both OTP surfaces)

Customer create-account and ops login use **the same Worker send path**.
Fix the key once; both surfaces start delivering.

| Surface | Host | Worker route | Same function |
|---|---|---|---|
| Customer | https://cyvoriq.co.in/create-account | `POST /auth/request` | `sendOtpEmail()` |
| Ops | https://admin.cyvoriq.co.in/ | `POST /admin/auth/request` | `sendOtpEmail()` |

Do **not** paste API keys, OTP codes, or inbox contents in chat.

---

## What is wrong (12 Sep 2026)

Resend application logs for Mobile key `235c5518-11ab-4442-ae35-a1f86efa2d3b`:

| When (UTC) | Status |
|---|---|
| 9 Sep 13:02 and 16:22 | **200** |
| 11 Sep 10:40 onward, including 12 Sep 05:09 | **403** |

What changed between those dates: Mobile `RESEND_FROM` moved to
`CYVRA Mobile <noreply@cyvoriq.co.in>`. The sending key did not.

Both Resend domains are already **Verified**:

- `cyvoriq.co.in` — Mobile. Keep.
- `cyvra.co.in` — Erase. Keep. Do **not** delete.

The 403 matches a sending key whose **Domain** is still `cyvra.co.in`
(Erase). Resend then rejects `From: noreply@cyvoriq.co.in`.

A second, less likely 403: the key is unrestricted but the account is
still in **testing mode**, which only delivers to `mukpswar@gmail.com`,
not `ceo@cyvoriq.com`.

On-screen codes on admin mean send failed. That is expected while
`API_ENV=preview`. Production must never return the code.

Live `GET https://cyvra-mobile-api.mukpswar.workers.dev/health` still
omits `mailConfigured` / `mailFromHost`. The Worker bundle is stale
until **Deploy mobile API preview** runs on this branch.

Do **not** “fix” this by sending Mobile mail from `noreply@cyvra.co.in`.
That remixes Erase. Do **not** rotate Erase keys or delete `cyvra.co.in`.

---

## What you do (dashboard only)

### 1. Create a Mobile-only sending key

1. Open https://resend.com/api-keys
2. Find the key used by Worker `cyvra-mobile-api`. If **Domain** is
   `cyvra.co.in`, that is the bug. Leave Erase keys untouched.
3. **Create API Key**:
   - Name: `cyvra-mobile-otp`
   - Permission: **Sending access** only
   - Domain: `cyvoriq.co.in` (or all domains)
4. Copy the key once into a password manager. Never into Git or chat.

### 2. Put that key only on the Mobile Worker

Cloudflare → Workers → `cyvra-mobile-api` → Settings →
**Variables and Secrets**.

| Name | Action |
|---|---|
| `RESEND_API_KEY` | Encrypt the **new** `cyvra-mobile-otp` key. This replaces the Erase-restricted key on **this Worker only**. |
| `RESEND_FROM` | Keep `CYVRA Mobile <noreply@cyvoriq.co.in>` |
| `API_ENV` | Keep `preview` |

Do not edit Erase Workers (`cyvoriq-erase-api`, `cyvra-approvals`).
Do not put `RESEND_*` on Pages.

### 3. Deploy this branch

GitHub → Actions, branch `cursor/g0-g3-mobile-slice-7474`:

1. **Deploy mobile API preview** (required — Worker is stale).
2. **Deploy cyvoriq-www Pages** (required so create-account shows the
   exact Resend error, same as ops).

After the API Action:

```text
GET https://cyvra-mobile-api.mukpswar.workers.dev/health
```

Expect `mailConfigured: true` and `mailFromHost: "cyvoriq.co.in"`.
`mailFromHost` is the From host only — never a key or full address.

### 4. Prove both OTPs

Hard-refresh (`Ctrl+Shift+R`) so the browser is not on an old JS file.

1. Ops: https://admin.cyvoriq.co.in/ as `ceo@cyvoriq.com`
2. Customer: https://cyvoriq.co.in/create-account with a real inbox you
   control (not a fake gmail)

Success:

- Green / “Code emailed…” copy
- Resend → Emails shows **200** for `POST /emails`
- Code arrives in Inbox, Spam, or Promotions
- No on-screen code

Still failing:

- Red `mailError` on the page — read it; do not paste the code in chat
- Open the newest Resend **403** row (do not paste the key)
- If the message is testing-mode, add `ceo@cyvoriq.com` as a recipient
  or enable production sending now that `cyvoriq.co.in` is Verified
- If the message is domain / restricted key, the Worker still has the
  old Erase-scoped secret — repeat step 2

Keep `API_ENV=preview` until a real code lands. Do not Create PENDING
with dummy payment on live.

---

## Parked (do later)

G5 APK, Report 1 wiring, `API_ENV=production`, Station / Knox.
See [resume-g8-freeze.md](./resume-g8-freeze.md).
