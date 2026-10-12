# Remote factory reset — measured proof (2026-10-12)

**Status:** executed on a real device, by explicit commission.
**Scope:** the two-tier purge capability — erase all applications, and perform a
remote factory reset, with nothing installed by us on the target beyond the
sacrificial proof artifact.

This record contains no device identifier, no account name, no contact name, no
phone number and no fixture content. Counts only.

---

## 1. What was commissioned

The Chief Engineer asked for a test of remote factory-reset capability, to be run
against the bench phone, as the final proof that CYVRA can delete all applications
and additionally perform a remote factory reset. The operation is destructive and
irreversible; it was approved in writing with the consequences stated before it
was run (standing hold H1 permits a destructive device operation only as an
explicitly commissioned sequence).

---

## 2. Method

The wipe was triggered by the proof-of-concept in `apps/android/sanitization-agent`
acting as Device Owner, via one command:

```sh
adb shell am broadcast -n com.cyvra.sanitization/.SanitizationBroadcastReceiver \
                       -p com.cyvra.sanitization \
                       -a com.cyvra.sanitization.WIPE
```

The receiver calls `DevicePolicyManager.wipeData(0)`. Flag `0` means the internal
storage is erased; removable media is not touched and bootloader state is not
altered.

Two defects were found and corrected before the wipe would fire. Both are recorded
in §4 because both are still present in our own documentation as of this morning.

---

## 3. Result

### 3.1 Erasure table

| Metric | Before | After |
|---|---:|---:|
| Total installed packages | 363 | 333 |
| Third-party (non-system) packages | 40 | 4 |
| CYVRA packages present | 2 | 0 |
| CYVRA Device Owner references | 4 | 0 |
| Contact rows | 294 | 1 |
| Media rows | 288 | 20 |
| Accounts | 1 | 0 |

The single remaining contact row and the 20 remaining media rows are the stock
entries the operating system recreates on every fresh boot (an OEM helpline entry
and the default `Music`/`Ringtones`/`DCIM`-class folder records). They are not
surviving user data.

The 4 remaining third-party packages are not survivors either: their
`firstInstallTime` is **+222 s, +236 s, +258 s and +267 s after the reset boot**.
They were installed by the device's own provisioning after the wipe, not carried
across it.

### 3.2 The independent confirmation

The device's own bootloader records why its current session started:

```
ro.boot.bootreason = reboot,factory_reset
```

Boot time is pinned to **11:41:24** from `/proc/uptime`, which is monotonic and
cannot be skewed by a clock change, and is consistent across three readings taken
at different wall-clock times.

### 3.3 Why the Device Owner row is the decisive line

The `CYVRA Device Owner references: 4 → 0` line is the proof that does not depend
on counting anything. Earlier the same morning, five separate removal methods were
attempted against that Device Owner and **all five refused** (§4.2). The only
remaining removal path was a factory reset. It is now gone. Therefore a factory
reset occurred — this follows from a measured negative result, not from an
inference about what a wipe should look like.

---

## 4. Defects found by running it

### 4.1 The documented wipe command does not work on Android 8.0+

The README instructed:

```sh
adb shell am broadcast -a com.cyvra.sanitization.WIPE   # IMPLICIT — does not deliver
```

This is an implicit broadcast. Android 8.0 (API 26) stopped delivering implicit
broadcasts to manifest-declared receivers of background apps. The command prints
`Broadcast completed: result=0`, which reads exactly like success, while Android
logs:

```
W BroadcastQueue: Background execution not allowed: receiving Intent
  { act=com.cyvra.sanitization.WIPE } to .SanitizationBroadcastReceiver
```

The receiver never ran. Two attempts were spent before the log line was found.
**Fixed:** the README now names the component with `-n` (and the package with
`-p`), and explains why.

This matters beyond this module: any capability whose only trigger is an implicit
broadcast is silently inoperative on modern Android, and reports success while
doing nothing.

### 4.2 `android:testOnly` is a precondition, not a repair

A build was produced declaring `android:testOnly="true"`, installed over the
existing Device Owner, and confirmed present via `dumpsys` (`TEST_ONLY` set).
Every removal method was then retried:

| Method | Result |
|---|---|
| `pm uninstall` | `DELETE_FAILED_DEVICE_POLICY_MANAGER` |
| `pm uninstall --user 0` | `DELETE_FAILED_DEVICE_POLICY_MANAGER` |
| `pm disable-user` | `Cannot disable a protected package` |
| `pm clear` | `Cannot clear data for a protected package` |
| `dpm remove-active-admin` | `Attempt to remove non-test admin` |

All five refused. The system stores the test-only answer **at grant time** and
never re-reads it, so retrofitting the flag onto an existing grant accomplishes
nothing. The flag must be present *before* `dpm set-device-owner` runs.

**Fixed:** `AndroidManifest.xml` now declares `android:testOnly="true"` with a
comment recording the measured failure, so the next grant is releasable and this
device never again needs a wipe merely to remove our own software.

---

## 5. Weaknesses — stated plainly (hold H8)

1. **One device.** Android 11, one OEM, one model. Support across other Android
   versions and OEMs is **not** established by this test. That mapping is a
   separate, not-yet-run piece of work.
2. **Not agent-less.** This proof used an installed sacrificial artifact holding
   Device Owner rights. It does **not** demonstrate purging a device on which
   nothing of ours is installed. The agent-less erase question (Q2/Q3) remains
   open and untested.
3. **Purge verified, verification not.** The erasure is confirmed. A ratified
   *verification contract* — what it means to attest that a purge happened — is
   still unratified under governed §29, and the capability matrix row
   `PUR-DO-WIPE` is not being changed by this record.
4. **Two observations not explained by me.** After the wipe the device reported
   `adb_enabled=1`, `development_settings_enabled=1`, `user_setup_complete=1` and
   the launcher in front — a state a factory reset does not produce by itself,
   because developer options are normally off afterwards. The device was not in
   my custody between the reset and these readings, so I cannot say who completed
   setup or re-enabled debugging, and I did not do it. The readings are reported
   as observed rather than used as evidence.
5. **Human step not yet exercised at scale.** The wipe ran against one device
   under direct supervision. Whether the human step (unlock, diagnostic mode,
   USB diagnostic option) holds up at 50 devices per batch is untested.

---

## 6. What this proves and what it does not

**Proves:** one command over ADB, against a real device, erased every application
and all user data, including software that no command could otherwise remove, and
the device's own bootloader corroborates the reset.

**Does not prove:** agent-less purging, cross-device support, or an attested
verification contract. Those remain open, and are recorded as open here rather
than allowed to be read as covered.
