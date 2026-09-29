<#
.SYNOPSIS
    Builds the CYVRA Mobile Windows installer locally (P6 / P7).

.DESCRIPTION
    One command from the repository root:

        powershell -NoProfile -ExecutionPolicy Bypass -File .\build-local.ps1

    It runs, in this order:

      1. install the JavaScript workspace dependencies
         (pnpm by default; the repository lockfile is pnpm-lock.yaml)
      2. stage the Kotlin payload via scripts/stage-windows-installer-resources.ps1
         -> :host:installDist JARs, a jlink Java runtime, Android platform-tools
      3. run `tauri build` in apps/desktop, which typechecks + bundles the P5
         React UI (beforeBuildCommand) and packages the NSIS and MSI installers
      4. verify the installed layout by running the built executable with
         --selftest; the run must print SELFTEST_OK and readyToScan=true
      5. print the path and size of the executable and of every installer

    This is the local counterpart of .github/workflows/windows-engineering-build.yml.
    It only orchestrates build steps: it does not modify the frozen Kotlin Host,
    the core domain models, or any P2-P5 logic.

.OUTPUTS
    The path of apps/desktop/src-tauri/target/release/cyvra-mobile-desktop.exe
    (also printed as the last line of the console output).

.PARAMETER PackageRunner
    'auto' (default) prefers pnpm and falls back to npm. 'pnpm' and 'npm' force
    a specific package manager. npm is supported for contributors without pnpm,
    but pnpm is what CI and pnpm-lock.yaml use.

.PARAMETER SkipInstall
    Reuse the existing node_modules instead of installing dependencies.

.PARAMETER SkipStage
    Reuse the already staged payload under apps/desktop/src-tauri/.resources.
    Only safe when the Kotlin Host has not changed since the last staging.

.PARAMETER SkipBuild
    Skip `tauri build` and only verify/report the artifacts that already exist.

.PARAMETER SkipVerify
    Skip the installed-layout --selftest run.

.PARAMETER Clean
    Delete generated outputs first (dist/, .resources/, bundles, selftest sim).
    The incremental Rust target directory is kept so the rebuild stays fast.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\build-local.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\build-local.ps1 -Clean -PackageRunner npm
#>
[CmdletBinding()]
param(
    [ValidateSet('auto', 'pnpm', 'npm')]
    [string]$PackageRunner = 'auto',

    [switch]$SkipInstall,
    [switch]$SkipStage,
    [switch]$SkipBuild,
    [switch]$SkipVerify,
    [switch]$Clean
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot    = $PSScriptRoot
$desktopDir  = Join-Path $repoRoot 'apps\desktop'
$tauriDir    = Join-Path $desktopDir 'src-tauri'
$stageScript = Join-Path $repoRoot 'scripts\stage-windows-installer-resources.ps1'
$releaseDir  = Join-Path $tauriDir 'target\release'
$resources   = Join-Path $tauriDir '.resources'
$exePath     = Join-Path $releaseDir 'cyvra-mobile-desktop.exe'

$startedAt = Get-Date

function Write-Step {
    param([string]$Message)
    Write-Host ''
    Write-Host ('==> {0}' -f $Message)
}

<#
    Runs a native tool and turns a non-zero exit code into a real error.

    PowerShell turns native-command stderr into error records, which would
    otherwise abort the script on a successful step that merely prints to
    stderr; this wrapper captures both streams and restores the preference.
#>
function Invoke-Native {
    param(
        [string]$File,
        [string[]]$Arguments,
        [string]$Label,
        [string]$WorkingDirectory = $repoRoot
    )

    $output = @()
    $code   = -1

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        Push-Location $WorkingDirectory
        try {
            $output = @(& $File @Arguments 2>&1 | ForEach-Object { [string]$_ })
            $code   = $LASTEXITCODE
        } finally {
            Pop-Location
        }
    } finally {
        $ErrorActionPreference = $previous
    }

    $text = $output -join [Environment]::NewLine

    if ($code -ne 0) {
        throw ('{0}_FAILED (exit {1}):{2}{3}' -f $Label, $code, [Environment]::NewLine, $text)
    }

    return $text
}

<#
    Picks the package manager.

    pnpm.cmd is looked up explicitly: on Windows pnpm also ships pnpm.ps1,
    which the default execution policy refuses to run.
