# OEM adapter architecture

**Freeze:** [ANDROID_COMPATIBILITY_FREEZE.md](./ANDROID_COMPATIBILITY_FREEZE.md)

## Decision

The generic Android provider is always available. Unknown OEM selects `GenericAndroidProvider` instead of failing.

Core must never depend on Samsung Knox, MIUI, or other proprietary OEM APIs unless an isolated adapter is added **after** real-hardware verification.

## Do not create empty OEM stubs

Do not add ten OEM classes that only return `UNSUPPORTED`. Implement:

1. `GenericAndroidProvider`
2. `OemCapabilityResolver`
3. `OemAdapter` interface

Create a real adapter only when a verified OEM-specific capability or behaviour requires it.

## Test families (physical lab, not compile-time claims)

Samsung; Xiaomi / Redmi / POCO; Motorola; OnePlus; OPPO / Realme; Vivo; Google Pixel; Nothing; Nokia/HMD; other/unknown.

One Samsung does not prove universal OEM support.

## Code location

Keep adapters under `apps/android/core` (and later `apps/host` using those types). Do not invent parallel `oem/` Gradle modules for unused brands.

## Implementation Status (Slices A5–A10)

- Implemented `OemAdapter` interface in `apps/android/core/src/main/kotlin/cyvra/mobile/core/CapabilityModels.kt`.
- Implemented `OemCapabilityResolver` and `DefaultOemCapabilityResolver` in `apps/android/core/src/main/kotlin/cyvra/mobile/core/EvidenceProviders.kt`.
- Implemented `StandardCapabilityAssessmentEngine` in `:core`, falling back truthfully to verified generic Android platform reset when no OEM hardware adapter exists (§9).
- Implemented `CompatibilityMatrixEvaluator` in `:core` and `HostCompatibilityValidator` in `apps/host`, classifying device profiles into verified `OemFamily` groups (`SAMSUNG`, `XIAOMI_REDMI_POCO`, `MOTOROLA`, `ONEPLUS`, `OPPO_REALME`, `VIVO`, `GOOGLE_PIXEL`, `NOTHING`, `UNKNOWN_GENERIC`).
- Unit tested in `:core:test` (`CapabilityAssessmentEngineTest`, `CompatibilityMatrixModelsTest`) and `:host:test` (`HostCapabilityCoordinatorTest`, `HostCompatibilityValidatorTest`).

