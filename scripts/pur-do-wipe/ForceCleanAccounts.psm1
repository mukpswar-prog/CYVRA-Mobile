# ForceCleanAccounts.psm1
#
# Parsing and decision core for the PUR-DO-WIPE force-clean sequence (TASK U).
#
# Everything in this module is host-side and pure: no adb, no I/O, no side effects.
# The driver (ForceCleanAccounts.ps1) performs adb calls and feeds their output in
# here. That split exists so the logic that decides *what counts as "clean"* can be
# unit-tested against fixtures without a device attached.
#
# PRIVACY (standing rule): account identifiers are real-device fixture content and
# never egress. This module returns counts, account *types* and boolean outcomes
# only. Functions that must touch an identifier to do their job receive it as a
# parameter and never store it, log it, or return it.

Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

<#
.SYNOPSIS
  Reads the authoritative account count out of `dumpsys content`.
.DESCRIPTION
  Samsung replaces AccountManagerService's dump with its own "Accounts History"
  event log, so the AOSP-idiomatic `dumpsys account | findstr "Account {"` check
  returns zero on One UI and produces a false "clean" reading. `dumpsys content`
  prints a plain `Accounts: <n>` header, which is the only count that is both
  present on AOSP and on Samsung.
.OUTPUTS
  int. -1 when the header cannot be found (treated as failure, never as zero).
#>
function Get-AccountCountFromContentDump {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$DumpText
    )

    foreach ($line in ($DumpText -split "`r?`n")) {
        if ($line -match '^\s*Accounts:\s*(\d+)\s*$') {
            return [int]$Matches[1]
        }
    }
    return -1
}

<#
.SYNOPSIS
  Decides whether the device is clean enough to enrol a device owner.
.DESCRIPTION
  `enforceCanSetDeviceOwnerLocked` throws when *any* account is present, so the
  bar is exactly zero - not "no Google accounts", not "none that sync".
#>
function Test-DeviceOwnerPrecondition {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [int]$AccountCount
    )
    return ($AccountCount -eq 0)
}

<#
.SYNOPSIS
  Does this build of Android expose `cmd account remove-account`?
.DESCRIPTION
  The commissioned primitive. It is absent on Android 11 (the `cmd account`
  surface there is `help` plus the two bind-instant-service flags), so the driver
  must probe rather than assume - otherwise the primary path fails silently
  mid-sequence. We match the bare word so that a future build which adds the
  subcommand is picked up without changing this code.
#>
function Test-RemoveAccountPrimitiveAvailable {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$UsageText
    )
    return ($UsageText -match '(?im)^\s*remove-account\b')
}

<#
.SYNOPSIS
  Extracts authenticator packages and the account types they own.
.DESCRIPTION
  Parses the `RegisteredServicesCache` block of `dumpsys account`. The result is
  the name-independent removal plan: we may not know *which* accounts exist
  (Samsung hides them), but we always know which packages provide authenticators.
.OUTPUTS
  hashtable of account-type -> package name.
#>
function Get-AuthenticatorMap {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$DumpText
    )

    $map = @{}
    foreach ($line in ($DumpText -split "`r?`n")) {
        if ($line -match 'AuthenticatorDescription\s*\{type=([^,}]+)\},\s*ComponentInfo\{([^/]+)/') {
            $map[$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }
    return $map
}

<#
.SYNOPSIS
  Redacts an email-shaped identifier to a non-identifying token.
.DESCRIPTION
  Used wherever a real identifier must be reported (for example, to prove a
  specific account was seen and then gone) without the identifier ever reaching
  disk, a log, or a commit. Only the local-part *length* survives; the domain and
  the local part are dropped entirely, so the token cannot be reversed, matched
  against a wordlist, or correlated across runs.
#>
function Get-IdentifierToken {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$Identifier,
        [Parameter(Mandatory)] [string]$Type
    )

    if ($Identifier -match '^[^@\s]+@') {
        $localPart = ($Identifier -split '@')[0]
        return "[$Type local-part-len=$($localPart.Length)]"
    }
    if ([string]::IsNullOrWhiteSpace($Identifier)) {
        return "[unknown-identifier]"
    }
    return "[$Type opaque len=$($Identifier.Length)]"
}

<#
.SYNOPSIS
  Returns the redacted view of a visible-account list (from a UI hierarchy).
.DESCRIPTION
  The UI dump is the only place One UI reveals account names. The driver needs
  them to tap the right row, so it consumes them transiently; anything that is
  *persisted* comes from here instead, and this never emits the identifier.
#>
function Get-RedactedAccountView {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [AllowEmptyCollection()] [object[]]$Accounts
    )

    $view = @()
    foreach ($account in $Accounts) {
        $view += [pscustomobject]@{
            token = Get-IdentifierToken -Identifier $account.Name -Type $account.Type
            type  = $account.Type
        }
    }
    return $view
}

# ---------------------------------------------------------------------------
# Removal ladder
# ---------------------------------------------------------------------------

<#
.SYNOPSIS
  Plans the removal ladder for this device.
