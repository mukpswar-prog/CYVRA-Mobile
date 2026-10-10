<#
.SYNOPSIS
    Stages everything the CYVRA Mobile Windows installer must ship.

.DESCRIPTION
    Produces <src-tauri>/.resources/ containing:

      host/            the :host:installDist distribution (JARs)
      runtime/         a trimmed Java runtime built with jlink
      platform-tools/  adb.exe and its support DLLs
      drivers/         Android USB driver packages (Samsung + Google)
      agent/           the sanitization agent APK, UNSIGNED (see R-I)

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
    [string]$AgentApk,
    [switch]$SkipHost,
    [switch]$SkipRuntime,
    [switch]$SkipPlatformTools,
    [switch]$SkipDrivers,
    [switch]$SkipAgent,
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
         # at all.
         #
         # RULING (Chief Engineer, 11-Oct-2026) - R-B, OPTION B. Redistribution
         # of the Samsung and Google driver packages is an OPEN commercial item
         # with legal, so the binaries must NOT be committed to this public
         # repository. A release build supplies them to CI as a PRIVATE SECRET
         # and passes that location via -DriversRoot. R-B gates only the final
         # release .exe; it gates nothing else.
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

# --------------------------------------------------------------------- agent --
#
# Stages the sanitization agent APK so the installed product can deploy it to a
# phone without a network fetch.
#
# SIGNING IS DEFERRED (R-I). Ed25519 / APK key custody has no ruling yet, so only
# an UNSIGNED artifact may reach the installer.
#
# The checks below VERIFY that rather than trust the file name. A signed APK
# landing in the installer would mean a private key was used before custody was
# settled, and the name "-unsigned" alone would not have stopped it.
#
if (-not $SkipAgent) {
    $agentDir = Join-Path $ResourcesDir 'agent'
    $agentOutputs = Join-Path $androidDir 'sanitization-agent\build\outputs\apk\release'

    $apk = $null
    if ($AgentApk) {
        # Explicit override. Used by release engineering to stage a reviewed
        # artifact, and by the signature-guard tests.
        if (-not (Test-Path $AgentApk)) {
            throw "AGENT_APK_NOT_FOUND: -AgentApk was given as '$AgentApk' but does not exist"
        }
        Write-Host "[stage] agent: using -AgentApk $AgentApk"
        $apk = Get-Item -Path $AgentApk
    }
    else {
        $apk = Get-ChildItem -Path $agentOutputs -Filter '*.apk' -ErrorAction SilentlyContinue |
            Select-Object -First 1
    }

    if (-not $apk) {
        # Building here mirrors how the host JARs are produced above: the artifact
        # is derived from source on every machine rather than carried along.
        $gradlew = Join-Path $androidDir 'gradlew.bat'
        if (-not (Test-Path $gradlew)) {
            throw "GRADLEW_MISSING: $gradlew"
        }

        Write-Host '[stage] agent: building :sanitization-agent:assembleRelease ...'
        Push-Location $androidDir
        try {
            Invoke-Native $gradlew @(':sanitization-agent:assembleRelease', '--console=plain') `
                'AGENT_BUILD_FAILED'
        }
        finally {
            Pop-Location
        }

        $apk = Get-ChildItem -Path $agentOutputs -Filter '*.apk' -ErrorAction SilentlyContinue |
            Select-Object -First 1
    }

    if (-not $apk) {
        throw "AGENT_APK_MISSING: no APK produced under $agentOutputs"
    }

    # ---------------------------------------------- verify it is unsigned --
    # Three independent signals. Any one of them alone is weak; together they
    # cover both APK signature schemes plus the naming convention.

    $signingEvidence = @()

    # 1. Name. A release build with no signingConfig assembles "-unsigned".
    if ($apk.Name -notmatch '-unsigned') {
        $signingEvidence += "file name '$($apk.Name)' does not carry the -unsigned suffix"
    }

    # 2. v1 (JAR) signature scheme: entries under META-INF/ at the archive root.
    #    Guarded because the assembly is not preloaded in every PowerShell host.
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
        $zip = [System.IO.Compression.ZipFile]::OpenRead($apk.FullName)
        try {
            $signingEvidence += @($zip.Entries | Where-Object {
                $_.FullName -match '^META-INF/[^/]+\.(RSA|DSA|EC|SF|MF)$'
            } | ForEach-Object { "v1 signature entry $($_.FullName)" })
        }
        finally {
            $zip.Dispose()
        }
    }
    catch {
        Write-Host '[stage] agent: WARNING - v1 signature scan unavailable; relying on v2 scan and name'
    }

    # 3. v2/v3 signature scheme. The APK Signing Block sits immediately before the
    #    ZIP central directory and is NOT a ZIP entry, so scan 2 can never see it.
    #    It carries the literal marker "APK Sig Block 42". Latin-1 gives a strict
    #    byte-to-character mapping, so a string search here is a byte search - and
    #    it runs in milliseconds instead of a per-byte loop.
    $latin1 = [System.Text.Encoding]::GetEncoding(28591)
    $rawText = $latin1.GetString([System.IO.File]::ReadAllBytes($apk.FullName))
    if ($rawText.IndexOf('APK Sig Block 42', [StringComparison]::Ordinal) -ge 0) {
        $signingEvidence += 'APK Signing Block present (v2/v3 signature)'
    }

    if ($signingEvidence.Count -gt 0) {
        throw ("AGENT_APK_SIGNED_UNEXPECTED: refusing to stage a signed APK. " +
            "Signing is deferred until the Ed25519 custody ruling (R-I). " +
            "Evidence: $($signingEvidence -join '; ')")
    }

    if (Test-Path $agentDir) { Remove-Item $agentDir -Recurse -Force }
    New-Item -ItemType Directory -Path $agentDir -Force | Out-Null

    # Staged under a stable name so downstream references do not depend on the
    # build variant that produced the bytes.
    $stagedAgent = Join-Path $agentDir 'sanitization-agent-unsigned.apk'
    Copy-Item -Path $apk.FullName -Destination $stagedAgent -Force

    Write-Host ('[stage]   agent apk        : {0} ({1:N0} bytes, verified unsigned)' -f
        $apk.Name, $apk.Length)
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
if (-not $SkipAgent) {
    $stagedAgentApk = Join-Path $ResourcesDir 'agent\sanitization-agent-unsigned.apk'
    if (Test-Path $stagedAgentApk) {
        Write-Host ("[stage]   agent apk        : {0} (UNSIGNED - signing deferred, R-I)" -f
            (Get-Item $stagedAgentApk).Name)
    }
    else {
        Write-Host '[stage]   agent apk        : NOT STAGED (device-side sanitization agent absent)'
    }
}

Write-Host ''
