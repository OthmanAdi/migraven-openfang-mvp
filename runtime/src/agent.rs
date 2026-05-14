//! Loads `agent.toml` + `SYSTEM_PROMPT.md` + `skill.toml`. Builds the OpenAI
//! `tools` array from the skill manifest so the runtime stays in sync with the
//! skill's declared surface.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::types::{ToolDef, ToolFunctionDef};

#[derive(Debug, Clone)]
pub struct AgentDef {
    pub name: String,
    pub model: String,
    pub fallback_model: Option<String>,
    pub base_url: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub system_prompt: String,
}

#[derive(Debug, Deserialize)]
struct AgentToml {
    name: String,
    #[serde(default)]
    description: Option<String>,
    model: AgentModel,
    #[serde(default)]
    fallback_models: Vec<AgentModel>,
}

#[derive(Debug, Deserialize)]
struct AgentModel {
    model: String,
    base_url: String,
    #[serde(default = "default_max_tokens")]
    max_tokens: u32,
    #[serde(default = "default_temperature")]
    temperature: f32,
    #[serde(default)]
    system_prompt_file: Option<String>,
}

fn default_max_tokens() -> u32 {
    8192
}
fn default_temperature() -> f32 {
    0.3
}

pub fn load_agent(agent_dir: &Path) -> Result<AgentDef> {
    let toml_path = agent_dir.join("agent.toml");
    let raw = std::fs::read_to_string(&toml_path)
        .with_context(|| format!("read {}", toml_path.display()))?;
    let parsed: AgentToml = toml::from_str(&raw).with_context(|| "parse agent.toml")?;

    let system_prompt = if let Some(file) = parsed.model.system_prompt_file.as_ref() {
        let p = agent_dir.join(file);
        std::fs::read_to_string(&p).with_context(|| format!("read system prompt {}", p.display()))?
    } else {
        parsed.description.unwrap_or_default()
    };

    let base_url = override_env_endpoint(&parsed.model.base_url);
    let fallback_model = parsed.fallback_models.first().map(|m| m.model.clone());

    Ok(AgentDef {
        name: parsed.name,
        model: parsed.model.model,
        fallback_model,
        base_url,
        temperature: parsed.model.temperature,
        max_tokens: parsed.model.max_tokens,
        system_prompt,
    })
}

fn override_env_endpoint(base_url: &str) -> String {
    if let Ok(ep) = std::env::var("AZURE_FOUNDRY_ENDPOINT") {
        let ep = ep.trim().trim_end_matches('/');
        if !ep.is_empty() {
            return ep.to_string();
        }
    }
    base_url
        .trim_end_matches("/openai/v1")
        .trim_end_matches('/')
        .to_string()
}

#[derive(Debug, Deserialize)]
struct SkillToml {
    #[serde(default, rename = "tools")]
    tools_section: Option<ToolsSection>,
}

#[derive(Debug, Deserialize)]
struct ToolsSection {
    #[serde(default)]
    provided: Vec<ToolEntry>,
}

#[derive(Debug, Deserialize)]
struct ToolEntry {
    name: String,
    description: String,
    input_schema: Value,
}

pub fn load_tool_defs(skill_dir: &Path) -> Result<Vec<ToolDef>> {
    let toml_path = skill_dir.join("skill.toml");
    let raw = std::fs::read_to_string(&toml_path)
        .with_context(|| format!("read {}", toml_path.display()))?;
    let parsed: SkillToml = toml::from_str(&raw).with_context(|| "parse skill.toml")?;
    let provided = parsed.tools_section.map(|t| t.provided).unwrap_or_default();
    if provided.is_empty() {
        return Err(anyhow!("skill.toml declared zero tools"));
    }
    Ok(provided
        .into_iter()
        .map(|t| ToolDef {
            kind: "function".to_string(),
            function: ToolFunctionDef {
                name: t.name,
                description: t.description,
                parameters: ensure_object_schema(t.input_schema),
            },
        })
        .collect())
}

fn ensure_object_schema(mut schema: Value) -> Value {
    if let Some(obj) = schema.as_object_mut() {
        obj.entry("type".to_string()).or_insert(json!("object"));
        obj.entry("properties".to_string()).or_insert(json!({}));
        return schema;
    }
    json!({ "type": "object", "properties": {} })
}

pub fn resolve_paths() -> (PathBuf, PathBuf) {
    let project_root = project_root();
    let agent_dir = project_root.join("openfang/agents/ad-auditor");
    let skill_dir = project_root.join("skills/migraven-ad");
    (agent_dir, skill_dir)
}

fn project_root() -> PathBuf {
    if let Ok(p) = std::env::var("PROJECT_ROOT") {
        return PathBuf::from(p);
    }
    let exe = std::env::current_exe().ok();
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let candidate = manifest_dir.parent().map(Path::to_path_buf);
    candidate.unwrap_or_else(|| exe.unwrap_or_else(|| PathBuf::from(".")))
}
