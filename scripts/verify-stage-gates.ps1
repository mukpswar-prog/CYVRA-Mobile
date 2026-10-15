<#
    CYVRA — STAGE GATE RUNNER
    =========================
    Runs every acceptance gate for a work package and prints one PASS/FAIL row per gate.

    NOTHING here weakens a gate. Where a gate needs a non-default invocation for an
    environmental reason, the reason is printed beside the result so it cannot later be
    mistaken for a silent relaxation.

    USAGE
      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-stage-gates.ps1
      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-stage-gates.ps1 -SkipAndroid -SkipRust
      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-stage-gates.ps1 -SkipWeb        # docs-only change

    EXIT CODE
      0 = every executed gate passed
      1 = at least one gate failed
#>
[CmdletBinding()]
param(
    [switch]$SkipWeb,      # no JS/TS touched
    [switch]$SkipAndroid,  # no Kotlin touched
    [switch]$SkipRust,     # no Rust touched

    # ==========================================================================
    # CHIEF ENGINEER RULING, 15-Oct-2026 - STAGED VERIFICATION
    # ==========================================================================
    #
    #   "Staged verification is the standard working method: the activity runs as
    #    four parts - rules and types, JavaScript tests, Android, Rust - with the
    #    three memory-heavy suites each isolated in their own part. The Gradle
    #    daemon is stopped when Android work ends, so no process survives into the
    #    next part. All 13 checks run; none is skipped, relaxed, or reordered into
    #    concurrency. The one-shot gate remains the release authority."
    #
    # 0 (DEFAULT) runs every check in one pass. That is the release authority and
    # this parameter does not alter it - no check moves, none changes command, and
    # the output rows are in the same order as before this parameter existed.
    #
    # 1..4 runs ONE part of those same checks, so a 6.89 GB machine is never
    # running Gradle, vitest and cargo against each other:
    #
    #   1  rules and types    G-E, G-D (both rows), G-F, G-G, G-A, G-C   = 8 rows
    #   2  javascript tests   G-B, alone                                  = 1 row
    #   3  android            G-H (three rows), then the Gradle daemon is stopped
    #   4  rust               G-I, alone                                  = 1 row
    #                         ------------------------------------------
    #                                            total across 1..4 = 13 rows
    #
    # WHY THE PARTS CAN BE TRUSTED AT ALL: each part invokes the SAME command
    # with the SAME pass criterion it uses in a full pass. There is one
    # definition of each check, in this file, and it is not copied anywhere. A
    # staged run and a full run therefore cannot disagree about a check - they
    # are the same code taking a different route through it.
    #
    # WHAT THIS NEVER DOES: it selects WHICH checks run, never HOW they are
    # judged. No check is relaxed, no exit code is reinterpreted, and running a
    # single part is not "gates green" - a full pass is (H7).
    [ValidateSet(0,1,2,3,4)]
    [int]$Stage = 0
)

# $Stage = 0 means "every stage", which is the release path.
function In-Stage([int]$n) { return ($script:Stage -eq 0 -or $script:Stage -eq $n) }

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$script:results = New-Object System.Collections.ArrayList

