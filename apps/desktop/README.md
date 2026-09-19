# CYVRA Mobile Windows Desktop

This is the customer Windows desktop shell for CYVRA Mobile.

It uses React/TypeScript for presentation and Tauri/Rust for Windows-native integration.

## Architecture

```text
React UI
    ↓ Tauri commands/events
Rust Native Layer
    ├─ Windows USB/PnP
    ├─ WPD/MTP
    └─ Kotlin Domain Engine process lifecycle
            ↓
Kotlin Domain Engine
```

## Responsibilities

### React

- operator UX;
- device selection;
- status/limitations;
- verification/sanitization workflow presentation.

### Rust/Tauri

- authoritative Windows USB observation;
- WPD/MTP COM/native APIs;
- native device correlation support;
- safe IPC surface;
- Domain Engine process lifecycle.

### Kotlin Domain Engine

- Android/ADB semantics;
- evidence interpretation;
- licensing/report/sanitization policy.

## Development

```powershell
pnpm install
pnpm build
pnpm validate:shell
pnpm tauri dev
```

Native checks:

```powershell
cd src-tauri
cargo check
cargo test
```

Build the Kotlin host distribution when the current desktop workflow requires it.

## Safety

- do not infer USB truth from ADB;
- do not expose raw device identifiers to the UI unnecessarily;
- no implicit first-device selection for chargeable/destructive actions;
- WPD verification is metadata-first;
- sanitization is separate from diagnostics.

## Formatting

During narrow native patches, avoid broad crate-root formatting that recursively rewrites unrelated modules. Review exact formatter scope before applying.

## Current maturity

Native USB observation and WPD device discovery are implemented/hardware exercised in the current D2.3 work.

WPD storage/object traversal, Evidence V2 integration, complete lifecycle UI, and release packaging remain under implementation.

See [`../../docs/CYVRA_MOBILE_PROJECT_INDEX.md`](../../docs/CYVRA_MOBILE_PROJECT_INDEX.md).
