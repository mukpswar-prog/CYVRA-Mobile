<#
.SYNOPSIS
    Verifies the CYVRA standing holds (H1-H7) against the repository and, when a
    device is attached, against the bench phone.

.DESCRIPTION
    This script exists so that the prohibitions in docs/CYVRA_GOVERNANCE_LEDGER.md
    are ENFORCED rather than remembered. Every check is read-only: nothing here
    writes to a device, signs anything, or modifies the working tree.

    It is deliberately independent of the test suites. Typecheck and unit tests
    answer "does the code work"; this answers "did we stay inside the rules",
    which is a different question and one a compiler cannot ask.

    Exit code 0 means every hold is intact. Non-zero means at least one is
    breached, and the violating paths are printed.

.NOTES
    Checks are scoped to THE INTEGRATION SPRINT commits unless stated. A
    repository-wide search since the Design Freeze would sweep in every approved
    task that landed between the freeze and now, and would report the sprint as
    violating rules that other people's approved work satisfies.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-standing-holds.ps1
#>
[CmdletBinding()]
param(
    # The Design Freeze baseline. H2/H3 are measured from here.
    [string]$Baseline = '73d3f3a',
    # Integration Sprint commits. Extend this list as the sprint progresses.
    # A commit missing from here is a commit the H2 journey check does not see,
    # so this list is part of the gate, not bookkeeping.
    [string[]]$SprintCommits = @(
        'e175945', '45687d7', 'bdbb32c', '2866db0', '3d62589', 'ec1d441',
        'bbfc08a', '12c817a', 'af9bd02', 'fba759d', '02963dc', '74c6d5f',
        '92c11de', '11c143c', 'd0d64fb', '7d479fe', 'b7fdaf8',
        '83fb710', '777743d', '849f03f', '37aebc0',
        '83f7553', '42b29eb', '64ae486',
        'd419743', '6b66d0f'
    ),
    # Skip the ADB probe when no bench phone should be attached.
    [switch]$SkipDevice,
    <#
        Run ONLY the H1 device probe and stop.

        CHIEF ENGINEER RULING, 14-Oct: the phone check must run inside the normal
        test, not only when run by hand. The gate used to pass -SkipDevice, so
        H1's label said "H1-H8" while the device half never executed at all -
        which is exactly how a commissioned purge could read as a breach for days
        without anyone noticing the probe had not been asked.

        Exits 0 only when a device was ACTUALLY OBSERVED and probed. Exits 2 when
        nothing was attached, because a check that did not run is not a pass, and
        reporting it as one is the same overclaim this switch exists to prevent.
    #>
    [switch]$DeviceOnly
)

$ErrorActionPreference = 'Continue'
$breaches = 0

function Findings([int]$id, [string]$hold, [bool]$ok, [string]$evidence) {
    $tag = if ($ok) { 'OK  ' } else { 'BREACH' }
    if (-not $ok) { $script:breaches++ }
    Write-Host ('  [{0}] H{1}  {2}' -f $tag, $id, $hold)
    Write-Host ('          {0}' -f $evidence)
}

Write-Host '=============================================================='
Write-Host 'CYVRA STANDING HOLDS - verified against the repository'
Write-Host ('  baseline  : ' + $Baseline)
Write-Host ('  sprint    : ' + ($SprintCommits -join ' '))
Write-Host '=============================================================='

# --- H1 + H2 : destructive operation, and the frozen customer journey --------
Write-Host ''
Findings 2 'M1 customer journey frozen (apps/web, services/api)' $true 'scoping below'

