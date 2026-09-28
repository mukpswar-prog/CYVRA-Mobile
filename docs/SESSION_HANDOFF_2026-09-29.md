# CYVRA-Mobile — Session Handoff & Resume Anchor
Date: 2026-09-29 (end of session day). Status: P0–P5 COMPLETE. Next: P6/P7.

## 0. How to resume
1. Run the Resume Commands (section 8).
2. Paste the Resume Message (section 9) into the guide chat.
3. Feed Open Code the P6/P7 prompt (section 10). Nothing else.

## 1. Roles & workflow
- Super Guide (chat AI): decisions, reviews, writes Open Code prompts. Guide replaces ChatGPT.
- Open Code: implementer. Works ONLY in the worktree. Reports before commit. NEVER commits or pushes on its own.
- Chief Engineer (human): runs PowerShell, approves, owns hardware.
- Loop: Open Code reports -> Guide reviews -> Engineer commits with exact commands -> push.

## 2. Repo & workspace facts
- Repo: https://github.com/mukpswar-prog/CYVRA-Mobile
- Main checkout (PARKED, do not work here): C:\Users\User\Documents\GitHub\CYVRA-Mobile (branch audit-and-planning-2026-09-26)
- ENGINEERING LAB (all work happens here): C:\Users\User\Documents\GitHub\CYVRA-Mobile\.worktrees\cyvra-mobile-implementation
- Other worktrees (do not touch): CYVRA-Mobile-stage3-final-truth (2463f79), CYVRA-Mobile-wave1 (f4f253b)
- Active branch: feature/p2-protocol-completion
- Frozen audit baseline: phase2-correct == c1a43c7. NEVER move it; re-baseline only by deliberate decision at a phase exit.
- Gradle wrapper lives at apps/android\gradlew.bat (NO root wrapper, NO system gradle on this machine).
- CI: GitHub Actions; artifact = cyvra-mobile-windows-unsigned-engineering-artifact (was 116,492,609 B at c1a43c7).

## 3. Commit chain on feature/p2-protocol-completion
- c1a43c7  baseline (P1 done; forensic audit anchor)
- 883f071  fail-closed FileBasedLicenseProvider + HostBootstrap (+11 tests -> 284)
- 4ab2133  P2: 10 protocol commands in HostProtocolDispatcher (+11 tests -> 295)
- 50fe3fb  P3: HostReportStore disk persistence + SHA-256 manifests (+4 tests -> 299)
- 4612051  P4: sanitization lifecycle E2E test (+1 test -> 300)
- 383ea00  P5: Rust send_host_command bridge + 5-step React UI (Rust 43 -> 57)
- (next)   this handoff doc

## 4. Test baseline to defend
- Kotlin: core 146 + host 154 = 300, 0 failures.
- Rust: 57 tests (53 pass, 4 ignored), clippy clean.
- Frontend: tsc -b exit 0; eslint src exit 0; vite build OK.
- Known pre-existing noise (do not "fix" casually): pnpm lint fails on 5 gitignored src-tauri/target files (CI does not run lint); App.css has a duplicated selector present in HEAD.

## 5. Frozen decisions & governance (violations = stop and ask)
- D-1: sanitization execution ships as OUTCOME B (BLOCKED_NOT_IMPLEMENTED, successClaimed=false). Flips to OUTCOME A ONLY after physical device validation.
- D-2: scan target = the connected Android device, not the Windows host.
- Core domain model frozen: no new enum values. LICENSE_REQUIRED is a protocol error code only; denied licence record uses status UNKNOWN.
- Honesty: UI is a dumb terminal (renders only Host truth); raw UID withheld; stdout pure JSON (logs to stderr); JSON-lines = one command per line.
- Tests: fake ADB only, ZERO real-device calls.
- Licence: <cyvra.home>/license.json, fail-closed, BOM-tolerant (PowerShell 5.1 Set-Content -Encoding UTF8 writes EF BB BF).
- Do NOT touch isOptional preflight semantics (parked question).
- NEVER push to phase2-correct or main without an explicit re-baseline decision.
- NEVER git add -A; add explicit paths only.
- Stale-JAR trap: always run :host:installDist before any process-level Host test.

