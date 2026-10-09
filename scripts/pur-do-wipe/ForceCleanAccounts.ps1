# ForceCleanAccounts.ps1
#
# TASK U - PUR-DO-WIPE force-clean sequence.
#
# Why this exists
# ---------------
# `dpm set-device-owner` is refused by DevicePolicyManagerService while any
# account is present:
#
#     java.lang.IllegalStateException: Not allowed to set the device owner
#     because there are already some accounts on the device
#         at DevicePolicyManagerService.enforceCanSetDeviceOwnerLocked(:10847)
#
# That is a precondition of the governed wipe proof, so the accounts have to go
# before the device can be enrolled. This tool takes them there and records how
# it was done.
#
# The ladder
# ----------
#   1. PRIMITIVE      `cmd account remove-account <name>` - the commissioned
#                     primitive. Probed, not assumed: it does not exist on
#                     Android 11, where `cmd account` offers only `help` and the
#                     two bind-instant-service flags. On a build that has it, it
#                     is used first.
#   2. AUTHENTICATOR  `pm uninstall --user 0 <pkg>` per authenticator package,
#                     third-party packages before platform ones. This is the rung
#                     that actually works here, and it needs no account names -
#                     which matters, because Samsung's dumps hide 7 of the 10
#                     accounts and only the 3 Google ones are enumerable at all.
#   3. HUMAN          whatever survives, escalated to the operator on-device.
#
# Privacy
# -------
# Account identifiers are real-device fixture content and never egress. This
# script holds them in memory only while it needs them, writes them nowhere, and
# the attestation it emits contains counts, package names and outcomes - never an
# account name, and never the device serial.
#
# Usage
# -----
#   powershell -ExecutionPolicy Bypass -File ForceCleanAccounts.ps1            # run
#   powershell -ExecutionPolicy Bypass -File ForceCleanAccounts.ps1 -DryRun    # plan only
#   powershell -ExecutionPolicy Bypass -File ForceCleanAccounts.Tests.ps1      # unit tests

[CmdletBinding()]
param(
    [string]$Serial,
    [string]$OutFile,
    [switch]$DryRun,
    [switch]$SkipHumanGate,
    [string[]]$ProtectedPackages = @('com.cyvra.sanitization', 'co.in.cyvra.mobile'),
    [int]$SettleSeconds = 3
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here 'ForceCleanAccounts.psm1') -Force

$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (-not (Test-Path $adb)) { $adb = 'adb' }
# Some hosts require the vendor key path; harmless where it is not needed.
if (-not $env:ADB_VENDOR_KEYS) {
    foreach ($candidate in @('C:\Android\.android\adbkey', "$env:USERPROFILE\.android\adbkey")) {
        if (Test-Path $candidate) { $env:ADB_VENDOR_KEYS = (Split-Path $candidate); break }
    }
}

$script:attempts = New-Object System.Collections.ArrayList
$script:removedPackages = New-Object System.Collections.ArrayList

function Invoke-Adb {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $output = & $adb @Arguments 2>&1
    return [pscustomobject]@{
        Text   = (($output | ForEach-Object { "$_" }) -join "`n")
        Exit   = $LASTEXITCODE
    }
}

function Invoke-Shell {
    param([Parameter(Mandatory)][string]$Command)
    $args = @()
    if ($script:serial) { $args += @('-s', $script:serial) }
    $args += @('shell') + ($Command -split ' ')
    return Invoke-Adb -Arguments $args
}

function Get-DeviceAccountCount {
    $result = Invoke-Shell -Command 'dumpsys content'
    return Get-AccountCountFromContentDump -DumpText $result.Text
}

