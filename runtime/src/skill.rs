//! Spawns the Node skill subprocess once per tool call. Pipes JSON payload to
//! stdin, reads JSON result from stdout. Matches the OpenFang skill protocol
//! verbatim so swapping orchestrators is a no-op.

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

#[derive(Debug, Clone)]
pub struct SkillRunner {
    pub entry: PathBuf,
    pub agent_name: String,
}

impl SkillRunner {
    pub fn new(entry: PathBuf, agent_name: String) -> Self {
        Self { entry, agent_name }
    }

    pub async fn invoke(&self, tool: &str, args_json: &str) -> Result<Value> {
        let input: Value = serde_json::from_str(args_json)
            .with_context(|| format!("tool {} args not JSON: {}", tool, args_json))?;
        let payload = json!({
            "tool": tool,
            "input": input,
            "agent_id": "runtime",
            "agent_name": self.agent_name,
        });

        let mut child = Command::new("node")
            .arg(&self.entry)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| format!("spawn node {} (is Node 20+ on PATH?)", self.entry.display()))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(payload.to_string().as_bytes()).await?;
            stdin.shutdown().await?;
        }

        let mut stdout = String::new();
        if let Some(mut out) = child.stdout.take() {
            out.read_to_string(&mut stdout).await?;
        }
        let mut stderr = String::new();
        if let Some(mut err) = child.stderr.take() {
            err.read_to_string(&mut stderr).await?;
        }
        let status = child.wait().await?;

        if stdout.trim().is_empty() {
            return Err(anyhow!(
                "skill produced empty stdout (status {}). stderr: {}",
                status,
                stderr
            ));
        }
        let parsed: Value =
            serde_json::from_str(stdout.trim()).with_context(|| format!("skill stdout not JSON: {}", stdout))?;

        if let Some(err_str) = parsed.get("error").and_then(|v| v.as_str()) {
            return Err(anyhow!(err_str.to_string()));
        }
        let result = parsed
            .get("result")
            .cloned()
            .unwrap_or_else(|| json!({ "raw": stdout }));
        Ok(result)
    }
}
