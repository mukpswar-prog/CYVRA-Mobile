# Customer Update & Upgrade Architecture

**Status:** ACTIVE CONTRACT
**Date:** 2026-09-19

## Separate concepts

### Software UPDATE

Changes installed CYVRA software.

Must eventually cover:

```text
desktop UI
Rust/Tauri native layer
Kotlin Domain Engine/runtime
controlled ADB/platform tools where bundled
schemas/rules compatible with release
```

### Commercial UPGRADE

Changes entitlement/plan.

It does not replace application binaries by itself.

## Update trust

A production update mechanism must verify:

- release identity/version;
- signed installer/update artifact;
- integrity/checksum;
- supported upgrade path;
- failure/rollback behavior;
- compatibility of bundled components.

A SHA-256 checksum alone is not a publisher signature.

## Current maturity

The final updater/installer mechanism is not release-validated yet.

Do not publish exact future version strings or claim background/delta update behavior until implemented and tested.

## Customer behavior

The UI may show:

```text
Current version
Update available
Release notes
Update action
Restart required
```

but it must not silently start a destructive device workflow during software update.

## Entitlement upgrade

Commercial upgrade occurs through an authenticated server/web process.

The desktop:

- does not collect raw card data;
- refreshes server-authoritative entitlement;
- preserves historical transactions;
- does not reset consumed scans when an entitlement revision changes.

## Clean-machine release

Every updater/installer release requires Windows 10/11 clean-machine acceptance and signing verification before `RELEASE-VALIDATED`.
