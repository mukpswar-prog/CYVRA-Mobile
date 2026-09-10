# Resume here — live Neon evidence migrate (DONE 10 Sep 2026)

**Completed.** Neon production has the five evidence tables. Worker `/health` is
`database=connected`, `env=preview`. Do not repeat this playbook unless you
are setting up a new Codespace `.env`.

Historical steps remain below. Next coding when you say **go**: **G6 Report 1**.

**Stop point (9 Sep 2026 evening).** Do not start G6, G7–G10, www, Station, or Knox.  
**Branch:** `cursor/g0-g3-mobile-slice-7474`  
**Codespace path:** `/workspaces/CYVRA-Mobile`

Do **not** paste Neon passwords, connection strings, or API tokens into chat or Git.

---

## Already done (do not redo)

| Item | Status |
|---|---|
| G0–G3 pipe | Live. `https://mobile.cyvra.co.in/` HTTP 200 |
| G4 evidence package | 19 tests pass |
| G5 Android `:core` | Gradle 9.1.0, Codespaces Java 25 green |
| G5 local ingest | `bash scripts/run-local-evidence.sh` passed in Codespaces |
| Neon password rotate | Done. Live `/health` `database=connected`, `env=preview` |
| Hyperdrive `cyvra-mobile-neon` | id `db31fc8dafca49b29172da7046b97175` |
| Worker ingest routes | Already on `cyvra-mobile-api` (`API_ENV=preview`). **Do not** `wrangler login` in Codespaces (OAuth times out). |
| `books_to_read` on Neon | Leftover. Leave it |

## Not done (start here)

`DATABASE_URL_DIRECT` in gitignored `database/.env` is still `127.0.0.1`.  
`bash scripts/migrate-neon.sh` correctly **refused** local Postgres. Neon public tables are still:

- `books_to_read`
- `email_otp_challenges`
- `sessions`
- `users`

Missing: `device_lifecycles`, `processing_sessions`, `capability_profiles`, `evidence_records`, `evidence_batches`.

---

## Tomorrow — one command at a time

Wait until the codespace shows a `$` prompt (not “getting your codespace ready”).

### Step 1 — Open the repo on this branch

```bash
cd /workspaces/CYVRA-Mobile
git fetch origin
git checkout cursor/g0-g3-mobile-slice-7474
git pull --rebase origin cursor/g0-g3-mobile-slice-7474
```

Expected: already on this branch, fast-forward or “Already up to date.”

### Step 2 — See which host migrate would use (no password printed)

```bash
bash scripts/open-db-env.sh
```

Expected first time: `DATABASE_URL_DIRECT host: 127.0.0.1`.  
That means Neon is **not** configured yet. Continue.

If the editor does not open: `Ctrl+Shift+P` → type `excludeGitIgnore` → turn **Explorer: Exclude Git Ignore** **off** → `Ctrl+P` → type `database/.env` → Enter.

### Step 3 — Copy the Neon **direct** URL (other browser tab)

1. Open https://console.neon.tech/app/projects/floral-art-02749206
2. **Connect**
3. Branch **production** (`br-empty-silence-b3a7hhss`), database `neondb`, role `neondb_owner`
4. **Uncheck Pooled connection**
5. Copy the string. Host must **not** contain `-pooler`  
   Good shape: `ep-….c-4.ap-southeast-1.aws.neon.tech`  
   Bad: `ep-…-pooler.…`

Keep it in the password manager / clipboard. Not in chat.

### Step 4 — Edit **only** `DATABASE_URL_DIRECT`

In `database/.env`:

- Leave this line **exactly**:
  `DATABASE_URL=postgres://cyvra:cyvra@127.0.0.1:5432/cyvra_mobile`
- Change **only** the value after `DATABASE_URL_DIRECT=` to the string from Step 3.

If you use **nano** in the terminal:

1. `nano database/.env`
2. Arrow to the `DATABASE_URL_DIRECT=` line
3. Delete the old `postgres://cyvra:cyvra@127.0.0.1:5432/cyvra_mobile` after `=`
4. Paste (`Ctrl+Shift+V` or right-click Paste)
5. Save: `Ctrl+O` → `Enter` → quit: `Ctrl+X`

If you use the editor tab: paste on that line → `Ctrl+S`.

Do **not** `source database/.env` and do not run `bash database/.env`.

### Step 5 — Confirm the host flipped

```bash
bash scripts/open-db-env.sh
```

**Stop unless** you see `DATABASE_URL_DIRECT host: ep-….neon.tech`.  
If it still says `127.0.0.1`, Step 4 did not save. Repeat Step 4.

Also:

```bash
git check-ignore -v database/.env
git status --short
```

`database/.env` must **not** appear as a file to commit.

### Step 6 — Migrate Neon

```bash
bash scripts/migrate-neon.sh
```

Expected:

```text
[neon] DATABASE_URL_DIRECT host: ep-….neon.tech
[migrate] target ep-….neon.tech:5432
[migrate] done
```

If it says `refusing local Postgres`, go back to Step 4.  
If it says `refusing Neon pooled host`, repeat Step 3 with Pooled **unchecked**.

### Step 7 — Prove tables in Neon SQL Editor

https://console.neon.tech/app/projects/floral-art-02749206 → SQL Editor:

```sql
select tablename
from pg_tables
where schemaname = 'public'
order by 1;
```

You must now also see:

- `capability_profiles`
- `device_lifecycles`
- `evidence_batches`
- `evidence_records`
- `processing_sessions`

Leave `books_to_read`. Reply in chat: **tables: ok** (names only, no rows, no URLs).

### Step 8 — Live Worker health (no deploy needed)

```bash
curl -sS https://cyvra-mobile-api.mukpswar.workers.dev/health
```

Expected: `"status":"ok"`, `"env":"preview"`, `"database":"connected"`.  
Ingest routes are already deployed. Do **not** run `wrangler login`. Do **not** flip `API_ENV=production`.

---

## After Step 7+8 succeed (not today)

Optional leftovers, not blocking:

- GitHub description: [g0-github-description.md](./g0-github-description.md)
- Worker host `api-mobile.cyvra.co.in`: [dashboard-configure.md](./dashboard-configure.md) §4.2
- Samsung device tests: [testing/pool.md](./testing/pool.md) (`queued-no-device`)

Coding next after you say **go**: **G6 Report 1** (frozen manifest / PDF). Not before Step 7.

## Do not touch

Erase, `cyvra-www`, `cyvoriq-erase-api`, `cyvra-approvals`, `api.cyvra.co.in`, Hyperdrive **Connect database**, Pages `DATABASE_URL`, attaching `mobile.cyvra.co.in` to the Worker.
