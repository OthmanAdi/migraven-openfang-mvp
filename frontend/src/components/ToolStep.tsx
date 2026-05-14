import type { ToolCallView } from "../lib/openfang-api.js";

type Finding = {
  id: string;
  check: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  detail: string;
  affected: Record<string, unknown>[];
  remediation: string;
};

export function ToolStep({ call }: { call: ToolCallView }) {
  const err = !!call.error;
  return (
    <div className={`tool-step ${err ? "err" : ""}`}>
      <div>
        <span className="label">tool</span> <span className="tag">{call.name}</span>
      </div>
      {call.arguments ? <pre style={{ margin: 0 }}>{prettyJson(call.arguments)}</pre> : null}
      {call.error ? <div>error: {call.error}</div> : null}
      {call.result ? renderResult(call.name, call.result) : null}
    </div>
  );
}

function renderResult(name: string, raw: string) {
  if (name === "audit_security") {
    try {
      const parsed = JSON.parse(raw) as { findings: Finding[] };
      if (Array.isArray(parsed.findings)) {
        return (
          <div className="findings">
            {parsed.findings.map((f) => (
              <div key={f.id} className={`finding ${f.severity}`}>
                <span className="sev">{f.severity}</span>
                <div>
                  <strong>{f.title}</strong>
                  <div style={{ fontSize: "0.85em", opacity: 0.8 }}>{f.detail}</div>
                  <div style={{ fontSize: "0.8em", marginTop: 4 }}>
                    <em>Empfehlung:</em> {f.remediation}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      }
    } catch {
      // fall through
    }
  }
  return <pre style={{ margin: "0.4rem 0 0" }}>{truncate(prettyJson(raw), 4000)}</pre>;
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n... (${s.length - n} chars truncated)` : s;
}
