# How and where — remaining setup (Windows)

**Private GitHub:** done.  
**Do not start:** CYVRA Station Windows app, Knox/S3, Erase, `cyvra-www` tab, Android app. Those are later gates.

This is the click path for what is left. Do it on **your Windows PC** in a browser (Chrome/Edge). This Cursor session cannot push to the private GitHub.

---

## A. GitHub — change the description

1. Open https://github.com/mukpswar-prog/CYVRA-Mobile (sign in as `mukpswar-prog`).
2. Click the **gear** next to “About” on the right of the repo home  
   **or** **Settings** (top tab) → scroll to **General**.
3. **Description** — replace the scanner text with exactly:

   `CYVRA Mobile Evidence — Android phones & tablets, reports, later CYVRA Station`

4. **Website** (optional): `https://mobile.cyvra.co.in`
5. Uncheck **Releases / Packages / Deployments** if you do not need them yet.
6. Save.

Confirm the repo still shows **Private**.

---

## B. GitHub — put `GUIDELINE.md` on `main`

Easiest on Windows: upload in the browser. You do not need Git installed.

### B1. Download the file from this chat

In **this** Cursor agent / workspace, the file is:

`docs/CYVRA-MOBILE-ENGINEERING-GUIDELINE.md`

- Open it → copy all  
  **or** in Cursor: right-click the file → Download / Save As  
  Save on your PC as `GUIDELINE.md` (not `.txt`).

### B2. Create the file on GitHub

1. https://github.com/mukpswar-prog/CYVRA-Mobile
2. Branch must be **`main`**.
3. **Add file** → **Create new file**.
4. File name: `GUIDELINE.md` (repo root, not inside a folder).
5. Paste the full guideline.
6. Commit message: `Add governing engineering guideline`
7. Commit directly to **`main`**.

Also replace the README (same screen, or **Add file** again is not needed — click `README.md` → pencil):

```markdown
# CYVRA Mobile Evidence

Android phone and tablet verification, evidence, and reports for the CYVRA platform.

**Governing document:** [GUIDELINE.md](GUIDELINE.md)

- Planned site: https://mobile.cyvra.co.in
- Company: CYVORIQ Solutions Pvt. Ltd.
- Frozen Windows product: https://www.cyvra.co.in — not this repository

Do not start CYVRA Station or Knox until the guideline gates say so.
```

Commit to `main`.

### B3. Allow Cursor to see the private repo

If a new Cloud Agent cannot find `CYVRA-Mobile`:

1. GitHub → your profile → **Settings** → **Applications** → **Installed GitHub Apps**
2. Open **Cursor** (or **Cursor Cloud**)
3. **Repository access** → **Only select repositories** → add **`CYVRA-Mobile`**
4. Save

Without this, the next agent will only see public/old repos (Erase, approvals).

---

## C. Open the **next** Cursor agent on that repo

Do this in **Cursor**, not inside this approvals chat.

1. Go to https://cursor.com/agents  
   **or** in Cursor Desktop: **Agents** / Cloud Agents → **New agent**.
2. **Repository:** `mukpswar-prog/CYVRA-Mobile` (not `Erase`, not `cyvra-approvals`).
3. **Branch:** `main`.
4. **Environment:** your usual Cloudflare-capable environment if you have one; otherwise default.
5. Paste this as the first message (copy as-is):

```text
Read GUIDELINE.md first. This is CYVRA Mobile Evidence.

Do G0–G3 only:
- confirm GUIDELINE.md is on main
- Cloudflare account 5a3eeb2b3d42726a8ba08732464a0eda
- Neon project floral-art-02749206
- Resend for transactional OTP only

Create new resources only: Pages cyvra-mobile, Worker cyvra-mobile-api, Hyperdrive to Neon.
Never touch mukpswar-prog/Erase, cyvra-www, cyvoriq-erase-api, cyvra-admin, cyvra-approvals.

Do NOT start CYVRA Station (Windows bench), Knox, S3, Android app, or the www.cyvra.co.in tab.

First slice: Worker + Neon users/sessions + Resend OTP + apps/web registration on a preview URL.

Log in to Cloudflare, Neon, and Resend MCP/CLI in this session before creating resources.
```

6. Start the agent. **Close or ignore this approvals chat** for product work.

---

