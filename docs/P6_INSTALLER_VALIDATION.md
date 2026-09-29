# P6 Installer Validation — clean Windows VM

**Phase:** P6 (real installer) / P7 (CI produces the real artifact)
**Status:** validation procedure. This document describes what an engineer must
do and what must be observed. It does **not** record a completed validation:
until the checklist below has been executed on a clean VM and its evidence
attached, the P6/P7 exit gates are **open**, not met.

**Artifact policy:** everything produced by this repository is an
**UNSIGNED ENGINEERING ARTIFACT**. There is no code-signing infrastructure. Do
not present it as a signed or commercial release.

---

## 0. What you need

| Item | Notes |
| --- | --- |
| A clean Windows 10/11 64-bit VM | Snapshot it before you start. "Clean" means: no JDK, no Android SDK, no ADB on `PATH`, no source checkout. The point is to prove the installer carries everything. |
| The NSIS installer `CYVRA Mobile_<version>_x64-setup.exe` | Primary artifact (~53 MB). |
| The MSI `CYVRA Mobile_<version>_x64_en-US.msi` | Optional second package; validates the per-machine path. |
| The executable `cyvra-mobile-desktop.exe` | Needed for the `--selftest` check in step 2. |
| An Android device (optional) | Not required for steps 1, 2 or 4. Required only if you also want to walk the scan/report flow in step 3. |
| Network access on the VM | The installer downloads the WebView2 runtime if it is missing (`webviewInstallMode: downloadBootstrapper`, silent). |

Get the artifacts from the GitHub Actions run of
`.github/workflows/windows-engineering-build.yml`
(`cyvra-mobile-windows-unsigned-engineering-artifact`), or build them locally
with `build-local.ps1` from the repository root.

---

## 1. Install the `.exe`

1. Copy the installer into the VM (Downloads is fine).
2. Double-click `CYVRA Mobile_<version>_x64-setup.exe`.
   * **Expected:** Windows SmartScreen shows "Windows protected your PC".
     This is correct and must be recorded, not worked around silently:
     the binary is unsigned. Choose **More info → Run anyway** and note in the
     evidence that the warning appeared.
   * The NSIS package is built with `installMode: currentUser`, so **no
     Administrator prompt** is expected for the per-user install.
3. Finish the wizard.

### 1a. Verify what was installed

Open PowerShell **on the VM** and resolve the install location (the ARP value
is quoted, hence the `Trim('"')`):

```powershell
$arp = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
       Where-Object { $_.DisplayName -eq 'CYVRA Mobile' }
$install = $arp.InstallLocation.Trim('"')
$install
```

Expected result (per-user NSIS install):

```text
DisplayName      : CYVRA Mobile
DisplayVersion   : 0.1.0
Publisher        : Cyvoriq Solutions Pvt. Ltd.
InstallLocation  : "C:\Users\<you>\AppData\Local\CYVRA Mobile"
UninstallString  : "C:\Users\<you>\AppData\Local\CYVRA Mobile\uninstall.exe"
EstimatedSize    : <KB>
```

Then confirm the layout:

```powershell
Get-ChildItem $install -Force
Get-ChildItem (Join-Path $install 'resources') -Force
```

| Must exist | Meaning |
| --- | --- |
| `cyvra-mobile-desktop.exe` | The application. |
| `uninstall.exe` | The NSIS uninstaller (also the ARP entry). |
| `resources\host\lib\*.jar` | `:host:installDist` Kotlin Host distribution. |
| `resources\runtime\bin\java.exe` | The jlink Java runtime — **no system JDK is used**. |
| `resources\platform-tools\adb.exe` | Bundled ADB — **no Android SDK is used**. |

Shortcuts:

```powershell
Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\CYVRA Mobile.lnk"   # Start Menu
Test-Path "$env:USERPROFILE\Desktop\CYVRA Mobile.lnk"                              # Desktop
```

