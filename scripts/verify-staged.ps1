<#
.SYNOPSIS
    Four-stage staged verification - a DEVELOPMENT aid, not a gate.

.DESCRIPTION
    WHY THIS EXISTS
    `verify-stage-gates.ps1` runs every check in one process tree. That is correct for a
    release gate, but it is the worst possible shape for day-to-day work:

      * a syntax error surfaces minutes late, after the expensive suites have already run;
      * Gradle, vitest and cargo hold their working sets at the same time, which is what
        exhausts memory. G-B has failed at 2.21 GB free and passed at 2.14 GB - there is
        no safe threshold, only peak concurrent load.

    Splitting the work into four stages fixes both. Each stage runs alone, so memory is
    released between them, and a compile error stops the run at stage 1 instead of after
    a full test cycle.

    WHAT THIS IS NOT
    This script does NOT replace `verify-stage-gates.ps1`. The official gate remains the
    authority and must still be run - green here is not "gates green". Every commit in
    this repository carries the official gate's log, and that does not change.

    COVERAGE, STATED EXACTLY SO THIS SCRIPT NEVER OVERSTATES ITSELF:
      runs here   : desktop tsc -b, pnpm -r typecheck, :core/:host compile and tests,
                    :sanitization-agent assembleDebug and tests, pnpm -r test,
                    cargo test, wrangler deploy --dry-run, verify-standing-holds.
      does NOT    : M1 freeze check (G-E), no-BOM/strict-UTF-8 (G-F), banned absolute
                    claim grep (G-G). Those three live only inside the official gate, so
                    running this script INSTEAD of that one means those three have not
                    run at all.
    Nothing here is skipped or weakened; the checks it runs are the same ones the gate
    runs, in an order that costs less peak memory.

    Stages:
      1  COMPILE AND TYPES   syntax errors die here, in about a minute
      2  ANDROID TESTS       :core + :host + sanitization-agent
      3  JAVASCRIPT TESTS    pnpm -r test, alone, with the machine otherwise idle
      4  RUST, WORKER, HOLDS cargo + wrangler dry-run + standing holds

    A failing stage prints the tail of the command that failed. A tool that hides why it
    failed is not a diagnostic tool.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-staged.ps1
#>
[CmdletBinding()]
param(
    # Stop after the first failing stage (default). Set $false to run all four.
    [bool]$StopOnFirstFailure = $true,

    # The official gate runs verify-standing-holds.ps1 with -SkipDevice, so G-D has never
    # exercised the H1 DEVICE probe. Default here matches the gate exactly; pass this flag
    # to run the probe as well.
    #
    # KNOWN STATE, so nobody rediscovers it: the H1 device probe reads
    #     $intact = connected -and uptime>3600s -and agent>=1 -and deviceOwner
    # as physical evidence that no destructive operation has occurred. The Chief Engineer's
    # COMMISSIONED purge on 14-Oct removed the agent and the device owner, so that indicator
    # is now false and will stay false until an agent is enrolled again. It reports a breach
    # for an operation that was authorised - an over-report, not a weakened hold. What has
    # actually gone unchecked is the gate's own device probe, which never runs at all.
    [switch]$IncludeDeviceProbe
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Get-FreeGb {
    try { return [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 2) }
    catch { return -1 }
}

# Runs a native command, returns its exit code, and prints the last $Tail lines of its
# output only when it failed. On success it prints nothing, so a green run stays quiet.
function Invoke-Step {
    param(
        [string]$Label,
        [scriptblock]$Command,
        [int]$Tail = 40
    )

    $text = (& $Command 2>&1 | Out-String -Width 220)
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Write-Host ''
        Write-Host ("   !! FAILED: {0}  (exit {1})" -f $Label, $code) -ForegroundColor Red
        $lines = $text -split "`r?`n"
        $start = [Math]::Max(0, $lines.Count - $Tail)
        for ($i = $start; $i -lt $lines.Count; $i++) {
            Write-Host ('   | ' + $lines[$i])
        }
        Write-Host ''
    }
    return $code
}

function Invoke-Stage {
    param(
        [string]$Index,
        [string]$Name,
        [scriptblock]$Body
    )

    $before = Get-FreeGb
    Write-Output ''
    Write-Output ("==== STAGE {0} : {1} ====" -f $Index, $Name)
    Write-Output ("      free memory before: {0} GB" -f $before)

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $code = [int](& $Body)
    $sw.Stop()

    if ($null -eq $code) { $code = 0 }
    $after = Get-FreeGb

    Write-Output ("      free memory after : {0} GB   ({1}s)" -f $after, [math]::Round($sw.Elapsed.TotalSeconds, 1))
    Write-Output ("      STAGE {0} -> {1}" -f $Index, $(if ($code -eq 0) { 'PASS' } else { 'FAIL (exit ' + $code + ')' }))

    return $code
}