## D. Log in to Cloudflare, Neon, and Resend — **in that new agent**

The new agent cannot use your dashboards until **you** authenticate. Do it **after** the agent is running on `CYVRA-Mobile`.

### D1. Cursor Desktop MCP (best)

In **Cursor Desktop** (the app on Windows), not only the cloud tab:

1. **Cursor Settings** → **MCP**
2. Connect / Sign in:
   - **Cloudflare** (Workers, Pages, Hyperdrive)
   - **Neon**
   - **Resend**
3. Ensure those MCPs are enabled for **Cloud Agents** / the environment the new agent uses.
4. In the new agent chat, if it asks to authenticate, click **Allow** / complete the browser OAuth.

If MCP OAuth is “desktop only” and the cloud agent still cannot log in: you create the resources yourself in the browsers (sections E–G), then tell the new agent “Hyperdrive id is …, Worker is cyvra-mobile-api, Resend domain is verified.”

### D2. Browser logins (you, same Windows session)

Keep these three tabs open while the new agent works:

| Tab | URL |
|---|---|
| Cloudflare | https://dash.cloudflare.com/5a3eeb2b3d42726a8ba08732464a0eda/home |
| Neon | https://console.neon.tech/app/projects/floral-art-02749206 |
| Resend | https://resend.com/emails |

---

## E. Cloudflare — what to create and **where** (Gate G1)

Account home: https://dash.cloudflare.com/5a3eeb2b3d42726a8ba08732464a0eda/home  

**Left sidebar names can vary slightly.** Look for **Workers & Pages**, **Hyperdrive**, **DNS**.

### E1. Confirm you are on the CYVRA account

Top-right account switcher: the URL must keep `5a3eeb2b3d42726a8ba08732464a0eda`.  
If you land on a different account, switch before creating anything.

### E2. Do **not** open these existing apps

Leave them alone:

- Pages: `cyvra-www`
- Worker: `cyvoriq-erase-api`
- Worker: `cyvra-approvals`
- Hosts: `www.cyvra.co.in`, `admin.cyvra.co.in`, `api.cyvra.co.in`, `approvals.cyvra.co.in`

### E3. Hyperdrive (do this after you have the Neon **pooled** URL from F2)

1. Cloudflare dashboard → **Storage & databases** (or **Workers**) → **Hyperdrive**
2. **Create configuration**
3. Name: `cyvra-mobile-neon`
4. Connection string: Neon **pooled** URI (`-pooler` in the host). Not the direct host.
5. Create. Copy the Hyperdrive **id** (you will bind it in Wrangler later).

### E4. Worker `cyvra-mobile-api`

**Wait for the new agent if it can deploy.** If you create a placeholder yourself:

1. **Workers & Pages** → **Create** → **Worker**
2. Name: `cyvra-mobile-api` (exact)
3. Deploy the hello Worker for now
4. **Settings** → **Variables and Secrets** → later add `RESEND_API_KEY` (Encrypt) — **after** G2
5. Do **not** attach a route on `api.cyvra.co.in`

Optional later route: `api-mobile.cyvra.co.in/*` → this Worker.

### E5. Pages `cyvra-mobile` (can wait until there is a web app)

When `apps/web` exists on `main` or a branch:

1. **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Provider: **GitHub**
3. Repository: **`mukpswar-prog/CYVRA-Mobile`** (grant access if GitHub asks)
4. Project name: `cyvra-mobile`
5. Production branch: `main`
6. Build: whatever the agent sets (e.g. Next.js in `apps/web`). If the repo is docs-only, **skip Pages** until G3.

### E6. DNS `mobile.cyvra.co.in`

1. Cloudflare → **Websites** → **cyvra.co.in** (the zone you already use for www)
2. **DNS** → **Add record**
3. After Pages is live: CNAME `mobile` → the Pages target Cloudflare shows  
   **or** Workers custom domain on the Pages project: **Custom domains** → `mobile.cyvra.co.in`
4. Proxy **Proxied** (orange cloud)

Do not change `www`, `api`, `admin`.

---

## F. Neon — what to check and **where** (Gate G1)

Open: https://console.neon.tech/app/projects/floral-art-02749206

1. Confirm this project is **only** for mobile (not Erase).
2. **Dashboard** → note **region**. Keep using this project; do not create a second production project.
3. **Connect** (or **Connection details**):
   - Copy **Pooled** connection string → Hyperdrive (E3)
   - Copy **Direct** connection string → Drizzle migrations only (the new agent will use this)
