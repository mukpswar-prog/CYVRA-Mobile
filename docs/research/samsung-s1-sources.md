# Samsung / Android S1 sources (G4 research)

**Status:** research for G4 capability contract. Not Knox. Not S3.  
**Date:** 9 September 2026  
**No device in hand:** findings are from public OEM/AOSP documents. Device
confirmation is queued in [docs/testing/pool.md](../testing/pool.md).

S1 is a normal Android app: least privilege, no root, no Knox SDK, no
OEM-authoritative identity (GUIDELINE §8.2). The contract is **feature-flag
driven**. `Build.MODEL` is recorded as a fact. It is never a `switch` that
unlocks tests.

## What S1 may read (public Android APIs)

| Fact | API | Notes |
|---|---|---|
| Manufacturer / brand / model / fingerprint | `android.os.Build` | Public. Samsung devices typically report `Build.MANUFACTURER = "samsung"`. |
| Android release / SDK | `Build.VERSION` | Public. |
| App-scoped Android ID | `Settings.Secure.ANDROID_ID` | Resettable, signing-key scoped. **Not** IMEI. |
| Form factor | `Configuration.smallestScreenWidthDp` | Tablets are commonly ≥ 600 dp. Feature-based, not a second product. |
| Feature flags | `PackageManager.hasSystemFeature` | Source of capability. CDD: telephony is optional on tablets. |
| Camera ids | `CameraManager.getCameraIdList` | Some Camera2 characteristics need `CAMERA` on Android 10+. |
| Sensors | `SensorManager.getSensorList` / `getDefaultSensor` | **Declare ≠ detect.** Samsung devices have reported `FEATURE_SENSOR_STEP_COUNTER == true` while `getDefaultSensor` is null. |
| Battery **status** | `BatteryManager` / `ACTION_BATTERY_CHANGED` | Level, scale, plugged, `EXTRA_HEALTH` (GOOD/OVERHEAT/…). This is **not** state-of-health. |
| Storage | `StatFs` / `StorageStatsManager` | Public. |
| Wi-Fi / BT presence | feature flags + connection APIs | Classify. Do not enable/disable Wi-Fi (`setWifiEnabled` is a no-op for apps targeting API 29+). |
| Lock **presence** | `KeyguardManager.isDeviceSecure` / `isKeyguardLocked` | Detect only. Forgotten PIN ≠ authority. |
| USB / ADB settings | `UsbManager`, `Settings.Global.ADB_ENABLED` | USB ≠ authorization. ADB visible ≠ ADB authorized. |

Official references:

- [Build](https://developer.android.com/reference/android/os/Build)
- [PackageManager features](https://developer.android.com/reference/android/content/pm/PackageManager)
- [Android 14 CDD](https://source.android.com/docs/compatibility/14/android-14-cdd) (telephony optional for tablets)
- [Android 10 privacy changes](https://developer.android.com/about/versions/10/privacy/changes)
- [BatteryManager](https://developer.android.com/reference/android/os/BatteryManager)

## What S1 must not claim (documented, not guessed)

### IMEI / hardware serial

Android 10+ protects IMEI, MEID, IMSI, SIM serial, and `Build.getSerial()`
behind `READ_PRIVILEGED_PHONE_STATE`. Third-party Play apps cannot hold that
permission. Samsung’s own docs say the same: unique identifiers on Knox
devices from Android 10 need **Knox Configure** (`DeviceInventory.getKnoxServiceId`)
or **Knox Manage Open API**, not a consumer app.

- https://developer.android.com/about/versions/10/privacy/changes
- https://source.android.com/docs/core/connect/device-identifiers
- https://docs.samsungknox.com/dev/knox-sdk/kbas/how-to-get-the-unique-identifier-for-devices-running-android-10-q-os-using-knox-configure/
- https://docs.samsungknox.com/admin/knox-manage/kbas/kba-900-how-to-find-device-imei-and-serial-number-with-knox-manage-open-api/

G4 encoding: test `IDN.IMEI_SERIAL` is `s1ForbiddenPass`. Planned result
`NOT_AVAILABLE` / limitation `LAYER_FORBIDDEN`. Never FAIL.

### Battery state of health

Public `BatteryManager` exposes `BATTERY_PROPERTY_CAPACITY` (charge %) and
`EXTRA_HEALTH` (immediate health enum). `BATTERY_PROPERTY_STATE_OF_HEALTH` exists
in AOSP behind `FLAG_STATE_OF_HEALTH_PUBLIC` and is **not** a third-party S1
API. Samsung publishes battery SOH through **Knox Asset Intelligence**
`POST /devices/getDevices` (`batterySoh`: Good / Normal / Weak / Bad) — S3.

- https://developer.android.com/reference/android/os/BatteryManager
- https://android.googlesource.com/platform/frameworks/base.git/+/master/core/java/android/os/BatteryManager.java
- https://docs.samsungknox.com/dev/knox-asset-intelligence/tutorials/manage-devices/
- https://docs.samsungknox.com/dev/knox-asset-intelligence/release-notes/25-01/

G4 encoding: `PWR.BATTERY_STATUS` is S1. `PWR.BATTERY_SOH` is forbidden on S1.

### Knox

Knox SDK (`EnterpriseDeviceManager.getAPILevel`, attestation, inventory) is S3.
From Android 15 / Knox 3.11, many methods require Device Owner or Profile Owner.
A consumer S1 app must not claim Samsung-authorized, Knox-attested, or
warranty-bit root detection as a CYVRA result.

- https://docs.samsungknox.com/dev/knox-sdk/api-reference/restricted-api-methods/
- https://docs.samsungknox.com/devref/knox-sdk/reference/com/samsung/android/knox/EnterpriseDeviceManager.html

G4 encoding: `SEC.KNOX_CLAIM` is `s1ForbiddenPass`.

## Discovery order (locked in code)

Detect → classify access (L0–L4) → discover capabilities from feature flags →
policy filter → permitted ops → evidence plan → record limitations.

USB state and ADB state are **independent** fields on the capability profile.

Declare / detect / tested stay three different facts on each feature.

## When a Samsung phone arrives

Do not expand the contract with `if (model === …)`. Confirm:

1. `Build.MANUFACTURER` / `MODEL` / `FINGERPRINT` snapshot
2. `hasSystemFeature` vs `getDefaultSensor` disagreements (record both)
3. Camera permission gating on Camera2 characteristics
4. Tablet SKU: `FEATURE_TELEPHONY` false → `NET.CELLULAR` = `NOT_SUPPORTED`

Step-by-step device procedures live in the test pool, not in this file.
