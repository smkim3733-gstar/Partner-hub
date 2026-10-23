#requires -Version 7.0
param(
    [switch]$SendApprovedTest,
    [switch]$RetryReviewedTest,
    [switch]$RetryAfterSmtpEnabled,
    [string]$ReviewedRejectedSha256,
    [string]$ReviewedSecondRejectedSha256,
    [switch]$KeepResultOpen
)
$ErrorActionPreference = 'Stop'
$mailNode = (Get-Command node -ErrorAction Stop).Source
$mailScript = Join-Path $PSScriptRoot 'backup-alert-mail.mjs'

# Default invocation only previews. Do not run the send switch without approval.
if (@(@($SendApprovedTest, $RetryReviewedTest, $RetryAfterSmtpEnabled) | Where-Object { $_ }).Count -gt 1) { throw 'Choose one test mode only.' }
if ($ReviewedRejectedSha256 -and -not ($RetryReviewedTest -or $RetryAfterSmtpEnabled)) { throw 'A reviewed hash requires retry mode.' }
if ($ReviewedSecondRejectedSha256 -and -not $RetryAfterSmtpEnabled) { throw 'The second reviewed hash requires SMTP-enabled retry mode.' }
if (-not $SendApprovedTest -and -not $RetryReviewedTest -and -not $RetryAfterSmtpEnabled) {
    & $mailNode $mailScript --preview
    exit $LASTEXITCODE
}

function Read-ReviewedRejection {
    param([string]$ReceiptPath, [string]$ExpectedSha256)
    if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'A reviewed rejection hash is required.' }
    $mailPriorInfo = Get-Item -LiteralPath $ReceiptPath -ErrorAction Stop
    if ($mailPriorInfo.PSIsContainer -or ($mailPriorInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $mailPriorInfo.Length -gt 8192) { throw 'Prior record is not a regular result file.' }
    if ((Get-FileHash -LiteralPath $ReceiptPath -Algorithm SHA256).Hash -ne $ExpectedSha256) { throw 'Prior record changed; review required.' }
    $mailReviewed = Get-Content -LiteralPath $ReceiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($mailReviewed.version -ne 1 -or $mailReviewed.status -ne 'smtp-rejected' -or $mailReviewed.error -ne 'MAIL_TEST_REJECTED' -or $mailReviewed.synthetic -ne $true -or $mailReviewed.recipient -ne 'smkim3733@naver.com' -or $mailReviewed.networkAttempted -ne $true -or $mailReviewed.smtpAccepted -ne $false -or $mailReviewed.receiptVerified -ne $false -or $mailReviewed.automaticRetry -ne $false) { throw 'Prior result does not allow a reviewed retry.' }
    return $mailReviewed
}

Write-Host 'Approved one-time synthetic test: smkim3733@naver.com -> smkim3733@naver.com'
$mailReceipt = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'PartnerHubNotifications/naver-o2-test-v1.json'
$mailNodeArguments = '"' + $mailScript + '" --send-approved-test'
if ($RetryReviewedTest -or $RetryAfterSmtpEnabled) {
    $null = Read-ReviewedRejection -ReceiptPath $mailReceipt -ExpectedSha256 $ReviewedRejectedSha256
    $mailReceipt = Join-Path (Split-Path -Parent $mailReceipt) 'naver-o2-test-v2.json'
    $mailNodeArguments = '"' + $mailScript + '" --retry-reviewed-test ' + $ReviewedRejectedSha256
    if ($RetryAfterSmtpEnabled) {
        $mailSecond = Read-ReviewedRejection -ReceiptPath $mailReceipt -ExpectedSha256 $ReviewedSecondRejectedSha256
        if ($mailSecond.reviewedRejectedSha256 -ne $ReviewedRejectedSha256) { throw 'Prior record chain changed; review required.' }
        $mailReceipt = Join-Path (Split-Path -Parent $mailReceipt) 'naver-o2-test-v3.json'
        $mailNodeArguments = '"' + $mailScript + '" --retry-after-smtp-enabled ' + $ReviewedRejectedSha256 + ' ' + $ReviewedSecondRejectedSha256
        Write-Host 'SMTP enabled and saved by operator; one approved retry only. Both prior results are preserved; v3 blocks further attempts.'
    } else {
        Write-Host 'One reviewed retry only. The first result is preserved; v2 blocks this retry mode.'
    }
}
if (Test-Path -LiteralPath $mailReceipt) {
    Write-Host 'A prior attempt exists. Inspect its result before any retry; do not delete its record automatically.'
    exit 1
}
Write-Host 'Enter the NAVER application password here only. It is not saved to disk.'
$mailSecure = Read-Host 'NAVER application password' -AsSecureString
$mailPointer = [IntPtr]::Zero
$mailChild = $null
try {
    $mailStart = [Diagnostics.ProcessStartInfo]::new()
    $mailStart.FileName = $mailNode
    $mailStart.Arguments = $mailNodeArguments
    $mailStart.UseShellExecute = $false
    $mailStart.CreateNoWindow = $true
    $mailStart.RedirectStandardInput = $true
    $mailStart.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
    $mailChild = [Diagnostics.Process]::Start($mailStart)
    $mailPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($mailSecure)
    $mailPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($mailPointer)
    $mailPayload = @{ password = $mailPlain } | ConvertTo-Json -Compress
    $mailChild.StandardInput.WriteLine($mailPayload)
    $mailChild.StandardInput.Close()
    $mailChild.WaitForExit()
    $mailExit = $mailChild.ExitCode
} catch {
    Write-Host 'Mail test failed. Inspect the sanitized local result before any retry.'
    $mailExit = 1
} finally {
    if ($mailPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($mailPointer) }
    $mailPlain = $null
    $mailPayload = $null
    $mailSecure.Dispose()
    if ($null -ne $mailChild) { $mailChild.Dispose() }
}
if ($KeepResultOpen) {
    Write-Host ('Mail test exit code: ' + $mailExit + '. SMTP acceptance does not confirm receipt. Do not run again.')
    [void](Read-Host 'Press Enter to close this result window')
}
exit $mailExit