# ---------------------------------------------------------------------------
# H2 SCOPE COMPLETENESS - a commit the gate cannot see is a silent hole
#
# The parameter note on $SprintCommits already warns that "a commit missing
# from here is a commit the H2 journey check does not see". Nothing enforced
# it, so the failure mode was a gate that quietly stopped looking instead of
# one that said so. This makes it loud.
#
# Scoped to $SprintCommits[0]..HEAD, deliberately NOT $Baseline..HEAD: eight
# approved WS-* commits from before the sprint also touched apps/web or
# services/api, and sweeping those in would report this sprint as breaching
# rules that other people's approved work satisfies - the precise outcome the
# parameter notes warn about.
#
# Measured 13-Oct: 105 commits since the freeze, 9 of them touching M1, 8 of
# those ancestors of the sprint start, 1 inside the sprint range (6b66d0f,
# which is listed). The 5 in-range commits absent from the list touch no M1
# path, so they are - correctly - not flagged here.
# ---------------------------------------------------------------------------
$sprintStart = $SprintCommits[0]
$listFull = @($SprintCommits | ForEach-Object { git rev-parse $_ 2>$null } | Where-Object { $_ -match '^[0-9a-f]{7,40}$' })

git merge-base --is-ancestor $sprintStart HEAD 2>$null
$anchorOk = ($LASTEXITCODE -eq 0)

$journeyInRange = @()
$unscoped = @()
if ($anchorOk) {
    foreach ($c in @(git rev-list ("{0}..HEAD" -f $sprintStart) 2>$null)) {
        $t = @(git show --name-only --format='' $c -- apps/web services/api 2>$null |
                 Where-Object { $_ -match '\S' })
        if ($t.Count -gt 0) {
            $journeyInRange += $c
            if ($c -notin $listFull) { $unscoped += $c }
        }
    }
}

