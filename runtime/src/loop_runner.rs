//! ReAct loop. Each turn:
//!   1. POST current message history + tool defs to Foundry.
//!   2. If response has tool_calls, spawn skill subprocess per call, append
//!      tool messages, loop.
//!   3. If response has plain text content, emit as final answer.
//!
//! Loop guard: hard ceiling of MAX_TURNS (default 16) prevents runaway. Each
//! identical (tool_name, args) tuple beyond 3 hits = warn, beyond 5 = block.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;

use crate::foundry::{
    build_tool_error_message, build_tool_result_message, empty_assistant_text, extract_tool_calls,
    FoundryClient,
};
use crate::skill::SkillRunner;
use crate::types::{ChatMessage, ToolDef};

pub const MAX_TURNS: usize = 16;
pub const LOOP_WARN_THRESHOLD: u32 = 3;
pub const LOOP_BLOCK_THRESHOLD: u32 = 5;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LoopEvent {
    Token { content: String },
    ToolCall { id: String, name: String, arguments: String },
    ToolResult { id: String, result: Value },
    ToolError { id: String, error: String },
    Done { reason: String },
    Error { message: String },
}

pub struct LoopConfig {
    pub client: Arc<FoundryClient>,
    pub skill: SkillRunner,
    pub tools: Vec<ToolDef>,
    pub system_prompt: String,
    pub model: String,
    pub fallback_model: Option<String>,
    pub temperature: f32,
    pub max_tokens: u32,
}

pub async fn run(cfg: LoopConfig, user_history: Vec<ChatMessage>, tx: mpsc::Sender<LoopEvent>) {
    let mut history: Vec<ChatMessage> = Vec::with_capacity(user_history.len() + 2);
    history.push(ChatMessage {
        role: "system".to_string(),
        content: Some(cfg.system_prompt.clone()),
        name: None,
        tool_calls: None,
        tool_call_id: None,
    });
    history.extend(user_history);

    let mut loop_guard: HashMap<String, u32> = HashMap::new();
    let mut active_model = cfg.model.clone();

    for turn in 0..MAX_TURNS {
        let resp = match cfg
            .client
            .chat(
                &active_model,
                &history,
                Some(&cfg.tools),
                Some(cfg.temperature),
                Some(cfg.max_tokens),
            )
            .await
        {
            Ok(r) => r,
            Err(err) => {
                if let Some(fb) = cfg.fallback_model.as_ref().filter(|fb| **fb != active_model) {
                    tracing::warn!(error = %err, "primary model failed, falling back to {}", fb);
                    active_model = fb.clone();
                    continue;
                }
                let _ = tx
                    .send(LoopEvent::Error { message: format!("Foundry error: {}", err) })
                    .await;
                return;
            }
        };

        let Some(choice) = resp.choices.into_iter().next() else {
            let _ = tx.send(LoopEvent::Error { message: "Foundry returned 0 choices".into() }).await;
            return;
        };
        let assistant_msg = choice.message;
        let tool_calls = extract_tool_calls(&assistant_msg);

        if !empty_assistant_text(&assistant_msg) {
            if let Some(content) = assistant_msg.content.clone() {
                let _ = tx.send(LoopEvent::Token { content }).await;
            }
        }

        if tool_calls.is_empty() {
            let _ = tx
                .send(LoopEvent::Done {
                    reason: choice.finish_reason.unwrap_or_else(|| "stop".into()),
                })
                .await;
            return;
        }

        history.push(ChatMessage {
            role: "assistant".to_string(),
            content: assistant_msg.content.clone(),
            name: None,
            tool_calls: Some(tool_calls.clone()),
            tool_call_id: None,
        });

        for tc in tool_calls {
            let guard_key = format!("{}|{}", tc.function.name, tc.function.arguments);
            let count = loop_guard.entry(guard_key.clone()).or_insert(0);
            *count += 1;

            if *count > LOOP_BLOCK_THRESHOLD {
                let msg = format!(
                    "Loop guard blocked: tool '{}' called with identical args >{} times.",
                    tc.function.name, LOOP_BLOCK_THRESHOLD
                );
                let _ = tx
                    .send(LoopEvent::ToolError { id: tc.id.clone(), error: msg.clone() })
                    .await;
                history.push(build_tool_error_message(&tc.id, &msg));
                continue;
            }
            if *count >= LOOP_WARN_THRESHOLD {
                tracing::warn!("loop guard warn: '{}' x{}", tc.function.name, count);
            }

            let _ = tx
                .send(LoopEvent::ToolCall {
                    id: tc.id.clone(),
                    name: tc.function.name.clone(),
                    arguments: tc.function.arguments.clone(),
                })
                .await;

            match cfg.skill.invoke(&tc.function.name, &tc.function.arguments).await {
                Ok(result) => {
                    let _ = tx
                        .send(LoopEvent::ToolResult { id: tc.id.clone(), result: result.clone() })
                        .await;
                    history.push(build_tool_result_message(&tc.id, &result));
                }
                Err(err) => {
                    let emsg = err.to_string();
                    let _ = tx
                        .send(LoopEvent::ToolError { id: tc.id.clone(), error: emsg.clone() })
                        .await;
                    history.push(build_tool_error_message(&tc.id, &emsg));
                }
            }
        }
        tracing::debug!("turn {} done, history len={}", turn, history.len());
    }

    let _ = tx
        .send(LoopEvent::Done {
            reason: format!("max_turns ({}) reached", MAX_TURNS),
        })
        .await;
}