Both must be `True`.

**If you installed the MSI instead:** it is a per-machine package, so expect an
elevation prompt and a location under `C:\Program Files\CYVRA Mobile` with the
uninstall key under
`HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\`. Always read the
real directory from `InstallLocation` rather than assuming it.

**Failure conditions for step 1**

* Any of `resources\host\lib`, `resources\runtime\bin\java.exe` or
  `resources\platform-tools\adb.exe` is missing.
* An error message contains an absolute path from the build machine
  (e.g. `D:\a\CYVRA-Mobile\...`, `C:\Users\<builder>\...`,
  `CARGO_MANIFEST_DIR`). That is the P1 regression and it fails the gate.
* Installation required a JDK or Android SDK to be pre-installed.

---

## 2. Launch and verify `HOST CONNECTED` / `readyToScan=true`

### 2a. Command-line gate (deterministic)

The executable accepts `--selftest`, boots the bundled Host from the installed
layout and performs one protocol round-trip. It is a windowed binary, so
redirect its output to files:

```powershell
$out = Join-Path $env:TEMP 'cyvra-selftest.out'
$err = Join-Path $env:TEMP 'cyvra-selftest.err'

# Optional but recommended: hide the build machine from the runtime.
Remove-Item Env:JAVA_HOME  -ErrorAction SilentlyContinue
Remove-Item Env:CYVRA_HOME -ErrorAction SilentlyContinue

$p = Start-Process -FilePath (Join-Path $install 'cyvra-mobile-desktop.exe') `
       -ArgumentList '--selftest' -Wait -PassThru -NoNewWindow `
       -RedirectStandardOutput $out -RedirectStandardError $err

