# ==============================================================================
# CYVRA Mobile Version 2.1.2 - Clean Automated Build Script
# Can be run from any folder (including C:\Windows\system32)
# ==============================================================================

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " Starting CYVRA Mobile 2.1.2 Production Build Pipeline" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

# Step 0: Ensure we are in the project root directory
$projectPath = "C:\Users\User\Documents\GitHub\CYVRA-Mobile"
if (-not (Test-Path $projectPath)) {
    $projectPath = "C:\Users\User\.gemini\antigravity\worktrees\CYVRA-Mobile\version_two_feature_audit"
}
Set-Location $projectPath
Write-Host "Project Root : $(Get-Location)" -ForegroundColor Green

# Set session execution policy and environment variables
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
$env:CYVRA_SIGNING_MODE = 'test'
if (Test-Path "C:\Program Files\Java\jdk-21") {
    $env:JAVA_HOME = "C:\Program Files\Java\jdk-21"
}

# Step 1: Clean all previous build artifacts
Write-Host "`n[1/6] Cleaning previous build artifacts..." -ForegroundColor Yellow
Push-Location apps\android
.\gradlew.bat clean --console=plain
Pop-Location

Push-Location apps\desktop
if (Test-Path dist) { Remove-Item -Recurse -Force dist }
if (Test-Path src-tauri\.resources\host) { Remove-Item -Recurse -Force src-tauri\.resources\host }
if (Test-Path src-tauri\.resources\agent) { Remove-Item -Recurse -Force src-tauri\.resources\agent }
Pop-Location

# Step 2: Build and sign on-device Android Agents (v2.1.2) - Both Sanitization and Hardware Agents
Write-Host "`n[2/6] Compiling & signing Android Agents (Sanitization + Hardware) v2.1.2..." -ForegroundColor Yellow
Push-Location apps\android
.\gradlew.bat :sanitization-agent:assembleRelease :app:assembleRelease "-Pcyvra.signing.mode=test" --console=plain
Pop-Location

# Step 3: Build Host Engine JAR packages
Write-Host "`n[3/6] Compiling Host Engine packages..." -ForegroundColor Yellow
Push-Location apps\android
.\gradlew.bat :host:installDist --console=plain
Pop-Location

# Step 4: Stage fresh installer resources
Write-Host "`n[4/6] Staging verified installer resources into Desktop bundle..." -ForegroundColor Yellow
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stage-windows-installer-resources.ps1 -SigningMode test -Force

# Step 5: Compile Desktop Frontend (React & TypeScript)
Write-Host "`n[5/6] Building Desktop Frontend (React/TypeScript)..." -ForegroundColor Yellow
Push-Location apps\desktop
pnpm.cmd build
Pop-Location

# Step 6: Assemble Windows Desktop Installer (.exe) with Tauri NSIS
Write-Host "`n[6/6] Packaging Windows NSIS Installer (.exe)..." -ForegroundColor Yellow
Push-Location apps\desktop
pnpm.cmd tauri build
Pop-Location

# Verification & Summary
$installerPath = "apps\desktop\src-tauri\target\release\bundle\nsis\CYVRA Mobile_2.1.2_x64-setup.exe"
if (Test-Path $installerPath) {
    $fileInfo = Get-Item $installerPath
    $hash = (Get-FileHash -Algorithm SHA256 $installerPath).Hash
    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host " BUILD SUCCESSFUL! CYVRA MOBILE VERSION 2.1.2 READY" -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Green
    Write-Host "Installer Location : $($fileInfo.FullName)"
    Write-Host "File Size          : $([math]::Round($fileInfo.Length / 1MB, 2)) MB ($($fileInfo.Length) bytes)"
    Write-Host "Build Timestamp    : $($fileInfo.LastWriteTime)"
    Write-Host "SHA-256 Checksum   : $hash"
    Write-Host "========================================================`n" -ForegroundColor Green
} else {
    Write-Host "`n[ERROR] Installer was not found. Please review build log above." -ForegroundColor Red
}
