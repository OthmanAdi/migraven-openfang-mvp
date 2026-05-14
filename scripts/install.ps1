# scripts/install.ps1
# Bootstraps the OpenFang AD-Auditor MVP on Windows.
#
# - Verifies required Windows Credential Manager targets exist.
# - Renders openfang/config.toml + openfang/agents/ad-auditor/agent.toml with the
#   AZURE_FOUNDRY_ENDPOINT from .env and copies them to %USERPROFILE%\.openfang.
# - Builds the migraven-ad skill (npm install + tsc).
# - Symlinks the skill into %USERPROFILE%\.openfang\skills (requires Developer Mode).

[CmdletBinding()]
param(
    [string]$EnvFile = (Join-Path $PSScriptRoot ".." | Join-Path -ChildPath ".env"),
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$OpenFangHome = Join-Path $env:USERPROFILE ".openfang"

Write-Host "[install] Project root: $ProjectRoot"
Write-Host "[install] OpenFang home: $OpenFangHome"

# 1) Load .env (simple KEY=VALUE parser)
if (-not (Test-Path $EnvFile)) {
    Write-Host "[install] No .env found at $EnvFile, copying from .env.example."
    Copy-Item (Join-Path $ProjectRoot ".env.example") $EnvFile
    Write-Host "[install] PLEASE edit $EnvFile to set AZURE_FOUNDRY_ENDPOINT, then re-run."
    exit 1
}

$envMap = @{}
Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line -match "^([^=]+)=(.*)$") {
        $envMap[$matches[1].Trim()] = $matches[2].Trim()
    }
}

$foundryEndpoint = $envMap["AZURE_FOUNDRY_ENDPOINT"]
if (-not $foundryEndpoint -or $foundryEndpoint -like "*YOUR-FOUNDRY*") {
    throw "AZURE_FOUNDRY_ENDPOINT must be set in $EnvFile (not the placeholder)."
}

# 2) Verify required Credential Manager targets
$prefix = if ($envMap.ContainsKey("MAX_CREDENTIAL_PREFIX")) { $envMap["MAX_CREDENTIAL_PREFIX"] } else { "migRaven.MAX" }
$required = @("$prefix-AI", "$prefix-Neo4j")
foreach ($target in $required) {
    $found = cmdkey /list:$target 2>$null | Select-String "Target:"
    if (-not $found) {
        throw "Required Windows Credential Manager target '$target' not found. Use 'cmdkey /add:$target /user:<u> /pass:<p>'."
    }
    Write-Host "[install] Credential target OK: $target"
}

# 3) Render config.toml with endpoint substitution
$cfgSrc = Get-Content (Join-Path $ProjectRoot "openfang\config.toml") -Raw
$cfgDst = $cfgSrc -replace [regex]::Escape("https://YOUR-FOUNDRY.cognitiveservices.azure.com"), $foundryEndpoint
New-Item -ItemType Directory -Path $OpenFangHome -Force | Out-Null
$cfgDst | Set-Content (Join-Path $OpenFangHome "config.toml") -Encoding UTF8
Write-Host "[install] Wrote $OpenFangHome\config.toml"

# 4) Render agent.toml with endpoint substitution
$agentSrcDir = Join-Path $ProjectRoot "openfang\agents\ad-auditor"
$agentDstDir = Join-Path $OpenFangHome "agents\ad-auditor"
New-Item -ItemType Directory -Path $agentDstDir -Force | Out-Null

$agentSrc = Get-Content (Join-Path $agentSrcDir "agent.toml") -Raw
$agentDst = $agentSrc -replace [regex]::Escape("https://YOUR-FOUNDRY.cognitiveservices.azure.com"), $foundryEndpoint
$agentDst | Set-Content (Join-Path $agentDstDir "agent.toml") -Encoding UTF8

Copy-Item (Join-Path $agentSrcDir "SYSTEM_PROMPT.md") (Join-Path $agentDstDir "SYSTEM_PROMPT.md") -Force
Write-Host "[install] Wrote agent.toml + SYSTEM_PROMPT.md to $agentDstDir"

# 5) Build the skill
$skillDir = Join-Path $ProjectRoot "skills\migraven-ad"
if (-not $SkipBuild) {
    Push-Location $skillDir
    try {
        Write-Host "[install] npm install..."
        npm install --silent
        Write-Host "[install] npm run build..."
        npm run build
    } finally {
        Pop-Location
    }
}

# 6) Symlink skill into ~/.openfang/skills/migraven-ad
$skillsDst = Join-Path $OpenFangHome "skills"
New-Item -ItemType Directory -Path $skillsDst -Force | Out-Null
$skillLink = Join-Path $skillsDst "migraven-ad"
if (Test-Path $skillLink) { Remove-Item $skillLink -Recurse -Force }
try {
    New-Item -ItemType SymbolicLink -Path $skillLink -Target $skillDir -ErrorAction Stop | Out-Null
    Write-Host "[install] Symlinked $skillLink -> $skillDir"
} catch {
    Write-Warning "Symlink failed ($_). Copying instead (enable Developer Mode for faster iteration)."
    Copy-Item $skillDir $skillLink -Recurse -Force
}

Write-Host ""
Write-Host "[install] DONE."
Write-Host "[install] Next:"
Write-Host "  1. scripts\start-openfang.ps1     # launches OpenFang with cred-injected env"
Write-Host "  2. cd frontend; npm install; npm run dev"
Write-Host "  3. openfang chat ad-auditor       # CLI smoke test"