Get-Content $out, $err
$p.ExitCode
```

**Required output** (single line, exit code `0`):

```text
SELFTEST_OK protocol=1 hostVersion=<v> jars=<n> java=<install>\resources\runtime\bin\java.exe home=<install>\resources readyToScan=true adb=Found ADB at: <install>\resources\platform-tools\adb.exe
```

Pass criteria:

| Check | Required value |
| --- | --- |
| Exit code | `0` |
| Line prefix | `SELFTEST_OK` (never `SELFTEST_NOT_READY` / `SELFTEST_FAILED`) |
| `readyToScan=` | `true` |
| `java=` | points inside `<install>\resources\runtime` |
| `home=` | points at `<install>\resources` (this **is** `<cyvra.home>`) |
| `adb=` | `Found ADB at: ...` inside `<install>\resources\platform-tools` |

`readyToScan=true` needs only the critical preflight checks — 64-bit
architecture, the bundled Java 21 runtime, and the bundled ADB component.
**No Android device has to be connected** for this gate.

### 2b. GUI gate

1. Launch **CYVRA Mobile** from the Start Menu or Desktop shortcut.
2. The header status badge must read **`HOST CONNECTED`** (not `STARTING`).
   If it reads `BRIDGE FAILURE`, capture the message and fail the run.
3. Step **1 Connect / Preflight** must show:
   * step state `CONNECTED`
   * `Host engine` → `Connected | V<version>`
   * `Host preflight` → **`readyToScan = true`**
   * the preflight check table listing `Operating System`,
     `64-bit Architecture`, `Java Runtime`, `ADB Component`

### 2c. Licence (expected fail-closed behaviour — record, do not "fix")

The installer does **not** ship a `license.json`. Until an operator places a
valid licence at `<cyvra.home>\license.json`, any command that needs one
returns the protocol error `LICENSE_REQUIRED`. This is the signed design
(fail-closed); it is **not** an installation defect and it must never be
worked around by faking a licence.

### 2d. Purge gate (D-1) must be blocked

Step **4 Sanitization Flow** must display:

```text
PURGE BLOCKED | DECISION D-1, OUTCOME B
```

with the Host's `BLOCKED_NOT_IMPLEMENTED` outcome. On a clean VM this is a
**pass**. Do not attempt a destructive purge: the trigger is hardware-gated
and only a validated physical Samsung A10s can move it to OUTCOME A.

**Failure conditions for step 2**

* `readyToScan=false`, or `SELFTEST_NOT_READY`.
* The UI shows `STARTING` forever, or `BRIDGE FAILURE`.
* The purge path reports success, or any screen shows invented/simulated data.
* Any message contains a build-machine path.

---

## 3. Verify `<cyvra.home>` (reports / certificates)

### 3.1 Where `<cyvra.home>` is

`<cyvra.home>` is the **installation root handed to the JVM as
`-Dcyvra.home=`**, i.e. the directory that contains `host\`, `runtime\` and
`platform-tools\`:

| Package | `<cyvra.home>` |
| --- | --- |
| NSIS (per-user) | `%LOCALAPPDATA%\CYVRA Mobile\resources` |
| MSI (per-machine) | `C:\Program Files\CYVRA Mobile\resources` |

Resolution order is: environment variable **`CYVRA_HOME`** (wins if set and
non-blank) → `<exe dir>\resources` → `<exe dir>` → `<exe dir>\..\resources`.

```powershell
$home1 = Join-Path $install 'resources'
Test-Path (Join-Path $home1 'host\lib')
Test-Path (Join-Path $home1 'runtime\bin\java.exe')
Test-Path (Join-Path $home1 'platform-tools\adb.exe')
```

All three must be `True`.

### 3.2 What must appear, and when

The folders are created **on demand**, when an artifact is exported — not at
first run. Their absence right after installation is correct, not a defect.

| Trigger | Directory created | Files |
| --- | --- | --- |
| Exporting a report (step 5 Export) | `<cyvra.home>\reports\<reportId>\` | `report.json`, `report.md`, `manifest.json` |
| Completing the sanitization lifecycle (step 4) | `<cyvra.home>\certificates\<certificateId>\` | `certificate.json`, `certificate.md`, `manifest.json` |

Procedure:

1. Walk the scan flow (step 2 Run Scan → step 3 View Inventory) with a device
   connected, then step 5 Export.
2. Confirm the response carries absolute paths — the UI shows them as
   `reportJsonPath` and `manifestPath`.
3. Confirm the files exist on disk:

```powershell
Get-ChildItem (Join-Path $home1 'reports') -Recurse -File
Get-ChildItem (Join-Path $home1 'certificates') -Recurse -File
```

4. Verify each `manifest.json` digest against the file it describes:

```powershell
param([string]$Dir)   # the <reportId> or <certificateId> directory
$m = Get-Content (Join-Path $Dir 'manifest.json') -Raw | ConvertFrom-Json
foreach ($pair in @(@('jsonFile','jsonSha256'), @('markdownFile','markdownSha256'))) {
  $file = Join-Path $Dir $m.($pair[0])
  $actual = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
  "{0}: {1}" -f $m.($pair[0]), $(if ($actual -eq $m.($pair[1])) { 'MATCH' } else { 'MISMATCH' })
}
```

Every entry must be `MATCH`.

5. Confirm `manifest.json` names the right algorithm (`SHA-256`) and the right
   `artifactId`, and that no file escaped `<cyvra.home>`.

### 3.3 Writability check

* Per-user install (NSIS): `<cyvra.home>` lives under `%LOCALAPPDATA%`, so a
  standard user can write to it. Any export failure here is a **defect**.
* Per-machine install (MSI): `<cyvra.home>` lives under `Program Files`, which
  a non-elevated process cannot write to. The Host must then answer
  **`REPORT_WRITE_FAILED`** — an honest, fail-closed error — instead of
  crashing or claiming success. If you see `REPORT_WRITE_FAILED` here, record
  it as an open finding for P6 task 6.2 (report output folder), not as a
  silent pass.

**Failure conditions for step 3**

* A folder appears outside `<cyvra.home>`.
* Any manifest digest mismatch.
* A response claims an artifact was written while no file exists.
* The app claims `SANITIZATION SUCCESS` — this string must never appear; the
  shipped design is `BLOCKED_NOT_IMPLEMENTED` with
  `sanitizationSuccessClaimed = false`.

---

## 4. Uninstall and verify no orphans

### 4.1 Before uninstalling — export the evidence

Evidence written under `<cyvra.home>` lives **inside the install directory**
and is deleted with it. Copy any `reports\` and `certificates\` content you
need to keep out of the VM's install folder first.

### 4.2 Uninstall

Settings → Apps → **CYVRA Mobile** → Uninstall, or run
`<install>\uninstall.exe`, and confirm the removal completes.

### 4.3 Orphan scan

Run this on the VM **after** uninstalling:

```powershell
$orphans = [ordered]@{
  'Install dir (per-user)'  = "$env:LOCALAPPDATA\CYVRA Mobile"
  'Install dir (per-machine)' = "$env:ProgramFiles\CYVRA Mobile"
  'ARP key (HKCU)'          = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CYVRA Mobile'
  'ARP key (HKLM)'          = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CYVRA Mobile'
  'Start Menu shortcut'     = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\CYVRA Mobile.lnk"
  'Public Start Menu link'  = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\CYVRA Mobile.lnk"
  'Desktop shortcut'        = "$env:USERPROFILE\Desktop\CYVRA Mobile.lnk"
  'ProgramData data'        = "$env:ProgramData\CYVRA Mobile"
  'Roaming app data'        = "$env:APPDATA\CYVRA Mobile"
}

