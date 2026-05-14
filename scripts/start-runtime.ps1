# scripts/start-runtime.ps1
# Builds the runtime if missing, then launches it. Reads the Foundry API key
# from Windows Credential Manager (target migRaven.MAX-AI) and injects it as
# AZURE_FOUNDRY_KEY for the runtime process. No manual key copy-paste.

[CmdletBinding()]
param(
    [string]$CredentialName = "migRaven.MAX-AI",
    [string]$ListenAddr = "127.0.0.1:50051",
    [switch]$Dev
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$BinaryRelease = Join-Path $ProjectRoot "runtime\target\release\migraven-runtime.exe"
$BinaryDebug = Join-Path $ProjectRoot "runtime\target\debug\migraven-runtime.exe"

# Load .env if present
$envFile = Join-Path $ProjectRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line -match "^([^=]+)=(.*)$") {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            Set-Item -Path "env:$name" -Value $value
        }
    }
    Write-Host "[start-runtime] loaded $envFile"
}

# Validate AZURE_FOUNDRY_ENDPOINT
if (-not $env:AZURE_FOUNDRY_ENDPOINT -or $env:AZURE_FOUNDRY_ENDPOINT -like "*YOUR-FOUNDRY*") {
    throw "AZURE_FOUNDRY_ENDPOINT not set or still placeholder. Edit $envFile first."
}

# Pull Foundry key from Windows Credential Manager
$signature = @"
using System;
using System.Runtime.InteropServices;
public class CredManLauncher {
  [DllImport("Advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredReadW(string target, int type, int flags, out IntPtr credential);
  [DllImport("Advapi32.dll")]
  public static extern void CredFree(IntPtr buffer);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
    [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount;
    public IntPtr Attributes;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
    [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
  }
}
"@
if (-not ([System.Management.Automation.PSTypeName]"CredManLauncher").Type) {
    Add-Type -TypeDefinition $signature -Language CSharp | Out-Null
}
$ptr = [IntPtr]::Zero
$ok = [CredManLauncher]::CredReadW($CredentialName, 1, 0, [ref]$ptr)
if (-not $ok) {
    throw "Credential '$CredentialName' not found. cmdkey /add:$CredentialName /user:foundry /pass:<KEY>"
}
try {
    $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManLauncher+CREDENTIAL])
    $secret = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob, ($cred.CredentialBlobSize / 2))
} finally {
    [CredManLauncher]::CredFree($ptr)
}
if (-not $secret) { throw "Empty credential payload for '$CredentialName'." }
$env:AZURE_FOUNDRY_KEY = $secret
$env:RUNTIME_LISTEN = $ListenAddr
Write-Host "[start-runtime] AZURE_FOUNDRY_KEY exported (length $($secret.Length)) - target $CredentialName"

# Pick binary
if ($Dev) {
    if (-not (Test-Path $BinaryDebug)) {
        Write-Host "[start-runtime] debug binary missing, building..."
        cargo build --manifest-path (Join-Path $ProjectRoot "runtime\Cargo.toml")
    }
    $bin = $BinaryDebug
    $env:RUST_LOG = "info,migraven_runtime=debug,tower_http=info"
} else {
    if (-not (Test-Path $BinaryRelease)) {
        Write-Host "[start-runtime] release binary missing, building..."
        cargo build --release --manifest-path (Join-Path $ProjectRoot "runtime\Cargo.toml")
    }
    $bin = $BinaryRelease
}

# Skill build check
$skillEntry = Join-Path $ProjectRoot "skills\migraven-ad\dist\index.js"
if (-not (Test-Path $skillEntry)) {
    Write-Host "[start-runtime] building skill..."
    npm install --prefix (Join-Path $ProjectRoot "skills\migraven-ad") --no-audit --no-fund
    npm run build --prefix (Join-Path $ProjectRoot "skills\migraven-ad")
}

Write-Host "[start-runtime] Launching $bin on $ListenAddr"
& $bin
