# Windows Android transport architecture

**Freeze:** [ANDROID_COMPATIBILITY_FREEZE.md](./ANDROID_COMPATIBILITY_FREEZE.md)  
**Slice:** A3 (not in the A1 Kotlin commit)

## Decision

The Windows host is the architectural authority. USB is the physical connection. ADB is the primary Android communication transport **where the device and security state permit it**. Production operators must not need Android Studio, Gradle, or a random PATH `adb.exe`.

CYVRA must use a controlled, versioned Platform-Tools distribution. PATH `adb` is a diagnostic fallback only.

## Not Station

`apps/station` (CYVRA Station, Decision 5.1.20.2) stays parked.  
A3 adds **`apps/host`** (CYVRA Mobile Windows host): Kotlin JVM, depending on existing `:core`, wrapping managed ADB. No Tauri UI in A3. No Knox.

## Connection states (host-internal)

USB vs ADB are independent:

```text
USB_NOT_CONNECTED
USB_CONNECTED
ADB_UNAVAILABLE
ADB_UNAUTHORIZED
ADB_OFFLINE
ADB_READY
DEVICE_RECONNECTING
```

Recommended flow:

```text
NO_DEVICE → USB_DETECTED → ADB_DETECTED
  → ADB_UNAVAILABLE | ADB_UNAUTHORIZED → ADB_AUTHORIZED → ADB_READY
  → SCANNING → SCAN_COMPLETE
```

USB file copy is not authorization. ADB visible is not ADB authorized. Never bypass the Android USB-debugging prompt.

## Map to frozen G4 ingest

| Host-internal | G4 `usbState` / `adbState` today |
|---|---|
| no cable | `USB_DISCONNECTED` / `ADB_UNKNOWN` or `ADB_DISABLED` |
| USB/MTP only | `USB_CONNECTED_CHARGING` or `USB_CONNECTED_DATA` / `ADB_DISABLED` |
| ADB unauthorized | `USB_CONNECTED_DATA` / `ADB_VISIBLE_UNAUTHORIZED` |
| ADB ready | `USB_CONNECTED_DATA` / `ADB_AUTHORIZED` |

Do not add new enum values to live Worker ingest in A3.

## A3 responsibilities (when that slice runs)

- USB detection, ADB discovery, ADB version, device listing
- authorization / offline / disconnect / reconnect / timeouts / health
- operator copy for unlock-and-authorize
- persist operation state before a device reboot (needed later for sanitization)

No sanitization execution in A3.

## Windows baseline

Windows 10 64-bit and Windows 11 64-bit. Emulators do not prove USB drivers or real ADB.
