<#
.SYNOPSIS
    CYVRA Mobile 2.0.1 — PowerShell Cryptographic Key Lifecycle Automation.

.DESCRIPTION
    Automates key generation, trust manifest creation, and patch signing
    using .NET / Python cryptographic providers.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("Generate-KeyPair", "Create-Manifest", "Sign-Patch")]
    [string]$Action,

    [string]$Prefix = "CYVRA-OP-KEY",
    [string]$RootPrivKeyBase64,
    [string]$RootKeyId = "CYVRA-ROOT-KEY-2026-01",
    [string]$AnchorsJsonPath,
    [int]$ManifestVersion = 1,
    [string]$PatchJsonPath,
    [string]$OperationalPrivKeyBase64,
    [string]$OperationalKeyId,
    [string]$OutputPath
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonScript = Join-Path $scriptDir "manage_key_lifecycle.py"

switch ($Action) {
    "Generate-KeyPair" {
        python $pythonScript generate-key-pair --prefix $Prefix
    }
    "Create-Manifest" {
        if (-not $RootPrivKeyBase64 -or -not $AnchorsJsonPath -or -not $OutputPath) {
            throw "Create-Manifest requires -RootPrivKeyBase64, -AnchorsJsonPath, and -OutputPath"
        }
        python $pythonScript create-manifest --root-priv $RootPrivKeyBase64 --root-id $RootKeyId --anchors-json $AnchorsJsonPath --version $ManifestVersion --out $OutputPath
    }
    "Sign-Patch" {
        if (-not $PatchJsonPath -or -not $OperationalPrivKeyBase64 -or -not $OperationalKeyId -or -not $OutputPath) {
            throw "Sign-Patch requires -PatchJsonPath, -OperationalPrivKeyBase64, -OperationalKeyId, and -OutputPath"
        }
        python $pythonScript sign-patch --patch-json $PatchJsonPath --key-priv $OperationalPrivKeyBase64 --key-id $OperationalKeyId --out $OutputPath
    }
}
