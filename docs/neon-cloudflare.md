# Neon + Cloudflare: which guide we use

Neon publishes two Cloudflare guides. Only **one** matches this product.

| Guide | Link | Use for CYVRA Mobile? |
| --- | --- | --- |
| Cloudflare **Pages** | https://neon.com/docs/guides/cloudflare-pages | **No.** Puts `DATABASE_URL` on Pages Functions and uses `@neondatabase/serverless`. The customer site must never talk to Postgres. |
| Cloudflare **Workers** + **Hyperdrive** | https://neon.com/docs/guides/cloudflare-workers | **Yes. This is what we already built.** Native `pg`, Hyperdrive binding `HYPERDRIVE`, Worker `cyvra-mobile-api`. |

The Pages guide is a “books list” demo that runs SQL inside Pages. That would put the database on `cyvra-mobile` (the public UI). Guideline §6 forbids that.

The Workers guide has two recipes. We use **Hyperdrive (recommended)**, not the “Neon serverless driver / DATABASE_URL secret” recipe.

```
Browser  →  Pages `cyvra-mobile`  (static Vite, VITE_API_URL only)
                ↓ HTTPS
         Worker `cyvra-mobile-api`  (Hono + pg)
                ↓ Hyperdrive `cyvra-mobile-neon`
         Neon `floral-art-02749206` / `neondb`
```

## Do not click

- Neon left sidebar **Integrations** → Cloudflare Pages
- Pages project **`cyvra-mobile`** → Environment variables → `DATABASE_URL`
- Creating a second Hyperdrive or a new Neon project
- `@neondatabase/serverless` in the Worker (Hyperdrive needs TCP `pg`)

## Hyperdrive origin string (important)

Neon’s Workers guide: **uncheck Pooled connection**. Hyperdrive already pools. Stacking Neon’s `-pooler` on Hyperdrive is the wrong origin.

| String | Host looks like | Where it goes |
| --- | --- | --- |
| **Direct** (pooled checkbox **off**) | `ep-….ap-southeast-1.aws.neon.tech` **no** `-pooler` | Cloudflare Hyperdrive **origin** |
| **Pooled** (checkbox **on**) | `ep-…-pooler.…` | Only if something talks to Neon **without** Hyperdrive. Not Pages. Not the Worker. |
| Direct (same) | no `-pooler` | Codespaces `database/.env` → `DATABASE_URL_DIRECT` for `pnpm db:migrate` |

## Where things are saved (not the health curl)

| Thing | Where |
| --- | --- |
| `curl -sS https://cyvra-mobile-api.mukpswar.workers.dev/health` | **Codespaces / local terminal only.** It is a test. Do not paste it into Neon, Hyperdrive, or Git. |
| Neon **direct** connection string | Hyperdrive `cyvra-mobile-neon` **Settings** (click the blue name on the list; do not use **Connect database**). Also gitignored `database/.env` as `DATABASE_URL_DIRECT`. |
| Neon password | Password manager. Never Git, never chat. |
| Pages | `VITE_API_URL` only (Worker URL). No database. |

Live Worker already returns `database=connected`, so Hyperdrive exists. You only **edit the origin** if you rotated the Neon password or the origin is empty.

## Codespaces test (after Hyperdrive Save)

```bash
cd /workspaces/CYVRA-Mobile
git fetch origin
git checkout cursor/g0-g3-mobile-slice-7474
git pull --rebase origin cursor/g0-g3-mobile-slice-7474
curl -sS https://cyvra-mobile-api.mukpswar.workers.dev/health
```

Expect `"status":"ok"` and `"database":"connected"`. That proves Pages is not involved: the Worker reached Neon through Hyperdrive.

Local `wrangler dev` still uses local Postgres (`localConnectionString` in `wrangler.jsonc`), not Neon. That is separate from this live check.