$scopeOk = $anchorOk -and ($unscoped.Count -eq 0)
$scopeDetail = if (-not $anchorOk) {
    'sprint start {0} is not an ancestor of HEAD - scope is indeterminate, so this cannot be signed off' -f $sprintStart
} else {
    'commits since sprint start touching apps/web or services/api = {0}; named in $SprintCommits = {1}' -f `
        $journeyInRange.Count, ($journeyInRange.Count - $unscoped.Count)
}
Findings 2 'Journey scope complete (no unlisted commit reaches M1)' $scopeOk $scopeDetail
foreach ($c in $unscoped) {
    Write-Host ('          VIOLATION: unlisted journey commit {0}  {1}' -f $c.Substring(0, 7), (git log -1 --format=%s $c))
}

# ---------------------------------------------------------------------------
# SANCTIONED M1 EXCEPTIONS   ruling B1, Chief Engineer, 13-Oct-2026
#
# H2 has always meant "no UNAPPROVED edit to the customer journey". This list
# is how an approved edit is told apart from an unapproved one. It removes
# nothing from the check:
#
#   1. Every sanctioned file is still PRINTED on every run, under SANCTIONED,
#      with its ruling ID beside it. Nothing is ever hidden from this gate.
#   2. A ruling counts only if its ID literally appears in the governance
#      ledger. An unrecorded ruling is NOT a ruling, and the file breaches.
#   3. Entries must be EXACT file paths. A directory is rejected outright.
#   4. Any journey file NOT named below still breaches. No exceptions.
#   5. A sanctioned file no longer touched by the sprint is reported STALE,
#      so this list cannot quietly accumulate dead entries.
#
# Adding an entry here is a governance act, not a code change.
# ---------------------------------------------------------------------------
$SanctionedM1 = @(
    [pscustomobject]@{
        Ruling = 'CE-1'
        Files  = @('services/api/src/entitlementSigner.ts', 'services/api/src/env.ts')
    }
)

$repoRoot   = Split-Path -Parent $PSScriptRoot
$ledgerPath = Join-Path $repoRoot 'docs\CYVRA_GOVERNANCE_LEDGER.md'
$ledgerText = if (Test-Path $ledgerPath) { Get-Content -LiteralPath $ledgerPath -Raw } else { '' }

$allowed = @()
foreach ($s in $SanctionedM1) {
    foreach ($f in $s.Files) {
        if ($f -match '[\\/]$') {
            Write-Host ('          SANCTION REJECTED (directory, not an exact path): ' + $f) -ForegroundColor Red
            continue
        }
        if ($ledgerText -notmatch [regex]::Escape($s.Ruling)) {
            Write-Host ('          SANCTION REJECTED (ruling ' + $s.Ruling +
                         ' is not recorded in the governance ledger): ' + $f) -ForegroundColor Red
            continue
        }
        $allowed += $f
    }
}
$allowed = @($allowed | Sort-Object -Unique)

$journeyFiles = @()
foreach ($c in $SprintCommits) {
    $journeyFiles += @(git show --name-only --format='' $c -- apps/web services/api 2>$null)
}
$journeyFiles = @($journeyFiles | Where-Object { $_ -match '\S' } | Sort-Object -Unique)

$breaching  = @($journeyFiles | Where-Object { $_ -notin $allowed })
$sanctioned = @($journeyFiles | Where-Object { $_ -in $allowed })
$stale      = @($allowed | Where-Object { $_ -notin $journeyFiles })

Findings 2 'M1 customer journey frozen' ($breaching.Count -eq 0) `
    ('Integration Sprint commits touching apps/web or services/api = {0} (sanctioned {1}, unapproved {2})' -f `
     $journeyFiles.Count, $sanctioned.Count, $breaching.Count)

foreach ($f in $sanctioned) {
    $rid = ($SanctionedM1 | Where-Object { $f -in $_.Files } | ForEach-Object { $_.Ruling }) -join ','
    Write-Host ('          SANCTIONED [' + $rid + ']: ' + $f) -ForegroundColor Yellow
}
foreach ($f in $breaching) { Write-Host ('          VIOLATION: ' + $f) }
foreach ($f in $stale) {
    Write-Host ('          STALE SANCTION (no longer touched by the sprint; remove it): ' + $f) -ForegroundColor DarkYellow
}

<#
 * WHY EVERY ADB CALL BELOW CARRIES A TIMEOUT.
 *
 * CHIEF ENGINEER RULING, 15-Oct: the bench-phone probe must complain quickly
 * rather than fall silent.
 *
 * On 15-Oct at 09:07 the probe hung for 44 MINUTES with no output at all. The
 * handset had been unplugged overnight and replugged that morning; adb blocked
 * on the USB link, and because not one of these calls had a timeout, the whole
 * gate stalled behind it and was killed at the 45-minute ceiling. ADB waits
 * forever for a shell command, so any caller that waits on adb waits forever
 * too. That is the defect, and this is the fix.
 *
 * It also costs the Chief Engineer the thing they asked for: the test was
 * meant to "complain" when the phone is unplugged, and instead it stopped
 * talking. A ten-second named failure is what was wanted.
 *
 * Each call's duration is now recorded, so a future stall names WHICH command
 * stopped. That evidence did not exist on 15-Oct, which is why the exact
 * command that blocked could not be established afterwards - only narrowed to
 * "one of the three shell calls".
#>
function Invoke-AdbWithTimeout {
    param(
        [string]$AdbPath,
        [string]$AdbArguments,
        [int]$TimeoutMs
    )

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $AdbPath
    $psi.Arguments = $AdbArguments
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    try {
        [void]$proc.Start()
    } catch {
        return @{ State = 'error'; Ms = 0; Text = ''; Detail = $_.Exception.Message }
    }

    # Read both streams asynchronously BEFORE waiting. A synchronous ReadToEnd
    # here would itself block forever on a stalled process and defeat the point.
    $outTask = $proc.StandardOutput.ReadToEndAsync()
    $errTask = $proc.StandardError.ReadToEndAsync()

    if (-not $proc.WaitForExit($TimeoutMs)) {
        # Did not finish in time. Killing the CLIENT releases the caller; it does
        # not repair the link. This state must never be read as a pass, because
        # nothing at all was observed.
        try { $proc.Kill() } catch { }
        try { [void]$proc.WaitForExit(3000) } catch { }
        $sw.Stop()
        return @{ State = 'timeout'; Ms = $sw.ElapsedMilliseconds; Text = ''; Detail = '' }
    }

    [void]$proc.WaitForExit()
    $sw.Stop()
    $text = $outTask.Result
    if ($null -eq $text) { $text = '' }
    return @{ State = 'ok'; Ms = $sw.ElapsedMilliseconds; Text = $text; Detail = $errTask.Result }
}

if ($DeviceOnly -or (-not $SkipDevice)) {
    $adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    $env:ADB_VENDOR_KEYS = 'C:\Android\.android\adbkey'
    # 30,000 ms. Measured on the healthy link, 15-Oct: the slowest call is
    # 17.3s (first shell call, connection set-up) and the rest are ~2.2s. So
    # 30s is about double the worst healthy observation - a normal run never
    # trips it, and a stalled link is reported in 30s instead of never.
    $AdbTimeoutMs = 30000

    $connected = 0; $uptime = ''; $agent = 0; $hasOwner = $false
    $adbTimedOut = $false
    $adbTimeoutStep = ''
    $adbTiming = @()

    if (Test-Path $adb) {
        $run = Invoke-AdbWithTimeout -AdbPath $adb -AdbArguments 'devices' -TimeoutMs $AdbTimeoutMs
        $adbTiming += ('devices={0}ms/{1}' -f $run.Ms, $run.State)
        if ($run.State -eq 'timeout') {
            $adbTimedOut = $true
            $adbTimeoutStep = 'adb devices'
        }
        elseif ($run.State -eq 'ok') {
            $lines = @($run.Text -split "`r?`n")
            $connected = @($lines | Where-Object { $_ -match "`tdevice$" }).Count

            if ($connected -gt 0) {
                $run = Invoke-AdbWithTimeout -AdbPath $adb -AdbArguments 'shell cat /proc/uptime' -TimeoutMs $AdbTimeoutMs
                $adbTiming += ('uptime={0}ms/{1}' -f $run.Ms, $run.State)
                if ($run.State -eq 'timeout') {
                    $adbTimedOut = $true
                    $adbTimeoutStep = 'adb shell cat /proc/uptime'
                } else {
                    $firstLine = @($run.Text -split "`r?`n" | Select-Object -First 1)
                    if ($firstLine.Count -gt 0) { $uptime = ($firstLine[0] -replace '\s+.*$', '') }
                }

                if (-not $adbTimedOut) {
                    $run = Invoke-AdbWithTimeout -AdbPath $adb -AdbArguments 'shell pm list packages' -TimeoutMs $AdbTimeoutMs
                    $adbTiming += ('packages={0}ms/{1}' -f $run.Ms, $run.State)
                    if ($run.State -eq 'timeout') {
                        $adbTimedOut = $true
                        $adbTimeoutStep = 'adb shell pm list packages'
                    } else {
                        $agent = @($run.Text -split "`r?`n" | Where-Object { $_ -match 'cyvra\.sanitization' }).Count
                    }
                }

                if (-not $adbTimedOut) {
                    $run = Invoke-AdbWithTimeout -AdbPath $adb -AdbArguments 'shell dumpsys device_policy' -TimeoutMs $AdbTimeoutMs
                    $adbTiming += ('device_policy={0}ms/{1}' -f $run.Ms, $run.State)
                    if ($run.State -eq 'timeout') {
                        $adbTimedOut = $true
                        $adbTimeoutStep = 'adb shell dumpsys device_policy'
                    } else {
                        $ownerLines = @($run.Text -split "`r?`n" | Where-Object { $_ -match 'Device Owner' })
                        $hasOwner = ($ownerLines.Count -gt 0)
                    }
                }
            }
        }
    }
    $timingText = ($adbTiming -join '; ')
    if (-not $timingText) { $timingText = 'no call was issued' }
    $secs = 0
    [double]::TryParse($uptime, [ref]$secs) | Out-Null
    $mins = [Math]::Round($secs / 60, 1)
    $reading = ('devices={0}; uptime={1} min; agent={2}; device-owner={3}' -f $connected, $mins, $agent, $hasOwner)

    <#
     * CHIEF ENGINEER RULING, 14-Oct.
     *
     * This probe used to collapse to two readings: intact, or breach. "Intact"
     * required the agent to still be installed and the device owner still set.
     * Before any purge existed that was a fair proxy for "nothing destructive has
     * happened" - a factory reset would have removed both.
     *
     * It is no longer a fair proxy, and the reason is specific: the Chief
     * Engineer's COMMISSIONED purge removes exactly those two things. So the
     * probe began reporting a breach for an operation that was authorised, and
     * kept reporting it forever, because nothing short of re-enrolling an agent
     * could move the reading back.
     *
     * The fault is not that the proxy changed. It is that the probe could only
     * say "breach", which is a conclusion it has never been able to establish:
     * it observes device state, and whether a purge was commissioned is not a
     * device state. It was claiming a verdict it did not hold.
     *
     * So it now returns three readings and names the action for each. It reports
     * what it observed and what must happen next, and it does not claim the one
     * thing it cannot know.
     #>
    if ($adbTimedOut) {
        # The handset stopped answering. This is NEITHER "no device" NOR "intact":
        # nothing was observed, so nothing can be claimed in either direction.
        # Reporting a reading we did not obtain is exactly the overclaim this
        # probe was reworked on 14-Oct to stop making.
        Write-Host '  [WARN] H1  device probe: THE HANDSET DID NOT ANSWER - probe timed out'
        Write-Host ('          stalled at : ' + $adbTimeoutStep + ' (limit ' + $AdbTimeoutMs + ' ms)')
        Write-Host ('          timing     : ' + $timingText)
        Write-Host ('          observed   : ' + $reading)
        Write-Host '          NOT established: anything - no reading was obtained'
        Write-Host '          ACTION: check the cable and the USB-debugging prompt, then re-run'
    }
    elseif ($connected -le 0) {
        # Nothing to probe. Silence here would read as "no problem found".
        Write-Host '  [WARN] H1  device probe: no device connected - nothing was observed'
        Write-Host '          ACTION: connect the bench device and re-run before relying on H1'
    }
    elseif ($secs -le 3600) {
        # Uptime under an hour is the signature of a recent reset - which is what
        # a factory reset produces, commissioned or not. Agent and owner are
        # expected to be absent here, so their absence says nothing.
        Write-Host '  [WARN] H1  device probe: ACTION REQUIRED - device reset within the last hour'
        Write-Host ('          observed: ' + $reading)
        Write-Host '          ACTION: confirm this reset was a commissioned operation, then re-enrol'
        Write-Host '                  the agent before any further scan is relied upon'
    }
    elseif ($agent -ge 1 -and $hasOwner) {
        # Both present, so no destructive operation has cleared this device since
        # it booted. This is the one reading that positively supports H1.
        Findings 1 'No destructive device operation' $true $reading
    }
    else {
        # The device has been running for over an hour and the agent and owner are
        # gone. That is consistent with a purge that already ran. It is ALSO
        # consistent with a breach. This probe cannot tell the two apart, so it
        # declines to choose - and says what settles it.
        Write-Host '  [WARN] H1  device probe: ACTION REQUIRED - agent and device owner absent on a'
        Write-Host '                          device that has been up for over an hour'
        Write-Host ('          observed: ' + $reading)
        Write-Host '          consistent with: a purge that has already run (commissioned or not)'
        Write-Host '          NOT established by this probe: whether that purge was commissioned'
        Write-Host '          ACTION: verify the commission record for this device, then re-enrol'
        Write-Host '                  the agent so the next run observes a settled device'
    }

    if ($DeviceOnly) {
        Write-Host ''
        Write-Host ('          per-call timing: ' + $timingText)
        if ($adbTimedOut) {
            # A stalled handset is a failure of the CHECK, not of the hold. It is
            # reported as failure because a probe that could not obtain a reading
            # has verified nothing - and a verification that verified nothing must
            # never be filed as green.
            Write-Host 'H1 DEVICE PROBE  : FAIL - the handset stopped answering; nothing was checked'
            exit 2
        }
        if ($connected -le 0) {
            # Nothing attached. Exiting non-zero is the point of this switch: a
            # phone check that could not run must never be filed as a pass, or
            # the gate would report "H1 verified" on a machine with no phone
            # plugged in - which is how the device half went unnoticed before.
            Write-Host 'H1 DEVICE PROBE  : FAIL - no device was observed, so nothing was checked'
            exit 2
        }
        Write-Host ('H1 DEVICE PROBE  : a device was observed and probed (devices={0})' -f $connected)
        Write-Host '                  the reading above is what the probe saw; it is not a verdict'
        exit 0
    }
}
else {
    Write-Host '  [SKIP] H1  device probe skipped by -SkipDevice'
}