foreach ($name in $orphans.Keys) {
  '{0,-26} {1,-8} {2}' -f $name, (Test-Path $orphans[$name]), $orphans[$name]
}

# Nothing anywhere under the usual roots may still be named after the product.
Get-ChildItem "$env:LOCALAPPDATA", "$env:APPDATA", $env:ProgramFiles -Directory -ErrorAction SilentlyContinue |
  Where-Object Name -like '*CYVRA Mobile*' | Select-Object -ExpandProperty FullName
```

**Required:** every line above reports `False`, and the directory search
returns nothing.

> **Do not delete unrelated products.** `CYVRA Erase` (CYVORIQ) is a separate
> product with its own key
> (`HKLM\...\Uninstall\CYVRA Erase`) and its own install folder. It must be
> left untouched and must not be counted as an orphan of this installer.

### 4.4 Known residuals — record, do not hide

| Location | Verdict |
| --- | --- |
| `%LOCALAPPDATA%\in.co.cyvra.mobile\EBWebView` (about 100 MB) | **Residual.** This is the WebView2 user-data folder the runtime creates for the app identifier. The NSIS uninstaller does not remove it. Record it as an open orphan (or remove it manually and record that you did). |
| `%LOCALAPPDATA%\Microsoft\EdgeWebView\Application` | **Not an orphan.** Shared WebView2 runtime installed by the bootstrapper. Must NOT be removed. |
| Registry | No `HKCU\Software\in.co.cyvra.mobile`, `HKCU\Software\CYVRA Mobile`, protocol handler or file association is expected — if one appears after uninstall, it is an orphan. |
| Windows Services / scheduled tasks / `PATH` entries | None are installed. If any appear, they are orphans. |

**Failure conditions for step 4**

* Any file, folder, shortcut or registry key from the table in 4.3 still
  exists.
* The uninstaller reports an error, or leaves a partially deleted install
  directory.
* A residual is silently declared "clean" without being recorded.

---

## 5. Pass / fail matrix

| # | Gate | Pass criterion |
| --- | --- | --- |
| 1 | Install | NSIS install completes without elevation; `resources\host\lib`, `runtime\bin\java.exe`, `platform-tools\adb.exe` all present; Start Menu + Desktop shortcuts present; no build-machine path in any message. |
| 2 | First run | `--selftest` exits `0` with `SELFTEST_OK` **and** `readyToScan=true`; UI header shows `HOST CONNECTED`; preflight shows `readyToScan = true`. |
| 3 | `<cyvra.home>` | Equals `<install>\resources`; `reports\<reportId>\` and `certificates\<id>\` appear after export with all three files each; every manifest SHA-256 matches; nothing written outside `<cyvra.home>`. |
| 4 | Purge gate | `PURGE BLOCKED | DECISION D-1, OUTCOME B` with `BLOCKED_NOT_IMPLEMENTED`; no destructive operation performed. |
| 5 | Uninstall | No leftover file, folder, shortcut or registry key (4.3); residuals in 4.4 recorded explicitly. |
| 6 | CI | A fresh Actions run of `windows-engineering-build.yml` is green, including the >100 MB payload gate and the `readyToScan=true` selftest gate. |

Any row that cannot be evidenced is a **fail**, not a pass-by-assumption.

---

## 6. Rules for recording the result

* Never write `SANITIZATION SUCCESS`, or any completion claim, unless a
  verification step actually passed. The shipped design deliberately reports
  `BLOCKED_NOT_IMPLEMENTED`.
* `UNKNOWN` is a valid answer. A filtered or partial inventory is not
  `COMPLETE`.
* The laptop being installed on is the **install host**; only the connected
  Android device is a scan target. The laptop itself is never scanned and
  never purged.
* Attach the raw outputs (selftest text, PowerShell transcript, screenshots)
  to the run — not just a summary sentence.

---

## Appendix A — quick command sheet

```powershell
# Locate the install
$arp = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
       Where-Object { $_.DisplayName -eq 'CYVRA Mobile' }
