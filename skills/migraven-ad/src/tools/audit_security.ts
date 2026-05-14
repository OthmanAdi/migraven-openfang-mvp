import { AuditSecurityIn, AuditSecurityOut } from "../schema.js";
import { runCypher } from "../neo4j-client.js";
import { SECURITY_CHECKS } from "../security-queries.js";

export async function auditSecurity(rawInput: unknown): Promise<unknown> {
  const input = AuditSecurityIn.parse(rawInput);
  const includeAll = input.include.includes("all");
  const selected = includeAll ? Object.keys(SECURITY_CHECKS) : input.include;

  const t0 = Date.now();
  const findings: Array<{
    id: string;
    check: string;
    severity: "info" | "low" | "medium" | "high" | "critical";
    title: string;
    detail: string;
    affected: Array<Record<string, unknown>>;
    remediation: string;
  }> = [];
  const severitySummary: Record<string, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  for (const key of selected) {
    const check = SECURITY_CHECKS[key];
    if (!check) continue;
    try {
      const r = await runCypher(check.cypher, { rowCap: 200 });
      if (r.rows.length === 0) continue;
      findings.push({
        id: check.id,
        check: key,
        severity: check.severity,
        title: check.title,
        detail: `${r.rows.length} betroffene Eintraege gefunden${r.truncated ? " (truncated)" : ""}.`,
        affected: r.rows.slice(0, 50),
        remediation: check.remediation,
      });
      severitySummary[check.severity] = (severitySummary[check.severity] ?? 0) + 1;
    } catch (err) {
      findings.push({
        id: check.id,
        check: key,
        severity: "info",
        title: `${check.title} (query failed)`,
        detail: err instanceof Error ? err.message : String(err),
        affected: [],
        remediation: check.remediation,
      });
    }
  }

  return AuditSecurityOut.parse({
    findings,
    severitySummary,
    elapsedMs: Date.now() - t0,
  });
}