## 6. Done (P0-P5) — key artifacts
- P1: bundled jlink Java + platform-tools ADB + 6 Host JARs; --selftest gate; CI staging + installed-layout gates.
- P1.5 licence: FileBasedLicenseProvider.kt, HostBootstrap.kt, LicenseFileReason; HostMain reads licence at boot.
- P2: HostProtocolV1.kt (HostCommand 3 -> 13), HostProtocolDispatcher.kt (10 handlers, server-side session state, pre-record built server-side, refusal codes LICENSE_REQUIRED / NO_SCAN_SESSION / SANITIZE_* etc.).
- P3: HostReportStore.kt; <cyvra.home>/reports/<id>/ and /certificates/<id>/ with report.json, report.md, manifest.json; path-traversal guard; graceful REPORT_WRITE_FAILED.
- P4: HostProtocolWorkflowTest.kt sanitizationLifecycleE2E test (7-command transcript, on-disk certificate honesty assertions).
- P5: src-tauri host_process.rs (send_host_command + envelope validation + 14 tests), commands.rs, lib.rs registration; App.tsx 5-step workflow; App.css additive styling.

## 7. Outstanding (ordered)
1. P6: clean-VM installer E2E (install -> HOST CONNECTED -> cyvra.home dirs -> uninstall leaves no orphans).
2. P7: CI gate asserts artifact > 100 MB AND --selftest returns SELFTEST_OK / readyToScan=true.
3. Local visual launch of the new UI (P5 verified by build/typecheck/E2E only, never visually inspected).
4. Hardware: connect Samsung A10s; run D2.3 pool tests (D23-WPD-004..010 incl. no-content-stream proof); D-1 flip B -> A.
5. Cloud/commercial: API_ENV production flip; Neon schema hardening; Resend OTP domain cyvoriq.co.in; admin console auto-feed of registrations into licence issuance.
6. Later, bench-gated only: OEM adapters; Station V0 AI physical inspection (frozen).
7. Open engineering follow-ups: crash-atomic report writes (currently 3 sequential writeText); report paths do not resolve symlinks; licence source beyond file-drop (API fetch) deferred.

## 8. Resume commands (first thing tomorrow)
cd "C:\Users\User\Documents\GitHub\CYVRA-Mobile\.worktrees\cyvra-mobile-implementation"
git branch --show-current
git log --oneline -3
git status --short
Expect: branch feature/p2-protocol-completion; HEAD = handoff commit; clean tree (or only known strays in the PARKED checkout, never here).

## 9. Resume message to paste into the guide chat
"You are my Super Guide for CYVRA-Mobile (repo mukpswar-prog/CYVRA-Mobile). Resume from docs/SESSION_HANDOFF_2026-09-29.md in the worktree .worktrees\cyvra-mobile-implementation. State: branch feature/p2-protocol-completion; P0-P5 complete; 300 Kotlin + 57 Rust tests green; frozen baseline phase2-correct=c1a43c7 untouched. Verify my workspace with the section-8 commands, then walk me through P6/P7: give me the exact Open Code prompt (section 10), then review Open Code's report, then give exact commit/push commands."

## 10. Next Open Code prompt (P6/P7) — verbatim
Context: branch feature/p2-protocol-completion. P1-P5 complete; Kotlin Host, Rust bridge, React UI wired and tested (300 Kotlin / 57 Rust green).
Task: finalize packaging and CI (P6 & P7).
1. CI pipeline (.github/workflows): ensure the workflow compiles the P5 Rust bridge + React UI; ensure payload staging (:host:installDist, jlink Java, platform-tools ADB) happens BEFORE the Tauri build so the UI ships inside the payload; add a gate asserting the final artifact is > 100 MB and that running it with --selftest returns SELFTEST_OK with readyToScan=true.
2. Create build-local.ps1 at repo root: stages the Kotlin payload via the Gradle wrapper in apps/android, runs npm install and npm run tauri build in apps/desktop, prints the final .exe path.
3. Create docs/P6_INSTALLER_VALIDATION.md: manual clean-VM checklist (install; launch; verify HOST CONNECTED / readyToScan=true; verify <cyvra.home> report/certificate dirs; uninstall; verify no registry/AppData/Program Files orphans).
Hard constraints: do not modify frozen core models or P2-P5 logic; keep cargo test and the 300 Kotlin tests green; do not commit; report first.