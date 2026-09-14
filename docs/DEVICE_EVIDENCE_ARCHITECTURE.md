# Device evidence architecture

**Freeze:** [ANDROID_COMPATIBILITY_FREEZE.md](./ANDROID_COMPATIBILITY_FREEZE.md)  
**Code home:** existing JVM module `apps/android/core` — do not create a duplicate evidence Gradle project.

## Decision

Evidence is collected through independent collectors. One collector failure must not crash the scan. Every important field records **source** and **status**. Accurate limitation is better than false success.

## Existing types to extend (do not replace)

| File | Role |
|---|---|
| `apps/android/core/src/main/kotlin/cyvra/mobile/core/Models.kt` | `CapabilityProfile`, `EvidenceRecord` |
| `Collect.kt` / `Plan.kt` / `Honesty.kt` | S1 plan → honest records |
| `S1Collectors.kt` | IMEI / battery SOH / Knox stay `NOT_AVAILABLE` |
| `Ingest.kt` | G4 ingest envelope for `POST /evidence/batches` |
| `packages/evidence` | Frozen wire schema |

## Interfaces (A4, conceptual names)

Place in `cyvra.mobile.core` (same package as today):

- `DeviceEvidenceProvider`
- `DeviceCapabilityProvider`
- `GenericAndroidProvider`
- `OemCapabilityResolver`

Collectors: identity, software, hardware, storage, memory, battery, security, network, application, capability.

Conceptual result:

```text
value, status, source, reason, timestamp
```

Statuses: `AVAILABLE`, `NOT_AVAILABLE`, `RESTRICTED`, `PERMISSION_REQUIRED`, `UNSUPPORTED_API`, `OEM_UNSUPPORTED`, `ERROR`.

Sources (host-internal): `ADB`, `ANDROID_PLATFORM`, `ANDROID_COMPONENT`, `OEM_ADAPTER`, `WINDOWS_USB`, `SERVER`.

At ingest, map onto G4 `S1_APPLICATION` / `S2_AUTHORIZED_ADB` until the API freeze lifts.

## Identifier hierarchy

Manufacturer, brand, model, device, product, Android version, API level, build ID, security patch, platform identifier where permitted, CYVRA session UUID.

IMEI and serial: report only when legitimately available. Never invent `000000000000000`.

## Storage and permissions

Do not design around unrestricted `/data`. Use app-private storage on the APK. The Windows host holds the authoritative service-session evidence. Permissions are minimal, version-aware, and return `PERMISSION_REQUIRED` instead of crashing or fabricating.

API 26+ guards are mandatory after A2 lowers minSdk. `BLUETOOTH_CONNECT` (API 31) and `NEARBY_WIFI_DEVICES` (API 33) are not universal.

## Implementation status

Implemented in `:core` and `apps/host` (slice A4):
- `EvidenceModels.kt`: `EvidenceStatus`, `EvidenceFieldResult<T>`, `DeviceIdentifierRecord`, `DeviceIdentityEvidence`, `BatteryEvidence`, `StorageEvidence`, `SecurityEvidence`, `GenericDeviceEvidence`.
- `EvidenceProviders.kt`: `DeviceEvidenceProvider`, `DeviceCapabilityProvider`, `OemCapabilityResolver`, `DefaultOemCapabilityResolver`.
- `AdbGenericEvidenceProvider.kt` (in `apps/host`): Independent collectors for identity, battery, storage, and security. Source is explicitly labelled (`ADB`).
- Non-fabrication enforced: Hardware serial and IMEI return `RESTRICTED` status; no dummy values.
- Scoped storage limitation recorded; no unrestricted filesystem crawling (§22).
- Unit test coverage in `EvidenceModelsTest.kt` (`:core`) and `AdbGenericEvidenceProviderTest.kt` (`apps/host`).
