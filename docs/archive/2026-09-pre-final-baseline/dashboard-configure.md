# Dashboard configure — Neon, Resend, Worker, `mobile.cyvra.co.in`

Governing law: [GUIDELINE.md](../../../GUIDELINE.md) §6. **New resources only.** Do not
open or change `cyvra-www`, `cyvoriq-erase-api`, `cyvra-approvals`,
`www.cyvra.co.in`, or `api.cyvra.co.in`.

Do **not** paste passwords, connection strings, or API keys into chat or Git.
Reply with **status only** (Verified / Not started / error text with no secrets).

## Already live (checked 9 Sep 2026)

| Piece | Status |
| --- | --- |
| Worker `cyvra-mobile-api` | `https://cyvra-mobile-api.mukpswar.workers.dev/health` → `status=ok`, `env=preview`, `database=connected` |
| Pages `cyvra-mobile` | `https://cyvra-mobile.pages.dev` → HTTP 200 |
| Hyperdrive | `cyvra-mobile-neon` id `db31fc8dafca49b29172da7046b97175` |
| Neon | project `floral-art-02749206`, database `neondb` |
| Zone `cyvra.co.in` | Cloudflare nameservers (`sloan` / `guy.ns.cloudflare.com`) |
| `mobile.cyvra.co.in` | **live** (HTTP 200, 9 Sep 2026) |
| `api-mobile.cyvra.co.in` | **no DNS yet** |
| Resend | domain Verified; Worker has `RESEND_API_KEY`; `API_ENV=preview` |

## Order (do not skip)

1. **Neon** — confirm project and tables, rotate leaked password, point Hyperdrive at the **direct** (unpooled) Neon URL.
2. **Resend** — verify `cyvra.co.in` (SPF/DKIM/DMARC), create a **sending-only** API key.
3. **Worker** — put `RESEND_*` and `SESSION_SECRET` in **production** secrets. Keep `API_ENV=preview` until a real OTP email arrives.
4. **Subdomains** — Pages custom domain `mobile.cyvra.co.in`. Worker custom domain `api-mobile.cyvra.co.in`.
5. **Flip production** — `API_ENV=production` and `APP_ORIGIN=https://mobile.cyvra.co.in` only after email works. Production **never** returns `devCode`.

---

## Phase 1 — Neon project `floral-art-02749206`

Open: https://console.neon.tech/app/projects/floral-art-02749206

### 1.1 Confirm this is the mobile project

On **Dashboard**:

| Check | Expected |
| --- | --- |
| Project name / id | `floral-art-02749206` |
| Region | `ap-southeast-1` (Asia Pacific, Singapore) |
| Default database | `neondb` |
| Role | `neondb_owner` (or the role you already use) |

If the project is a different id, **stop**. Do not create a second production database. Do not open any Erase Neon project.

### 1.2 Confirm G2 tables exist

Left sidebar → **SQL Editor** → New query. Run:

```sql
select tablename
from pg_tables
where schemaname = 'public'
order by 1;
```

You should see at least:

- `users`
- `email_otp_challenges`
- `sessions`

(`__drizzle_migrations` may live in schema `drizzle`, not `public`. The three tables above are enough.)

Then:

```sql
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'users'
order by 1;
```

`users` should include `email`, `full_name`, `company_name`, `address_line1`,
`address_line2`, `pincode`, `state`, `created_at`, `last_login_at`.

Reply **tables: ok** or paste the table-name list (no rows of customer data).

If tables are missing, migrations were not applied to this branch. Say so; do
not create tables by hand.

### 1.3 Copy connection strings (keep them local)

Neon Dashboard → **Connect**.