$stages = @(
    @{
        Index = 1
        Name  = 'COMPILE AND TYPES'
        Body  = {
            # Default matches verify-stage-gates.ps1, which passes -SkipDevice.
            $holdArgs = @()
            if (-not $IncludeDeviceProbe) { $holdArgs += '-SkipDevice' }

            $code = Invoke-Step 'verify-standing-holds.ps1' {
                & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\verify-standing-holds.ps1') @holdArgs
            }
            if ($code -ne 0) { return $code }

            $code = Invoke-Step 'desktop tsc -b' {
                Push-Location (Join-Path $repo 'apps\desktop')
                try { & "$env:APPDATA\npm\pnpm.cmd" exec tsc -b } finally { Pop-Location }
            }
            if ($code -ne 0) { return $code }

            $code = Invoke-Step 'pnpm -r typecheck' {
                Push-Location $repo
                try { & "$env:APPDATA\npm\pnpm.cmd" -r --silent typecheck } finally { Pop-Location }
            }
            if ($code -ne 0) { return $code }

            # Compile only. No tests yet - that is the point of stage 1: a syntax error
            # costs about a minute here instead of a full test cycle later.
            $code = Invoke-Step 'gradle :core/:host compile' {
                Push-Location (Join-Path $repo 'apps\android')
                try { & .\gradlew.bat :core:compileKotlin :host:compileKotlin :host:compileTestKotlin --console=plain } finally { Pop-Location }
            }
            return $code
        }
    },
    @{
        Index = 2
        Name  = 'ANDROID TESTS'
        Body  = {
            $code = Invoke-Step 'gradle :core/:host/:agent tests + agent assembleDebug' {
                Push-Location (Join-Path $repo 'apps\android')
                try { & .\gradlew.bat :core:test :host:test :sanitization-agent:assembleDebug :sanitization-agent:test --console=plain } finally { Pop-Location }
            }
            return $code
        }
    },
    @{
        Index = 3
        Name  = 'JAVASCRIPT TESTS'
        Body  = {
            # Deliberately alone. This is the stage that has flaked under memory
            # pressure, so nothing else may hold a working set while it runs.
            $code = Invoke-Step 'pnpm -r test' {
                Push-Location $repo
                try { & "$env:APPDATA\npm\pnpm.cmd" -r --silent test -- --maxWorkers=1 } finally { Pop-Location }
            }
            return $code
        }
    },
    @{
        Index = 4
        Name  = 'RUST, WORKER, HOLDS'
        Body  = {
            $code = Invoke-Step 'cargo test --lib' {
                Push-Location $repo
                try { & cargo test --lib } finally { Pop-Location }
            }
            if ($code -ne 0) { return $code }

            $code = Invoke-Step 'wrangler deploy --dry-run' {
                Push-Location (Join-Path $repo 'services\api')
                try { & "$env:APPDATA\npm\pnpm.cmd" exec wrangler deploy --dry-run } finally { Pop-Location }
            }
            return $code
        }
    }
)

Write-Output 'CYVRA staged verification - four stages, one at a time, low peak memory.'
Write-Output 'This is a development aid. The official gate still runs before every commit.'
Write-Output ('free memory at start: {0} GB' -f (Get-FreeGb))

$failed = @()
foreach ($stage in $stages) {
    $code = Invoke-Stage -Index $stage.Index -Name $stage.Name -Body $stage.Body
    if ($code -ne 0) {
        $failed += $stage.Index
        if ($StopOnFirstFailure) {
            Write-Output ''
            Write-Output ("STOPPED AT STAGE {0} ({1})." -f $stage.Index, $stage.Name)
            Write-Output 'Fix that stage before spending time on the ones behind it.'
            Write-Output 'Nothing has been skipped or weakened - the later stages simply have'
            Write-Output 'not run yet, and the official gate has not run at all.'
            exit 1
        }
    }
}

Write-Output ''
if ($failed.Count -eq 0) {
    Write-Output 'ALL FOUR STAGES GREEN.'
    Write-Output 'Now run verify-stage-gates.ps1 - that is the gate, not this script.'
    exit 0
}
Write-Output ('FAILED STAGES: ' + ($failed -join ', '))
exit 1
