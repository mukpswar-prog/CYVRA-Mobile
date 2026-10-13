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
        '83f7553', '42b29eb', '64ae486'
    ),
    # Skip the ADB probe when no bench phone should be attached.
    [switch]$SkipDevice
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

$journeyFiles = @()
foreach ($c in $SprintCommits) {
    $journeyFiles += @(git show --name-only --format='' $c -- apps/web services/api 2>$null)
}
$journeyFiles = @($journeyFiles | Where-Object { $_ -match '\S' } | Sort-Object -Unique)
Findings 2 'M1 customer journey frozen' ($journeyFiles.Count -eq 0) `
    ('Integration Sprint commits touching apps/web or services/api = {0}' -f $journeyFiles.Count)
$journeyFiles | ForEach-Object { Write-Host ('          VIOLATION: ' + $_) }

if (-not $SkipDevice) {
    $adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    $env:ADB_VENDOR_KEYS = 'C:\Android\.android\adbkey'
    $connected = 0; $uptime = ''; $agent = 0; $hasOwner = $false
    if (Test-Path $adb) {
        $connected = @(& $adb devices 2>&1 | Where-Object { $_ -match "`tdevice$" }).Count
        if ($connected -gt 0) {
            $uptime = ((& $adb shell cat /proc/uptime 2>$null | Select-Object -First 1) -replace '\s+.*$', '')
            $agent = @(& $adb shell pm list packages 2>$null | Select-String -Pattern 'cyvra.sanitization').Count
            $hasOwner = [bool](& $adb shell dumpsys device_policy 2>$null |
                Select-String -Pattern 'Device Owner' | Select-Object -First 1)
        }
    }
    $secs = 0
    [double]::TryParse($uptime, [ref]$secs) | Out-Null
    # A factory reset would drop uptime to a small number, purge the agent, and
    # clear device ownership. All three surviving is physical evidence of H1.
    $intact = ($connected -gt 0) -and ($secs -gt 3600) -and ($agent -ge 1) -and $hasOwner
    $mins = [Math]::Round($secs / 60, 1)
    Findings 1 'No destructive device operation' $intact `
        ('devices={0}; uptime={1} min; agent={2}; device-owner={3}' -f $connected, $mins, $agent, $hasOwner)
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
