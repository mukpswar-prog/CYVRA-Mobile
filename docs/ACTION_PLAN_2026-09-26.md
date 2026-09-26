# CYVRA Mobile — Action Plan

**Date:** 2026-09-26  
**Status:** APPROVED FOR EXECUTION  
**Branch:** `phase2-correct` (current), `audit-and-planning-2026-09-26` (documentation)  
**Next gate:** P1.5A.2 (README rewrite) → G6 (WPD metadata scanner) → P0 fixes

---

## 0. Execution Principles

1. **No destructive changes** until Phase 4 hardware validation
2. **No architecture rewrites** — consolidate and correct
3. **Every task starts with an audit** of current state
4. **Every implementation ends with regression verification**
5. **No commit until scope/read-only/privacy checks pass**
6. **Documentation before code** — freeze contracts before implementation
7. **Hardware validation before release claims**

---

## 1. Immediate Priorities (Next 2 Weeks)

### 1.1 Complete P1.5 — Documentation Consolidation

**Status:** P1.5A.1 (Project Index) is done. Next: P1.5A.2 (README rewrite)

#### Task 1.1.1: Rewrite Root README.md

**What:** Replace current README with honest, current-state documentation

**Why:** Current README links to historical resume documents and contains superseded claims

**Steps:**
1. Read current `README.md` to understand structure
2. Draft new content:
   - One-paragraph product description
   - Current architecture summary (GEN-2 Tauri/Rust)
   - Current maturity status (G4/G5 verified, G6 next)
   - Repository layout
   - Build/test entrypoints
   - Link to Project Index as primary navigation
3. Remove all references to:
   - `resume-*` documents
   - `g0-*` / `g5-*` / `g7-*` documents
   - "v3.2.2-release" claims
   - Old G0-G10 gate table
4. Add mandatory link to `docs/CYVRA_MOBILE_PROJECT_INDEX.md`
5. Review against P1.5A.2 requirements

**Dependencies:** None

**Estimated time:** 2-3 hours

**Success criteria:**
- [ ] No references to historical resume documents
- [ ] No superseded claims (v3.2.2, G0-G10, etc.)
- [ ] Current architecture accurately described
- [ ] Link to Project Index present
- [ ] Build/test commands work as documented

**Risk:** LOW — documentation only, no code changes

---

#### Task 1.1.2: Create Audit Documentation

**What:** Create `AUDIT_SUMMARY.md`, `ACTION_PLAN.md`, `STATUS_REPORT.md`

**Why:** Preserve audit findings and execution plan for future reference

