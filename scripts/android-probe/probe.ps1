<#
.SYNOPSIS
    CYVRA read-only Android probe harness (TASK O).

.DESCRIPTION
    Runs a fixed, read-only diagnostic battery against an ANDROID EMULATOR and records the raw
    outputs as a fixture with a provenance header.

    Safety rails (enforced, not conventional):
      * Emulator-only: the target serial must begin "emulator-" and ro.kernel.qemu must be 1.
      * Physical serials are refused. Physical-device runs are FORBIDDEN in this session.
      * Read-only allowlist: commands are hard-coded; there is no command passthrough.
      * Local only: output is written under the fixtures path. No network call, no upload.

    Exit codes:
      0  fixture written
      2  BLOCKED - no emulator (exact missing component printed)
      3  refused - physical-device target
      4  refused - target is not a qemu emulator
      5  BLOCKED - adb unavailable

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\android-probe\probe.ps1 -ApiLevel 36
#>
[CmdletBinding()]
param(
    [string]$ApiLevel = '',
    [string]$Serial   = '',
    [string]$OutDir   = '',
    [switch]$ListOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$ScriptPath  = $MyInvocation.MyCommand.Path
$ProbeDir    = Split-Path -Parent $ScriptPath     # .../scripts/android-probe
$ScriptsDir  = Split-Path -Parent $ProbeDir       # .../scripts
$RepoRoot    = Split-Path -Parent $ScriptsDir     # repo root
$HarnessId   = 'cyvra-android-probe/1.0'
$FixtureRel  = 'apps/android/core/src/test/fixtures'
if (-not $OutDir) { $OutDir = Join-Path $RepoRoot $FixtureRel }

function Write-Blocked([int]$Code, [string]$Message) {
    Write-Output "BLOCKED: $Message"
    exit $Code
}

function Find-Adb {
    # Prefer the SDK's platform-tools build: the PATH copy on this host is 1.0.32 (2014).
    if ($env:LOCALAPPDATA) {
        $cand = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
        if (Test-Path -LiteralPath $cand) { return $cand }
    }
    if ($env:ANDROID_HOME) {
        $cand = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
        if (Test-Path -LiteralPath $cand) { return $cand }
    }
    $cmd = Get-Command adb -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

# --- 0. adb discovery -------------------------------------------------------
$Adb = Find-Adb
if (-not $Adb) {
    Write-Blocked 5 'adb not found. Install Android SDK platform-tools (Sdk\platform-tools\adb.exe) and re-run.'
}
$AdbVersionLine = (& $Adb version 2>&1 | Select-Object -First 1 | Out-String).Trim()

# --- 1. device enumeration --------------------------------------------------
$Lines      = & $Adb devices 2>&1 | ForEach-Object { "$_" }
$Devices    = @()
foreach ($L in $Lines) {
    if ($L -match '^(?<s>\S+)\s+(?<st>\S+)\s*$' -and $L -notmatch '^List of devices') {
        $Devices += [pscustomobject]@{ Serial = $Matches.s; State = $Matches.st }
    }
}
$Emulators = @($Devices | Where-Object { $_.Serial -like 'emulator-*' })
$Physicals = @($Devices | Where-Object { $_.Serial -notlike 'emulator-*' })

if ($ListOnly) {
    Write-Output "adb            : $Adb"
    Write-Output "adb version    : $AdbVersionLine"
    Write-Output "emulators      : $(if ($Emulators.Count) { ($Emulators | ForEach-Object { $_.Serial }) -join ', ' } else { 'NONE' })"
    Write-Output "physical (refused): $(if ($Physicals.Count) { ($Physicals | ForEach-Object { $_.Serial + '(' + $_.State + ')' }) -join ', ' } else { 'none' })"
    Write-Output "fixture root   : $OutDir"
    exit 0
}

if ($Serial -and $Serial -notlike 'emulator-*') {
    Write-Blocked 3 "target '$Serial' is a physical device. Physical-device runs are forbidden in this session."
}
if (-not $Serial) {
    $ready = @($Emulators | Where-Object { $_.State -eq 'device' })
    if ($ready.Count -eq 0) {
        $msg = 'no emulator attached.'
        if ($Physicals.Count -gt 0) {
            $msg += " A physical device IS attached ($(($Physicals | ForEach-Object { $_.Serial }) -join ', ')) but it must not be probed."
        }
        $msg += ' Missing component: an Android Virtual Device - %USERPROFILE%\.android\avd does not exist and ANDROID_AVD_HOME is unset.'
        $msg += ' Unblocked by: installing Android SDK cmdline-tools (for avdmanager), installing system images for API 26/30/33/36, and creating the AVDs.'
        Write-Blocked 2 $msg
    }
    $Serial = $ready[0].Serial
}

# --- 2. emulator proof ------------------------------------------------------
function Get-Prop([string]$Key) {
    $v = (& $Adb -s $Serial shell getprop $Key 2>&1 | Out-String).Trim()
    return $v
}
$Qemu = Get-Prop 'ro.kernel.qemu'
if ($Qemu -ne '1') {
    Write-Blocked 4 "target '$Serial' reports ro.kernel.qemu='$Qemu' (expected 1). Refusing: this harness only runs on emulators."
}

$SdkInt   = Get-Prop 'ro.build.version.sdk'
$Rel      = Get-Prop 'ro.build.version.release'
$Manu     = Get-Prop 'ro.product.manufacturer'
$Model    = Get-Prop 'ro.product.model'
$Finger   = Get-Prop 'ro.build.fingerprint'
if (-not $ApiLevel) { $ApiLevel = $SdkInt }

Write-Output "target         : $Serial (emulator, ro.kernel.qemu=1)"
Write-Output "api level      : $ApiLevel (device reports $SdkInt, Android $Rel)"
Write-Output "$Manu / $Model"
Write-Output "fingerprint    : $Finger"
if (@(26, 30, 33, 36) -notcontains [int]$ApiLevel) {
    Write-Output "NOTE: API $ApiLevel is outside the governed matrix (26/30/33/36); fixture will be labelled as captured but marked off-matrix."
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
    @{ Name = 'battery';    Remote = 'dumpsys battery' },
    @{ Name = 'display';    Remote = 'dumpsys display' },
    @{ Name = 'sensors';    Remote = 'dumpsys sensorservice' },
    @{ Name = 'wifi';       Remote = 'dumpsys wifi' },
    @{ Name = 'diskstats';  Remote = 'dumpsys diskstats' },
    @{ Name = 'packages';   Remote = 'pm list packages' },
    @{ Name = 'df';         Remote = 'df' },
    @{ Name = 'wm';         Remote = 'wm size; wm density' },
    @{ Name = 'getprop';    Remote = '__cyvra_getprop_allowlist__' },
    @{ Name = 'cid';        Remote = '__cyvra_cid_read__' }
)

$Target = Join-Path $OutDir ("api-" + $ApiLevel)
New-Item -ItemType Directory -Force -Path $Target | Out-Null

$Manifest = @()
$StartUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

function Save-Result([string]$Name, [int]$ExitCode, [string]$Text) {
    $Path = Join-TargetPath $Name
    $Bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    [System.IO.File]::WriteAllBytes($Path, $Bytes)
    $Sha = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
    $script:Manifest += [pscustomobject]@{
        file = $Name; exit_code = $ExitCode; bytes = $Bytes.Length; sha256 = $Sha
    }
}
function Join-TargetPath([string]$Name) {
    if ($Name -notlike '*.txt' -and $Name -notlike '*.json') { $Name = "$Name.txt" }
    return (Join-Path $Target $Name)
}

foreach ($C in $Commands) {
    $Text = ''
    $Code = 0
    if ($C.Remote -eq '__cyvra_getprop_allowlist__') {
        $Raw = (& $Adb -s $Serial shell getprop 2>&1 | ForEach-Object { "$_" })
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
            $Out = (& $Adb -s $Serial shell "cat $P" 2>&1 | ForEach-Object { "$_" }) -join "`n"
            if ($LASTEXITCODE -eq 0 -and $Out -and $Out -notmatch 'No such file|Permission denied|cannot open') {
                $Body += "$P => $($Out.Trim())`n"
                $Found = $true
            } else {
                $Body += "$P => NOT AVAILABLE`n"
            }
        }
        if (-not $Found) { $Body += "RESULT => NOT AVAILABLE`n" }
        $Text = $Body
    }
    else {
        $Out = (& $Adb -s $Serial shell $C.Remote 2>&1 | ForEach-Object { "$_" })
        $Code = $LASTEXITCODE
        $Text = ($Out -join "`n") + "`n"
        if (-not $Text.Trim()) { $Text = "NOT AVAILABLE (empty output)`n" }
    }
    Save-Result $C.Name $Code $Text
    Write-Output ("  probed {0,-10} exit={1}" -f $C.Name, $Code)
}

# --- 4. provenance ----------------------------------------------------------
$EndUtc  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$Prov    = [ordered]@{
    harness            = $HarnessId
    harness_path       = 'scripts/android-probe/probe.ps1'
    mode               = 'READ_ONLY=TRUE'
    captured_at_utc    = $StartUtc
    completed_at_utc   = $EndUtc
    host_os            = [System.Environment]::OSVersion.VersionString
    adb_path           = $Adb
    adb_version        = $AdbVersionLine
    emulator_serial    = $Serial
    emulator_proof     = 'ro.kernel.qemu=1'
    api_level          = [int]$ApiLevel
    device_sdk_reported= $SdkInt
    android_release    = $Rel
    manufacturer       = $Manu
    model              = $Model
    build_fingerprint  = $Finger
    off_matrix         = (@(26, 30, 33, 36) -notcontains [int]$ApiLevel)
    commands           = @($Commands | ForEach-Object { $_.Remote })
    identifier_policy  = 'identifier getprop keys excluded (governed doc section 4; Spec 24)'
    egress             = 'none - local fixture only; no network call'
    physical_device_runs = 'FORBIDDEN in this session - not performed'
}
$ProvJson = $Prov | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllBytes((Join-TargetPath 'provenance'), [System.Text.Encoding]::UTF8.GetBytes($ProvJson))

$Man = [ordered]@{
    harness        = $HarnessId
    api_level      = [int]$ApiLevel
    emulator_serial= $Serial
    file_count     = $Manifest.Count
    files          = $Manifest
}
$ManJson = $Man | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllBytes((Join-TargetPath 'manifest'), [System.Text.Encoding]::UTF8.GetBytes($ManJson))

Write-Output "fixture written : $Target"
Write-Output "files           : $($Manifest.Count) outputs + provenance.json + manifest.json"
Write-Output "egress          : none (local only)"
exit 0
