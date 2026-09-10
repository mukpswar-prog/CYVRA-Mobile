# Test pool

Step-by-step checks for CYVRA Mobile Evidence.

- **Pool (what / how / status):** [pool.md](./pool.md)
- **S1 research (Samsung + AOSP, no device):** [../research/samsung-s1-sources.md](../research/samsung-s1-sources.md)
- **G4 package tests:** `pnpm --filter @cyvra/evidence test`
- **G5 local ingest:** `bash scripts/run-local-evidence.sh` (starts local Postgres + wrangler if needed)
- **G6 local Report 1 freeze:** `bash scripts/run-local-report.sh`
- **G7 local serials:** `bash scripts/run-local-admin-serials.sh`

No Samsung handset is in this environment. Device rows stay `queued-no-device`
until a phone is on the bench. Do not fill PASS/FAIL from documentation alone.