#>
function Resolve-Runner {
    if ($PackageRunner -eq 'npm') {
        $command = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
        if (-not $command) {
            throw 'NPM_MISSING: npm.cmd was not found on PATH. Install Node.js, or drop -PackageRunner npm to use pnpm.'
        }
        return [pscustomobject]@{ Name = 'npm'; File = $command.Source }
    }

    $candidates = if ($PackageRunner -eq 'pnpm') { @('pnpm.cmd') } else { @('pnpm.cmd', 'npm.cmd') }

    foreach ($candidate in $candidates) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            $name = if ($candidate.StartsWith('pnpm')) { 'pnpm' } else { 'npm' }
            return [pscustomobject]@{ Name = $name; File = $command.Source }
        }
    }

    if ($PackageRunner -eq 'pnpm') {
        throw 'PNPM_MISSING: pnpm.cmd was not found on PATH. Install pnpm, or drop -PackageRunner pnpm to fall back to npm.'
    }

    throw 'PACKAGE_MANAGER_MISSING: neither pnpm.cmd nor npm.cmd was found on PATH.'
}

function Get-DirectorySizeBytes {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return [int64]0 }
    return [int64]((Get-ChildItem $Path -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum)
}

# ------------------------------------------------------------------ preflight --
Write-Step 'Preflight'

if (-not (Test-Path $stageScript)) {
    throw "STAGING_SCRIPT_MISSING: $stageScript"
}
if (-not (Test-Path (Join-Path $desktopDir 'package.json'))) {
    throw "DESKTOP_WORKSPACE_MISSING: $desktopDir"
}

$runner = Resolve-Runner
Write-Host ('package manager : {0} ({1})' -f $runner.Name, $runner.File)
Write-Host ('repository root : {0}' -f $repoRoot)

$jdkHome = $env:JAVA_HOME
if ([string]::IsNullOrWhiteSpace($jdkHome)) { $jdkHome = $env:JDK_HOME }
if ([string]::IsNullOrWhiteSpace($jdkHome) -and (Test-Path 'C:\Program Files\Java')) {
    $candidate = Get-ChildItem 'C:\Program Files\Java' -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName 'bin\jlink.exe') } |
        Sort-Object Name -Descending | Select-Object -First 1
    if ($candidate) { $jdkHome = $candidate.FullName }
}
if ([string]::IsNullOrWhiteSpace($jdkHome)) {
    Write-Warning 'JAVA_HOME is not set; staging will search for a JDK with jlink.exe itself.'
} else {
    Write-Host ('JDK (jlink)     : {0}' -f $jdkHome)
}

if ($Clean) {
    Write-Step 'Clean generated outputs'
    foreach ($path in @(
            (Join-Path $desktopDir 'dist'),
            $resources,
            (Join-Path $releaseDir 'bundle'),
            (Join-Path $releaseDir 'installed-sim')
        )) {
        if (Test-Path $path) {
            Write-Host ('  removing {0}' -f $path)
            Remove-Item $path -Recurse -Force
        }
    }
}

# ---------------------------------------------------------------- 1. JS deps --
if (-not $SkipInstall) {
    Write-Step 'Install JavaScript dependencies'
    if ($runner.Name -eq 'pnpm') {
        Invoke-Native $runner.File @('install', '--frozen-lockfile') 'PNPM_INSTALL' | Out-Null
    } else {
        # npm cannot honour pnpm-lock.yaml; it resolves from package.json and
        # writes package-lock.json. Do not commit that file.
        Write-Warning 'Using npm: package-lock.json may be created. pnpm is the repository lockfile owner; do not commit npm lockfiles.'
        Invoke-Native $runner.File @('install') 'NPM_INSTALL' | Out-Null
    }
} else {
    Write-Step 'Install JavaScript dependencies (skipped)'
}

# ------------------------------------------------------------- 2. Kotlin payload --
if (-not $SkipStage) {
    Write-Step 'Stage installer payload (Host dist, jlink runtime, platform-tools)'

    # The staging script throws on any failure ($ErrorActionPreference = Stop),
    # so a plain in-process call already fails this script loudly.
    if ([string]::IsNullOrWhiteSpace($jdkHome)) {
        & $stageScript
    } else {
        & $stageScript -JdkHome $jdkHome
    }
} else {
    Write-Step 'Stage installer payload (skipped)'
}

$stagedChecks = @(
    @{ Path = (Join-Path $resources 'host\lib');            Label = ':host:installDist JARs' },
    @{ Path = (Join-Path $resources 'runtime\bin\java.exe'); Label = 'jlink Java runtime' },
    @{ Path = (Join-Path $resources 'platform-tools\adb.exe'); Label = 'platform-tools adb' }
)
foreach ($check in $stagedChecks) {
    if (-not (Test-Path $check.Path)) {
        throw ("STAGED_PAYLOAD_MISSING: {0} ({1}). Re-run without -SkipStage." -f $check.Label, $check.Path)
    }
}
Write-Host ('staged payload  : {0:N0} bytes' -f (Get-DirectorySizeBytes $resources))

