# CYVRA Mobile Testing

This folder contains the living acceptance pool and hardware-test records.

Primary engineering matrix: [`../TEST_MATRIX.md`](../TEST_MATRIX.md).

## Test layers

```text
unit
component
protocol/integration
UI integration
physical hardware
clean-machine release
```

Do not promote a result from one layer into another.

## Current high-value commands

```text
pnpm typecheck
pnpm build
pnpm test:evidence
pnpm test:api-origins
```

Android/domain:

```text
apps\android\gradlew.bat :core:test :host:test
```

Desktop/native:

```text
pnpm build
pnpm validate:shell
cargo check
cargo test
```

Hardware results live in [`pool.md`](./pool.md).

## Rules

- no PASS from documentation alone;
- one handset does not prove an OEM family;
- ADB is not required for every WPD path;
- destructive sanitization requires a separate qualification matrix;
- record exact Windows/device/Android/build context for hardware proof.
