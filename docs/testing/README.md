# Test pool

Step-by-step checks for CYVRA Mobile Evidence.

- **Pool (what / how / status):** [pool.md](./pool.md)
- **S1 research (Samsung + AOSP, no device):** [../research/samsung-s1-sources.md](../research/samsung-s1-sources.md)
- **G4 package tests:** `pnpm --filter @cyvra/evidence test`
- **G5 local ingest:** `API_URL=http://127.0.0.1:8787 bash scripts/test-local-evidence.sh`

No Samsung handset is in this environment. Device rows stay `queued-no-device`
until a phone is on the bench. Do not fill PASS/FAIL from documentation alone.
