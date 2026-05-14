//! Anthropic Messages API adapter for Claude deployments hosted on Azure
//! Foundry. Foundry exposes Claude at `{base}/anthropic/v1/messages` with the
//! standard Anthropic wire — `system` is a top-level field, `tools` lack the
//! `function` wrapper, tool calls live inside content blocks as `tool_use`,
//! and tool results come back as `tool_result` blocks in a user message.
//!
//! This module translates *to* and *from* our internal OpenAI-shaped
//! `ChatMessage` so `loop_runner` stays format-agnostic.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::types::{ChatMessage, FunctionCall, ToolCall, ToolDef};

const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Debug, Serialize)]
struct AnthropicBody<'a> {
    model: &'a str,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<AnthropicToolDef>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    stream: bool,
}

#[derive(Debug, Serialize)]
struct AnthropicToolDef {
    name: String,
    description: String,
    input_schema: Value,
}

#[derive(Debug, Serialize)]
struct AnthropicMessage {
    role: String,
    content: Value,
}

#[derive(Debug, Deserialize)]
pub struct AnthropicResponse {
    #[serde(default)]
    pub content: Vec<AnthropicContentBlock>,
    #[serde(default)]
    pub stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AnthropicContentBlock {
    Text { text: String },
    ToolUse { id: String, name: String, input: Value },
    #[serde(other)]
    Other,
}

pub async fn call_claude(
    http: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ChatMessage],
    tools: Option<&[ToolDef]>,
    temperature: Option<f32>,
    max_tokens: u32,
) -> Result<crate::foundry::ChatCompletionResp> {
    let url = format!(
        "{}/anthropic/v1/messages",
        base_url.trim_end_matches('/')
    );

    let (system, converted) = convert_to_anthropic(messages)?;
    let body = AnthropicBody {
        model,
        max_tokens,
        system,
        messages: converted,
        tools: tools.map(|t| {
            t.iter()
                .map(|td| AnthropicToolDef {
                    name: td.function.name.clone(),
                    description: td.function.description.clone(),
                    input_schema: td.function.parameters.clone(),
                })
                .collect()
        }),
        temperature,
        stream: false,
    };

    let raw = serde_json::to_string(&body)?;
    let resp = http
        .post(&url)
        .header("api-key", api_key)
        .header("authorization", format!("Bearer {}", api_key))
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .body(raw)
        .send()
        .await
        .with_context(|| format!("POST {}", url))?;

    let status = resp.status();
    let bytes = resp.bytes().await?;
    if !status.is_success() {
        let text = String::from_utf8_lossy(&bytes);
        return Err(anyhow!("Anthropic {} error: {}", status, text));
    }

    let parsed: AnthropicResponse = serde_json::from_slice(&bytes).with_context(|| {
        format!("parse Anthropic response: {}", String::from_utf8_lossy(&bytes))
    })?;

    let assistant = anthropic_to_openai(parsed.content, parsed.stop_reason.as_deref());
    Ok(crate::foundry::ChatCompletionResp {
        choices: vec![crate::foundry::ChatChoice {
            message: assistant,
            finish_reason: parsed.stop_reason,
        }],
        usage: None,
    })
}

fn convert_to_anthropic(messages: &[ChatMessage]) -> Result<(Option<String>, Vec<AnthropicMessage>)> {
    let mut system: Option<String> = None;
    let mut out: Vec<AnthropicMessage> = Vec::new();
    let mut pending_tool_results: Vec<Value> = Vec::new();

    for msg in messages {
        match msg.role.as_str() {
            "system" => {
                if let Some(c) = &msg.content {
                    system = match system.take() {
                        Some(prev) => Some(format!("{}\n\n{}", prev, c)),
                        None => Some(c.clone()),
                    };
                }
            }
            "user" => {
                flush_tool_results(&mut out, &mut pending_tool_results);
                if let Some(c) = &msg.content {
                    out.push(AnthropicMessage {
                        role: "user".into(),
                        content: json!([{"type": "text", "text": c}]),
                    });
                }
            }
            "assistant" => {
                flush_tool_results(&mut out, &mut pending_tool_results);
                let mut blocks: Vec<Value> = Vec::new();
                if let Some(text) = msg.content.as_ref().filter(|s| !s.trim().is_empty()) {
                    blocks.push(json!({"type": "text", "text": text}));
                }
                if let Some(tcs) = &msg.tool_calls {
                    for tc in tcs {
                        let input: Value = serde_json::from_str(&tc.function.arguments)
                            .unwrap_or_else(|_| json!({}));
                        blocks.push(json!({
                            "type": "tool_use",
                            "id": tc.id,
                            "name": tc.function.name,
                            "input": input,
                        }));
                    }
                }
                if !blocks.is_empty() {
                    out.push(AnthropicMessage {
                        role: "assistant".into(),
                        content: Value::Array(blocks),
                    });
                }
            }
            "tool" => {
                let id = msg.tool_call_id.clone().unwrap_or_default();
                let content = msg.content.clone().unwrap_or_default();
                pending_tool_results.push(json!({
                    "type": "tool_result",
                    "tool_use_id": id,
                    "content": content,
                }));
            }
            _ => {}
        }
    }
    flush_tool_results(&mut out, &mut pending_tool_results);
    Ok((system, out))
}

fn flush_tool_results(out: &mut Vec<AnthropicMessage>, pending: &mut Vec<Value>) {
    if pending.is_empty() {
        return;
    }
    out.push(AnthropicMessage {
        role: "user".into(),
        content: Value::Array(std::mem::take(pending)),
    });
}

fn anthropic_to_openai(blocks: Vec<AnthropicContentBlock>, _stop_reason: Option<&str>) -> ChatMessage {
    let mut text_parts: Vec<String> = Vec::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    for block in blocks {
        match block {
            AnthropicContentBlock::Text { text } => text_parts.push(text),
            AnthropicContentBlock::ToolUse { id, name, input } => {
                tool_calls.push(ToolCall {
                    id,
                    kind: "function".into(),
                    function: FunctionCall {
                        name,
                        arguments: input.to_string(),
                    },
                });
            }
            AnthropicContentBlock::Other => {}
        }
    }
    ChatMessage {
        role: "assistant".into(),
        content: if text_parts.is_empty() {
            None
        } else {
            Some(text_parts.join("\n"))
        },
        name: None,
        tool_calls: if tool_calls.is_empty() {
            None
        } else {
            Some(tool_calls)
        },
        tool_call_id: None,
    }
}
