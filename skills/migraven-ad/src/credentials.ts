import { spawnSync } from "node:child_process";

const PREFIX = process.env.MAX_CREDENTIAL_PREFIX?.trim() || "migRaven.MAX";

const NEO4J_TARGET =
  process.env.NEO4J_CREDENTIAL_NAME?.trim() || `${PREFIX}-Neo4j`;
const AI_TARGET = process.env.AI_CREDENTIAL_NAME?.trim() || `${PREFIX}-AI`;

export type CredentialPair = { username: string; password: string };

function readWithPowerShell(target: string): CredentialPair {
  const script = `
    $ErrorActionPreference = 'Stop'
    $target = '${target.replace(/'/g, "''")}'
    $sig = @"
using System;
using System.Runtime.InteropServices;
public class CredMan {
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
    Add-Type -TypeDefinition $sig -Language CSharp | Out-Null
    $ptr = [IntPtr]::Zero
    $ok = [CredMan]::CredReadW($target, 1, 0, [ref]$ptr)
    if (-not $ok) { throw "Credential '$target' not found in Windows Credential Manager." }
    try {
      $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredMan+CREDENTIAL])
      $passLen = $cred.CredentialBlobSize / 2
      $pass = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob, $passLen)
      [pscustomobject]@{ username = $cred.UserName; password = $pass } | ConvertTo-Json -Compress
    } finally {
      [CredMan]::CredFree($ptr)
    }
  `;
  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf-8", maxBuffer: 1024 * 1024 }
  );
  if (res.status !== 0) {
    const stderr = (res.stderr || "").trim() || `exit ${res.status}`;
    throw new Error(`Credential read failed for '${target}': ${stderr}`);
  }
  const json = (res.stdout || "").trim();
  if (!json) throw new Error(`Credential '${target}': empty PowerShell output.`);
  const parsed = JSON.parse(json) as CredentialPair;
  if (!parsed.username || !parsed.password) {
    throw new Error(`Credential '${target}': username/password missing.`);
  }
  return parsed;
}

let neo4jCache: CredentialPair | null = null;
export function getNeo4jCredentials(): CredentialPair {
  if (neo4jCache) return neo4jCache;
  neo4jCache = readWithPowerShell(NEO4J_TARGET);
  return neo4jCache;
}

let foundryKeyCache: string | null = null;
export function getFoundryApiKey(): string {
  if (foundryKeyCache) return foundryKeyCache;
  const { password } = readWithPowerShell(AI_TARGET);
  foundryKeyCache = password;
  return foundryKeyCache;
}

export const credentialTargets = { neo4j: NEO4J_TARGET, foundry: AI_TARGET };