# ---------------------------------------------------------------------------
# GATE OUTPUT LOG - added 13-Oct-2026, approved by the Chief Engineer under H7
#
# WHY: a failing gate printed only "See above for more details" with nothing
# above it, so the failing test could not be identified from the console.
#
# WHAT THIS DOES: captures every gate's full output to a file IN ADDITION to
# the console.
#
# WHAT THIS DOES NOT DO: it reads no result, writes no result, and influences
# no decision. Every gate is still judged solely on the $LASTEXITCODE of the
# command it runs, exactly as before. Purely additive diagnostics - the
# pass/fail criteria are untouched (H7).
#
# Logging must never be able to fail a gate, so any error here is swallowed
# and leaves $script:gateLog null, which every writer below checks first.
# ---------------------------------------------------------------------------
$script:gateLogDir  = Join-Path $env:TEMP 'cyvra-stage-gates'
$script:gateLogFile = "gate-run-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss')
$script:gateLog     = Join-Path $script:gateLogDir $script:gateLogFile
# UTF8Encoding($false) = no BOM. PowerShell 5 "Set-Content -Encoding utf8"
# writes a BOM, which is wrong for a log consumed by tooling.
$script:gateEnc     = New-Object System.Text.UTF8Encoding($false)
try {
    if (-not (Test-Path $script:gateLogDir)) {
        New-Item -ItemType Directory -Path $script:gateLogDir -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($script:gateLog,
        "CYVRA stage gate run " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') +
        "`r`nrepo $repo`r`n", $script:gateEnc)
} catch {
    $script:gateLog = $null
}

function Out-GateLog {
    param([Parameter(ValueFromPipeline = $true)][string]$Text)
    process {
        Write-Host $Text
        if ($script:gateLog) {
            try { [System.IO.File]::AppendAllText($script:gateLog, $Text + "`r`n", $script:gateEnc) } catch { }
        }
    }
}

function Add-Result([string]$gate, [string]$what, [string]$status, [string]$note = '') {
    [void]$script:results.Add([pscustomobject]@{
        Gate = $gate; Check = $what; Status = $status; Note = $note
    })
}

function Invoke-Step([string]$gate, [string]$what, [string]$note, [scriptblock]$body) {
    Write-Host "  -> $gate  $what" -ForegroundColor Cyan
    if ($script:gateLog) {
        try {
            # Build the string first. Passing "...{0}..." -f $a, $b inline as a
            # method argument makes the commas ambiguous between the format
            # array and AppendAllText's own parameter list; that parses wrong,
            # throws, and a bare catch{} would hide it forever.
            $hdr = "======== {0}  {1}  [{2}] ========" -f @($gate, $what, (Get-Date -Format 'HH:mm:ss'))
            [System.IO.File]::AppendAllText($script:gateLog, "`r`n" + $hdr + "`r`n", $script:gateEnc)
        } catch {
            Write-Host ("    (log header unavailable: " + $_.Exception.Message + ")") -ForegroundColor DarkGray
        }
    }
    try {
        $ok = & $body
        if ($ok) { Add-Result $gate $what 'PASS' $note }
        else     { Add-Result $gate $what 'FAIL' $note }
    } catch {
        Add-Result $gate $what 'FAIL' ("threw: " + $_.Exception.Message)
    }
}

$pnpm = Join-Path $env:APPDATA 'npm\pnpm.cmd'
if (-not (Test-Path $pnpm)) { throw "pnpm not found at $pnpm" }

Write-Host ""
Write-Host "============================================================" -ForegroundColor White
Write-Host " CYVRA STAGE GATE RUNNER" -ForegroundColor White
Write-Host " repo : $repo" -ForegroundColor DarkGray
Write-Host " time : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor DarkGray
if ($Stage -eq 0) {
    Write-Host " stage: ALL - full pass, the release authority" -ForegroundColor DarkGray
} else {
    Write-Host " stage: part $Stage of 4 (staged run - this is NOT the release authority)" -ForegroundColor DarkYellow
}
if ($script:gateLog) {
    Write-Host " log  : $script:gateLog" -ForegroundColor DarkGray
} else {
    Write-Host " log  : unavailable (this run is console-only)" -ForegroundColor DarkGray
}
Write-Host "============================================================" -ForegroundColor White
Write-Host ""

# ---------------------------------------------------------------------------
# G-E  M1 FREEZE  (the gate that must never move)
# ---------------------------------------------------------------------------
if (In-Stage 1) {
Write-Host "[G-E] M1 freeze: apps/web + services/api must be untouched" -ForegroundColor Yellow
$staged = git diff --name-only HEAD -- apps/web services/api
$untracked = git ls-files --others --exclude-standard -- apps/web services/api
if ($staged -or $untracked) {
    Add-Result 'G-E' 'M1 freeze (apps/web, services/api)' 'FAIL' 'files changed: ' + (@($staged) + @($untracked) -join ', ')
} else {
    Add-Result 'G-E' 'M1 freeze (apps/web, services/api)' 'PASS' 'no changes'
}
Write-Host ""
}

# ---------------------------------------------------------------------------
# G-D  STANDING HOLDS
# ---------------------------------------------------------------------------
if (In-Stage 1) {
Write-Host "[G-D] Standing holds harness" -ForegroundColor Yellow
$holdScript = Join-Path $repo 'scripts\verify-standing-holds.ps1'
if (Test-Path $holdScript) {
    # CHIEF ENGINEER RULING, 14-Oct: the phone check must run inside the normal
    # test, not only when run by hand. This first row is the repository-only half
    # - H1's own code path plus H2-H8.
    Invoke-Step 'G-D' 'verify-standing-holds (code checks)' 'inspects only $SprintCommits via git show; the bench-phone probe runs in the row below' {
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $holdScript -SkipDevice 2>&1 | Out-String
        # The exit code is the harness's own documented contract (.NOTES: "Exit
        # code 0 means every hold is intact"), so it is the authoritative signal.
        # The output test below is belt-and-braces and must match the [BREACH]
        # tag printed once per failing finding - NOT the bare word. PowerShell's
        # -match is case-insensitive, so 'BREACH' also matched the harness's own
        # success line "ALL HOLDS INTACT - 0 breaches" and made this gate
        # impossible to pass whatever the repository's state was. Correcting the
        # pattern restores the intended double-check (exit 0 AND no [BREACH])
        # and relaxes nothing: a real breach trips both halves.
        if ($LASTEXITCODE -eq 0 -and $out -notmatch '\[BREACH\]') { $true } else { Write-Host $out; $false }
    }

    # CHIEF ENGINEER RULING, 14-Oct: this row did not exist before. The gate passed
    # -SkipDevice, so H1's device half never executed while its label claimed H1-H8.
    # The probe now runs on every gate and is visible here. It FAILS when no phone
    # is attached - a check that could not run is not a pass.
    Invoke-Step 'G-D' 'H1 bench-phone probe' 'read-only ADB observation; FAIL here means no phone was attached, not a hold breach' {
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $holdScript -DeviceOnly 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0 -and $out -notmatch '\[BREACH\]') { $true } else { Write-Host $out; $false }
    }
} else {
    Add-Result 'G-D' 'verify-standing-holds (code checks)' 'FAIL' 'script missing'
}
Write-Host ""
}

