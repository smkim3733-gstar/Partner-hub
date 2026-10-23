param([Parameter(Mandatory = $true)][string]$Config)
$ErrorActionPreference = 'Stop'

# Existing verification DB password only. No network, password reset, transcript,
# command-line password or environment file inside the repository is used.
$taskFile = Get-Item -LiteralPath $Config
$taskPath = $taskFile.FullName
$taskParent = Split-Path -Parent $taskPath
if ($taskFile.LinkType -or $taskFile.Length -gt 16384 -or
    $taskPath -match '(?i)[\\/]OneDrive(?:\s*-.*)?[\\/]' -or
    (Split-Path -Leaf $taskParent) -notlike 'partner-hub-verification-*') {
    throw 'Use the dedicated private verification folder outside OneDrive.'
}
$taskSettings = Get-Content -Raw -LiteralPath $taskPath | ConvertFrom-Json
if ($taskSettings.target.projectRef -ne 'oaqodendjnztzcqaahaq' -or
    $taskSettings.target.purpose -ne 'partner-hub-synthetic-verification' -or
    $taskSettings.environment.SUPABASE_URL -ne 'https://oaqodendjnztzcqaahaq.supabase.co') {
    throw 'Unexpected verification project. No change made.'
}
$taskSecret = Read-Host 'Enter the EXISTING verification DB password (hidden; no reset)' -AsSecureString
$taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
try {
    $taskPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
    if ([string]::IsNullOrEmpty($taskPlain)) { throw 'Password is empty. No change made.' }
    $taskEncoded = [Uri]::EscapeDataString($taskPlain)
    $taskSettings.environment.SUPABASE_DATABASE_URL = 'postgresql://postgres.oaqodendjnztzcqaahaq:' + $taskEncoded + '@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'
    [IO.File]::WriteAllText($taskPath, ($taskSettings | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    Write-Host 'Saved only in the private local verification folder. You can return to Codex.'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)
    $taskPlain = $null
    $taskEncoded = $null
    $taskSettings = $null
    $taskSecret.Dispose()
}