.DESCRIPTION
  Three rungs, tried in order. Each rung returns the rung name so the attestation
  can record *how* every account was cleared - the proof is worthless if it only
  says "zero" without saying how zero was reached.

    1. PRIMITIVE   - `cmd account remove-account <name>`; commissioned, needs the
                     account name, and is absent on Android 11. Probed first.
    2. AUTHENTICATOR - `pm uninstall --user 0 <pkg>` per authenticator package.
                     Name-independent, which is what makes it viable on Samsung,
                     where 7 of the 10 accounts are not enumerable.
    3. HUMAN       - accounts that survive both, escalated to the operator.
.OUTPUTS
  Ordered rung descriptors: Name, RequiresName, Enabled.
#>
function Get-RemovalLadder {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [bool]$PrimitiveAvailable
    )

    return @(
        [pscustomobject]@{
            Name         = 'PRIMITIVE'
            RequiresName = $true
            Enabled      = $PrimitiveAvailable
            Detail       = if ($PrimitiveAvailable) { 'available' } else { 'absent on this build' }
        },
        [pscustomobject]@{
            Name         = 'AUTHENTICATOR'
            RequiresName = $false
            Enabled      = $true
            Detail       = 'pm uninstall --user 0 per authenticator package'
        },
        [pscustomobject]@{
            Name         = 'HUMAN'
            RequiresName = $false
            Enabled      = $true
            Detail       = 'operator removes the remainder on-device'
        }
    )
}

<#
.SYNOPSIS
  Orders authenticator packages so the destructive rung does least harm first.
.DESCRIPTION
  The one guarantee this makes is: every third-party authenticator is attempted
  before any platform authenticator. Removing WhatsApp's authenticator costs
  nothing we care about, while removing `com.google.android.gms` or the Samsung
  sign-in stack is a bigger commitment - so ordering means that if the count
  reaches zero early, no platform package has been touched.

  Within a tier the order is alphabetical by package name. That is deliberately
  arbitrary and carries no safety property: do not read a "most consequential
  last" guarantee into it, because it does not provide one. The real protection
  is the tier boundary, and the per-package re-count in the driver, which stops
  the ladder the moment the device is clean.
#>
function Get-RemovalOrder {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [hashtable]$AuthenticatorMap
    )

    $platformPatterns = @(
        '^com\.google\.android\.',
        '^com\.samsung\.',
        '^com\.osp\.',
        '^com\.android\.',
        '^com\.samsung\.android\.mobileservice$'
    )

    $all = @()
    foreach ($entry in $AuthenticatorMap.GetEnumerator()) {
        $package = $entry.Value
        $isPlatform = $false
        foreach ($pattern in $platformPatterns) {
            if ($package -match $pattern) { $isPlatform = $true; break }
        }
        $all += [pscustomobject]@{
            Package  = $package
            Type     = $entry.Key
            Platform = $isPlatform
        }
    }

    return @($all |
        Sort-Object -Property @{Expression = { [int]$_.Platform }}, Package -Unique)
}

# ---------------------------------------------------------------------------
# Attestation
# ---------------------------------------------------------------------------

<#
.SYNOPSIS
  Builds the attestation record for a force-clean run.
.DESCRIPTION
  Deliberately identifier-free: counts, types, rungs, timestamps, outcomes. No
  account name, no device serial, no package-removal payload beyond the
  authenticator package that was acted on. This is the artifact that gets
  committed; the phone's actual contents stay on the phone.
#>
function New-AttestationRecord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [int]$BaselineCount,
        [Parameter(Mandatory)] [int]$FinalCount,
        [Parameter(Mandatory)] [string]$DeviceModel,
        [Parameter(Mandatory)] [string]$AndroidRelease,
        [Parameter(Mandatory)] [string]$PrimitiveStatus,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [object[]]$Attempts,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [object[]]$RemovedPackages,
        [Parameter(Mandatory)] [string]$StartedAt,
        [Parameter(Mandatory)] [string]$CompletedAt
    )

    return [ordered]@{
        schema            = 'cyvra.pur-do-wipe.attestation/1'
        tool              = 'ForceCleanAccounts.ps1'
        deviceModel       = $DeviceModel
        androidRelease    = $AndroidRelease
        primitiveStatus   = $PrimitiveStatus
        baselineAccounts  = $BaselineCount
        finalAccounts     = $FinalCount
        clean             = (Test-DeviceOwnerPrecondition -AccountCount $FinalCount)
        accountsRemoved   = ($BaselineCount - $FinalCount)
        removedPackages   = @($RemovedPackages)
        attempts          = @($Attempts)
        startedAt         = $StartedAt
        completedAt       = $CompletedAt
        identifiersStored = $false
        serialStored      = $false
    }
}

Export-ModuleMember -Function @(
    'Get-AccountCountFromContentDump',
    'Test-DeviceOwnerPrecondition',
    'Test-RemoveAccountPrimitiveAvailable',
    'Get-AuthenticatorMap',
    'Get-IdentifierToken',
    'Get-RedactedAccountView',
    'Get-RemovalLadder',
    'Get-RemovalOrder',
    'New-AttestationRecord'
)
