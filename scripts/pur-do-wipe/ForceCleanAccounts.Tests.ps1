# ForceCleanAccounts.Tests.ps1
#
# Unit tests for the force-clean parsing and redaction core (TASK U).
#
# These run with no device attached: every input is a fixture string. Two things
# are being proved here, and both are load-bearing for the proof that follows:
#
#   1. The account count is read correctly, and failure to read it yields -1
#      rather than 0. A silent 0 would report a clean device that is not clean,
#      which is exactly the false-positive that Samsung's dump format causes.
#   2. Nothing that reaches the attestation can carry an account identifier.
#
# Run:  powershell -ExecutionPolicy Bypass -File ForceCleanAccounts.Tests.ps1
# Exit: 0 = all passed, 1 = at least one failure.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here 'ForceCleanAccounts.psm1') -Force

$script:pass = 0
$script:fail = 0

function Assert-Equal {
    param($Expected, $Actual, [string]$Because)
    if ("$Expected" -eq "$Actual") {
        $script:pass++
        Write-Output ("  PASS  " + $Because)
    } else {
        $script:fail++
        Write-Output ("  FAIL  " + $Because + " | expected=[" + $Expected + "] actual=[" + $Actual + "]")
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Because)
    Assert-Equal -Expected $true -Actual $Condition -Because $Because
}

function Assert-False {
    param([bool]$Condition, [string]$Because)
    Assert-Equal -Expected $false -Actual $Condition -Because $Because
}

Write-Output '--- count parsing: the Samsung trap ---'

# AOSP-shaped dump.
$aospDump = @"
Accounts: 3
Now: 12345
Active Syncs: 0
"@
Assert-Equal -Expected 3 `
    -Actual (Get-AccountCountFromContentDump -DumpText $aospDump) `
    -Because 'reads the Accounts header from an AOSP-shaped dump'

# Samsung One UI: the header is absent, only an event-history table exists.
# This is the false-positive the detector exists to prevent.
$samsungDump = @"
User UserInfo{0:owner:c13}:

AccountId, Action_Type, timestamp, UID, TableName, Key
Accounts History
31,action_account_add,2022-08-12 16:02:49,10105,accounts,23
31,action_account_remove,2022-08-12 16:41:19,10105,accounts,24

Active Sessions: 0
"@
Assert-Equal -Expected -1 `
    -Actual (Get-AccountCountFromContentDump -DumpText $samsungDump) `
    -Because 'Samsung dump with no Accounts header yields -1, never a false 0'

Assert-Equal -Expected -1 `
    -Actual (Get-AccountCountFromContentDump -DumpText '') `
    -Because 'empty input yields -1, never a false 0'

# Regression guard: a dump that has BOTH the history table and a real header.
$mixedDump = @"
Accounts History
31,action_account_add,2022-08-12 16:02:49,10105,accounts,23

Accounts: 9
Active Syncs: 0
"@
Assert-Equal -Expected 9 `
    -Actual (Get-AccountCountFromContentDump -DumpText $mixedDump) `
    -Because 'reads the real header even when an Accounts History table is present'

# Indented header (dumpsys content indents it by two spaces).
$indented = "  Accounts: 10`n  Now: 1"
Assert-Equal -Expected 10 `
    -Actual (Get-AccountCountFromContentDump -DumpText $indented) `
    -Because 'handles the indentation dumpsys content actually uses'

Write-Output '--- device-owner precondition ---'

Assert-True  -Condition (Test-DeviceOwnerPrecondition -AccountCount 0)  -Because 'zero accounts satisfies the precondition'
Assert-False -Condition (Test-DeviceOwnerPrecondition -AccountCount 1)  -Because 'one account is enough to block enrolment'
Assert-False -Condition (Test-DeviceOwnerPrecondition -AccountCount 10) -Because 'ten accounts blocks enrolment'
Assert-False -Condition (Test-DeviceOwnerPrecondition -AccountCount -1) -Because 'an unreadable dump (-1) must never satisfy the precondition'

Write-Output '--- primitive probe ---'

$android11Usage = @"
Account manager service commands:
  help
    Print this help text.
  set-bind-instant-service-allowed [--user <USER_ID> (current user if not specified)] true|false
    Set whether binding to services provided by instant apps is allowed.
  get-bind-instant-service-allowed [--user <USER_ID> (current user if not specified)]
    Get whether binding to services provided by instant apps is allowed.