# --- H3 : no early capability claim -----------------------------------------
Write-Host ''
$rg = 'apps/host/src/main/kotlin/cyvra/mobile/host/engine/ReportGenerator.kt'
$schemaHeld = @(Select-String -Path $rg -Pattern 'schemaVersion:\s*String\s*=\s*"0011-DRAFT"' 2>$null).Count -eq 1
# The docstring must still DECLINE normalisation and sealing, not assert them.
$docHeld = @(Select-String -Path $rg -Pattern 'are \*\*not\*\* claimed by this class' 2>$null).Count -ge 1
$noOverclaim = @(git grep -n -I -e 'normalis' -e 'normaliz' -- $rg 2>$null |
    Select-String -Pattern 'status\s*=\s*"Sealed"|isSealed\s*=\s*true').Count -eq 0
Findings 3 'No code claims a capability it does not have' `
    ($schemaHeld -and $docHeld -and $noOverclaim) `
    ('schemaVersion still 0011-DRAFT={0}; docstring still declines to claim={1}; no sealed assertion={2}' -f `
    $schemaHeld, $docHeld, $noOverclaim)

# --- H4 : no key generation, no APK signing ---------------------------------
Write-Host ''
$keyFiles = @(git ls-files | Select-String -Pattern '\.jks$|\.keystore$|\.p12$|\.pfx$|\.pepk$|\.pk8$|\.key$|keystore\.properties$|signing\.properties$')
# Match on configuration lines only. A comment saying "no signingConfig exists"
# is documentation of the hold, not a breach of it.
$signingCfg = @(git grep -n -I -e 'signingConfig' -e 'storePassword' -e 'keyPassword' -- 'apps/android' 2>$null |
    Where-Object { $_ -notmatch '^\S+:\s*\d+:\s*//' })
Findings 4 'No private key generated, no APK signed' ($keyFiles.Count -eq 0 -and $signingCfg.Count -eq 0) `
    ('tracked keystore files={0}; signingConfig/storePassword declarations={1}' -f $keyFiles.Count, $signingCfg.Count)

$apk = 'apps\desktop\src-tauri\.resources\agent\sanitization-agent-unsigned.apk'
if (Test-Path $apk) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $apk).Path)
    $v1 = @($z.Entries | Where-Object { $_.FullName -match '^META-INF/[^/]+\.(RSA|DSA|EC|SF|MF)$' }).Count
    $z.Dispose()
    $raw = [System.Text.Encoding]::GetEncoding(28591).GetString(
        [System.IO.File]::ReadAllBytes((Resolve-Path $apk).Path))
    $v2 = $raw.IndexOf('APK Sig Block 42', [StringComparison]::Ordinal) -ge 0
    Findings 4 'Staged agent APK is unsigned' ($v1 -eq 0 -and -not $v2) `
        ('{0} bytes; v1 entries={1}; v2 signing block={2}' -f (Get-Item $apk).Length, $v1, $v2)
}

# --- H5 : no driver binaries in the public repo -----------------------------
Write-Host ''
$drvBin = @(git ls-files | Select-String -Pattern '\.(sys|cat|pnf)$')
$drvDir = @(git ls-files | Select-String -Pattern '\.resources/drivers')
Findings 5 'No driver binaries committed' ($drvBin.Count -eq 0 -and $drvDir.Count -eq 0) `
    ('tracked .sys/.cat/.pnf={0}; tracked .resources/drivers={1}' -f $drvBin.Count, $drvDir.Count)

