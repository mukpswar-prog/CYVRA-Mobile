# Compatibility test matrix

**Freeze:** [ANDROID_COMPATIBILITY_FREEZE.md](./ANDROID_COMPATIBILITY_FREEZE.md)  
**Do not claim support from compilation alone.**

## Capability levels (not a single compatible flag)

| Level | Meaning |
|---|---|
| A | Launch / connect |
| B | Generic evidence |
| C | Extended evidence |
| D | Sanitization capability assessment |
| E | Sanitization execution |
| F | Verification |

A device may be A PASS, B PASS, C PARTIAL, E UNSUPPORTED. That is more truthful than DEVICE = FAILED.

## Android OS (physical validation target)

Android 8 / API 26 through Android 16 / API 36, including 12L.

APK minSdk 26 covers install of the supporting component. Host service of older devices is a separate matrix row.

## OEM (physical)

Samsung; Xiaomi/Redmi/POCO; Motorola; OnePlus; OPPO/Realme; Vivo; Pixel; Nothing; unknown OEM (must use generic provider).

First lab set: one device from each of Samsung, Xiaomi-family, Motorola, OnePlus, OPPO/Realme/Vivo, Pixel — across multiple Android generations.

## Windows

Windows 10 64-bit and Windows 11 64-bit. Managed ADB, USB detect, authorization, offline, disconnect, reconnect.

## G5 stages (revised)

| Stage | Meaning |
|---|---|
| G5-A | Windows + USB + ADB + Samsung |
| G5-B | Windows + ADB + generic Android evidence |
| G5-C | Additional OEM |
| G5-D | Older and current Android |

Sanitization **execution** stays non-destructive until G5-A/B pass.

## Emulator policy

Useful: UI, lifecycle, permissions, API/storage behaviour, reports, failure handling.  
Not a substitute: OEM firmware, physical storage, USB drivers, real ADB, hardware identifiers, factory reset, sanitization verification.

## Automated (no phone)

`cd apps/android && ./gradlew :core:test`  
Existing `G5CoreTest`. Host transport tests with a fake ADB come in A3.

## Existing pool

Living G0–G7 rows remain in [testing/pool.md](./testing/pool.md). This file is the multi-OEM / USB-ADB matrix the freeze adds.
