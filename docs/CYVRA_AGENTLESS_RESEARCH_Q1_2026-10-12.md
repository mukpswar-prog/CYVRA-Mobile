# Agent-less research — Question 1 · Can data be gathered with no agent installed?

**Status:** measured, not modelled · **Date:** 12-Oct-2026
**Authority:** Chief Engineer approval, 12-Oct-2026 · **Governing rule:** ledger **H8**
**Device class measured:** one Samsung, Android 11 (API 30), bootloader **locked**, SELinux
**Enforcing**, `adb` identity `uid=2000(shell)` — **not root**.

> **H8 applied.** Where the agent-less route is weaker than the agent route, it is stated
> in those words below. No finding here may be quoted as favourable without the
> measurement that produced it.

---

## 1. Why this measurement was trustworthy

The evidence application (`co.in.cyvra.mobile`) had been **uninstalled** before this ran.
The only CYVRA package still present was the sanitization proof-of-concept, which declares
**no permissions and no network code**. So every result below was obtained with **no CYVRA
evidence software on the device at all**.

**Method correction, recorded honestly.** The first pass used a regex classifier that
produced **false positives**. It scored `ls /data/data` and `cat /data/system/packages.xml`
as returning data when both are in fact refused, and it scored contact/SMS/media queries as
"real data" because the pattern `Rows: [0-9]+` also matches `Rows: 0` — an *empty* result.
A second pass re-inspected every sensitive probe structurally, counting row objects and
matching refusal text instead. **Only the corrected figures are reported.** The raw first
pass is not cited anywhere.

---

## 2. Result — 63 of 69 probes returned data

| Class | Result with no agent installed |
|---|---|
| **Applications** | **363 packages** enumerated with UID, system/third-party split (323 / 40), enabled/disabled (361 / 2), install path, and installing source. |
| **Hardware** | CPU info, memory, partitions, storage volumes, disk stats, battery state and health, display size and density, **sensor service**, camera service, thermal zones, network interfaces, telephony state. |
| **Identity & build** | Build fingerprint, API level, hardware/chipset, board platform, manufacturer, model. |
| **Security state** | Verified-boot state, **bootloader lock state**, `ro.debuggable`, `ro.secure`, SELinux mode, device-policy/owner state, screen-lock state. |
| **Usage history** | Usage-stats service returned **tens of thousands of lines** of per-application usage records. |
| **Device identifiers** | A 16-character Android ID was returned. The hardware serial was returned by `getprop` (11 characters). |

### Correctly refused — the boundaries are real

| Probe | Result |
|---|---|
| `ls /data/data` | **Refused** — "Permission denied", zero directory entries. |
| `cat /data/system/packages.xml` | **Refused.** |
| `su -c id` | **Refused** — no root present. |
| Call log | **Refused.** |

This matters: the earlier false positives on `/data/data` and `packages.xml` were artefacts
of my own classifier, **not** evidence of elevated access. The device's boundaries held.

---

## 3. Where the agent-less route is STRONGER

1. **Complete application inventory.** ADB enumerates **every** package. An installed
   application on Android 11+ is subject to package-visibility filtering and sees only a
   subset — our own evidence app declares no `QUERY_ALL_PACKAGES`, so it would see fewer
   apps than ADB does.
2. **No installation required.** Nothing is written to the device, so there is nothing to
   remove afterwards — and therefore no permanent-residue risk of the kind demonstrated on
   the bench phone, where a non-test device owner could not be removed by any command.
3. **Full hardware reach**, including sysfs nodes and service dumps an ordinary application
   cannot read.
4. **Security posture is measurable** — bootloader lock and verified-boot state are
   obtainable, which is central to a resale-grade condition report.

---

## 4. Where the agent-less route is WEAKER — required by H8

1. **It requires a human authorisation tap.** USB debugging must be enabled and the host
   computer authorised on the device screen. An on-device agent could operate over the
   network with no physical session at all. **Agent-less is not superior when USB
   authorisation is unavailable.**
2. **It exposes the previous owner's personal data to the operator's workstation.**
   Measured: the contacts database returned **294 row objects** and the media store returned
   **288 file entries**, with no permission refusal. An on-device agent could process such
   data locally without ever egressing it to a PC. **This is a genuine privacy advantage of
   the agent route, and it is the single strongest counter-argument to the agent-less
   direction.** It is stated here because H8 requires it, not because it is convenient.
3. **OEM dependence is unmeasured.** Only one Samsung device on Android 11 was probed.
   Shell privileges vary by OEM and Android version. **No claim is made about any other
   device.**
4. **Some probes were inconclusive and are recorded as such.** The IMEI/subinfo call
   returned a parcel whose contents were not decoded, and the SMS query returned neither row
   objects nor a refusal. **Neither is claimed as a capability.**

---

## 5. Consequence for the product — the part that needs a lawyer

Reading a third-party device's contacts and media over USB is simultaneously:

- **the strongest available proof** that a purge succeeded — you can demonstrate the data
  is gone by showing it cannot be read afterwards; and
- **a data-protection exposure** while such a device is in the operator's possession.

This is a legal question, not an engineering one, and **no engineering conclusion in this
report should be read as legal advice or as permission to read personal data.** The
technical capability is recorded so the Chief Engineer can take it to counsel with the
facts in hand.

---

## 6. What is deliberately NOT claimed

- Not proven on any device other than one Samsung Android 11 unit.
- No erase or purge capability was tested — that is **Question 2**, still open.
- No verification contract exists; reading data is not the same as certifying a purge.
- Unit measurement is **not** product support. Real proof remains the installed-workstation
  verification.

---

## 7. Next

- **Question 2** — can data be erased without a factory reset, with no agent installed.
- **Question 3** — map which devices support the gentle method, and confirm the automated
  one-command factory reset as the fallback tier.

Reproduce every figure above from the commands recorded in this report. Raw device dumps
were **never written to the repository**; no serial, account name, contact or phone number
appears in this file.