function Write-Step {
    param([string]$Message)
    Write-Output ('[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $Message)
}

function Record-Attempt {
    param([string]$Rung, [string]$Target, [string]$Outcome, [int]$CountBefore, [int]$CountAfter)
    [void]$script:attempts.Add([pscustomobject]@{
        rung        = $Rung
        target      = $Target
        outcome     = $Outcome
        countBefore = $CountBefore
        countAfter  = $CountAfter
        at          = (Get-Date -Format 'o')
    })
}

# --------------------------------------------------------------------------
# 0. Device
# --------------------------------------------------------------------------
$devices = Invoke-Adb -Arguments @('devices')
$lines = @($devices.Text -split "`r?`n" | Where-Object { $_ -match "`t" })
if ($lines.Count -eq 0) {
    Write-Output 'ERROR: no device attached. Connect the device and enable USB debugging.'
    exit 4
}
if ($lines.Count -gt 1 -and -not $Serial) {
    Write-Output 'ERROR: more than one device attached; pass -Serial <id>.'
    $lines | ForEach-Object { Write-Output ('    ' + $_) }
    exit 4
}
if (-not $Serial) { $Serial = ($lines[0] -split "`t")[0].Trim() }
$script:serial = $Serial

$props = @{}
foreach ($entry in @('ro.product.model', 'ro.build.version.release')) {
    $r = Invoke-Shell -Command ('getprop ' + $entry)
    $props[$entry] = $r.Text.Trim()
}
$deviceModel = $props['ro.product.model']
$androidRelease = $props['ro.build.version.release']

# Captured before any attempt, so the attestation window genuinely contains them.
$startedAt = (Get-Date -Format 'o')

Write-Output ''
Write-Output 'PUR-DO-WIPE force-clean sequence (TASK U)'
Write-Output ('  device  : ' + $deviceModel + '  (Android ' + $androidRelease + ')')
Write-Output ('  serial  : [withheld - not recorded]')
Write-Output ('  mode    : ' + $(if ($DryRun) { 'DRY RUN (no changes)' } else { 'EXECUTE' }))
Write-Output ''

# --------------------------------------------------------------------------
# 1. Capability probe
# --------------------------------------------------------------------------
$usage = Invoke-Shell -Command 'cmd account'
$primitiveAvailable = Test-RemoveAccountPrimitiveAvailable -UsageText $usage.Text
$primitiveStatus = if ($primitiveAvailable) { 'available' } else { 'absent' }
Write-Step ('probe: cmd account remove-account = ' + $primitiveStatus.ToUpper())

$ladder = Get-RemovalLadder -PrimitiveAvailable $primitiveAvailable

# --------------------------------------------------------------------------
# 2. Baseline
# --------------------------------------------------------------------------
$baseline = Get-DeviceAccountCount
if ($baseline -lt 0) {
    Write-Output 'ERROR: could not read an account count from dumpsys content.'
    Write-Output '       Refusing to continue: an unreadable count must never read as clean.'
    exit 5
}
Write-Step ('baseline: ' + $baseline + ' account(s) present')
if (Test-DeviceOwnerPrecondition -AccountCount $baseline) {
    Write-Step 'already clean - nothing to do'
}

# --------------------------------------------------------------------------
# 3. Rung 1 - the commissioned primitive
# --------------------------------------------------------------------------
if ($primitiveAvailable -and -not $DryRun -and $baseline -gt 0) {
    Write-Step 'rung 1: attempting cmd account remove-account'
    $before = Get-DeviceAccountCount
    $attempt = Invoke-Shell -Command 'cmd account remove-account --user 0'
    Record-Attempt -Rung 'PRIMITIVE' -Target 'enumerable-accounts' `
        -Outcome $(if ($attempt.Exit -eq 0) { 'ok' } else { 'failed exit=' + $attempt.Exit }) `
        -CountBefore $before -CountAfter (Get-DeviceAccountCount)
} elseif (-not $primitiveAvailable) {
    Record-Attempt -Rung 'PRIMITIVE' -Target 'n/a' -Outcome 'skipped: primitive absent' `
        -CountBefore $baseline -CountAfter $baseline
} elseif ($DryRun) {
    Record-Attempt -Rung 'PRIMITIVE' -Target 'n/a' -Outcome 'skipped: dry run' `
        -CountBefore $baseline -CountAfter $baseline
}

# --------------------------------------------------------------------------
# 4. Rung 2 - authenticator packages, third-party first
# --------------------------------------------------------------------------
$accountDump = (Invoke-Shell -Command 'dumpsys account').Text
$authenticatorMap = Get-AuthenticatorMap -DumpText $accountDump
$order = Get-RemovalOrder -AuthenticatorMap $authenticatorMap

Write-Step ('rung 2: ' + $order.Count + ' authenticator package(s) in removal plan (third-party first)')

if (-not $DryRun) {
    foreach ($item in $order) {
        $count = Get-DeviceAccountCount
        if ($count -le 0) { break }

        $pkg = $item.Package
        if ($ProtectedPackages -contains $pkg) {
            Record-Attempt -Rung 'AUTHENTICATOR' -Target $pkg -Outcome 'protected: skipped' `
                -CountBefore $count -CountAfter $count
            continue
        }

        # Already gone?
        $pathResult = Invoke-Shell -Command ('pm path ' + $pkg)
        if ($pathResult.Exit -ne 0 -or [string]::IsNullOrWhiteSpace($pathResult.Text)) {
            Record-Attempt -Rung 'AUTHENTICATOR' -Target $pkg -Outcome 'not installed: skipped' `
                -CountBefore $count -CountAfter $count
            continue
        }

        Write-Step ('    removing authenticator ' + $pkg + ' (type ' + $item.Type + ')')
        $before = $count
        $result = Invoke-Shell -Command ('pm uninstall --user 0 ' + $pkg)

        # AccountManager applies the package removal asynchronously; a count read
        # immediately afterwards is stale and would understate progress.
        Start-Sleep -Seconds $SettleSeconds
        $after = Get-DeviceAccountCount
        if ($after -lt 0) { $after = $before }

        $outcome = if ($result.Exit -eq 0 -and $result.Text -match 'Success') {
            if ($after -lt $before) { 'removed' } else { 'uninstalled, account count unchanged' }
        } else {
            'refused: ' + (($result.Text -split "`n")[0]).Trim()
        }

        if ($result.Exit -eq 0 -and $result.Text -match 'Success') {
            [void]$script:removedPackages.Add($pkg)
        }
        Record-Attempt -Rung 'AUTHENTICATOR' -Target $pkg -Outcome $outcome `
            -CountBefore $before -CountAfter $after

        if ($outcome -eq 'refused: ' + (($result.Text -split "`n")[0]).Trim()) {
            Write-Step ('        refused: ' + (($result.Text -split "`n")[0]).Trim())
        }
    }
} else {
    foreach ($item in $order) {
        $protected = ($ProtectedPackages -contains $item.Package)
        Record-Attempt -Rung 'AUTHENTICATOR' -Target $item.Package `
            -Outcome $(if ($protected) { 'would skip: protected' } else { 'would attempt' }) `
            -CountBefore -1 -CountAfter -1
    }
}

