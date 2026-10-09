# PUR-DO-WIPE force-clean sequence (TASK U)

Removes every account from a device so `dpm set-device-owner` will accept it,
and attests to how it was done.

## Why this exists

`DevicePolicyManagerService.enforceCanSetDeviceOwnerLocked` refuses enrolment
while any account is present:

```
java.lang.IllegalStateException: Not allowed to set the device owner
because there are already some accounts on the device
    at DevicePolicyManagerService.enforceCanSetDeviceOwnerLocked(:10847)
```

That check gates the governed wipe proof (TASK T), so the accounts have to go
first. On the D-P5 test device there were **10**.

## What we learned building it

Four findings that shaped the design. Each one falsified an assumption we would
otherwise have shipped on.

1. **The commissioned primitive does not exist on Android 11.**
   `adb shell cmd account remove-account <name>` returns exit 255 with no output.
   The entire `cmd account` surface there is `help` plus the two
   `bind-instant-service-allowed` flags. The tool therefore *probes* for the
   subcommand rather than calling it, so the primary path cannot fail silently
   mid-sequence - and a future build that adds it is picked up with no code
   change.

2. **Samsung hides the accounts.** One UI replaces `AccountManagerService`'s
   dump with its own `Accounts History` event table, so the AOSP-idiomatic check
   (`dumpsys account | grep "Account {"`) returns **zero** on a device that has
   ten. That is a false "clean" reading on the exact question this tool exists to
   answer. `dumpsys content` prints a plain `Accounts: <n>` header on both AOSP
   and Samsung, so that is the signal used. When the header cannot be read the
   tool returns **-1 and aborts** - it never coerces an unreadable count to 0.

3. **Uninstalling an authenticator removes its accounts, but not instantly.**
   `pm uninstall --user 0 <pkg>` is the rung that works, and it needs **no
   account names** - which is what makes it viable at all here, since 7 of the 10
   accounts are not enumerable from the host. `AccountManager` applies the
   removal asynchronously, so a count read immediately afterwards is stale and
   understates progress. The driver settles before re-reading.

4. **Device-policy-protected packages cannot be uninstalled.**
   `com.google.android.gms` is an enabled device admin, so
   `pm uninstall` returns `DELETE_FAILED_DEVICE_POLICY_MANAGER` and the Google
   accounts it owns survive. `dpm remove-active-admin` does not help: it is
   documented as only working for admins that declare `android:testOnly`, which
   GMS does not. `pm clear com.google.android.gms` succeeds but leaves the
   accounts untouched.

## The ladder

| Rung | Mechanism | Status on D-P5 |
|---|---|---|
| 1. `PRIMITIVE` | `cmd account remove-account <name>` | absent - skipped by probe |
| 2. `AUTHENTICATOR` | `pm uninstall --user 0 <pkg>`, third-party packages before platform ones | **worked**: 9 → 3 |
| 3. `HUMAN` | operator removes the remainder on-device | **required** for the 3 Google accounts |

Rung 2 stops the moment the count reaches zero, so platform packages are only
touched when third-party removal was not enough.

### Not attempted, on purpose

`pm disable-user com.google.android.gms`. Because uninstalling an authenticator
*does* drop its accounts, disabling GMS risks converting the three Google
accounts into **orphaned entries that are no longer listed in Settings but still
count** - an unfixable state replacing a fixable one. The current state (three
visible accounts, removable by hand) is strictly better.

## Files

| File | Purpose |
|---|---|
| `ForceCleanAccounts.psm1` | Parsing, ordering, redaction and attestation core. Pure - no adb, no I/O, so it is testable without a device. |
| `ForceCleanAccounts.ps1` | Driver: probes, detects, runs the ladder, gates on the operator, writes the attestation. |
| `ForceCleanAccounts.Tests.ps1` | 43 unit tests over fixture strings. No device required. |
| `attestation-latest.json` | Output of the most recent run. Identifier-free by construction. |

## Usage

```sh
# unit tests (no device)
powershell -ExecutionPolicy Bypass -File ForceCleanAccounts.Tests.ps1

# plan only, changes nothing
powershell -ExecutionPolicy Bypass -File ForceCleanAccounts.ps1 -DryRun

# run the ladder; stops at the human gate if accounts remain
powershell -ExecutionPolicy Bypass -File ForceCleanAccounts.ps1

# run without pausing (for unattended use / CI)
powershell -ExecutionPolicy Bypass -File ForceCleanAccounts.ps1 -SkipHumanGate
```

Exit codes: `0` clean · `3` still not clean (human gate outstanding) ·
`4` no/ambiguous device · `5` account count unreadable · `6` attestation
contained an identifier and was refused.

## Privacy

Account identifiers are real-device fixture content and **never egress**. The
driver holds them in memory only while it needs them, writes them nowhere, and
the attestation records counts, types, authenticator package names and outcomes.
Two explicit guards enforce this:

- `Get-IdentifierToken` reduces an address to `[type local-part-len=n]`, dropping
  the local part and the domain, so a token cannot be reversed or correlated
  across runs.
- Before writing, the driver regex-scans the serialised attestation for anything
  email-shaped and **refuses to write** (exit 6) rather than persist it.

The device serial is likewise never written.

## Relationship to the governed record

Sanitization is domain 22 of the capability matrix (`PUR-DO-WIPE`). This tool
clears a *precondition* of the wipe proof; it does not perform, verify or claim
a purge. Verification remains an unratified contract (governed §29), and no purge
claim is made here.
