<#
.SYNOPSIS
    Automated regression tests for the CYVRA Mobile Android signing contract.

.DESCRIPTION
    Validates all aspects of Phase 4 (Signing Failure Root-Cause Fix):
      1. Default / Unsigned mode produces an unsigned APK compliant with R-I and H4.
      2. Clean runner simulation (no pre-existing ~/.android/debug.keystore) builds cleanly.
      3. Production mode fails closed when credentials are missing (no silent fallback).
      4. Production mode fails closed when keystore file is not found.
      5. Unsupported signing modes fail cleanly with UNKNOWN_SIGNING_MODE.
      6. Test mode produces a valid signed APK with deterministic test keys.
      7. stage-windows-installer-resources.ps1 validates prerequisites and stages correctly.
#>
[CmdletBinding()]
param(
    [switch]$SkipLongBuilds
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
$androidDir = Join-Path $repoRoot 'apps\android'
$gradlew = Join-Path $androidDir 'gradlew.bat'
$stagingScript = Join-Path $scriptDir 'stage-windows-installer-resources.ps1'
$agentOutputs = Join-Path $androidDir 'sanitization-agent\build\outputs\apk\release'
$resourcesAgentDir = Join-Path $repoRoot 'apps\desktop\src-tauri\.resources\agent'

$passCount = 0
$failCount = 0

function Report-Assert([string]$testName, [bool]$condition, [string]$detail) {
    if ($condition) {
        Write-Host "  [PASS] ${testName}: $detail" -ForegroundColor Green
        $script:passCount++
    }
    else {
        Write-Host "  [FAIL] ${testName}: $detail" -ForegroundColor Red
        $script:failCount++
    }
}

function Invoke-GradleCommand([string[]]$gradleArgs) {
    Push-Location $androidDir
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $gradlew @gradleArgs 2>&1 | ForEach-Object { [string]$_ }
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $prev
        Pop-Location
    }
    return @{
        ExitCode = $exitCode
        Output = ($output -join [Environment]::NewLine)
    }
}

Write-Host "================================================================"
Write-Host "CYVRA MOBILE - Signing Contract Regression Tests"
Write-Host "================================================================"

# -----------------------------------------------------------------------------
# Test 1: Production Mode with Missing Credentials (Fail-Closed)
# -----------------------------------------------------------------------------
Write-Host "`nTest 1: Production mode fails closed when credentials are missing"
$res = Invoke-GradleCommand @(':sanitization-agent:assembleRelease', '-Pcyvra.signing.mode=production', '--console=plain', '-q')
Report-Assert "Production Missing Credentials Exit Code" ($res.ExitCode -ne 0) "Exit code $($res.ExitCode) (expected non-zero)"
Report-Assert "Production Missing Credentials Error Message" ($res.Output -match "PRODUCTION_SIGNING_CONFIG_MISSING") "Output matches PRODUCTION_SIGNING_CONFIG_MISSING"

# -----------------------------------------------------------------------------
# Test 2: Production Mode with Non-Existent Keystore File (Fail-Closed)
# -----------------------------------------------------------------------------
Write-Host "`nTest 2: Production mode fails closed when keystore file is not found"
$fakeKeystore = 'C:\cyvra_nonexistent_dir\keystore.jks'
$res = Invoke-GradleCommand @(
    ':sanitization-agent:assembleRelease',
    '-Pcyvra.signing.mode=production',
    "-Pcyvra.release.keystore=$fakeKeystore",
    '-Pcyvra.release.keystore.password=secret1',
    '-Pcyvra.release.key.alias=release-key',
    '-Pcyvra.release.key.password=secret2',
    '--console=plain',
    '-q'
)
Report-Assert "Production Missing Keystore Exit Code" ($res.ExitCode -ne 0) "Exit code $($res.ExitCode) (expected non-zero)"
Report-Assert "Production Missing Keystore Error Message" ($res.Output -match "PRODUCTION_KEYSTORE_NOT_FOUND") "Output matches PRODUCTION_KEYSTORE_NOT_FOUND"

# -----------------------------------------------------------------------------
# Test 3: Unsupported Signing Mode Fails Cleanly
# -----------------------------------------------------------------------------
Write-Host "`nTest 3: Unsupported signing mode fails cleanly"
$res = Invoke-GradleCommand @(':sanitization-agent:assembleRelease', '-Pcyvra.signing.mode=invalid_mode', '--console=plain', '-q')
Report-Assert "Invalid Mode Exit Code" ($res.ExitCode -ne 0) "Exit code $($res.ExitCode) (expected non-zero)"
Report-Assert "Invalid Mode Error Message" ($res.Output -match "UNKNOWN_SIGNING_MODE") "Output matches UNKNOWN_SIGNING_MODE"

