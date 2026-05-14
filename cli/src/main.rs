use anyhow::{anyhow, Context, Result};
use clap::{Parser, Subcommand};
use colored::Colorize;
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use rustyline::DefaultEditor;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::Stdio;

const DEFAULT_BASE: &str = "http://127.0.0.1:50051";
const DEFAULT_AGENT: &str = "ad-auditor";

#[derive(Parser, Debug)]
#[command(name = "migraven-ad-cli", version, about = "migRaven AD Auditor CLI (OpenFang MVP)")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Interactive REPL against the running OpenFang server.
    Chat {
        #[arg(long, default_value = DEFAULT_AGENT)]
        agent: String,
        #[arg(long, default_value = "gpt-5.5")]
        model: String,
        #[arg(long, default_value = DEFAULT_BASE)]
        base: String,
    },
    /// Run a single skill tool against the local skill build (no OpenFang).
    Skill {
        tool: String,
        #[arg(long, default_value = "{}")]
        input: String,
        #[arg(long, default_value = "skills/migraven-ad/dist/index.js")]
        entry: String,
    },
    /// One-shot question (non-interactive).
    Ask {
        question: String,
        #[arg(long, default_value = DEFAULT_AGENT)]
        agent: String,
        #[arg(long, default_value = "gpt-5.5")]
        model: String,
        #[arg(long, default_value = DEFAULT_BASE)]
        base: String,
    },
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMsg>,
    stream: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct ChatMsg {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChunkChoice {
    delta: Option<ChunkDelta>,
}

#[derive(Deserialize)]
struct ChunkDelta {
    content: Option<String>,
    tool_calls: Option<Vec<ChunkToolCall>>,
}

#[derive(Deserialize)]
struct ChunkToolCall {
    index: Option<usize>,
    id: Option<String>,
    function: Option<ChunkFunction>,
}

#[derive(Deserialize)]
struct ChunkFunction {
    name: Option<String>,
    arguments: Option<String>,
}

#[derive(Deserialize)]
struct Chunk {
    choices: Option<Vec<ChunkChoice>>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Chat { agent, model, base } => chat_repl(&base, &agent, &model).await,
        Cmd::Skill { tool, input, entry } => skill_oneshot(&entry, &tool, &input).await,
        Cmd::Ask { question, agent, model, base } => one_shot(&base, &agent, &model, &question).await,
    }
}

async fn chat_repl(base: &str, agent: &str, model: &str) -> Result<()> {
    println!(
        "{} {} {} ({})",
        "migRaven AD Auditor".bold().bright_white(),
        "agent:".dimmed(),
        agent.bright_blue(),
        model.bright_blue()
    );
    println!("{}", "Type your audit question. Ctrl+C to exit.".dimmed());

    let mut rl = DefaultEditor::new()?;
    let mut history: Vec<ChatMsg> = Vec::new();

    loop {
        let prompt = format!("{} ", ">".bright_green());
        let line = match rl.readline(&prompt) {
            Ok(l) => l,
            Err(_) => break,
        };
        let q = line.trim();
        if q.is_empty() {
            continue;
        }
        if q == "/quit" || q == "/exit" {
            break;
        }
        rl.add_history_entry(q).ok();
        history.push(ChatMsg { role: "user".into(), content: q.into() });
        let answer = stream_once(base, agent, model, &history).await?;
        history.push(ChatMsg { role: "assistant".into(), content: answer });
    }
    Ok(())
}

async fn one_shot(base: &str, agent: &str, model: &str, question: &str) -> Result<()> {
    let history = vec![ChatMsg { role: "user".into(), content: question.into() }];
    stream_once(base, agent, model, &history).await?;
    Ok(())
}

async fn stream_once(base: &str, _agent: &str, model: &str, history: &[ChatMsg]) -> Result<String> {
    let client = reqwest::Client::builder().build()?;
    let url = format!("{}/v1/chat/completions", base.trim_end_matches('/'));
    let req = ChatRequest { model: model.to_string(), messages: history.to_vec(), stream: true };

    let resp = client
        .post(&url)
        .json(&req)
        .send()
        .await
        .with_context(|| format!("POST {} failed", url))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow!("HTTP {}: {}", status, body));
    }

    let mut stream = resp.bytes_stream().eventsource();
    let mut answer = String::new();
    let mut stdout = std::io::stdout();

    while let Some(evt) = stream.next().await {
        let evt = evt?;
        if evt.data == "[DONE]" {
            break;
        }
        let chunk: Chunk = match serde_json::from_str(&evt.data) {
            Ok(c) => c,
            Err(_) => continue,
        };
        for ch in chunk.choices.unwrap_or_default() {
            let Some(delta) = ch.delta else { continue };
            if let Some(t) = delta.content {
                print!("{}", t);
                stdout.flush().ok();
                answer.push_str(&t);
            }
            if let Some(tcs) = delta.tool_calls {
                for tc in tcs {
                    if let Some(name) = tc.function.as_ref().and_then(|f| f.name.as_ref()) {
                        println!("\n{} {}", "[tool]".bright_yellow(), name.bright_white());
                    }
                    if let Some(args) = tc.function.as_ref().and_then(|f| f.arguments.as_ref()) {
                        print!("{}", args.dimmed());
                        stdout.flush().ok();
                    }
                }
            }
        }
    }
    println!();
    Ok(answer)
}

async fn skill_oneshot(entry: &str, tool: &str, input_json: &str) -> Result<()> {
    let parsed: serde_json::Value = serde_json::from_str(input_json)
        .with_context(|| format!("Bad --input JSON: {}", input_json))?;
    let payload = serde_json::json!({
        "tool": tool,
        "input": parsed,
        "agent_id": "cli",
        "agent_name": "ad-auditor"
    });
    let mut child = tokio::process::Command::new("node")
        .arg(entry)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        stdin.write_all(payload.to_string().as_bytes()).await?;
        stdin.shutdown().await?;
    }
    let output = child.wait_with_output().await?;
    if !output.status.success() {
        return Err(anyhow!("skill exited {}", output.status));
    }
    let out = String::from_utf8_lossy(&output.stdout);
    // Pretty-print JSON if possible
    match serde_json::from_str::<serde_json::Value>(out.trim()) {
        Ok(v) => println!("{}", serde_json::to_string_pretty(&v)?),
        Err(_) => println!("{}", out),
    }
    Ok(())
}
