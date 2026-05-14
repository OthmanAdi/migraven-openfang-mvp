//! Azure AI Foundry client. Hits `/openai/v1/chat/completions` with a deployment
//! name in the `model` field. Same surface for `gpt-5.5` and `claude-opus-4-5` —
//! Foundry exposes both through the OpenAI-compatible wire.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::types::{ChatMessage, ToolCall, ToolDef};

#[derive(Debug, Clone)]
pub struct FoundryClient {
    pub base_url: String,
    pub api_key: String,
    pub http: reqwest::Client,
}

#[derive(Debug, Deserialize)]
pub struct ChatCompletionResp {
    pub choices: Vec<ChatChoice>,
    #[serde(default)]
    pub usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
pub struct ChatChoice {
    pub message: ChatMessage,
    #[serde(default)]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct Usage {
    #[serde(default)]
    pub prompt_tokens: u32,
    #[serde(default)]
    pub completion_tokens: u32,
    #[serde(default)]
    pub total_tokens: u32,
}

#[derive(Debug, Serialize)]
struct ChatBody<'a> {
    messages: &'a [ChatMessage],
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<&'a [ToolDef]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(rename = "max_completion_tokens", skip_serializing_if = "Option::is_none")]
    max_completion_tokens: Option<u32>,
    stream: bool,
}

const AOAI_API_VERSION: &str = "2024-12-01-preview";

impl FoundryClient {
    pub fn new(base_url: String, api_key: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .expect("reqwest client");
        Self { base_url, api_key, http }
    }

    pub async fn chat(
        &self,
        model: &str,
        messages: &[ChatMessage],
        tools: Option<&[ToolDef]>,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
    ) -> Result<ChatCompletionResp> {
        let base = self.base_url.trim_end_matches('/');
        if is_anthropic_model(model) {
            return crate::anthropic::call_claude(
                &self.http,
                base,
                &self.api_key,
                model,
                messages,
                tools,
                temperature,
                max_tokens.unwrap_or(8192),
            )
            .await;
        }
        let url = format!(
            "{}/openai/deployments/{}/chat/completions?api-version={}",
            base, model, AOAI_API_VERSION
        );
        let supports_temp = !is_reasoning_model(model);
        let body = ChatBody {
            messages,
            tools,
            tool_choice: tools.map(|_| "auto"),
            temperature: if supports_temp { temperature } else { None },
            max_completion_tokens: max_tokens,
            stream: false,
        };
        let raw = serde_json::to_string(&body)?;
        let resp = self
            .http
            .post(&url)
            .header("api-key", &self.api_key)
            .header("content-type", "application/json")
            .body(raw)
            .send()
            .await
            .with_context(|| format!("POST {}", url))?;
        let status = resp.status();
        let bytes = resp.bytes().await?;
        if !status.is_success() {
            let text = String::from_utf8_lossy(&bytes);
            return Err(anyhow!("Foundry {} error: {}", status, text));
        }
        let parsed: ChatCompletionResp = serde_json::from_slice(&bytes).with_context(|| {
            format!("parse Foundry response: {}", String::from_utf8_lossy(&bytes))
        })?;
        Ok(parsed)
    }
}

pub fn is_anthropic_model(model: &str) -> bool {
    let m = model.to_lowercase();
    m.starts_with("claude") || m.contains("anthropic")
}

fn is_reasoning_model(model: &str) -> bool {
    let m = model.to_lowercase();
    m.starts_with("o1") || m.starts_with("o3") || m.starts_with("o4") || m.starts_with("o5")
        || m.starts_with("gpt-5") || m.starts_with("gpt-6") || m.starts_with("gpt-7")
        || m.contains("codex")
}

pub fn extract_tool_calls(msg: &ChatMessage) -> Vec<ToolCall> {
    msg.tool_calls.clone().unwrap_or_default()
}

pub fn empty_assistant_text(msg: &ChatMessage) -> bool {
    msg.content.as_deref().map(str::trim).unwrap_or("").is_empty()
}

pub fn build_tool_result_message(tool_call_id: &str, result: &Value) -> ChatMessage {
    ChatMessage {
        role: "tool".to_string(),
        content: Some(serde_json::to_string(result).unwrap_or_else(|_| "{}".to_string())),
        name: None,
        tool_calls: None,
        tool_call_id: Some(tool_call_id.to_string()),
    }
}

pub fn build_tool_error_message(tool_call_id: &str, error: &str) -> ChatMessage {
    let payload = json!({ "error": error });
    build_tool_result_message(tool_call_id, &payload)
}
