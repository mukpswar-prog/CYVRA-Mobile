# CYVRA Sanitization Agent — PROOF OF CONCEPT

> ## **PROOF OF CONCEPT — NOT FOR PRODUCTION**
>
> This module exists for one purpose: to produce an APK that an operator can make
> device owner with `dpm set-device-owner`, so that the wipe path can be proved
> end to end on a test device.
>
> **Do not install it on a production device. Do not publish it. Do not reuse any
> part of it as a sanitization implementation.**

## What it is

A deliberately minimal Android application that:

- registers a device-admin component declaring exactly one policy: `wipe-data`;
- exposes a broadcast receiver that turns `com.cyvra.sanitization.WIPE` into
  `DevicePolicyManager.wipeData(0)`;
- shows three lines of text and nothing else.

`applicationId` is `com.cyvra.sanitization`, `minSdk` 26, `targetSdk` 36. It has
**no runtime dependencies**, declares **no permissions at all**, and **no network
code at all**.

## What it deliberately does not do

| Not present | Why |
|---|---|
| Buttons | The wipe must not be reachable by a mis-tap. It is driven from the operator's shell only. |
| `INTERNET` permission | The module cannot make a network call; the permission is not declared. |
| Storage access | Nothing is read or written. The agent has no evidence of its own to keep. |
| Release signing config | A release build assembles unsigned and cannot be installed. Only debug builds carry the debug keystore. |
| Verification | This APK performs a purge. It does **not** verify one. Verification is a separate, unratified contract (governed §29). |

## How the proof is run (human in the loop)

These steps are **not** performed by the build or by CI. They are run by an operator
against a dedicated test device, and the device is consumed by the last step.

```sh
# 1. Install the debug build on a test device that has no account and no screen lock.
adb install -r sanitization-agent-debug.apk

# 2. Make it device owner (the component below must be the only admin on the device).
adb shell dpm set-device-owner com.cyvra.sanitization/.SanitizationAdmin

# 3. Trigger the wipe. The component MUST be named explicitly (-n), and the
#    package MUST be named with -p.
adb shell am broadcast -n com.cyvra.sanitization/.SanitizationBroadcastReceiver \
                       -p com.cyvra.sanitization \
                       -a com.cyvra.sanitization.WIPE
```

**Why step 3 names the receiver.** A bare `am broadcast -a <action>` is an *implicit*
broadcast, and Android 8.0 (API 26) stopped delivering implicit broadcasts to
manifest-declared receivers of background apps. On such a device the command prints
`Broadcast completed: result=0`, which reads as success, while Android logs
`BroadcastQueue: Background execution not allowed` and **the receiver never runs**.
That failure mode was observed on an Android 11 test device: the command reported
success, nothing happened, and the first diagnosis was that the wipe itself was
broken. Naming the component makes the broadcast explicit, which is still delivered.

Step 3 factory-resets the device, including internal storage, and erases this APK
with everything else. Removable media is not touched and bootloader state is not
altered, because the agent passes `0` as the wipe flags.

## Security posture & Cryptographic Gating

The sanitization receiver is guarded by a two-step cryptographic protocol with single-use token semantics (CYVRA-POL-AGENT-01 §4.2):

1. **`ARM` Action (`com.cyvra.sanitization.ARM`):**
   * Requires a high-entropy 256-bit token passed via `wipeToken`.
   * Cryptographically bound to `sessionUuid`, `targetSerial`, and `operationId`.
   * Enforces a strict 60-second Time-to-Live (TTL).
2. **`WIPE` Action (`com.cyvra.sanitization.WIPE`):**
   * Must present the matching `wipeToken`, `sessionUuid`, and `targetSerial` within the 60-second window.
   * State transitions and execution occur inside a synchronized block (`stateLock`).
   * The active token is immediately invalidated prior to invoking `DevicePolicyManager.wipeData(0)`, preventing replay attacks or unauthorized reset triggers.
3. **`DISARM` Action (`com.cyvra.sanitization.DISARM`):**
   * Explicitly disarms the agent and clears any active token immediately upon request.

Unauthenticated or mismatched broadcasts are rejected and logged with specific failure codes (`REJECTED_NOT_ARMED`, `REJECTED_TOKEN_MISMATCH`, `REJECTED_SERIAL_MISMATCH`, `REJECTED_TOKEN_EXPIRED`).

## Relationship to the governed record

Sanitization is domain 22 of the capability matrix (`PUR-DO-WIPE`), recorded
`CONDITIONAL` with result `NOT TESTED`, because no wipe probe was permitted in the
fixture task. This module is the first step toward changing that result honestly;
until the proof is executed and its verification contract is ratified, the matrix
row stays `NOT TESTED` and no purge claim is made (governed §29).

## Layout

```
sanitization-agent/
├── build.gradle.kts
└── src/
    ├── main/
    │   ├── AndroidManifest.xml
    │   ├── kotlin/com/cyvra/sanitization/
    │   │   ├── MainActivity.kt
    │   │   ├── SanitizationAdmin.kt
    │   │   └── SanitizationBroadcastReceiver.kt
    │   └── res/xml/device_admin.xml
    └── test/kotlin/com/cyvra/sanitization/
        └── SanitizationBroadcastReceiverTest.kt
```