**Steps:**
1. Create `AUDIT_SUMMARY.md` (this document's companion)
2. Create `ACTION_PLAN.md` (this document)
3. Create `STATUS_REPORT.md` (current state snapshot)
4. Update `PROJECT_INDEX.md` to reference these documents
5. Review all documents for accuracy

**Dependencies:** None

**Estimated time:** 3-4 hours (already mostly complete)

**Success criteria:**
- [ ] All three documents created
- [ ] Project Index references them
- [ ] Content is accurate and actionable

**Risk:** LOW — documentation only

---

#### Task 1.1.3: Commit Documentation to New Branch

**What:** Commit audit documentation to `audit-and-planning-2026-09-26` branch

**Why:** Preserve planning work without affecting `phase2-correct` or `main`

**Steps:**
1. Create new branch: `git checkout -b audit-and-planning-2026-09-26`
2. Stage documentation files:
   ```bash
   git add AUDIT_SUMMARY.md
   git add ACTION_PLAN.md
   git add STATUS_REPORT.md
   git add PROJECT_INDEX.md
   git add README.md  # if rewritten
   ```
3. Commit with descriptive message:
   ```
   docs: add forensic audit summary and execution plan
   
   - Comprehensive audit of 46 issues mapped to FSB
   - Action plan for Phase 1-5 execution
   - Status report for current state
   - Updated Project Index with audit context
   - Rewrote README to remove superseded claims
   
   Audit performed after reviewing all governance documents.
   All findings validated against existing documentation.
   Project is following deliberate consolidation plan.
   ```
4. Push branch (if remote is configured)
5. Do NOT merge to `main` yet

**Dependencies:** Tasks 1.1.1, 1.1.2

**Estimated time:** 30 minutes

**Success criteria:**
- [ ] Branch created
- [ ] All files committed
- [ ] Commit message is descriptive
- [ ] Branch pushed (if remote configured)
- [ ] No merge to `main`

**Risk:** LOW — isolated branch, no production impact

---

### 1.2 Implement G6 — Bounded WPD Metadata Scanner

**Status:** G4/G5 verified on Samsung A10s. G6 is next.

#### Task 1.2.1: Audit Current WPD Implementation

**What:** Review `apps/desktop/src-tauri/src/wpd/discovery.rs` to understand current state

**Why:** Must understand existing code before adding metadata scanning

**Steps:**
1. Read `wpd/discovery.rs` completely
2. Identify:
   - Current WPD COM initialization
   - `GetDevices` implementation (with bounded retry?)
   - Session ID generation
   - Error handling patterns
3. Check for:
   - Memory management (CoTaskMemFree)
   - Bounded enumeration (MAX_WPD_ENUMERATION_ATTEMPTS)
   - Privacy boundary (no raw PnP IDs in IPC)
4. Document current state

**Dependencies:** None

**Estimated time:** 2-3 hours

**Success criteria:**
- [ ] Current implementation fully understood
- [ ] Gaps identified
- [ ] Privacy boundary confirmed

**Risk:** LOW — read-only audit

---

#### Task 1.2.2: Design G6 Metadata Scanner

**What:** Design bounded, read-only, metadata-only WPD scanner

**Why:** Must freeze design before implementation per engineering process

**Steps:**
1. Define scope:
   - **IN SCOPE:** Object names, types, sizes, timestamps, hierarchy, storage metadata, aggregate counts
   - **OUT OF SCOPE:** File content streams, copy/upload, previews, private app data
2. Define bounds:
   - Maximum objects per scan (e.g., 10,000)
   - Maximum depth (e.g., 5 levels)
   - Maximum time (e.g., 30 seconds)
   - Cancellation support
3. Define error handling:
   - Per-object error isolation (one failure doesn't abort scan)
   - Stable error codes
   - Limitation reporting
4. Define output:
   - Deterministic ordering (stable sort by object ID)
   - Canonical digest of metadata
   - Source attribution (`WINDOWS_WPD_MTP`)
5. Document design in `docs/architecture/g6-wpd-metadata-scanner.md`

**Dependencies:** Task 1.2.1

**Estimated time:** 3-4 hours

**Success criteria:**
- [ ] Design document created
- [ ] Scope clearly defined
- [ ] Bounds specified
- [ ] Error handling defined
- [ ] Output format specified

**Risk:** LOW — design only, no code yet

---

#### Task 1.2.3: Implement G6 Scanner

**What:** Implement bounded WPD metadata scanner in Rust

**Why:** Complete G6 gate to enable Evidence V2 integration

**Steps:**
1. Implement `IPortableDevice::Open` with `GENERIC_READ` only
2. Implement `IPortableDeviceContent::EnumObjects` with bounds:
   - Object count limit
   - Depth limit
   - Time limit
   - Cancellation token
3. For each object:
   - Query properties (name, type, size, timestamps)
   - Handle errors per-object (don't abort on single failure)
   - Track metadata only (no content streams)
4. Implement deterministic ordering
5. Implement canonical digest of metadata
6. Add comprehensive tests:
   - Bounded enumeration (hit limits)
   - Error isolation (one object fails, others succeed)
   - Cancellation (abort mid-scan)
   - Privacy (verify no content streams opened)
7. Run `cargo check`, `cargo test`, `cargo clippy`
8. Run `cargo fmt --check` (leaf files only, no root formatting)
9. Review diff for unrelated changes

**Dependencies:** Task 1.2.2

**Estimated time:** 8-12 hours

**Success criteria:**
- [ ] Scanner opens device with `GENERIC_READ` only
- [ ] Bounds enforced (count, depth, time)
- [ ] Cancellation works
- [ ] Per-object error isolation
- [ ] Deterministic ordering
- [ ] Canonical digest computed
- [ ] All tests pass
- [ ] Clippy clean
- [ ] No unrelated formatting changes
- [ ] Privacy boundary maintained (no content streams)

**Risk:** MEDIUM — native Windows API, must be careful with COM memory management

**Mitigation:**
- Review COM memory management (CoTaskMemFree)
- Test on Samsung A10s before commit
- Keep changes isolated to `wpd/` module

---

#### Task 1.2.4: Hardware Validation on Samsung A10s

**What:** Validate G6 scanner on real Samsung Galaxy A10s

**Why:** Must prove on real hardware before claiming HARDWARE-VALIDATED

**Steps:**
1. Connect Samsung A10s via USB
2. Enable MTP (File Transfer) mode
3. Run G6 scanner
4. Verify:
   - Device opens successfully
   - Metadata enumerated within bounds
   - No customer content accessed
   - Digest computed correctly
   - Errors handled gracefully
5. Test edge cases:
   - Unplug during scan (should handle gracefully)
   - Large storage (should hit bounds)
   - Empty storage (should handle gracefully)
6. Document results

**Dependencies:** Task 1.2.3

**Estimated time:** 2-3 hours

**Success criteria:**
- [ ] Scanner works on real Samsung A10s
- [ ] Bounds enforced on real device
- [ ] No customer content accessed
- [ ] Edge cases handled
- [ ] Results documented

**Risk:** LOW — read-only operation, no destructive changes

---

#### Task 1.2.5: Commit G6 Implementation

**What:** Commit G6 scanner to `phase2-correct` branch

**Why:** Freeze G6 checkpoint before proceeding to Evidence V2

**Steps:**
1. Ensure all tests pass
2. Ensure clippy clean
3. Ensure no unrelated changes
4. Stage changes:
   ```bash
   git add apps/desktop/src-tauri/src/wpd/
   git add docs/architecture/g6-wpd-metadata-scanner.md
   ```
5. Commit:
   ```
   feat(wpd): implement G6 bounded metadata scanner
   
   - Bounded enumeration (count, depth, time limits)
   - Read-only with GENERIC_READ access
   - Per-object error isolation
   - Deterministic ordering and canonical digest
   - Cancellation support
   - Comprehensive tests
   - Hardware-validated on Samsung A10s
   
   Privacy boundary maintained: no customer content streams opened.
   Metadata-only scanning for Evidence V2 integration.
   ```
6. Push branch

**Dependencies:** Task 1.2.4

**Estimated time:** 30 minutes

**Success criteria:**
- [ ] All tests pass
- [ ] Clippy clean
- [ ] No unrelated changes
- [ ] Commit message descriptive
- [ ] Branch pushed

**Risk:** LOW — isolated to WPD module

---

### 1.3 Fix Critical P0 Issues

**Status:** Phase 2 in progress. P0 issues scheduled.

#### Task 1.3.1: Remove ADB-Derived `usbConnected` (FSB-003)

**What:** Fix Host Protocol V1 `GET_DEVICE_STATE` to not derive USB state from ADB

**Why:** Real Samsung acceptance proved `USB_PRESENT + MTP_READY + ADB_UNAVAILABLE` is valid

**Steps:**
1. Locate `GET_DEVICE_STATE` handler in Kotlin Host
2. Identify where `usbConnected` is derived from ADB device list
3. Remove ADB-derived USB state
4. Replace with:
   - USB state from Windows native snapshot (Rust)
   - WPD state from Windows native snapshot (Rust)
   - ADB state from ADB transport (Kotlin)
5. Update tests to verify:
   - USB present + ADB unavailable = valid state
   - No implicit device selection
6. Run `./gradlew :host:test`

**Dependencies:** None (can parallelize with other P0 fixes)

**Estimated time:** 2-4 hours

**Success criteria:**
- [ ] `usbConnected` no longer derived from ADB
- [ ] USB state comes from Windows native snapshot
- [ ] Tests verify USB+MTP present with ADB absent
- [ ] All host tests pass

**Risk:** MEDIUM — changes device state model, must be careful

**Mitigation:**
- Review all code that consumes `usbConnected`
- Test on real hardware (Samsung A10s)
- Keep changes isolated to device state module

---

#### Task 1.3.2: Implement Evidence Replay Digest Verification (FSB-009)

**What:** Add digest comparison to evidence replay to detect integrity conflicts

**Why:** Current `ON CONFLICT DO NOTHING` cannot prove same-ID/same-content replay

**Steps:**
1. Locate evidence ingest endpoint in `services/api/src/evidence.ts`
2. Identify current `ON CONFLICT DO NOTHING` logic
3. Add digest comparison:
   ```typescript
   // On conflict:
   // 1. Fetch existing record
   // 2. Canonicalize incoming record
   // 3. Compute digest
   // 4. Compare with stored digest
   // 5. If same: IDEMPOTENT_REPLAY
   // 6. If different: INTEGRITY_CONFLICT (reject, log, audit)
   ```
4. Add tests:
   - Same ID + same digest → replay accepted
   - Same ID + different digest → conflict rejected
   - Different ID → new record created
5. Run tests

**Dependencies:** None

**Estimated time:** 4-6 hours

**Success criteria:**
- [ ] Digest comparison implemented
- [ ] Idempotent replay works
- [ ] Integrity conflict detected and rejected
- [ ] Conflict logged/audited
- [ ] All tests pass

**Risk:** MEDIUM — changes evidence ingest logic, must preserve idempotency

**Mitigation:**
- Test both replay and conflict scenarios
- Verify no data loss
- Keep backward compatibility with V1 evidence

---

#### Task 1.3.3: Fix Cascade Deletion (FSB-010)

**What:** Prevent account deletion from cascading to frozen evidence/reports

**Why:** Frozen evidence must be preserved independent of account lifecycle

**Steps:**
1. Review `database/src/schema.ts` for cascade deletes
2. Identify foreign keys with `onDelete: "cascade"` on:
   - `deviceLifecycles`
   - `processingSessions`
   - `evidenceRecords`
   - `evidenceBatches`
   - `reports`
   - `reportManifests`
3. Change to `onDelete: "set null"` or `onDelete: "restrict"` for frozen records
4. Add retention policy:
   - Define retention period (e.g., 7 years for commercial records)
   - Add `retainedUntil` field where needed
   - Add soft-delete vs hard-delete distinction
5. Write migration:
   - Rehearse on non-production Neon branch first
   - Verify no data loss
   - Test account deletion preserves evidence
6. Update tests

**Dependencies:** None

**Estimated time:** 6-8 hours

**Success criteria:**
- [ ] Cascade deletes removed from frozen records
- [ ] Retention policy defined
- [ ] Migration tested on non-production
- [ ] Account deletion preserves evidence
- [ ] All tests pass

**Risk:** HIGH — database schema change, must not lose data

**Mitigation:**
- Test migration on non-production Neon branch first
- Backup production database before migration
- Verify retention policy with legal/compliance
- Keep migration reversible

---

#### Task 1.3.4: Replace Fake Ed25519 with Real Crypto (C1)

**What:** Implement real Ed25519 signing in `HostOfflineEntitlementEngine`

**Why:** Current implementation uses string concatenation, not real cryptography

**Steps:**
1. Review `HostOfflineEntitlementEngine.kt`
2. Identify fake signature: `signature = "SIG_ED25519_${digest.take(16)}_SERVER"`
3. Add Ed25519 dependency (e.g., Bouncy Castle, libsodium)
4. Generate Ed25519 key pair:
   - Private key: server-side only (secure storage)
   - Public key: embedded in client for verification
5. Implement real signing:
   ```kotlin
   val signature = ed25519Sign(privateKey, canonicalPayload)
   ```
6. Implement real verification:
   ```kotlin
   val valid = ed25519Verify(publicKey, canonicalPayload, signature)
   ```
7. Add migration plan:
   - Existing offline caches will be invalid
   - Users must re-verify online once
   - Document in release notes
8. Add tests:
   - Valid signature accepted
   - Forged signature rejected
   - Tampered payload rejected

**Dependencies:** None

**Estimated time:** 6-8 hours

**Success criteria:**
- [ ] Real Ed25519 signing implemented
- [ ] Real Ed25519 verification implemented
- [ ] Forged signatures rejected
- [ ] Migration plan documented
- [ ] All tests pass

**Risk:** HIGH — changes licensing crypto, may invalidate existing offline caches

**Mitigation:**
- Test thoroughly with valid and invalid signatures
- Document migration path for existing users
- Keep backward compatibility during transition period
- Coordinate with operations team

---

#### Task 1.3.5: Secure `/internal/prune` Endpoint (C2 / FSB-019)

**What:** Add authentication to `/internal/prune` or convert to scheduled job

**Why:** Currently publicly callable, DoS vector

**Steps:**
1. Review `services/api/src/index.ts` `/internal/prune` endpoint
2. Choose approach:
   - **Option A:** Add admin authentication (require staff session)
   - **Option B:** Convert to Cloudflare Cron Trigger (scheduled job)
   - **Option C:** Remove entirely (let expired records stay)
3. Implement chosen approach
4. Add tests:
   - Unauthenticated request rejected (if Option A)
   - Scheduled job runs successfully (if Option B)
5. Update documentation

**Dependencies:** None

**Estimated time:** 1-2 hours

**Success criteria:**
- [ ] Endpoint secured or removed
- [ ] Tests verify security
- [ ] Documentation updated

**Risk:** LOW — simple security fix

**Recommendation:** Option B (Cron Trigger) is cleanest — no HTTP endpoint needed

---

#### Task 1.3.6: Enable Branch Protection on `main` (C4 / FSB-035)

**What:** Enable branch protection rules on `main` branch

**Why:** Prevent direct pushes, require PR review and status checks

**Steps:**
1. Go to GitHub repository settings
2. Navigate to Branches → Branch protection rules
3. Add rule for `main`:
   - Require pull request before merging
   - Require approvals: 1
   - Require status checks to pass before merging
   - Require branches to be up to date before merging
   - Include administrators (optional, but recommended)
   - Do not allow force pushes
   - Do not allow deletions
4. Test by attempting direct push (should fail)
5. Document in `PROJECT_INDEX.md`

**Dependencies:** CI pipeline must be stable first (Phase 5)

**Estimated time:** 15 minutes

**Success criteria:**
- [ ] Branch protection enabled
- [ ] Direct push blocked
- [ ] PR required
- [ ] Status checks required

**Risk:** LOW — GitHub settings only

**Note:** This may be deferred to Phase 5 if CI is not yet stable

---

## 2. Medium-Term Priorities (1-2 Months)

### 2.1 Complete Phase 2 — CORRECT

#### Evidence V2 Schema
- Define V2 JSON Schema
- Freeze source/status/result vocabulary
- Freeze canonicalization rules
- Freeze digest algorithm
- Implement V2 ingest path
- Add V2 tests (18 acceptance tests A-R)

**Estimated time:** 20-30 hours

#### Device Correlation / SessionDeviceRef
- Implement `SessionDeviceRef` correlation object
- Bind Windows USB, WPD, ADB, Android component identities
- Prevent implicit first-device selection
- Require explicit disambiguation for multi-device

**Estimated time:** 12-16 hours

#### Auth Hardening
- Add OTP rate limiting (per-IP, per-email)
- Make OTP consume atomic (transaction)
- Use keyed HMAC for OTP verification
- Remove JS-readable session token
- Narrow CORS to exact origins
- Separate staff auth from break-glass token

**Estimated time:** 16-20 hours

#### Database Retention
- Define retention policy
- Remove unsafe cascade deletes
- Add append-only audit ledger
- Add auth-artifact cleanup

**Estimated time:** 12-16 hours

#### Canonical Report Manifest
- Define one canonical manifest format
- Unify Kotlin and cloud report engines
- Bind manifest entries to evidence digests
- Add cross-language digest test vectors

**Estimated time:** 16-20 hours

**Total Phase 2:** 80-120 hours

---

### 2.2 Start Phase 3 — INTEGRATE

#### Unified Evidence Model
- Fuse WINDOWS_USB, WINDOWS_WPD_MTP, ANDROID_ADB, ANDROID_COMPONENT
- Preserve source provenance
- Implement conflict preservation

**Estimated time:** 16-20 hours

#### Protocol V2
- Define V2 command set (8+ commands)
- Implement Rust → Kotlin snapshot passing
- Add request IDs, protocol version, session refs
- Add typed error codes, cancellation

**Estimated time:** 20-24 hours

#### Desktop UI Integration
- Display independent USB/MTP/ADB states
- Implement device verification workflow
- Integrate licensing transaction
- Integrate Report 1 generation

**Estimated time:** 24-32 hours

**Total Phase 3 start:** 60-76 hours

---

## 3. Long-Term Priorities (3-6 Months)

### 3.1 Phase 4 — HARDWARE-PROVE

- Multi-OEM testing matrix (Samsung, Xiaomi, Motorola, OnePlus, OPPO, Vivo, Pixel, Nothing)
- Android 8-16 version testing
- Sanitization method qualification (per-method, per-device)
- Post-reset verification strengthening
- Failure/reconnect matrix
- Entitlement failure matrix
- Report integrity matrix

**Estimated time:** 150-200 hours

### 3.2 Phase 5 — RELEASE-PROVE

- Windows packaging (bundle Kotlin runtime + Java)
- Code signing (Authenticode)
- Clean-machine validation (Win10 + Win11)
- CI/CD pipeline (Windows, Rust, Kotlin, Android)
- Branch protection enforcement
- Signed installer
- Production release

**Estimated time:** 100-150 hours

---

## 4. Dependencies and Sequencing

```
P1.5 (Documentation)
    ↓
G6 (WPD scanner)
    ↓
P0 Fixes (Phase 2 start)
    ├─ FSB-003 (USB state)
    ├─ FSB-009 (replay digest)
    ├─ FSB-010 (cascade deletion)
    ├─ C1 (Ed25519)
    ├─ C2 (/internal/prune)
    └─ C4 (branch protection)
    ↓
Phase 2 Completion
    ├─ Evidence V2
    ├─ Device correlation
    ├─ Auth hardening
    ├─ Database retention
    └─ Canonical report
    ↓
Phase 3 (Integration)
    ├─ Unified evidence
    ├─ Protocol V2
    └─ Desktop UI
    ↓
Phase 4 (Hardware validation)
    ↓
Phase 5 (Release)
```

---

## 5. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| WPD scanner breaks on non-Samsung devices | Medium | Medium | Test on multiple OEMs in Phase 4 |
| Ed25519 migration invalidates offline caches | High | Medium | Document migration path, coordinate with ops |
| Database migration loses data | Low | High | Test on non-production first, backup before production |
| Protocol V2 breaks backward compatibility | Medium | Medium | Version protocol, support V1 during transition |
| Multi-OEM testing reveals unexpected issues | High | Medium | Generic-core-first design, OEM adapters isolated |
| Clean-machine validation fails | Medium | High | Bundle all dependencies, test early and often |

---

## 6. Success Criteria

### Immediate (2 weeks)
- [ ] P1.5 complete (documentation consolidated)
- [ ] G6 implemented and hardware-validated
- [ ] All P0 issues fixed
- [ ] Audit documentation committed

### Medium-term (1-2 months)
- [ ] Phase 2 complete (all defects corrected)
- [ ] Phase 3 started (integration in progress)
- [ ] Evidence V2 schema frozen and implemented
- [ ] Protocol V2 frozen and implemented
- [ ] Desktop UI shows real verification workflow

### Long-term (3-6 months)
- [ ] Phase 4 complete (hardware validated across OEMs)
- [ ] Phase 5 complete (signed release on clean machine)
- [ ] Production release available
- [ ] Customer documentation generated from release

---

## 7. Communication Plan

### Weekly Updates
- Branch status (`phase2-correct` progress)
- Gate completion (G6, G7, etc.)
- Issue resolution (FSB issues closed)
- Blockers and risks

### Milestone Reviews
- Phase 2 completion review
- Phase 3 integration review
- Phase 4 hardware validation review
- Phase 5 release review

### Stakeholder Updates
- Monthly summary to product owner
- Quarterly roadmap review
- Release announcement

---

## 8. Next Actions

**This week:**
1. ✅ Create audit documentation (this document)
2. ⬜ Rewrite root README (P1.5A.2)
3. ⬜ Commit documentation to new branch
4. ⬜ Start G6 implementation

**Next week:**
5. ⬜ Complete G6 (WPD scanner)
6. ⬜ Hardware validate G6 on Samsung A10s
7. ⬜ Commit G6 to `phase2-correct`
8. ⬜ Start P0 fixes (FSB-003, FSB-009)

---

*Action plan approved for execution. Proceed with immediate priorities.*