# ---------------------------------------------------------------------------
# G-F  UTF-8 CLEANLINESS
# ---------------------------------------------------------------------------
if (In-Stage 1) {
Write-Host "[G-F] UTF-8 cleanliness of changed files" -ForegroundColor Yellow
Invoke-Step 'G-F' 'no BOM, strict UTF-8 decode' 'PowerShell 5 Set-Content writes a BOM - avoid it' {
    # git diff does not list untracked files, so a brand-new document - such as
    # the agent-less strategy design - was never checked here at all. A file
    # nobody has committed yet is still a file that is about to be committed.
    $files = @(& git diff --name-only HEAD) + @(& git ls-files --others --exclude-standard)
    $files = @($files | Where-Object { $_ } | Sort-Object -Unique)
    $bad = @()
    $strict = New-Object System.Text.UTF8Encoding($false, $true)
    foreach ($f in $files) {
        if (-not (Test-Path $f)) { continue }
        if ($f -match '\.(png|jpg|jpeg|gif|pdf|zip|keystore|jar|apk|exe|dll|so|ttf|woff2?)$') { continue }
        $bytes = [System.IO.File]::ReadAllBytes((Join-Path $repo $f))
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
            $bad += "$f (BOM)"
            continue
        }
        try { $null = $strict.GetString($bytes) } catch { $bad += "$f (invalid UTF-8)" }
    }
    if ($bad.Count) { Write-Host ("    bad: " + ($bad -join ', ')); $false } else { $true }
}
Write-Host ""

# ---------------------------------------------------------------------------
# G-G  ABSOLUTE-CLAIM SCAN
# ---------------------------------------------------------------------------
Write-Host "[G-G] Absolute-claim scan (no code may claim a capability it lacks)" -ForegroundColor Yellow
Invoke-Step 'G-G' 'zero hits on banned absolute claims' 'A-10 / H3' {
    $patterns = '100% (secure|unrecoverable|guaranteed|complete)|military[- ]grade|forensically (proven|certified)'
    $hits = git grep -n -I -E $patternS -- apps packages services 2>$null
    if ($hits) { Write-Host $hits; $false } else { $true }
}
Write-Host ""
}

