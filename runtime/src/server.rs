//! HTTP server. Exposes:
//!   GET  /api/health             — lightweight ping
//!   GET  /api/agent              — agent metadata + tool catalog
//!   POST /v1/chat/completions    — OpenAI-compatible, SSE when stream=true
//!
//! Frontend (`frontend/src/lib/openfang-api.ts`) and CLI both speak this wire,
//! exactly the surface OpenFang would expose. Swap target the day we install
//! `openfang` — zero frontend changes.

use anyhow::Result;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{get, post};
use axum::Router;
use futures_util::{Stream, StreamExt as FuturesStreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::StreamExt;
use uuid::Uuid;

use crate::agent::{load_agent, load_tool_defs, resolve_paths, AgentDef};
use crate::credentials::read_foundry_key;
use crate::foundry::FoundryClient;
use crate::loop_runner::{run, LoopConfig, LoopEvent};
use crate::skill::SkillRunner;
use crate::types::{ChatMessage, ChatRequest, ToolDef};

#[derive(Clone)]
pub struct AppState {
    pub agent: AgentDef,
    pub tools: Vec<ToolDef>,
    pub skill_entry: PathBuf,
    pub client: Arc<FoundryClient>,
}

impl AppState {
    pub async fn load() -> Result<Self> {
        let (agent_dir, skill_dir) = resolve_paths();
        let agent = load_agent(&agent_dir)?;
        let tools = load_tool_defs(&skill_dir)?;
        let skill_entry = skill_dir.join("dist/index.js");
        if !skill_entry.exists() {
            return Err(anyhow::anyhow!(
                "Skill entry missing: {}. Run: npm install --prefix skills/migraven-ad && npm run build --prefix skills/migraven-ad",
                skill_entry.display()
            ));
        }
        let key = read_foundry_key()?;
        let client = Arc::new(FoundryClient::new(agent.base_url.clone(), key));
        Ok(Self { agent, tools, skill_entry, client })
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/agent", get(agent_meta))
        .route("/v1/chat/completions", post(chat_completions))
        .with_state(state)
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    runtime: &'static str,
    agent: String,
    model: String,
    tools: usize,
}

async fn health(State(state): State<AppState>) -> Json<Health> {
    Json(Health {
        status: "ok",
        runtime: "migraven-runtime",
        agent: state.agent.name.clone(),
        model: state.agent.model.clone(),
        tools: state.tools.len(),
    })
}

async fn agent_meta(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "name": state.agent.name,
        "model": state.agent.model,
        "fallback_model": state.agent.fallback_model,
        "base_url": state.agent.base_url,
        "tools": state.tools.iter().map(|t| &t.function.name).collect::<Vec<_>>(),
    }))
}

async fn chat_completions(
    State(state): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> Response {
    if req.stream {
        sse_response(state, req).await.into_response()
    } else {
        non_streaming(state, req).await.into_response()
    }
}

async fn non_streaming(state: AppState, req: ChatRequest) -> Result<Json<Value>, (StatusCode, String)> {
    let (tx, mut rx) = mpsc::channel::<LoopEvent>(64);
    let cfg = build_loop_cfg(&state, &req);
    let user_history = filter_user_history(req.messages);
    tokio::spawn(async move {
        run(cfg, user_history, tx).await;
    });

    let mut answer = String::new();
    while let Some(evt) = rx.recv().await {
        match evt {
            LoopEvent::Token { content } => answer.push_str(&content),
            LoopEvent::Done { .. } => break,
            LoopEvent::Error { message } => {
                return Err((StatusCode::BAD_GATEWAY, message));
            }
            _ => {}
        }
    }
    Ok(Json(json!({
        "id": format!("chatcmpl-{}", Uuid::new_v4()),
        "object": "chat.completion",
        "model": state.agent.model,
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": answer },
            "finish_reason": "stop"
        }],
    })))
}

