# Tooling versions

This repo pins **current** CLIs. Older pins (Node 20, npm 10, pnpm 10, Wrangler 3,
Python 3.12) were leftover from the first scaffold, not a product requirement.

| Tool | Pin | Why |
| --- | --- | --- |
| Node.js | **24.21.0** (Active LTS, `.nvmrc`) | npm 12 requires `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`. Cloud Agent PATH had 22.14.0, which cannot run npm 12. |
| npm CLI | **12.0.2** | Current npm CLI ([package-lock.json docs](https://docs.npmjs.com/cli/v12/configuring-npm/package-lock-json)). Installed globally in `scripts/install.sh`. |
| pnpm | **12.3.4** (`packageManager`) | This is a **pnpm workspace**. The lockfile is `pnpm-lock.yaml`, not `package-lock.json`. Do not run `npm install` at the repo root. |
| Python | **3.14** (latest stable) | Scripts use `scripts/python`. Ubuntu’s `/usr/bin/python3` stays 3.12 so apt is not broken. 3.15 is still RC, so it is not pinned. |
| Wrangler | **4.x** | Cloudflare CLI. 3.x was the old major. |
| Vite | **8.x** | Web bundler. |
| TypeScript | **7.x** | `tsc --noEmit` typecheck. |

Cloudflare Pages reads `.nvmrc` / `.node-version` (and optional `NODE_VERSION`).
Do not leave Pages on Node 20.

The Cloud Agent image puts `/exec-daemon/node` (22.14) on PATH. That version is
too old for npm 12, so `scripts/install.sh` and `scripts/tooling-env.sh` prepend
`~/.local/bin` with the `.nvmrc` Node 24 binary.

## npm 12 vs `package-lock.json`

npm 12’s lockfile format is `package-lock.json` **when the installer is npm**.
This monorepo uses **one** lockfile: `pnpm-lock.yaml`. Generating a second
lockfile with `npm install` would desync installs.

`npm -v` should print `12.0.2` after `bash scripts/install.sh`. Workspace
commands stay `pnpm …`.