# ---------------------------------------------------------------------------
# G-A  TYPECHECK   -- part 1 of 4 (rules and types)
# ---------------------------------------------------------------------------
if ((-not $SkipWeb) -and (In-Stage 1)) {
    Write-Host "[G-A] Typecheck" -ForegroundColor Yellow
    # `pnpm -r typecheck` walks the workspace and runs the script only where a package
    # declares one. apps/desktop does not declare it, so this step alone has never
    # typechecked the desktop application - the note used to say "run tsc -b separately"
    # while nothing in this script did. That is how a `string | null` reaching
    # `string[].includes()` in App.tsx survived behind eleven green gates on 14-Oct.
    # The desktop is now checked below. Same gate, no check removed.
    Invoke-Step 'G-A' 'pnpm -r typecheck' 'skips apps/desktop, which declares no typecheck task' {
        & $pnpm -r --silent typecheck 2>&1 | Out-String | Out-GateLog
        $LASTEXITCODE -eq 0
    }
    Invoke-Step 'G-A' 'desktop tsc -b' 'apps/desktop typecheck; added 14-Oct because nothing covered it before' {
        Push-Location (Join-Path $repo 'apps\desktop')
        try {
            & $pnpm exec tsc -b 2>&1 | Out-String | Out-GateLog
            $LASTEXITCODE -eq 0
        } finally { Pop-Location }
    }

    Write-Host ""
}

# ---------------------------------------------------------------------------
# G-B  UNIT TESTS  -- part 2 of 4 (javascript tests, alone)
# ---------------------------------------------------------------------------
if ((-not $SkipWeb) -and (In-Stage 2)) {
    Write-Host "[G-B] Unit tests" -ForegroundColor Yellow
    # This is the only check in part 2, and that is deliberate. vitest starts a
    # worker per core; on 15-Oct a Gradle daemon left idle overnight held 493 MB
    # and vitest could not start its last worker, so 24 of 71 desktop tests never
    # ran and the gate failed with zero tests failing. Running it alone, with the
    # suites above finished and their memory released, removes that contention.
    Invoke-Step 'G-B' 'pnpm -r test' 'Run with --maxWorkers=1: parallel vitest workers exhaust RAM on this machine. Same tests, serialised scheduling. This is NOT a weakened gate.' {
        & $pnpm -r --silent test -- --maxWorkers=1 2>&1 | Out-String | Out-GateLog
        $LASTEXITCODE -eq 0
    }
    Write-Host ""
}

# ---------------------------------------------------------------------------
# G-C  WORKER API DRY-RUN  -- also part 1 of 4 (rules and types)
# ---------------------------------------------------------------------------
if ((-not $SkipWeb) -and (In-Stage 1)) {
    Write-Host "[G-C] Worker API dry-run" -ForegroundColor Yellow
    # This belongs to part 1 because it is a static check of the worker bundle,
    # not a suite: it holds no working set and adds no contention.
    #
    # It sits AFTER G-B here only so a full pass prints its rows in the order
    # this script printed them before staging existed. Staging is not permitted
    # to reorder the release authority's output, and the blocks below are split
    # three ways purely to preserve that.
    Invoke-Step 'G-C' 'wrangler deploy --dry-run' 'must be run from services/api, not apps/web' {
        Push-Location (Join-Path $repo 'services\api')
        try {
            & npx wrangler deploy --dry-run 2>&1 | Out-String | Out-GateLog
            $LASTEXITCODE -eq 0
        } finally { Pop-Location }
    }
    Write-Host ""
}