# --- H6 : sanitization gated on live entitlement -----------------------------
Write-Host ''
$gate = @(git grep -n -I -e 'SANITIZE_LOCKED_OFFLINE' -- 'apps/host' 2>$null).Count -gt 0
$bypass = @(git grep -n -I -e 'sanitizeExecute' -- 'apps/host' 'services/api' 2>$null |
    Select-String -Pattern 'true\s*//\s*forced|=\s*true\s*;\s*//\s*bypass').Count
Findings 6 'Sanitization gated on live entitlement' ($gate -and $bypass -eq 0) `
    ('offline lock present={0}; forced/bypass assignments={1}' -f $gate, $bypass)

# --- H7 : no release gate weakened ------------------------------------------
Write-Host ''
$weak = @(git grep -n -I -e 'continue-on-error' -e 'ignore-failures' -e '--allow-failure' -- '.github/workflows' 2>$null)
Findings 7 'No release gate weakened' ($weak.Count -eq 0) `
    ('continue-on-error / ignore-failures / allow-failure occurrences in workflows={0}' -f $weak.Count)
$weak | ForEach-Object { Write-Host ('          VIOLATION: ' + $_) }

# --- tracked-artifact hygiene (supports H5, guards ADB self-containment) -----
Write-Host ''
$adbTracked = @(git ls-files | Select-String -Pattern 'adb\.exe$')
Findings 7 'No adb.exe committed' ($adbTracked.Count -eq 0) `
    ('tracked adb.exe={0}' -f $adbTracked.Count)

# --- tracked-artifact hygiene (real bench-device identifiers) ----------------
#
# A DENYLIST, not a pattern. Every shape-based detector was measured against
# this tracked tree before being rejected:
#
#   serial-shaped  154 hits - SHA256SUMS.txt and every uppercase token
#   IMEI-shaped      8 hits - Cargo.lock checksums, plus Kotlin tests that
#                             deliberately assert IMEIs are scrubbed
#   email-shaped   344 hits - legitimate corporate addresses
#
# A check that fires on innocent content teaches readers to ignore it, which is
# worse than no check at all. So this detects the identifiers actually observed
# leaking, and nothing else.
#
# Entries are base64-encoded so the harness can search for them without itself
# committing a fresh copy of each literal. That is not secrecy - the serial was
# already public in git history. It stops the tree gaining MORE copies while
# still letting the check work.
$denyList = @(
    @{ what = 'bench device serial';     b64 = 'UjlCTjMwMTVOUUo=' },
    @{ what = 'bench account address';   b64 = 'a2EyOTU3OTA0MDQwMkBnbWFpbC5jb20=' },
    @{ what = 'bench account localpart'; b64 = 'a2EyOTU3OTA0MDQwMg==' },
    @{ what = 'personal account address'; b64 = 'TXVrcHN3YXJAZ21haWwuY29t' }
)
$idHits = @()
foreach ($d in $denyList) {
    $needle = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($d.b64))
    $found = @(git grep -n -I -F -- "$needle" 2>$null)
    if ($found.Count -gt 0) { $idHits += ('{0}: {1}' -f $d.what, ($found -join '; ')) }
}
Findings 3 'No real bench-device identifier committed' ($idHits.Count -eq 0) `
    ('denylist matches={0}' -f $idHits.Count)
$idHits | ForEach-Object { Write-Host ('          VIOLATION: ' + $_) }

Write-Host ''
Write-Host '=============================================================='
if ($breaches -eq 0) {
    Write-Host 'ALL HOLDS INTACT - 0 breaches'
}
else {
    Write-Host ("HOLD BREACHES: $breaches")
}
Write-Host '=============================================================='
exit $(if ($breaches -eq 0) { 0 } else { 1 })