# --------------------------------------------------------------------------
# 5. Verify, then Rung 3 - the human gate
# --------------------------------------------------------------------------
$remaining = Get-DeviceAccountCount
Write-Step ('after rung 2: ' + $remaining + ' account(s) remain')

$gateReached = $false

if ($remaining -gt 0) {
    $gateReached = $true
    if ($DryRun) {
        Write-Step ('rung 3: would enter the human gate for ' + $remaining + ' account(s)')
    } else {
    Write-Output ''
    Write-Output '=================================================================='
    Write-Output (' HUMAN GATE - ' + $remaining + ' account(s) could not be removed')
    Write-Output ' automatically.'
    Write-Output '=================================================================='
    Write-Output ''
    Write-Output ' WHAT TO DO:'
    Write-Output '   On the phone, open Settings and remove the remaining accounts'
    Write-Output '   by hand. Samsung requires a password for the Samsung account,'
    Write-Output '   and Google accounts removed from Settings are removed without'
    Write-Output '   prompting.'
    Write-Output ''
    Write-Output ' WHERE:'
    Write-Output '   Settings  >  Accounts and backup  >  Accounts'
    Write-Output '   Tap each entry  >  Remove account  >  Remove account (confirm)'
    Write-Output ''
    Write-Output ' THEN:'
    Write-Output '   Reboot the phone. Samsung can keep reporting a stale count'
    Write-Output '   until AccountManager is restarted, which has been observed to'
    Write-Output '   block enrolment even after the list looks empty.'
    Write-Output ''
    Write-Output ' FINALLY:'
    Write-Output '   Re-run this script to verify and complete the attestation.'
    Write-Output '=================================================================='
    }

    if (-not $DryRun -and -not $SkipHumanGate) {
        $reply = Read-Host 'Type DONE once the list is empty and the phone has rebooted (or press Enter to stop)'
        if ($reply -match '^(DONE|done)$') {
            # The reboot may not have happened yet; re-read rather than trust.
            $remaining = Get-DeviceAccountCount
            Write-Step ('after human gate: ' + $remaining + ' account(s) remain')
        }
    }
    Record-Attempt -Rung 'HUMAN' -Target 'operator' `
        -Outcome $(if ($remaining -le 0) { 'completed' } else { 'pending: ' + $remaining + ' remain' }) `
        -CountBefore $remaining -CountAfter $remaining
}

