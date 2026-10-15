<#
.SYNOPSIS
    Four-part staged verification - the standard working method, per the Chief
    Engineer's ruling of 15-Oct-2026.

.DESCRIPTION
    THE RULING THIS IMPLEMENTS

      "Staged verification is the standard working method: the activity runs as
       four parts - rules and types, JavaScript tests, Android, Rust - with the
       three memory-heavy suites each isolated in their own part. The Gradle
       daemon is stopped when Android work ends, so no process survives into the
       next part. All 13 checks run; none is skipped, relaxed, or reordered into
       concurrency. The one-shot gate remains the release authority."

    WHAT THIS SCRIPT IS

    An orchestrator and nothing else. It calls `verify-stage-gates.ps1` four
    times, once per part, and reports free memory around each one. It contains
    no check of its own.

    WHY IT CONTAINS NO CHECK OF ITS OWN

    The first version of this script (14-Oct) re-implemented eight of the
    thirteen checks itself. That was a defect, not a convenience:

      * it ran `cargo test --lib` where the gate runs `cargo test`;
      * it ran `:core:test :host:test` where the gate runs different targets;
      * it skipped the M1 freeze, the UTF-8 scan and the absolute-claim scan
        entirely, and said so in its own header;
      * its stage numbers disagreed with the ruling above.

    Two definitions of one check will drift, and when they do the copy that
    drifted is the one that gets run. So there is now exactly ONE definition of
    each check, in `verify-stage-gates.ps1`, and this script asks for it by
    part number. A staged run and a full pass execute the same code.

    COVERAGE - stated so this script can never overstate itself

      runs here : all thirteen gate checks, in four parts -
                    part 1  G-E, G-D (both rows), G-F, G-G, G-A, G-C   = 8 rows
                    part 2  G-B, alone                                  = 1 row
                    part 3  G-H (three rows), then daemon released      = 3 rows
                    part 4  G-I, alone                                  = 1 row
                                                                      -------
                                                                       13 rows

      Nothing is omitted. Running all four parts runs every check a full pass
      runs, and running them separately is what keeps Gradle, vitest and cargo
      from competing for a 6.89 GB machine.

    WHAT THIS IS NOT

    This is NOT the gate. `verify-stage-gates.ps1` with no `-Stage` argument is
    the one-shot full pass and remains the release authority; every commit
    carries that run's log. Green here means the checks passed, not that the
    release gate has been run.

    A FLOOR UNDER MEMORY, NOT A THRESHOLD

    There is no safe free-memory number. G-B has failed at 2.21 GB free and
    passed at 2.14 GB. What matters is peak concurrent load, which is why the
    three suites that load the machine each get a part to themselves.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-staged.ps1

.EXAMPLE
    # fast iteration: halt at the first failing part
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-staged.ps1 -StopOnFirstFailure $true
#>
[CmdletBinding()]
param(
    # Halt at the first failing part instead of running the remaining ones.
    #
    # Default $false: the ruling says all thirteen checks run, and a run that
    # stops at part 1 has told you nothing about parts 2 to 4. Halting early is
    # a convenience for iteration, and when it is used the output says plainly
    # that the remaining checks have NOT run - a stopped run is never reported
    # as green.
    [bool]$StopOnFirstFailure = $false,

    # Run a single part and exit. 1..4. Omit to run all four in order.
    [ValidateSet(0,1,2,3,4)]
    [int]$Stage = 0
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$gateScript = Join-Path $repo 'scripts\verify-stage-gates.ps1'

function Get-FreeGb {
    try { return [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 2) }
    catch { return -1 }
}

$parts = @(
    @{ Index = 1; Name = 'RULES AND TYPES'    ; Rows = 8; Holds = 'G-E, G-D code checks, G-D phone probe, G-F, G-G, G-A, G-C' }
    @{ Index = 2; Name = 'JAVASCRIPT TESTS'   ; Rows = 1; Holds = 'G-B, alone - the check that has failed under memory pressure' }
    @{ Index = 3; Name = 'ANDROID'            ; Rows = 3; Holds = 'G-H three rows, then the Gradle daemon is released' }
    @{ Index = 4; Name = 'RUST'               ; Rows = 1; Holds = 'G-I, alone' }
)

Write-Output 'CYVRA staged verification - four parts, one at a time, low peak memory.'
Write-Output 'Standard working method per the Chief Engineer ruling of 15-Oct-2026.'
Write-Output 'This is NOT the gate: the one-shot pass of verify-stage-gates.ps1 is.'
Write-Output ('free memory at start: {0} GB' -f (Get-FreeGb))

if ($Stage -gt 0) { $parts = @($parts | Where-Object { $_.Index -eq $Stage }) }

$failed = @()
foreach ($part in $parts) {
    $before = Get-FreeGb
    Write-Output ''
    Write-Output ("==== PART {0} of 4 : {1} ====" -f $part.Index, $part.Name)
    Write-Output ("      checks: " + $part.Holds)
    Write-Output ("      free memory before: {0} GB" -f $before)

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & powershell -NoProfile -ExecutionPolicy Bypass -File $gateScript -Stage $part.Index
    $code = $LASTEXITCODE
    $sw.Stop()

    if ($null -eq $code) { $code = 0 }
    $after = Get-FreeGb

    Write-Output ("      free memory after : {0} GB   ({1}s)" -f $after, [math]::Round($sw.Elapsed.TotalSeconds, 1))
    Write-Output ("      PART {0} -> {1}" -f $part.Index, $(if ($code -eq 0) { 'PASS' } else { 'FAIL (exit ' + $code + ')' }))

    if ($code -ne 0) {
        $failed += $part.Index
        if ($StopOnFirstFailure) {
            Write-Output ''
            Write-Output ("HALTED AT PART {0} ({1})." -f $part.Index, $part.Name)
            Write-Output 'The remaining parts have NOT run. This is not green, and it is not'
            Write-Output 'the gate - run verify-stage-gates.ps1 with no argument for a full pass.'
            exit 1
        }
    }
}

Write-Output ''
$ranRows = 0
foreach ($p in $parts) { $ranRows += $p.Rows }
Write-Output ("checks executed: {0} of 13" -f $ranRows)

if ($failed.Count -eq 0) {
    if ($parts.Count -eq 4) {
        Write-Output 'ALL FOUR PARTS GREEN - all thirteen checks ran and passed.'
    }
    Write-Output ''
    Write-Output 'Before a commit, run the one-shot gate:'
    Write-Output '  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-stage-gates.ps1'
    exit 0
}
Write-Output ('FAILED PARTS: ' + ($failed -join ', '))
exit 1
