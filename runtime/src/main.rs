mod agent;
mod anthropic;
mod credentials;
mod foundry;
mod loop_runner;
mod server;
mod skill;
mod types;

use anyhow::Result;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,migraven_runtime=debug")))
        .with_target(false)
        .compact()
        .init();

    let state = server::AppState::load().await?;
    let listen: SocketAddr = std::env::var("RUNTIME_LISTEN")
        .unwrap_or_else(|_| "127.0.0.1:50051".to_string())
        .parse()?;

    tracing::info!(target: "runtime", "agent={} model={} skill_entry={}", state.agent.name, state.agent.model, state.skill_entry.display());
    tracing::info!(target: "runtime", "tools loaded: {}", state.tools.len());
    tracing::info!(target: "runtime", "listening on http://{}", listen);

    let app = server::router(state)
        .layer(CorsLayer::very_permissive())
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(listen).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