# --------------------------------------------------------------------------
# 6. Attestation
# --------------------------------------------------------------------------
$finalCount = Get-DeviceAccountCount
$clean = Test-DeviceOwnerPrecondition -AccountCount $finalCount
$completedAt = Get-Date -Format 'o'

$attestation = New-AttestationRecord `
    -BaselineCount $baseline `
    -FinalCount $finalCount `
    -DeviceModel $deviceModel `
    -AndroidRelease $androidRelease `
    -PrimitiveStatus $primitiveStatus `
    -Attempts @($script:attempts) `
    -RemovedPackages @($script:removedPackages) `
    -StartedAt $startedAt `
    -CompletedAt $completedAt

if (-not $OutFile) {
    $OutFile = Join-Path $here 'attestation-latest.json'
}
$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$json = ($attestation | ConvertTo-Json -Depth 8)

# Belt and braces: refuse to persist anything that looks like an identifier.
if ($json -match '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}') {
    Write-Output ''
    Write-Output 'ERROR: the attestation contains an account identifier. Refusing to write it.'
    exit 6
}

if (-not $DryRun) {
    # PowerShell 5.1's `Set-Content -Encoding UTF8` emits a BOM, which strict JSON
    # parsers reject. Write the bytes directly, without one.
    [System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
    Write-Step ('attestation written: ' + $OutFile)
}

Write-Output ''
Write-Output '------------------------------------------------------------------'
Write-Output ('  baseline      : ' + $baseline)
Write-Output ('  final         : ' + $finalCount)
Write-Output ('  removed       : ' + ($baseline - $finalCount))
Write-Output ('  packages acted: ' + $script:removedPackages.Count)
Write-Output ('  primitive     : ' + $primitiveStatus)
Write-Output ('  CLEAN         : ' + $(if ($clean) { 'YES' } else { 'NO' }))
Write-Output '------------------------------------------------------------------'

if ($DryRun) {
    Write-Output 'DRY RUN - no changes were made.'
    exit 0
}

if ($clean) {
    Write-Output ''
    Write-Output 'Device is clean. Next step (TASK T, phase 2a step 3):'
    Write-Output '    adb shell dpm set-device-owner com.cyvra.sanitization/.SanitizationAdmin'
    exit 0
}

Write-Output ''
Write-Output 'NOT clean. Enrolment will still be refused; complete the human gate'
Write-Output 'above and re-run. Exit code 3.'
exit 3
