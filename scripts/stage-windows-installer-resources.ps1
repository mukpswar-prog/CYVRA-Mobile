<#
.SYNOPSIS
    Stages everything the CYVRA Mobile Windows installer must ship.

.DESCRIPTION
    Produces <src-tauri>/.resources/ containing:

      host/            the :host:installDist distribution (JARs)
      runtime/         a trimmed Java runtime built with jlink
      platform-tools/  adb.exe and its support DLLs
      drivers/         Android USB driver packages (Samsung + Google)

    tauri.conf.json maps that tree to `resources/` inside the installation
    directory, and host_process.rs resolves it at runtime relative to the
    executable. An installed copy therefore never depends on a source checkout,
    a preinstalled JDK, or an Android SDK (P1 exit gate).

    The script is cwd-independent ($PSScriptRoot) so it can be called from
    `beforeBuildCommand`, CI, or a developer shell alike.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stage-windows-installer-resources.ps1
#>
[CmdletBinding()]
param(
    [string]$ResourcesDir,
    [string]$JdkHome = $env:JAVA_HOME,
    [string]$DriversRoot,
    [switch]$SkipHost,
    [switch]$SkipRuntime,
    [switch]$SkipPlatformTools,
    [switch]$SkipDrivers,
    [switch]$RequireDrivers,
    [switch]$NoDownload,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$repoRoot       = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tauriDir       = Join-Path $repoRoot 'apps\desktop\src-tauri'
$androidDir     = Join-Path $repoRoot 'apps\android'
$hostInstallDir = Join-Path $repoRoot 'apps\host\build\install\cyvra-mobile-host\lib'

if (-not $ResourcesDir) {
    $ResourcesDir = Join-Path $tauriDir '.resources'
}
$ResourcesDir = [System.IO.Path]::GetFullPath($ResourcesDir)

$isWindowsHost = $env:OS -eq 'Windows_NT'
$javaName  = if ($isWindowsHost) { 'java.exe'  } else { 'java' }
$adbName   = if ($isWindowsHost) { 'adb.exe'   } else { 'adb' }
$jlinkName = if ($isWindowsHost) { 'jlink.exe' } else { 'jlink' }

# Modules the Host actually needs at runtime. Deliberately generous: a missing
# module would only surface as a NoClassDefFoundError on an operator's laptop,
# so we over-provision and let NSIS compression absorb the size.
$javaModules = @(
    'java.base', 'java.compiler', 'java.datatransfer', 'java.desktop',
    'java.instrument', 'java.logging', 'java.management', 'java.management.rmi',
    'java.naming', 'java.net.http', 'java.prefs', 'java.rmi', 'java.scripting',
    'java.security.jgss', 'java.sql', 'java.sql.rowset', 'java.transaction.xa',
    'java.xml', 'java.xml.crypto', 'jdk.charsets', 'jdk.crypto.cryptoki',
    'jdk.crypto.ec', 'jdk.localedata', 'jdk.management', 'jdk.naming.dns',
    'jdk.unsupported', 'jdk.zipfs'
) -join ','

<#
    Runs a native tool and turns a non-zero exit code into a real error.

    PowerShell turns native-command stderr into error records, which can abort
    a script unexpectedly; this wrapper captures both streams, restores the
    preference, and reports the exit code honestly.
#>
function Invoke-Native {
    param([string]$File, [string[]]$ToolArgs, [string]$Label)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output  = & $File @ToolArgs 2>&1 | ForEach-Object { [string]$_ }
        $code    = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }

    $text = $output -join [Environment]::NewLine

    if ($code -ne 0) {
        throw "${Label}_FAILED (exit ${code}):$([Environment]::NewLine)$text"
    }

    return $text
}

function Get-DirectorySizeBytes {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return 0 }
    return [int64]((Get-ChildItem $Path -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum)
}

<#
    Finds a JDK that can actually assemble a runtime.

    Both `jlink.exe` and a `jmods` directory are required: a JetBrains Runtime
    ships jlink without jmods and cannot build anything, which would otherwise
    surface as a late, confusing failure on a developer machine.
