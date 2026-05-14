# scripts/test-skill.ps1
# Pipes a JSON tool-call payload into the built skill and prints the JSON result.
# Useful for verifying the skill BEFORE OpenFang is even installed.
#
# Examples:
#   ./scripts/test-skill.ps1 -Tool get_ownership_coverage
#   ./scripts/test-skill.ps1 -Tool execute_cypher -Json '{"cypher":"MATCH (g:Group) RETURN count(g) AS n"}'

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$Tool,
    [string]$Json = "{}"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$entry = Join-Path $ProjectRoot "skills\migraven-ad\dist\index.js"

if (-not (Test-Path $entry)) {
    throw "Skill build missing. Run: cd skills/migraven-ad; npm install; npm run build"
}

$payload = @{
    tool = $Tool
    input = ($Json | ConvertFrom-Json)
    agent_id = "test-cli"
    agent_name = "ad-auditor"
} | ConvertTo-Json -Depth 10 -Compress

Write-Host "[test-skill] Tool: $Tool"
Write-Host "[test-skill] Input: $Json"
$payload | & node $entry