"@
Assert-False -Condition (Test-RemoveAccountPrimitiveAvailable -UsageText $android11Usage) `
    -Because 'Android 11 cmd account has no remove-account, so the ladder skips it'

$futureUsage = @"
Account manager service commands:
  help
  remove-account [--user <USER_ID>] <name>
    Remove the account with the given name.
"@
Assert-True -Condition (Test-RemoveAccountPrimitiveAvailable -UsageText $futureUsage) `
    -Because 'a build that does expose remove-account is picked up without code change'

# The word must appear as a command, not as prose inside some other description.
$proseUsage = @"
  help
    Print this help text. It does not remove-account data from the device.
"@
Assert-False -Condition (Test-RemoveAccountPrimitiveAvailable -UsageText $proseUsage) `
    -Because 'prose mentioning the phrase is not a command definition'

Assert-False -Condition (Test-RemoveAccountPrimitiveAvailable -UsageText '') `
    -Because 'an empty usage probe cannot claim the primitive exists'

Write-Output '--- authenticator map ---'

$accountDump = @"
RegisteredServicesCache: 22 services
  ServiceInfo: AuthenticatorDescription {type=com.google}, ComponentInfo{com.google.android.gms/com.google.android.gms.auth.account.authenticator.GoogleAccountAuthenticatorService}, uid 10007
  ServiceInfo: AuthenticatorDescription {type=com.whatsapp}, ComponentInfo{com.whatsapp/com.whatsapp.accountsync.AccountAuthenticatorService}, uid 10397
  ServiceInfo: AuthenticatorDescription {type=us.zoom.videomeetings}, ComponentInfo{us.zoom.videomeetings/com.zipow.videobox.AuthenticatorService}, uid 10025
"@
$map = Get-AuthenticatorMap -DumpText $accountDump
Assert-Equal -Expected 3 -Actual $map.Count -Because 'maps all three authenticator types'
Assert-Equal -Expected 'com.google.android.gms' -Actual $map['com.google'] -Because 'com.google is owned by GMS'
Assert-Equal -Expected 'com.whatsapp' -Actual $map['com.whatsapp'] -Because 'com.whatsapp is owned by WhatsApp'
Assert-Equal -Expected 'us.zoom.videomeetings' -Actual $map['us.zoom.videomeetings'] -Because 'Zoom self-authenticates'

$emptyMap = Get-AuthenticatorMap -DumpText 'no services here'
Assert-Equal -Expected 0 -Actual $emptyMap.Count -Because 'a dump with no authenticators yields an empty plan, not an error'

Write-Output '--- removal order: platform packages last ---'

$orderMap = @{
    'com.google'                 = 'com.google.android.gms'
    'com.osp.app.signin'         = 'com.osp.app.signin'
    'com.whatsapp'               = 'com.whatsapp'
    'us.zoom.videomeetings'      = 'us.zoom.videomeetings'
    'www.instagram.com'          = 'com.instagram.android'
}
$order = Get-RemovalOrder -AuthenticatorMap $orderMap
$packages = @($order | ForEach-Object { $_.Package })

# The safety property is the tier boundary: every third-party package must be
# attempted before any platform package. Nothing more than that is promised.
$thirdParty = @($order | Where-Object { -not $_.Platform } | ForEach-Object { $_.Package })
$platform   = @($order | Where-Object { $_.Platform }     | ForEach-Object { $_.Package })

Assert-Equal -Expected 'com.instagram.android, com.whatsapp, us.zoom.videomeetings' `
    -Actual ($thirdParty -join ', ') `
    -Because 'third-party authenticators come first, alphabetical within the tier'

Assert-Equal -Expected 'com.google.android.gms, com.osp.app.signin' `
    -Actual ($platform -join ', ') `
    -Because 'platform authenticators come last, alphabetical within the tier'

$lastPlatformIndex = $thirdParty.Count
Assert-Equal -Expected 'com.google.android.gms' -Actual $packages[$lastPlatformIndex] `
    -Because 'no platform package is reached until every third-party one is attempted'

# The ordering must not quietly regress into a mixed sequence.
$mixed = $false
$seenPlatform = $false
foreach ($item in $order) {
    if ($item.Platform) { $seenPlatform = $true }
    elseif ($seenPlatform) { $mixed = $true }
}
Assert-False -Condition $mixed `
    -Because 'a third-party package never appears after a platform package'