#>
function Find-JdkRoot {
    foreach ($root in @($JdkHome, $env:JDK_HOME, $env:JAVA_HOME)) {
        if ([string]::IsNullOrWhiteSpace($root)) { continue }
        if ((Test-Path (Join-Path (Join-Path $root 'bin') $jlinkName)) -and
            (Test-Path (Join-Path $root 'jmods'))) {
            return $root
        }
    }

    foreach ($parent in @(
            'C:\Program Files\Java',
            'C:\Program Files\Eclipse Adoptium',
            'C:\Program Files\Microsoft',
            'C:\Program Files\Amazon Corretto',
            'C:\Program Files\Zulu',
            'C:\Program Files (x86)\Java'
        )) {
        if (-not (Test-Path $parent)) { continue }

        foreach ($dir in (Get-ChildItem $parent -Directory -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending)) {
            if ((Test-Path (Join-Path (Join-Path $dir.FullName 'bin') $jlinkName)) -and
                (Test-Path (Join-Path $dir.FullName 'jmods'))) {
                return $dir.FullName
            }
        }
    }

    $command = Get-Command $jlinkName -ErrorAction SilentlyContinue
    if ($command) {
        $root = Split-Path (Split-Path $command.Source)
        if (Test-Path (Join-Path $root 'jmods')) { return $root }
    }

    return $null
}

# ---------------------------------------------------------------- host JARs --
if (-not $SkipHost) {
    $hasJars = @(Get-ChildItem $hostInstallDir -Filter '*.jar' -ErrorAction SilentlyContinue).Count -gt 0

    if (-not $hasJars) {
        Write-Host '[stage] building :host:installDist ...'
    } else {
        Write-Host '[stage] refreshing :host:installDist (gradle is incremental) ...'
    }

    $gradlew = Join-Path $androidDir 'gradlew.bat'
    if (-not (Test-Path $gradlew)) {
        throw "GRADLEW_MISSING: $gradlew"
    }

    <#
     * Always invoked: skipping it when JARs merely exist once packaged
     * pre-edit classes into an installer, which silently shipped a Host that
     * did not contain the current source. Gradle short-circuits when the
     * distribution is already up to date.
     #>
    Push-Location $androidDir
    try {
        Invoke-Native $gradlew @(':host:installDist', '--console=plain') 'HOST_INSTALL_DIST' | Out-Null
    } finally {
        Pop-Location
    }

    $sourceLib = $hostInstallDir
    if (-not (Test-Path $sourceLib)) {
        throw "HOST_DISTRIBUTION_MISSING: $sourceLib was not produced by :host:installDist"
    }

    $jarSource = @(Get-ChildItem $sourceLib -Filter '*.jar' -ErrorAction SilentlyContinue)
    if ($jarSource.Count -lt 1) {
        throw "HOST_DISTRIBUTION_EMPTY: no JARs in $sourceLib"
    }

    $targetLib = Join-Path $ResourcesDir 'host\lib'
    if (Test-Path $targetLib) { Remove-Item $targetLib -Recurse -Force }
    New-Item -ItemType Directory -Path $targetLib -Force | Out-Null
    Copy-Item -Path (Join-Path $sourceLib '*.jar') -Destination $targetLib -Force
}

# --------------------------------------------------------------- Java runtime --
if (-not $SkipRuntime) {
    $runtimeDir   = Join-Path $ResourcesDir 'runtime'
    $runtimeJava  = Join-Path $runtimeDir "bin\$javaName"

    if ($Force -or -not (Test-Path $runtimeJava)) {
        $jdkRoot = Find-JdkRoot

        if (-not $jdkRoot) {
            throw "JLINK_MISSING: no JDK with jlink.exe and a jmods directory was found. Point JAVA_HOME (or -JdkHome) at a full JDK such as Temurin 21. (A JetBrains Runtime cannot build a runtime: it ships no jmods.)"
        }

        $jlink = Join-Path (Join-Path $jdkRoot 'bin') $jlinkName

        Write-Host "[stage] building Java runtime with jlink from $jdkRoot ..."

        if (Test-Path $runtimeDir) { Remove-Item $runtimeDir -Recurse -Force }

        $attempts = @(
            @( '--compress=zip-6' ),   # JDK 21+
            @( '--compress=2' ),       # older syntax
            @()                        # last resort: uncompressed
        )

        $built = $false
        foreach ($extra in $attempts) {
            $toolArgs = @(
                '--add-modules', $javaModules,
                '--strip-debug',
                '--no-man-pages',
                '--no-header-files'
            ) + $extra + @('--output', $runtimeDir)

            try {
                Invoke-Native $jlink $toolArgs 'JLINK' | Out-Null
                $built = $true
                break
            } catch {
                Write-Warning "[stage] jlink attempt rejected ($extra): $($_.Exception.Message)"
                if (Test-Path $runtimeDir) { Remove-Item $runtimeDir -Recurse -Force }
            }
        }

        if (-not $built) {
            throw 'JLINK_FAILED: could not assemble a Java runtime with any compression setting.'
        }
    }

    if (-not (Test-Path $runtimeJava)) {
        throw "RUNTIME_INVALID: $runtimeJava is missing after jlink."
    }
}