# ---------------------------------------------------------------------------
# G-H  ANDROID  -- part 3 of 4 (android)
# ---------------------------------------------------------------------------
if ((-not $SkipAndroid) -and (In-Stage 3)) {
    Write-Host "[G-H] Android" -ForegroundColor Yellow
    $gradle = Join-Path $repo 'apps\android\gradlew.bat'
    if (Test-Path $gradle) {
        Invoke-Step 'G-H' ':core + :host compile' '' {
            Push-Location (Join-Path $repo 'apps\android')
            try { & .\gradlew.bat :core:compileKotlin :host:compileKotlin --console=plain -q 2>&1 | Out-String | Out-GateLog; $LASTEXITCODE -eq 0 }
            finally { Pop-Location }
        }
        Invoke-Step 'G-H' ':host unit tests' '' {
            Push-Location (Join-Path $repo 'apps\android')
            try { & .\gradlew.bat :host:test --console=plain -q 2>&1 | Out-String | Out-GateLog; $LASTEXITCODE -eq 0 }
            finally { Pop-Location }
        }
        Invoke-Step 'G-H' ':sanitization-agent assembleDebug + unit tests' 'proof-of-concept module; see its README' {
            Push-Location (Join-Path $repo 'apps\android')
            try { & .\gradlew.bat :sanitization-agent:assembleDebug :sanitization-agent:testDebugUnitTest --console=plain -q 2>&1 | Out-String | Out-GateLog; $LASTEXITCODE -eq 0 }
            finally { Pop-Location }
        }
    } else {
        Add-Result 'G-H' 'Android build' 'FAIL' 'gradlew.bat missing'
    }
    Write-Host ""

    # ==========================================================================
    # CHIEF ENGINEER RULING, 15-Oct-2026 - the daemon is released here.
    # ==========================================================================
    # Gradle keeps a JVM alive after its last task so the next build is faster.
    # That idle JVM still owns its heap, and nothing else on this machine gets it
    # back. On 15-Oct a daemon left running since the previous evening held 493 MB
    # for roughly twelve hours; the next morning vitest could not start its final
    # worker, 24 of 71 desktop tests never ran, and the gate reported FAIL with
    # zero tests failing. The check had not broken. The machine had run out of
    # room.
    #
    # Stopping the daemon here is housekeeping, not a check, so it cannot pass or
    # fail anything: a failure to stop is recorded in the log and nothing else.
    # The cost is a few seconds of daemon start-up on the next Android build. The
    # benefit is that no JVM from this run is still holding memory when the next
    # part - or tomorrow's run - begins.
    Write-Host "[G-H] releasing the Gradle daemon" -ForegroundColor Yellow
    if (Test-Path $gradle) {
        try {
            & $gradle --stop 2>&1 | Out-String | Out-GateLog
        } catch {
            Write-Host ("    daemon stop did not complete: " + $_.Exception.Message) -ForegroundColor DarkGray
        }
    }
    Write-Host ""
}

# ---------------------------------------------------------------------------
# G-I  RUST  -- part 4 of 4 (rust, alone)
# ---------------------------------------------------------------------------
if ((-not $SkipRust) -and (In-Stage 4)) {
    Write-Host "[G-I] Rust" -ForegroundColor Yellow
    $tauri = Join-Path $repo 'apps\desktop\src-tauri'
    if (Test-Path $tauri) {
        Invoke-Step 'G-I' 'cargo test' '' {
            Push-Location $tauri
            try { & cargo test 2>&1 | Out-String | Out-GateLog; $LASTEXITCODE -eq 0 }
            finally { Pop-Location }
        }
    } else {
        Add-Result 'G-I' 'cargo test' 'SKIP' 'src-tauri not present'
    }
    Write-Host ""
}

# ---------------------------------------------------------------------------
# REPORT
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "============================================================" -ForegroundColor White
Write-Host " GATE RESULTS" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor White
$script:results | Format-Table -AutoSize Gate, Status, Check, Note | Out-String | Out-GateLog

$failed = @($script:results | Where-Object { $_.Status -eq 'FAIL' })
$passed = @($script:results | Where-Object { $_.Status -eq 'PASS' })
Write-Host ("PASSED : " + $passed.Count) -ForegroundColor Green
Write-Host ("FAILED : " + $failed.Count) -ForegroundColor $(if ($failed.Count) { 'Red' } else { 'Green' })
if ($script:gateLog) {
    Write-Host ""
    Write-Host ("Full output of every gate: " + $script:gateLog) -ForegroundColor DarkGray
}

if ($failed.Count) {
    Write-Host ""
    Write-Host "FAILED GATES - a work package may not be committed until these are green." -ForegroundColor Red
    Write-Host "Never relax a gate to make it pass (standing hold H7)." -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "ALL EXECUTED GATES GREEN." -ForegroundColor Green
exit 0