4. **Branches:** you should see `production` / `main` (Neon’s default branch). Leave it. Preview branches come later.
5. **Tables:** if empty, that is correct. Do **not** paste Windows Erase tables here.
6. **Settings** → reset/copy role password only if you need a fresh secret. Store it in a password manager, never in GitHub.

The new agent should run the first Drizzle migration. You should not type SQL by hand unless the agent asks you to click **Run**.

---

## G. Resend — what to set and **where** (Gate G1–G2)

Open: https://resend.com/emails

### G1. Domain (required before real users)

1. Left: **Domains** → https://resend.com/domains
2. If `cyvra.co.in` (or `mobile.cyvra.co.in`) is **not** listed → **Add Domain**
3. Choose the domain you will put in `From:`  
   Recommended: `cyvra.co.in` then send `CYVRA Mobile <noreply@cyvra.co.in>`  
   **or** `mobile.cyvra.co.in` if you want a dedicated subdomain
4. Resend shows DNS records (SPF, DKIM, optionally DMARC)
5. Add those records in Cloudflare → **cyvra.co.in** → **DNS** (same zone as E6)
6. Back in Resend → **Verify**. Wait until status is **Verified**.  
   Do **not** use `onboarding@resend.dev` for customers (sandbox only mails your Resend login email).

### G2. API key

1. https://resend.com/api-keys
2. **Create API Key**
3. Name: `cyvra-mobile-worker`
4. Permission: **Sending access** is enough for OTP
5. Copy once. Paste into Cloudflare Worker secret `RESEND_API_KEY` (E4) **or** give it to the new agent via the secret UI, never into GitHub, never into chat if you can avoid it.

### G3. Test (after Worker exists)

Resend **Emails** list should show sends. For tests use `delivered@resend.dev`, not a fake gmail.

---

## H. What you must **not** start yet (and where that is written)

| Do not start | Where it is blocked | When it is allowed |
|---|---|---|
| CYVRA Station (Windows bench, USB, ADB) | Guideline §4, Gate G9, Decision **5.1.20.2** not approved | After S1 Report 1 exists and 5.1.20.2 is written |
| Knox / S3 / enterprise | Guideline §4, Gate G10 | After a real Samsung/enterprise contract path |
| Android S1 app | Gate G5 | After G2–G4 (API + schema + registration web) |
| `www.cyvra.co.in` Mobile tab | Gate G8 | After `mobile.cyvra.co.in` registration actually loads |
| Anything in `mukpswar-prog/Erase` | Guideline §9 | Never for this product |

If the next agent starts generating a Windows `.exe`, ADB console, or Knox SDK — **stop it** and paste: “G9/G10 only. S1 web+API first.”

---

## I. Order on your calendar (checklist)

Print this and tick in order:

- [x] Make `CYVRA-Mobile` private
- [ ] GitHub description (section A)
- [ ] Cursor GitHub App can access `CYVRA-Mobile` (B3)
- [ ] `GUIDELINE.md` + README on `main` (section B)
- [ ] New Cursor agent **on that repo** (section C)
- [ ] MCP or browser login: Cloudflare, Neon, Resend (section D)
- [ ] Neon pooled URL copied (F)
- [ ] Hyperdrive `cyvra-mobile-neon` (E3)
- [ ] Worker `cyvra-mobile-api` (E4) — agent may do this
- [ ] Resend domain verified + API key as Worker secret (G)
- [ ] Registration web preview (G3 in the **guideline**, not Resend G3)
- [ ] Custom domain `mobile.cyvra.co.in` only after preview works
- [ ] Station / Knox / Erase website tab: **leave closed**

---

## J. If something fails

| Problem | Where to look |
|---|---|
| New agent cannot see the repo | B3 GitHub App repository access |
| `wrangler` / Cloudflare MCP 401 | Wrong Cloudflare account; URL must contain `5a3eeb2b3d42726a8ba08732464a0eda` |
| Neon timeout / scale-to-zero | First query after idle is slow; not a wrong project |
| Resend 403 | Domain not verified, or `From:` host ≠ verified domain |
| Agent edits Erase | Wrong repo selected in C2 — kill that run |