# ------------------------------------------------------------ platform-tools --
if (-not $SkipPlatformTools) {
    $toolsDir = Join-Path $ResourcesDir 'platform-tools'
    $adb      = Join-Path $toolsDir $adbName

    if ($Force -or -not (Test-Path $adb)) {
        $sourceDir = $null

        foreach ($root in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT,
                            (Join-Path $env:LOCALAPPDATA 'Android\Sdk'))) {
            if ([string]::IsNullOrWhiteSpace($root)) { continue }
            $candidate = Join-Path (Join-Path $root 'platform-tools') $adbName
            if (Test-Path $candidate) {
                $sourceDir = Split-Path $candidate
                break
            }
        }

        if (-not $sourceDir) {
            $command = Get-Command $adbName -ErrorAction SilentlyContinue
            if ($command) { $sourceDir = Split-Path $command.Source }
        }

        # No SDK on this machine: fetch the official platform-tools package so the
        # installer stays self-contained instead of failing on a clean host.
        if (-not $sourceDir -and -not $NoDownload) {
            $url  = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip'
            $zip  = Join-Path ([System.IO.Path]::GetTempPath()) ("cyvra-platform-tools-{0}.zip" -f [guid]::NewGuid())
            $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("cyvra-platform-tools-{0}" -f [guid]::NewGuid())

            Write-Host "[stage] no local platform-tools; downloading $url ..."

            try {
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -ErrorAction Stop
                Expand-Archive -Path $zip -DestinationPath $temp -Force

                $extracted = Get-ChildItem $temp -Directory -Recurse -Filter 'platform-tools' |
                    Select-Object -First 1
                if ($extracted) { $sourceDir = $extracted.FullName }
            } catch {
                throw "ADB_DOWNLOAD_FAILED: no Android platform-tools on this host and $url could not be fetched. $($_.Exception.Message)"
            } finally {
                Remove-Item $zip  -ErrorAction SilentlyContinue
                Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
            }
        }

        if (-not $sourceDir) {
            throw "ADB_MISSING: no Android platform-tools found. Install them or set ANDROID_HOME."
        }

        Write-Host "[stage] bundling platform-tools from $sourceDir ..."

        if (Test-Path $toolsDir) { Remove-Item $toolsDir -Recurse -Force }
        New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null

        foreach ($name in @($adbName, 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'NOTICE.txt')) {
            $file = Join-Path $sourceDir $name
            if (Test-Path $file) { Copy-Item -Path $file -Destination $toolsDir -Force }
        }
    }

    if (-not (Test-Path $adb)) {
        throw "ADB_COPY_FAILED: $adb was not produced."
    }
}

