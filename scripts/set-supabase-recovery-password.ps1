param([Parameter(Mandatory = $true)][string]$Config, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'

# A desktop launcher may inherit PowerShell 7 module paths into Windows
# PowerShell 5.1. Resolve the security module from this executable's own PSHOME.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop

# Store an existing password for the approved, newly created recovery project.
# This never contacts Supabase or changes/resets any password.
$taskFile = Get-Item -LiteralPath $Config
$taskPath = $taskFile.FullName
$taskParent = Split-Path -Parent $taskPath
$taskDirectory = Get-Item -LiteralPath $taskParent
if ($taskFile.LinkType -or $taskDirectory.LinkType -or $taskFile.Length -gt 16384 -or
    $taskPath -match '(?i)[\\/]OneDrive(?:\s*-.*)?[\\/]' -or
    (Split-Path -Leaf $taskParent) -notlike 'partner-hub-verification-recovery-*') {
    throw 'Use the dedicated private recovery folder outside OneDrive.'
}
$taskIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach ($taskEntry in @($taskParent, $taskPath)) {
    $taskAcl = Get-Acl -LiteralPath $taskEntry
    if (($taskEntry -eq $taskParent -and -not $taskAcl.AreAccessRulesProtected) -or
        $taskAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $taskIdentity) {
        throw 'Private folder ownership or inheritance is invalid.'
    }
    foreach ($taskRule in $taskAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
        if ($taskRule.AccessControlType -eq 'Allow' -and
            $taskRule.IdentityReference.Value -notin @($taskIdentity, 'S-1-5-18')) {
            throw 'Unexpected access to private recovery configuration.'
        }
    }
}
$taskSettings = Get-Content -Raw -LiteralPath $taskPath | ConvertFrom-Json
if ($taskSettings.target.projectRef -ne 'fkbxfdowgazmqoqykwyc' -or
    $taskSettings.target.purpose -ne 'partner-hub-synthetic-verification' -or
    $taskSettings.environment.SUPABASE_URL -ne 'https://fkbxfdowgazmqoqykwyc.supabase.co' -or
    $taskSettings.recovery.purpose -ne 'partner-hub-synthetic-recovery' -or
    $taskSettings.recovery.sourceProjectRef -ne 'oaqodendjnztzcqaahaq' -or
    $taskSettings.recovery.databaseHost -ne 'aws-0-ap-southeast-1.pooler.supabase.com') {
    throw 'Unexpected recovery project. No change made.'
}
if (-not [string]::IsNullOrEmpty($taskSettings.environment.SUPABASE_DATABASE_URL)) {
    throw 'A connection password is already stored. No overwrite made.'
}
if ($CheckOnly) {
    Write-Host 'Recovery password preflight passed. No credentials read or written.'
    return
}
$Host.UI.RawUI.WindowTitle = 'Partner Hub - Recovery DB password'
$taskStatusFile = Join-Path $taskParent 'password-input-status.json'
[IO.File]::WriteAllText($taskStatusFile, '{"status":"awaiting-password","projectRef":"fkbxfdowgazmqoqykwyc"}', [Text.UTF8Encoding]::new($false))
Write-Host 'Recovery project: partner-hub-recovery-20261015'
Write-Host 'Enter the SAME DB password you just used when creating this project.'
Write-Host 'The password stays on this PC, outside OneDrive. Nothing is sent now.'
$taskSecret = Read-Host 'DB password (hidden)' -AsSecureString
$taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
try {
    $taskPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
    if ([string]::IsNullOrEmpty($taskPlain)) { throw 'Password is empty. No change made.' }
    $taskEncoded = [Uri]::EscapeDataString($taskPlain)
    $taskSettings.environment.SUPABASE_DATABASE_URL = 'postgresql://postgres.fkbxfdowgazmqoqykwyc:' + $taskEncoded + '@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'
    [IO.File]::WriteAllText($taskPath, ($taskSettings | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($taskStatusFile, '{"status":"saved","projectRef":"fkbxfdowgazmqoqykwyc"}', [Text.UTF8Encoding]::new($false))
    Write-Host 'SAVED. Password stored in the private recovery folder. Return to Codex.' -ForegroundColor Green
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)
    $taskPlain = $null
    $taskEncoded = $null
    $taskSettings = $null
    $taskSecret.Dispose()
}
