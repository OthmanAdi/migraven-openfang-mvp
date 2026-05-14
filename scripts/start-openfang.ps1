# scripts/start-openfang.ps1
# Pulls migRaven.MAX-AI from Windows Credential Manager and exports it as
# AZURE_FOUNDRY_KEY before launching `openfang start`. Same trick the legacy
# Rust backend uses, so OpenFang gets the same key without you ever typing it.

[CmdletBinding()]
param(
    [string]$CredentialName = "migRaven.MAX-AI"
)

$ErrorActionPreference = "Stop"

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
Add-Type -TypeDefinition $signature -Language CSharp | Out-Null

$ptr = [IntPtr]::Zero
$ok = [CredManLauncher]::CredReadW($CredentialName, 1, 0, [ref]$ptr)
if (-not $ok) {
    throw "Could not read '$CredentialName' from Windows Credential Manager."
}
try {
    $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManLauncher+CREDENTIAL])
    $passLen = $cred.CredentialBlobSize / 2
    $secret = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob, $passLen)
} finally {
    [CredManLauncher]::CredFree($ptr)
}

if (-not $secret) { throw "Empty credential payload for '$CredentialName'." }

$env:AZURE_FOUNDRY_KEY = $secret
Write-Host "[start-openfang] AZURE_FOUNDRY_KEY exported (length $($secret.Length))."

# Locate the openfang binary
$openfang = (Get-Command openfang -ErrorAction SilentlyContinue)
if (-not $openfang) {
    throw "OpenFang binary not found in PATH. Install via: irm https://openfang.sh/install.ps1 | iex"
}

Write-Host "[start-openfang] Launching $($openfang.Source) start"
& $openfang.Source start