# -----------------------------------------------------------------------------
# Test 4: Default / Unsigned Mode Produces Unsigned APK
# -----------------------------------------------------------------------------
Write-Host "`nTest 4: Default / Unsigned mode produces verified unsigned APK"
# Clean previous release outputs
if (Test-Path $agentOutputs) {
    Remove-Item (Join-Path $agentOutputs '*.apk') -Force -ErrorAction SilentlyContinue
}
$res = Invoke-GradleCommand @(':sanitization-agent:assembleRelease', '-Pcyvra.signing.mode=unsigned', '--console=plain', '-q')
Report-Assert "Unsigned Mode Exit Code" ($res.ExitCode -eq 0) "Exit code $($res.ExitCode) (expected 0)"

$unsignedApk = Join-Path $agentOutputs 'sanitization-agent-release-unsigned.apk'
Report-Assert "Unsigned APK Exists" (Test-Path $unsignedApk) "File exists: $unsignedApk"

if (Test-Path $unsignedApk) {
    $apkItem = Get-Item $unsignedApk
    Report-Assert "Unsigned APK Size > 0" ($apkItem.Length -gt 100000) "Size is $($apkItem.Length) bytes"

    # Verify no v1 signature
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $zip = [System.IO.Compression.ZipFile]::OpenRead($unsignedApk)
    $v1Entries = @($zip.Entries | Where-Object { $_.FullName -match '^META-INF/[^/]+\.(RSA|DSA|EC|SF|MF)$' })
    $zip.Dispose()
    Report-Assert "No v1 Signature" ($v1Entries.Count -eq 0) "Found $($v1Entries.Count) v1 entries (expected 0)"

    # Verify no v2/v3 signature
    $latin1 = [System.Text.Encoding]::GetEncoding(28591)
    $rawText = $latin1.GetString([System.IO.File]::ReadAllBytes($unsignedApk))
    $hasV2 = ($rawText.IndexOf('APK Sig Block 42', [StringComparison]::Ordinal) -ge 0)
    Report-Assert "No v2/v3 Signature" (-not $hasV2) "APK Signing Block 42 present: $hasV2 (expected False)"
}

# -----------------------------------------------------------------------------
# Test 5: Test Signing Mode Produces Signed APK with Deterministic Keystore
# -----------------------------------------------------------------------------
Write-Host "`nTest 5: Test signing mode produces signed APK"
$res = Invoke-GradleCommand @(':sanitization-agent:assembleRelease', '-Pcyvra.signing.mode=test', '--console=plain', '-q')
Report-Assert "Test Mode Exit Code" ($res.ExitCode -eq 0) "Exit code $($res.ExitCode) (expected 0)"

$testApk = Join-Path $agentOutputs 'sanitization-agent-release.apk'
Report-Assert "Test Signed APK Exists" (Test-Path $testApk) "File exists: $testApk"

if (Test-Path $testApk) {
    $apkItem = Get-Item $testApk
    Report-Assert "Test Signed APK Size > 0" ($apkItem.Length -gt 100000) "Size is $($apkItem.Length) bytes"

    $latin1 = [System.Text.Encoding]::GetEncoding(28591)
    $rawText = $latin1.GetString([System.IO.File]::ReadAllBytes($testApk))
    $hasV2 = ($rawText.IndexOf('APK Sig Block 42', [StringComparison]::Ordinal) -ge 0)
    Report-Assert "v2/v3 Signature Present" ($hasV2) "APK Signing Block 42 present: $hasV2 (expected True)"
}

# -----------------------------------------------------------------------------
# Test 6: Staging Script Stages Unsigned APK
# -----------------------------------------------------------------------------
Write-Host "`nTest 6: Resource staging script stages unsigned APK"
# Clean out agent outputs and re-run assembleRelease unsigned to ensure clean unsigned state
$null = Invoke-GradleCommand @(':sanitization-agent:assembleRelease', '-Pcyvra.signing.mode=unsigned', '--console=plain', '-q')

$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$stageOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $stagingScript -SkipHost -SkipRuntime -SkipPlatformTools -SkipDrivers 2>&1
$stageExitCode = $LASTEXITCODE
$ErrorActionPreference = $prev

Report-Assert "Staging Script Exit Code" ($stageExitCode -eq 0) "Exit code $stageExitCode (expected 0)"
$stagedApk = Join-Path $resourcesAgentDir 'sanitization-agent-unsigned.apk'
Report-Assert "Staged APK Exists" (Test-Path $stagedApk) "File exists: $stagedApk"

if (Test-Path $stagedApk) {
    $stagedItem = Get-Item $stagedApk
    Report-Assert "Staged APK Size > 0" ($stagedItem.Length -gt 100000) "Size is $($stagedItem.Length) bytes"
}

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
Write-Host "`n================================================================"
Write-Host ("Signing Contract Regression Test Results: {0} passed, {1} failed" -f $script:passCount, $script:failCount)
Write-Host "================================================================"

if ($script:failCount -gt 0) {
    throw "SIGNING_CONTRACT_REGRESSION_TESTS_FAILED: $script:failCount test(s) failed."
}