$platformCount = @($order | Where-Object { $_.Platform }).Count
Assert-Equal -Expected 2 -Actual $platformCount -Because 'exactly the two platform packages are flagged as platform'

Write-Output '--- removal ladder ---'

$ladderOff = Get-RemovalLadder -PrimitiveAvailable $false
Assert-Equal -Expected 3 -Actual $ladderOff.Count -Because 'the ladder always has three rungs'
Assert-False -Condition $ladderOff[0].Enabled -Because 'PRIMITIVE rung is disabled when the build lacks the command'
Assert-True  -Condition $ladderOff[1].Enabled -Because 'AUTHENTICATOR rung is always available'

$ladderOn = Get-RemovalLadder -PrimitiveAvailable $true
Assert-True -Condition $ladderOn[0].Enabled -Because 'PRIMITIVE rung is enabled when the build exposes it'

Write-Output '--- identifier redaction: nothing egresses ---'

# Local part 'ka29579040402' is 13 characters. The exact value is asserted
# because a token that silently became length-preserving-but-wrong, or that
# collapsed to a constant, would both still pass a loose "contains no @" check.
$email = 'ka29579040402@gmail.com'
$token = Get-IdentifierToken -Identifier $email -Type 'com.google'
Assert-False -Condition ($token -match 'ka29579040402') -Because 'the local part never survives redaction'
Assert-False -Condition ($token -match '@')             -Because 'the domain never survives redaction'
Assert-True  -Condition ($token -match 'local-part-len=13') -Because 'only the local-part length survives'
Assert-Equal -Expected '[com.google local-part-len=13]' -Actual $token -Because 'token format is stable'

$opaque = Get-IdentifierToken -Identifier 'someone@example.org' -Type 'com.samsung.android.email'
Assert-True -Condition ($token -cnotmatch 'gmail') -Because 'redaction is case-safe and identifier-free'

$blank = Get-IdentifierToken -Identifier '' -Type 'com.google'
Assert-Equal -Expected '[unknown-identifier]' -Actual $blank -Because 'an unknown identifier is marked, not blanked into a clean-looking result'

$view = Get-RedactedAccountView -Accounts @(
    [pscustomobject]@{ Name = 'first.person@example.com'; Type = 'com.google' },
    [pscustomobject]@{ Name = 'second.person@example.org'; Type = 'com.samsung.android.email' }
)
Assert-Equal -Expected 2 -Actual $view.Count -Because 'redacted view keeps one entry per account'
foreach ($entry in $view) {
    Assert-False -Condition ("$($entry.token)" -match '@') -Because 'no redacted view entry contains an email'
}

Write-Output '--- attestation: identifier-free by construction ---'

$attestation = New-AttestationRecord -BaselineCount 10 -FinalCount 0 `
    -DeviceModel 'SM-A107F' -AndroidRelease '11' `
    -PrimitiveStatus 'absent' `
    -Attempts @([pscustomobject]@{ Rung = 'AUTHENTICATOR'; Outcome = 'ok' }) `
    -RemovedPackages @('com.whatsapp') `
    -StartedAt '2026-10-09T21:00:00Z' -CompletedAt '2026-10-09T21:12:00Z'

$json = ($attestation | ConvertTo-Json -Depth 6)
Assert-False -Condition ($json -match '@') -Because 'the attestation contains no @ character at all'
Assert-False -Condition ($json -match '\b\d{15}\b') -Because 'the attestation contains no IMEI-shaped literal'
Assert-True  -Condition ($attestation.clean -eq $true) -Because 'zero final accounts marks the run clean'
Assert-Equal -Expected 10 -Actual $attestation.accountsRemoved -Because 'reports how many were removed'
Assert-False -Condition $attestation.identifiersStored -Because 'records explicitly that no identifiers were stored'
Assert-False -Condition $attestation.serialStored -Because 'records explicitly that no serial was stored'

$notClean = New-AttestationRecord -BaselineCount 10 -FinalCount 4 `
    -DeviceModel 'SM-A107F' -AndroidRelease '11' `
    -PrimitiveStatus 'absent' -Attempts @() -RemovedPackages @() `
    -StartedAt 'x' -CompletedAt 'y'
Assert-False -Condition $notClean.clean -Because 'a nonzero remainder is never reported as clean'

Write-Output ''
Write-Output ('TOTAL  pass=' + $script:pass + '  fail=' + $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