# ------------------------------------------------------------- 3. tauri build --
if (-not $SkipBuild) {
    Write-Step 'Build and package the Windows desktop application (tauri build)'

    if ($runner.Name -eq 'pnpm') {
        # `pnpm exec tauri build` runs beforeBuildCommand first:
        # `pnpm build && pnpm stage:resources` (typecheck + bundle the P5 UI,
        # then restage the payload), and only then compiles and bundles.
        Invoke-Native $runner.File @('exec', 'tauri', 'build') 'TAURI_BUILD' $desktopDir | Out-Null
    } else {
        Invoke-Native $runner.File @('run', 'tauri', '--', 'build') 'TAURI_BUILD' $desktopDir | Out-Null
    }
} else {
    Write-Step 'Build and package the Windows desktop application (skipped)'
}

if (-not (Test-Path $exePath)) {
    throw "EXECUTABLE_MISSING: $exePath was not produced. Drop -SkipBuild to build it."
}

# ------------------------------------------------- 4. installed-layout selftest --
if (-not $SkipVerify) {
    Write-Step 'Verify installed layout (--selftest)'

    $sim = Join-Path $releaseDir 'installed-sim'
    if (Test-Path $sim) { Remove-Item $sim -Recurse -Force }
    New-Item -ItemType Directory -Path $sim -Force | Out-Null

    # Reproduce the installed layout: executable plus resources/ together.
    Copy-Item $exePath $sim -Force
    Copy-Item $resources (Join-Path $sim 'resources') -Recurse -Force

    # Nothing the build machine has on PATH may satisfy the runtime; only what
    # the installer actually ships may be used.
    Remove-Item Env:JAVA_HOME  -ErrorAction SilentlyContinue
    Remove-Item Env:CYVRA_HOME -ErrorAction SilentlyContinue

    $outFile = Join-Path $sim 'selftest.out'
    $errFile = Join-Path $sim 'selftest.err'

    $process = Start-Process -FilePath (Join-Path $sim 'cyvra-mobile-desktop.exe') `
        -ArgumentList '--selftest' -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile

    $report = (@(Get-Content $outFile -ErrorAction SilentlyContinue) +
               @(Get-Content $errFile -ErrorAction SilentlyContinue)) -join [Environment]::NewLine
    Write-Host $report

    if ($process.ExitCode -ne 0 -or $report -notmatch 'SELFTEST_OK') {
        throw ('SELFTEST_FAILED (exit {0}): the installed layout would not run on a clean machine.' -f $process.ExitCode)
    }
    if ($report -notmatch 'readyToScan=true') {
        throw 'SELFTEST_NOT_READY: the Host answered, but preflight did not report readyToScan=true.'
    }
    foreach ($expected in @('runtime\bin\java.exe', 'platform-tools\adb.exe')) {
        if ($report -notlike "*$expected*") {
            throw "SELFTEST_RUNTIME_MISSING: selftest did not resolve the bundled $expected"
        }
    }
    Write-Host 'installed layout OK: bundled Java runtime and adb resolved from resources/.'
} else {
    Write-Step 'Verify installed layout (--selftest) (skipped)'
}

# ------------------------------------------------------------- 5. report output --
$nsis = @(Get-ChildItem (Join-Path $releaseDir 'bundle\nsis') -Filter '*-setup.exe' -File -ErrorAction SilentlyContinue)
$msi  = @(Get-ChildItem (Join-Path $releaseDir 'bundle\msi') -Filter '*.msi' -File -ErrorAction SilentlyContinue)

$artifacts = @($exePath) + @($nsis | ForEach-Object { $_.FullName }) + @($msi | ForEach-Object { $_.FullName })
$total = [int64]0

Write-Step 'Artifacts (UNSIGNED ENGINEERING ARTIFACT - no code signing)'
foreach ($artifact in $artifacts) {
    $item = Get-Item $artifact
    $total += $item.Length
    Write-Host ('  {0}  {1} bytes' -f $item.FullName, $item.Length)
}
Write-Host ('  total: {0:N0} bytes' -f $total)
Write-Host ('  expected installed root: <install dir>\resources (this is <cyvra.home>)')

if ($nsis.Count -eq 0 -and $msi.Count -eq 0) {
    Write-Warning 'No installer bundle was produced (msi/nsis). Only the bare executable exists.'
}

Write-Host ''
Write-Host ('BUILD_OK in {0:n1}s' -f ((Get-Date) - $startedAt).TotalSeconds)
Write-Host ('FINAL_EXECUTABLE: {0}' -f $exePath)
