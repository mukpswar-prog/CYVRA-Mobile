<#
.SYNOPSIS
    CYVRA read-only Android probe harness (TASK O base, extended by TASK Q).

.DESCRIPTION
    Runs a fixed, read-only diagnostic battery against an Android target and records the raw
    outputs as a fixture with a provenance header.

    Safety rails (enforced, not conventional):
      * READ-ONLY allowlist: commands are hard-coded; there is no command passthrough.
        Nothing installs, writes, wipes, reboots, taps or screenshots.
      * Emulator auto-selection only. A PHYSICAL target requires BOTH -AllowPhysical and an
        explicit -Serial; there is no auto-pick of a physical unit.
      * Emulator targets must additionally prove ro.kernel.qemu=1.
      * Local only: output is written under the fixtures path. No network call, no upload.

    A target that is not in state 'device' (unauthorized / offline / not listed) is still
    probed so the EXACT adb error text is captured verbatim; the run then exits 6.

    Exit codes:
      0  fixture written, target was in state 'device'
      2  BLOCKED - no emulator attached (exact missing component printed)
      3  refused - physical target without -AllowPhysical
      4  refused - emulator target failed ro.kernel.qemu=1
      5  BLOCKED - adb unavailable
      6  fixture written, but target was NOT usable (state captured verbatim)

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\android-probe\probe.ps1 -ApiLevel 36 -FixtureName emulator_api36
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\android-probe\probe.ps1 -AllowPhysical -Serial <target-serial> -ApiLevel 30 -FixtureName state_1_unlocked_debugON
#>
[CmdletBinding()]
param(
    [string]$ApiLevel     = '',
    [string]$Serial       = '',
    [string]$OutDir       = '',
    [string]$FixtureName  = '',
    [switch]$AllowPhysical,
    [switch]$ListOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$ScriptPath = $MyInvocation.MyCommand.Path
$ProbeDir   = Split-Path -Parent $ScriptPath       # .../scripts/android-probe
$ScriptsDir = Split-Path -Parent $ProbeDir         # .../scripts
$RepoRoot   = Split-Path -Parent $ScriptsDir       # repo root
$HarnessId  = 'cyvra-android-probe/1.1'
$FixtureRel = 'apps/android/core/src/test/fixtures'
if (-not $OutDir) { $OutDir = Join-Path $RepoRoot $FixtureRel }

function Write-Exit([int]$Code, [string]$Message) {
    Write-Output "BLOCKED: $Message"
    exit $Code
}

function Find-Adb {
    if ($env:LOCALAPPDATA) {
        $c = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
        if (Test-Path -LiteralPath $c) { return $c }
    }
    if ($env:ANDROID_HOME) {
        $c = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
        if (Test-Path -LiteralPath $c) { return $c }
    }
    $cmd = Get-Command adb -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

# --- 0. adb discovery -------------------------------------------------------
$Adb = Find-Adb
if (-not $Adb) { Write-Exit 5 'adb not found. Install Android SDK platform-tools (Sdk\platform-tools\adb.exe).' }
$AdbVersionLine = (& $Adb version 2>&1 | Select-Object -First 1 | Out-String).Trim()

# --- 1. device enumeration --------------------------------------------------
$RawDeviceLines = @(& $Adb devices -l 2>&1 | ForEach-Object { "$_" })
$Devices = @()
foreach ($L in $RawDeviceLines) {
    if ($L -match '^(?<s>\S+)\s+(?<st>\S+)' -and $L -notmatch '^List of devices' -and $L -notmatch '^\*') {
        $Devices += [pscustomobject]@{ Serial = $Matches.s; State = $Matches.st; Raw = $L }
    }
}
$Emulators = @($Devices | Where-Object { $_.Serial -like 'emulator-*' })
$Physicals = @($Devices | Where-Object { $_.Serial -notlike 'emulator-*' })

if ($ListOnly) {
    Write-Output "adb            : $Adb"
    Write-Output "adb version    : $AdbVersionLine"
    Write-Output "emulators      : $(if ($Emulators.Count) { ($Emulators | ForEach-Object { $_.Serial + '(' + $_.State + ')' }) -join ', ' } else { 'NONE' })"
    Write-Output "physical       : $(if ($Physicals.Count) { ($Physicals | ForEach-Object { $_.Serial + '(' + $_.State + ')' }) -join ', ' } else { 'none' })"
    Write-Output "physical policy: auto-select FORBIDDEN; requires -AllowPhysical AND explicit -Serial"
    Write-Output "fixture root   : $OutDir"
    Write-Output "raw 'adb devices -l':"
    $RawDeviceLines | ForEach-Object { "                 $_" }
    exit 0
}

# --- 1b. target selection ---------------------------------------------------
if ($Serial -and $Serial -notlike 'emulator-*' -and -not $AllowPhysical) {
    Write-Exit 3 "target '$Serial' is a physical device. Re-run with -AllowPhysical to permit a read-only physical probe, and pass -Serial explicitly."
}
if (-not $Serial) {
    $ready = @($Emulators | Where-Object { $_.State -eq 'device' })
    if ($ready.Count -eq 0) {
        $msg = 'no emulator attached.'
        if ($Physicals.Count -gt 0) {
            $msg += " A physical device IS attached ($(($Physicals | ForEach-Object { $_.Serial }) -join ', ')) - pass -AllowPhysical -Serial <serial> to probe it."
        }
        $msg += ' Missing component: an Android Virtual Device.'
        $msg += ' Present tooling: cmdline-tools (avdmanager) and system images must exist for the requested API.'
        Write-Exit 2 $msg
    }
    $Serial = $ready[0].Serial
}

$IsEmulator = $Serial -like 'emulator-*'
$StateEntry = @($Devices | Where-Object { $_.Serial -eq $Serial })
$DeviceState = if ($StateEntry.Count) { $StateEntry[0].State } else { 'NOT_LISTED' }

# --- 2. identity / emulator proof ------------------------------------------
function Get-Prop([string]$Key) {
    $v = (& $Adb -s $Serial shell getprop $Key 2>&1 | Out-String).Trim()
    return $v
}
$Qemu = ''
if ($IsEmulator) {
    $Qemu = Get-Prop 'ro.kernel.qemu'
    if ($Qemu -ne '1') { Write-Exit 4 "target '$Serial' reports ro.kernel.qemu='$Qemu' (expected 1). Refusing." }
}
else {
    $Qemu = Get-Prop 'ro.kernel.qemu'     # expected empty on hardware
}

$Usable = ($DeviceState -eq 'device')

$SdkInt  = '' ; $Rel = '' ; $Manu = '' ; $Model = '' ; $Finger = '' ; $Abi = ''
if ($Usable) {
    $SdkInt = Get-Prop 'ro.build.version.sdk'
    $Rel    = Get-Prop 'ro.build.version.release'
    $Manu   = Get-Prop 'ro.product.manufacturer'
    $Model  = Get-Prop 'ro.product.model'
    $Finger = Get-Prop 'ro.build.fingerprint'
    $Abi    = Get-Prop 'ro.product.cpu.abi'
}
if (-not $ApiLevel) { $ApiLevel = $SdkInt }

$TargetKind = if ($IsEmulator) { 'EMULATOR' } else { 'PHYSICAL' }
Write-Output "target         : $Serial ($TargetKind, state=$DeviceState)"
Write-Output "usable         : $Usable"
if ($Usable) {
    Write-Output "api level      : $ApiLevel (device reports $SdkInt, Android $Rel, abi=$Abi)"
    Write-Output "identity       : $Manu / $Model"
    Write-Output "fingerprint    : $Finger"
} else {
    Write-Output "api level      : $ApiLevel (supplied on the command line; target not readable)"
    Write-Output "NOTE           : target not in state 'device' - commands will be attempted so the exact adb error text is captured verbatim."
}
if ($ApiLevel -and (@(26, 30, 33, 36) -notcontains [int]$ApiLevel)) {
    Write-Output "NOTE           : API $ApiLevel is outside the governed matrix (26/30/33/36); fixture marked off-matrix."
}

# --- 3. read-only command allowlist ----------------------------------------
$GetPropAllow = @(
    'ro.build.version.sdk', 'ro.build.version.release', 'ro.build.fingerprint',
    'ro.build.id', 'ro.build.display.id', 'ro.build.type', 'ro.build.tags',
    'ro.build.characteristics', 'ro.product.manufacturer', 'ro.product.model',
    'ro.product.device', 'ro.hardware', 'ro.board.platform', 'ro.kernel.qemu',
    'ro.debuggable', 'ro.product.cpu.abi', 'ro.runtime.firstboot'
)
# Identifiers are deliberately NOT collected (governed doc section 4 / Spec 24).
$GetPropDeny = 'serial|imei|meid|android_id|mac|bssid|ssid|advertisingid|uid'

$Commands = @(
    @{ Name = 'battery';   Remote = 'dumpsys battery' },
    @{ Name = 'display';   Remote = 'dumpsys display' },
    @{ Name = 'sensors';   Remote = 'dumpsys sensorservice' },
    @{ Name = 'wifi';      Remote = 'dumpsys wifi' },
    @{ Name = 'diskstats'; Remote = 'dumpsys diskstats' },
    @{ Name = 'packages';  Remote = 'pm list packages' },
    @{ Name = 'df';        Remote = 'df' },
    @{ Name = 'wm';        Remote = 'wm size; wm density' },
    @{ Name = 'getprop';   Remote = '__cyvra_getprop_allowlist__' },
    @{ Name = 'cid';       Remote = '__cyvra_cid_read__' }
)

$Leaf = $FixtureName
if (-not $Leaf) { $Leaf = 'api-' + $ApiLevel }
$Target = Join-Path $OutDir $Leaf
New-Item -ItemType Directory -Force -Path $Target | Out-Null

$Manifest = @()
$StartUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

function Join-TargetPath([string]$Name) {
    if ($Name -notlike '*.txt' -and $Name -notlike '*.json') { $Name = "$Name.txt" }
    return (Join-Path $Target $Name)
}
function Save-Result([string]$Name, [int]$ExitCode, [string]$Text) {
    $Path = Join-TargetPath $Name
    $Bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    [System.IO.File]::WriteAllBytes($Path, $Bytes)
    $Sha = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
    $script:Manifest += [pscustomobject]@{
        file = $Name; exit_code = $ExitCode; bytes = $Bytes.Length; sha256 = $Sha
    }
}

# Always record how adb itself saw the target, before anything else.
Save-Result 'adb_devices' 0 (("adb devices -l  (captured " + $StartUtc + ")" + "`n") + ($RawDeviceLines -join "`n") + "`n")

foreach ($C in $Commands) {
    $Text = ''
    $Code = 0
    if ($C.Remote -eq '__cyvra_getprop_allowlist__') {
        $Raw = @(& $Adb -s $Serial shell getprop 2>&1 | ForEach-Object { "$_" })
        $Code = $LASTEXITCODE
        $Keep = @()
        foreach ($L in $Raw) {
            if ($L -match '^\[(?<k>[^\]]+)\]:\s*(?<v>.*)$') {
                $K = $Matches.k
                if ($K -notmatch $GetPropDeny -and $GetPropAllow -contains $K) {
                    $Keep += "[$K]: $($Matches.v)"
                }
            }
        }
        $Text = "# read-only getprop (allowlist only; identifier keys excluded)`n"
        if ($Code -ne 0) { $Text += "# adb exit=$Code`n"; $Text += ($Raw -join "`n") + "`n" }
        $Text += ($Keep -join "`n")
        if ($Keep.Count -eq 0) { $Text += "`nNOT AVAILABLE" }
        $Text += "`n"
    }
    elseif ($C.Remote -eq '__cyvra_cid_read__') {
        $Paths = @(
            '/sys/class/block/sda/device/cid',
            '/sys/class/block/mmcblk0/device/cid',
            '/sys/block/sda/device/cid',
            '/sys/block/mmcblk0/device/cid'
        )
        $Body = "# read-only storage CID sysfs probe`n"
        $Found = $false
        foreach ($P in $Paths) {
            $Out = @(& $Adb -s $Serial shell "cat $P" 2>&1 | ForEach-Object { "$_" })
            $ec = $LASTEXITCODE
            $joined = ($Out -join "`n")
            if ($ec -eq 0 -and $joined -and $joined -notmatch 'No such file|Permission denied|cannot open|not found|unauthorized|offline') {
                $Body += "$P => $($joined.Trim())`n"
                $Found = $true
            } else {
                $Body += "$P => NOT AVAILABLE (adb exit=$ec) $joined`n"
            }
        }
        if (-not $Found) { $Body += "RESULT => NOT AVAILABLE`n" }
        $Text = $Body
    }
    else {
        $Out = @(& $Adb -s $Serial shell $C.Remote 2>&1 | ForEach-Object { "$_" })
        $Code = $LASTEXITCODE
        $Text = ($Out -join "`n") + "`n"
        if (-not $Text.Trim()) { $Text = "NOT AVAILABLE (empty output, adb exit=$Code)`n" }
    }
    Save-Result $C.Name $Code $Text
    Write-Output ("  probed {0,-10} exit={1}" -f $C.Name, $Code)
}

# --- 3b. target health validation -------------------------------------------
# A guest whose framework is dying still reports state=device to `adb devices`,
# and shell-level commands (df / getprop / sysfs) keep succeeding because they
# never touch system_server. So `device` alone does NOT prove the capture is
# valid. Scan what was actually saved and mark the run degraded if any output
# carries a service-failure signature. The outputs are kept verbatim as evidence;
# the exit code (6) is what tells the caller not to trust them as a capability
# observation.
$Degraded = @()
$BadPattern = "DEAD_OBJECT|DUMP TIMEOUT|Can't find service|Failure calling service|Broken pipe"
foreach ($m in $Manifest) {
    $fp = Join-TargetPath $m.file
    if (Test-Path -LiteralPath $fp) {
        $txt = [System.IO.File]::ReadAllText($fp)
        if ($txt -match $BadPattern) { $Degraded += $m.file }
    }
}
if ($Degraded.Count -gt 0) {
    $Usable = $false
    Write-Output "DEGRADED        : guest services failed during capture -> $($Degraded -join ', ')"
}

# --- 4. provenance ----------------------------------------------------------
$EndUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$Prov = [ordered]@{
    harness            = $HarnessId
    harness_path       = 'scripts/android-probe/probe.ps1'
    mode               = 'READ_ONLY=TRUE'
    target_kind        = $TargetKind
    target_serial      = $Serial
    target_state       = $DeviceState
    target_usable      = $Usable
    physical_authorized= [bool]$AllowPhysical
    captured_at_utc    = $StartUtc
    completed_at_utc   = $EndUtc
    host_os            = [System.Environment]::OSVersion.VersionString
    adb_path           = $Adb
    adb_version        = $AdbVersionLine
    emulator_proof     = if ($IsEmulator) { "ro.kernel.qemu=$Qemu" } else { 'n/a (physical target, qemu flag = "' + $Qemu + '")' }
    api_level          = if ($ApiLevel) { [int]$ApiLevel } else { $null }
    device_sdk_reported= $SdkInt
    abi                = if ($Abi) { $Abi } else { 'NOT AVAILABLE (target not readable)' }
    android_release    = $Rel
    manufacturer       = $Manu
    model              = $Model
    build_fingerprint  = $Finger
    off_matrix         = if ($ApiLevel) { (@(26, 30, 33, 36) -notcontains [int]$ApiLevel) } else { $null }
    commands           = @($Commands | ForEach-Object { $_.Remote })
    identifier_policy  = 'identifier getprop keys excluded (governed doc section 4; Spec 24)'
    egress             = 'none - local fixture only; no network call'
    installs_wipes     = 'NONE - no install, no purge, no input, no screencap, no reboot'
    degraded_services  = @($Degraded)
}
$ProvJson = $Prov | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllBytes((Join-TargetPath 'provenance'), [System.Text.Encoding]::UTF8.GetBytes($ProvJson))

$Man = [ordered]@{
    harness        = $HarnessId
    target_kind    = $TargetKind
    target_serial  = $Serial
    target_state   = $DeviceState
    api_level      = if ($ApiLevel) { [int]$ApiLevel } else { $null }
    abi            = $Abi
    file_count     = $Manifest.Count
    files          = $Manifest
}
$ManJson = $Man | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllBytes((Join-TargetPath 'manifest'), [System.Text.Encoding]::UTF8.GetBytes($ManJson))

Write-Output "fixture written : $Target"
Write-Output "files           : $($Manifest.Count) outputs + provenance.json + manifest.json"
Write-Output "egress          : none (local only)"

if (-not $Usable) {
    if ($Degraded.Count -gt 0 -and $DeviceState -eq 'device') {
        Write-Output "RESULT          : DEGRADED capture - guest services failed, outputs are evidence of failure, NOT capability observations."
        exit 6
    }
    Write-Output "RESULT          : target NOT usable (state=$DeviceState) - exact adb errors captured verbatim."
    exit 6
}
exit 0