async fn sse_response(
    state: AppState,
    req: ChatRequest,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let model_label = req.model.clone().unwrap_or_else(|| state.agent.model.clone());
    let (tx, rx) = mpsc::channel::<LoopEvent>(128);
    let cfg = build_loop_cfg(&state, &req);
    let user_history = filter_user_history(req.messages);

    tokio::spawn(async move {
        run(cfg, user_history, tx).await;
    });

    let stream = ReceiverStream::new(rx);
    let chat_id = format!("chatcmpl-{}", Uuid::new_v4());

    let mapped = FuturesStreamExt::flat_map(stream, move |evt| {
        let chunk = render_chunk(&chat_id, &model_label, &evt).unwrap_or_default();
        let is_done = matches!(evt, LoopEvent::Done { .. });
        let primary = Event::default().data(chunk);
        let mut events: Vec<Result<Event, Infallible>> = vec![Ok::<_, Infallible>(primary)];
        if is_done {
            events.push(Ok::<_, Infallible>(Event::default().data("[DONE]")));
        }
        futures_util::stream::iter(events)
    });

    Sse::new(mapped).keep_alive(KeepAlive::new())
}

fn render_chunk(chat_id: &str, model: &str, evt: &LoopEvent) -> Option<String> {
    match evt {
        LoopEvent::Token { content } => Some(
            json!({
                "id": chat_id,
                "object": "chat.completion.chunk",
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": { "content": content },
                    "finish_reason": null
                }]
            })
            .to_string(),
        ),
        LoopEvent::ToolCall { id, name, arguments } => Some(
            json!({
                "id": chat_id,
                "object": "chat.completion.chunk",
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {
                        "tool_calls": [{
                            "index": 0,
                            "id": id,
                            "type": "function",
                            "function": { "name": name, "arguments": arguments }
                        }]
                    },
                    "finish_reason": null
                }]
            })
            .to_string(),
        ),
        LoopEvent::ToolResult { id, result } => Some(
            json!({
                "id": chat_id,
                "object": "chat.completion.chunk",
                "model": model,
                "x_tool_result": { "id": id, "result": result }
            })
            .to_string(),
        ),
        LoopEvent::ToolError { id, error } => Some(
            json!({
                "id": chat_id,
                "object": "chat.completion.chunk",
                "model": model,
                "x_tool_error": { "id": id, "error": error }
            })
            .to_string(),
        ),
        LoopEvent::Error { message } => Some(
            json!({
                "id": chat_id,
                "object": "chat.completion.chunk",
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": { "content": format!("\n[runtime error] {}", message) },
                    "finish_reason": "stop"
                }]
            })
            .to_string(),
        ),
        LoopEvent::Done { reason } => Some(
            json!({
                "id": chat_id,
                "object": "chat.completion.chunk",
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {},
                    "finish_reason": reason
                }]
            })
            .to_string(),
        ),
    }
}

fn render_done(chat_id: &str, model: &str) -> String {
    json!({
        "id": chat_id,
        "object": "chat.completion.chunk",
        "model": model,
        "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }]
    })
    .to_string()
}

fn build_loop_cfg(state: &AppState, req: &ChatRequest) -> LoopConfig {
    let model = req.model.clone().unwrap_or_else(|| state.agent.model.clone());
    LoopConfig {
        client: state.client.clone(),
        skill: SkillRunner::new(state.skill_entry.clone(), state.agent.name.clone()),
        tools: state.tools.clone(),
        system_prompt: state.agent.system_prompt.clone(),
        model,
        fallback_model: state.agent.fallback_model.clone(),
        temperature: req.temperature.unwrap_or(state.agent.temperature),
        max_tokens: state.agent.max_tokens,
    }
}

fn filter_user_history(messages: Vec<ChatMessage>) -> Vec<ChatMessage> {
    messages
        .into_iter()
        .filter(|m| m.role != "system")
        .collect()
}