$install = $arp.InstallLocation.Trim('"')

# Packaging gate
$out = "$env:TEMP\cyvra-selftest.out"; $err = "$env:TEMP\cyvra-selftest.err"
$p = Start-Process -FilePath "$install\cyvra-mobile-desktop.exe" -ArgumentList '--selftest' `
       -Wait -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
Get-Content $out, $err; $p.ExitCode

# <cyvra.home>
$cyvraHome = Join-Path $install 'resources'
Get-ChildItem "$cyvraHome\reports", "$cyvraHome\certificates" -Recurse -ErrorAction SilentlyContinue

# Uninstall + orphan scan
Start-Process "$install\uninstall.exe"
Test-Path "$env:LOCALAPPDATA\CYVRA Mobile"
Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CYVRA Mobile'
```

## Appendix B — baseline observed on the engineering workstation

Recorded on the developer machine (a machine that had the NSIS build
installed), so the clean-VM run can be compared against it:

```text
ARP        : HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\CYVRA Mobile
InstallDir : C:\Users\<user>\AppData\Local\CYVRA Mobile   (88,484,136 bytes)
Contents   : cyvra-mobile-desktop.exe, uninstall.exe, resources\
Shortcuts  : %APPDATA%\Microsoft\Windows\Start Menu\Programs\CYVRA Mobile.lnk
             %USERPROFILE%\Desktop\CYVRA Mobile.lnk
WebView2   : %LOCALAPPDATA%\in.co.cyvra.mobile\EBWebView
cyvra.home : <InstallDir>\resources   (no reports\ or certificates\ until an export)
Selftest   : SELFTEST_OK ... readyToScan=true adb=Found ADB at: ...\resources\platform-tools\adb.exe
Artifacts  : exe 9,612,288 B | NSIS 52,676,112 B | MSI 58,276,274 B | total 120,564,674 B
```

Note the bare executable is only ~9.6 MB: the Host JARs, the jlink runtime and
platform-tools travel inside the installers, which is why the CI gate asserts
on the **combined artifact size > 100 MB** rather than on the executable
alone.