1. Branch: **production**. Database: `neondb`. Role: `neondb_owner`.
2. **Uncheck Pooled connection.** The host must **not** contain `-pooler`.
   Hyperdrive is the pooler ([Neon Workers guide](https://neon.com/docs/guides/cloudflare-workers)).
3. Copy that **direct** string into a password manager.

A pooled string (`-pooler` in the host) is **not** the Hyperdrive origin.

Never put either URL on Cloudflare Pages. Never commit them. Never paste them in chat.

The health `curl` is **not** stored anywhere. After Hyperdrive Save, run it in **Codespaces**.

### 1.4 Rotate the role password (required)

A Neon password was pasted in chat earlier. Rotate it now.

1. Neon → project → **Settings** → **Roles** (or Dashboard → role menu).
2. Reset / generate password for `neondb_owner`.
3. Connect again, pooled checkbox **off**, copy the **new direct** URL.
4. Go to Hyperdrive (Phase 1.5) **immediately**, or the live Worker will fail until origin is updated.

### 1.5 Point Hyperdrive at the existing config (do not create)

You are already on the Hyperdrive **list**. There is no “origin” box on that list.

https://dash.cloudflare.com/5a3eeb2b3d42726a8ba08732464a0eda/workers/hyperdrive

1. If a **Create Hyperdrive Connection** modal is open (`?modal=1`), close it
   (X, Cancel, or Esc). Do **not** pick Connect to public/private/PlanetScale.
   Do **not** click **Connect database** (that creates a new config).
2. In the table, ignore the first row `cyvra-erase-neon-production`.
3. Click the **blue name** `cyvra-mobile-neon` (it is the link). Confirm the
   Configuration ID is `db31fc8dafca49b29172da7046b97175`.
   Direct URL:
   https://dash.cloudflare.com/5a3eeb2b3d42726a8ba08732464a0eda/workers/hyperdrive/db31fc8dafca49b29172da7046b97175
4. Open the **Settings** tab (not Metrics).
5. Origin is **not** a Git field. You will see host / port / database / user /
   password (or one connection-string box).
6. Host today starts with `ep-round-sound-b3maswpk-pooler` (Neon pooler).
   Prefer the **direct** host: same name **without** `-pooler`
   (`ep-round-sound-b3maswpk.c-4.ap-southeast-1.aws.neon.tech`).
   Port `5432`, database `neondb`, user `neondb_owner`.
   Paste a new password only if you rotated Neon.
7. **Save**.

If you have **not** rotated the Neon password and live health is already
`database=connected`, Save is optional. Do not create a second Hyperdrive.

Then in **GitHub Codespaces** (not Neon SQL, not Cloudflare’s search box):

```bash
curl -sS https://cyvra-mobile-api.mukpswar.workers.dev/health
```

Expect `"database":"connected"`. If it is `unreachable`, origin still has the old password. Edit origin again. Do not recreate Hyperdrive.

Which Neon/Cloudflare guide and what not to click: [neon-cloudflare.md](../../neon-cloudflare.md).

**Stop here and reply:** Neon tables ok / Hyperdrive saved / health JSON (the JSON is not a secret).

---

## Phase 2 — Resend transactional OTP

Open: https://resend.com/emails

Resend is **Worker-only**. The browser never calls Resend. Production from-address must be a **verified** CYVRA domain, not `onboarding@resend.dev`.

### 2.1 Add the domain

1. https://resend.com/domains → **Add Domain**.
2. Domain: `cyvoriq.co.in` (send as `noreply@cyvoriq.co.in`). Already **Verified** as of Sep 2026.  
   Keep `cyvra.co.in` verified for Erase. Do not send Mobile OTP from the Erase domain.
3. Region: pick the closest Resend region you are offered. Note it.

### 2.2 Put Resend’s DNS records on Cloudflare (zone `cyvoriq.co.in`)

Resend shows TXT / CNAME (DKIM) / maybe MX. Copy **those** values; do not invent records.
Do not edit zone `cyvra.co.in` for Mobile — that zone is Erase.

DNS editor:

https://dash.cloudflare.com/5a3eeb2b3d42726a8ba08732464a0eda/cyvoriq.co.in/dns/records

For each Resend row:

| If Resend asks for | In Cloudflare |
| --- | --- |
| TXT SPF `v=spf1 …` | If a `v=spf1` TXT **already exists** for Windows mail, **edit that record** and add Resend’s `include:…`. Do **not** add a second SPF TXT (that breaks both products). If none exists, create one as Resend shows. |
| DKIM CNAME(s) | Create **new** CNAMEs. Proxy status: **DNS only** (grey cloud). |
| DMARC TXT `_dmarc` | Create if missing. If `_dmarc` already exists, do not replace a stricter Windows policy; tell me the existing value. |
| MX | Only add if Resend requires it **and** the name does not collide with existing mail MX. |

Save. Back in Resend, click **Verify**. Wait until status is **Verified**.

### 2.3 Sending-only API key

1. https://resend.com/api-keys → **Create API Key**.
2. Name: `cyvra-mobile-otp`.
3. Permission: **Sending access** only (not full access).
4. Domain: restrict to `cyvoriq.co.in` (Mobile). Never lock this key to Erase domain `cyvra.co.in`.
5. Copy the key once into a password manager. It will not be shown again.

If an older Mobile key is Domain=`cyvra.co.in`, create a new key. Do not edit or delete Erase keys. See [resend-mobile-otp.md](../../resend-mobile-otp.md).

### 2.4 From address we will use

```text
CYVRA Mobile <noreply@cyvoriq.co.in>
```

**Stop here and reply:** domain Verified / not yet; SPF merged or created; key created (do **not** paste the key).

---

## Phase 3 — Worker `cyvra-mobile-api` production settings

Open the URL you sent:

https://dash.cloudflare.com/5a3eeb2b3d42726a8ba08732464a0eda/workers/services/view/cyvra-mobile-api/production

Confirm the service name is **`cyvra-mobile-api`**. If the URL ever shows `cyvoriq-erase-api` or `cyvra-approvals`, go back.

### 3.1 Bindings (Hyperdrive)

Settings → **Bindings** (or Variables and Secrets → Bindings).

| Binding | Type | Value |
| --- | --- | --- |
| `HYPERDRIVE` | Hyperdrive | `cyvra-mobile-neon` (`db31fc8dafca49b29172da7046b97175`) |

If missing, Add binding → Hyperdrive → that config. Do not bind an Erase Hyperdrive.

### 3.2 Secrets (encrypt; never Git)

Settings → **Variables and Secrets** → **Add** / **Encrypt**.

| Name | Type | Value |
| --- | --- | --- |
| `RESEND_API_KEY` | Secret | the sending key from Phase 2 |
| `RESEND_FROM` | Secret or text | `CYVRA Mobile <noreply@cyvoriq.co.in>` |
| `SESSION_SECRET` | Secret | new random string (32+ bytes). If one already exists, **leave it** unless you are rotating sessions. |

### 3.3 Plaintext variables — keep preview until email works

| Name | Set now | Later (Phase 5) |
| --- | --- | --- |
| `API_ENV` | `preview` | `production` |
| `APP_ORIGIN` | `https://cyvra-mobile.pages.dev` | `https://mobile.cyvra.co.in` |

Leave `API_ENV=preview` until a real OTP email arrives. If you switch to `production` first, registration fails with no on-screen code.

### 3.4 Smoke test (still on workers.dev)

1. Open https://cyvra-mobile.pages.dev
2. Create account with **your** email (not a fake gmail).
3. You should get a Resend email **and** (while `API_ENV=preview`) the page may still show `devCode`.
4. Confirm the mail in https://resend.com/emails (the log, not the inbox UI only).

If Resend shows a 403 unverified domain, DNS is not done. Stay on `preview`.

**Stop here and reply:** secrets saved; whether an OTP email arrived (yes/no). No codes in chat.

---

## Phase 4 — Approved subdomains

Approved customer host: **`mobile.cyvra.co.in`**.  
Optional API host: **`api-mobile.cyvra.co.in`**.  
Do **not** create `api.cyvra.co.in`. Do **not** attach these to `cyvra-www`.

`cyvra.co.in` is already on this Cloudflare account, so Custom Domain will create the DNS record.

### 4.1 Pages: `mobile.cyvra.co.in`

1. https://dash.cloudflare.com/5a3eeb2b3d42726a8ba08732464a0eda/workers-and-pages
2. Open project **`cyvra-mobile`** (not `cyvra-www`).
3. **Custom domains** → **Set up a domain** → `mobile.cyvra.co.in`.
4. Wait until status is **Active**.
5. Confirm DNS: type CNAME, name `mobile`, target `cyvra-mobile.pages.dev` (or the target Cloudflare fills). Proxy can stay orange-cloud.

Check: `https://mobile.cyvra.co.in` loads the same registration page.

### 4.2 Worker: `api-mobile.cyvra.co.in`

Back on:

https://dash.cloudflare.com/5a3eeb2b3d42726a8ba08732464a0eda/workers/services/view/cyvra-mobile-api/production

1. Settings → **Domains & Routes** (or Triggers) → **Add** → Custom domain.
2. Hostname: `api-mobile.cyvra.co.in`.
3. Zone: `cyvra.co.in`.
4. Save. Wait until Active.

Check:

```bash
curl -sS https://api-mobile.cyvra.co.in/health
```

Expect `status=ok`, `database=connected`. CORS already allowlists `mobile.cyvra.co.in`.

### 4.3 Point the web app at the API host

On Pages project **`cyvra-mobile`** → Settings → Environment variables (production **and** preview):

```text
VITE_API_URL=https://api-mobile.cyvra.co.in
```

No `DATABASE_URL` here. Rebuild / redeploy `cyvra-mobile` after changing `VITE_*` (Vite bakes it in at build time). Until Git is connected, Direct Upload to **`cyvra-mobile` only**.

**Stop here and reply:** both hostnames Active or the exact Cloudflare error (no secrets).

---

## Phase 5 — Production switch (after email works)

On Worker production Variables:

| Name | Value |
| --- | --- |
| `API_ENV` | `production` |
| `APP_ORIGIN` | `https://mobile.cyvra.co.in` |

Then:

1. `curl -sS https://api-mobile.cyvra.co.in/health` → `"env":"production"`.
2. Register on `https://mobile.cyvra.co.in` with a real inbox.
3. Code arrives by email. The JSON/UI must **not** show `devCode`.

---

## Do not touch

| Resource | Why |
| --- | --- |
| Pages `cyvra-www` | Windows site |
| Worker `cyvoriq-erase-api` | Windows API |
| Worker `cyvra-approvals` | other product |
| Hyperdrive `cyvra-erase-neon-production` | Windows DB |
| Host `www` / `admin` / `api.cyvra.co.in` | not this slice |
| Neon Auth | login stays in the Worker |

## After each phase

Push status notes to GitHub (`docs/g0-g3.md` live table) **without secrets**. Rotate any value that was ever pasted in chat.