# ----------------------------------------------------------------- drivers --
#
# Bundles the Android USB driver packages so a customer phone enumerates
# without any manual driver install (P1 self-containment exit gate).
#
# installer-hooks.nsh consumes .resources/drivers/<name>/*.inf at install time
# through pnputil, so the layout below is a contract with that file: one
# sub-directory per package, its INF at the sub-directory root.
#
if (-not $SkipDrivers) {
    $driverDir = Join-Path $ResourcesDir 'drivers'

    # Destination sub-directory, and the INF that identifies the package.
    $driverPackages = @(
        @{ Name = 'ssudadb';        Inf = 'ssudadb.inf'        },
        @{ Name = 'ssudbus';        Inf = 'ssudbus.inf'        },
        @{ Name = 'android_winusb'; Inf = 'android_winusb.inf' }
    )

    $sourceRoot = $DriversRoot
    if (-not $sourceRoot) {
        <#
         # Harvesting from the build machine works on a workstation that has the
         # drivers installed, but it is NOT reproducible: a CI runner carries no
         # Samsung package and would silently yield an installer with no drivers
         # at all. A release build must pass -DriversRoot at a reviewed,
         # checked-in package directory instead.
         #>
        $sourceRoot = Join-Path $env:SystemRoot 'System32\DriverStore\FileRepository'
        Write-Host '[stage] drivers: harvesting from the local Windows DriverStore'
    }
    else {
        Write-Host "[stage] drivers: using $sourceRoot"
    }

    if (-not (Test-Path $sourceRoot)) {
        throw "DRIVERS_ROOT_MISSING: $sourceRoot"
    }

    if (Test-Path $driverDir) { Remove-Item $driverDir -Recurse -Force }
    New-Item -ItemType Directory -Path $driverDir -Force | Out-Null

    $missing = @()

    foreach ($pkg in $driverPackages) {
        # The DriverStore names packages <inf>_amd64_<hash>; newest first so an
        # OEM revision is preferred over a superseded one.
        $found = Get-ChildItem -Path $sourceRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like ($pkg.Inf + '_amd64_*') } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1

        if (-not $found) {
            $missing += $pkg.Inf
            continue
        }

        $dest = Join-Path $driverDir $pkg.Name
        New-Item -ItemType Directory -Path $dest -Force | Out-Null

        # The whole tree, not just the INF: the package references co-installer
        # DLLs under amd64\, and pnputil refuses an incomplete package rather
        # than installing a partial one.
        Copy-Item -Path (Join-Path $found.FullName '*') -Destination $dest -Recurse -Force

        $infFile = Get-ChildItem -Path $dest -Filter $pkg.Inf -Recurse |
            Select-Object -First 1
        if (-not $infFile) {
            throw "DRIVER_INF_NOT_COPIED: $($pkg.Inf) did not land under $dest"
        }

        Write-Host ('[stage]   driver {0,-16} <- {1}' -f $pkg.Name, $found.Name)
    }

    if ($missing.Count -gt 0) {
        $msg = "DRIVER_PACKAGE_NOT_FOUND: $($missing -join ', ') under $sourceRoot"
        if ($RequireDrivers) {
            throw $msg
        }
        # Not fatal for a developer build, but stated plainly: the resulting
        # installer will not see a phone on a machine lacking the driver.
        Write-Host "[stage] WARNING: $msg"
        Write-Host '[stage] WARNING: the installer will be built WITHOUT USB drivers.'
    }

    $stagedCount = @(Get-ChildItem -Path $driverDir -Directory -ErrorAction SilentlyContinue).Count
    Write-Host "[stage]   driver packages  : $stagedCount"
}

# ------------------------------------------------------------------ validate --
$jarDir = Join-Path $ResourcesDir 'host\lib'
$jarCount = @(Get-ChildItem $jarDir -Filter '*.jar' -ErrorAction SilentlyContinue).Count

if ($jarCount -lt 1) {
    throw "HOST_JARS_MISSING: $jarDir contains no JARs."
}

Write-Host ''
Write-Host "[stage] OK  $ResourcesDir"
Write-Host ("[stage]   host JARs        : {0} ({1:N0} bytes)" -f $jarCount,
    (Get-DirectorySizeBytes $jarDir))

if (-not $SkipRuntime) {
    Write-Host ("[stage]   Java runtime     : {0:N0} bytes" -f (Get-DirectorySizeBytes (Join-Path $ResourcesDir 'runtime')))
}
if (-not $SkipPlatformTools) {
    Write-Host ("[stage]   platform-tools   : {0:N0} bytes" -f (Get-DirectorySizeBytes (Join-Path $ResourcesDir 'platform-tools')))
}
if (-not $SkipDrivers) {
    $stagedDrivers = Join-Path $ResourcesDir 'drivers'
    $stagedDriverCount = @(Get-ChildItem -Path $stagedDrivers -Directory -ErrorAction SilentlyContinue).Count
    if ($stagedDriverCount -gt 0) {
        Write-Host ("[stage]   usb drivers      : {0} packages ({1:N0} bytes)" -f $stagedDriverCount,
            (Get-DirectorySizeBytes $stagedDrivers))
    }
    else {
        Write-Host '[stage]   usb drivers      : NONE STAGED (installer will not auto-detect phones)'
    }
}

Write-Host ''
