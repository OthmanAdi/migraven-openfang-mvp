# scripts/run-all.ps1
# Launches runtime + frontend in two background jobs. Tails both logs to console.
# Ctrl+C kills both.

[CmdletBinding()]
param(
    [string]$CredentialName = "migRaven.MAX-AI"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

$runtimeScript = Join-Path $PSScriptRoot "start-runtime.ps1"
$frontendDir   = Join-Path $ProjectRoot "frontend"

Write-Host "[run-all] starting runtime + frontend"

$runtimeJob = Start-Job -Name "runtime" -ScriptBlock {
    param($script, $cred)
    & powershell -NoProfile -ExecutionPolicy Bypass -File $script -CredentialName $cred
} -ArgumentList $runtimeScript, $CredentialName

$frontendJob = Start-Job -Name "frontend" -ScriptBlock {
    param($dir)
    Set-Location $dir
    if (-not (Test-Path "node_modules")) {
        npm install --no-audit --no-fund
    }
    npm run dev
} -ArgumentList $frontendDir

try {
    Write-Host "[run-all] runtime:  http://127.0.0.1:50051"
    Write-Host "[run-all] frontend: http://localhost:5173"
    Write-Host "[run-all] Ctrl+C to stop both"
    while ($true) {
        Receive-Job -Job $runtimeJob -Keep
        Receive-Job -Job $frontendJob -Keep
        Start-Sleep -Seconds 1
        if ($runtimeJob.State -ne "Running" -and $frontendJob.State -ne "Running") {
            break
        }
    }
} finally {
    Stop-Job -Job $runtimeJob, $frontendJob -ErrorAction SilentlyContinue
    Remove-Job -Job $runtimeJob, $frontendJob -ErrorAction SilentlyContinue
}
