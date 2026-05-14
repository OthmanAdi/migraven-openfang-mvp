# migraven-openfang-mvp

> An [OpenFang](https://github.com/RightNow-AI/openfang)-style Active Directory + permission + security audit agent that reads from a **[Neo4j](https://neo4j.com)** knowledge graph and reasons with **Azure AI Foundry** (`gpt-5.5` and `claude-opus-4-5`). ReAct loop in Rust, tools in TypeScript, every input and output **Zod-validated**.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/runtime-Rust-orange.svg)](runtime/)
[![Node](https://img.shields.io/badge/skill-Node%2020%20%2B%20TypeScript-3c873a.svg)](skills/migraven-ad/)
[![React](https://img.shields.io/badge/UI-React%2018%20%2B%20Vite-61dafb.svg)](frontend/)
[![Neo4j](https://img.shields.io/badge/graph-Neo4j%205%2B-018bff.svg)](https://neo4j.com)
[![Azure AI Foundry](https://img.shields.io/badge/LLM-Azure%20AI%20Foundry-0078D4.svg)](https://learn.microsoft.com/azure/ai-studio/)
[![OpenFang](https://img.shields.io/badge/framework-OpenFang--compatible-purple.svg)](https://github.com/RightNow-AI/openfang)

This repo is a **framework-first replica** of a real-world ~24k LOC monolithic AD auditor agent. Same tool surface, same German `IT-Security-Consultant` persona, same Neo4j graph schema — collapsed into a small **declarative Hand** plus a Zod-validated **Skill**. Built to demonstrate that an agent OS plus 50 source files can replace several thousand lines of hand-rolled framework code.

---

## What it does

Asks an LLM running on Azure AI Foundry to investigate a Neo4j-backed Active Directory graph. The agent runs ReAct turns: it picks a tool, the runtime spawns the skill subprocess, the skill runs Cypher against Neo4j, validates the result with Zod, and feeds it back. When the model has enough evidence it writes an executive-grade German audit report with priority-ranked remediation and compliance references (BSI Grundschutz, ISO 27001, SOX 404).

Tools the agent can call (boss-prompt-portable naming):

| Tool                            | What it does                                                          |
| ------------------------------- | --------------------------------------------------------------------- |
| `execute_cypher`                | Read-only Cypher with EXPLAIN preflight, row/char/timeout caps        |
| `batch_queries`                 | Up to 5 read-only queries in parallel with shared timeout             |
| `search_fulltext`               | Fulltext index search over `group_search` / `user_search` / `computer_search` |
| `count_matching_objects`        | Pre-flight counter; mandatory before pulling rows of unknown size     |
| `enumerate_rule_matches`        | List objects matching an ownership rule (exact / OU / prefix / regex) |
| `get_ownership_coverage`        | Coverage breakdown for Group / User / Computer / Department           |
| `save_ownership_rule`           | Idempotent MERGE of a new ownership rule                              |
| `assign_owner_to_rule`          | Set owner SAMs on an existing rule                                    |
| `propose_ownership_clusters`    | Batch-create ownership rules from clustered candidates                |
| `audit_security`                | Canonical security bundle (6 canned Cypher checks)                    |
| `update_todos`                  | Visible working-memory mission list                                   |

See [`docs/TOOL_CATALOG.md`](docs/TOOL_CATALOG.md) for full Zod input/output schemas.

---

## Architecture

```
       Web UI (Vite + React 18 + TS + TanStack)
                       │
                       │  POST /v1/chat/completions  (SSE)
                       ▼
              ┌──────────────────────┐
              │  Rust runtime :50051 │  ◀── OpenAI-compatible wire (= OpenFang surface)
              │  - ReAct loop        │
              │  - Loop guard SHA-256│
              │  - Win32 cred reader │
              └──────────────────────┘
                       │
       ┌───────────────┼───────────────────────────┐
       │               │                           │
       ▼               ▼                           ▼
  Azure AI       Node skill subprocess        agent.toml + SYSTEM_PROMPT.md
  Foundry          (per tool call)            (declarative Hand definition)
       │               │
       │               │  JSON stdin/stdout (OpenFang skill protocol)
       │               ▼
       │      Zod-validated TS tool
       │               │
       │               ▼
       │      Neo4j bolt://localhost:7687
       │      (Active Directory knowledge graph)
       │
       ├── gpt-5.5            → /openai/deployments/{name}/chat/completions
       └── claude-opus-4-5    → /anthropic/v1/messages
```

The runtime is **drop-in replaceable** with [OpenFang](https://github.com/RightNow-AI/openfang). Same wire format (`/v1/chat/completions`), same skill protocol (subprocess JSON stdin/stdout), same Hand definition format (`agent.toml`). The day you install OpenFang, swap binaries and zero frontend or skill changes are required.

---

## Stack

| Layer            | Tech                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| Runtime          | Native Rust (`runtime/`), Axum + Tokio, port `127.0.0.1:50051`             |
|                  | Or [OpenFang](https://github.com/RightNow-AI/openfang) once installed      |
| AD tools         | Node 20 skill (`skills/migraven-ad/`), TypeScript strict, Zod schemas      |
| Graph DB         | Neo4j 5+ (`bolt://localhost:7687`)                                         |
| LLM              | Azure AI Foundry — `gpt-5.5` (primary) and `claude-opus-4-5` (fallback)    |
| Token budget     | `gpt-tokenizer`                                                            |
| Web UI           | Vite + React 18 + TypeScript + TanStack Query + SSE streaming              |
| CLI              | Rust binary (`cli/`), `chat`, `ask`, `skill` subcommands                   |
| Secrets          | Windows Credential Manager (configurable prefix, default `migRaven.MAX`)   |

---

## Why Neo4j

The AD graph isn't just a list of users and groups; it's a deeply nested set of relationships (`MEMBER_OF`, `OWNS`, `DELEGATES_TO`, `RESIDES_IN_OU`, `ACL_ON`, ...). Cypher lets the agent ask:

> *"For every privileged group, show me the union of all transitive members, their last logon, and whether any have unconstrained delegation enabled."*

In one round trip. The same question over a relational schema is a 7-way join you'd rather not write. The skill exposes Cypher as a first-class tool — with read-only enforcement, EXPLAIN preflight, and row/char/timeout caps — so the model can think in graph terms and the runtime keeps it safe.

---

## Why OpenFang as the framework target

OpenFang ships **16 mandatory security systems** you can't accidentally turn off: capability gates, WASM dual fuel/epoch metering, Merkle hash-chain audit, information-flow taint tracking, loop guard, session repair, secret zeroization. A monolithic agent has to reinvent each one (badly, usually). Modelling the agent as a *Hand* (persona + capability grants in TOML) plus a *Skill* (tools, with their own manifest and sandboxed runtime) means most of those concerns become **somebody else's problem**.

This MVP runs **today** without OpenFang installed, because the native Rust runtime mirrors the same wire and skill protocol. When you do install OpenFang, the skill and Hand are already in the right shape.

---

## Quick start

```powershell
# 1. Populate .env (copy .env.example and set AZURE_FOUNDRY_ENDPOINT + Neo4j cred name)
copy .env.example .env

# 2. Store secrets in Windows Credential Manager
cmdkey /add:migRaven.MAX-AI    /user:foundry /pass:<your-foundry-key>
cmdkey /add:migRaven.MAX-Neo4j /user:neo4j   /pass:<your-neo4j-password>

# 3. Launch runtime — auto-pulls Foundry key from CredMan, builds release binary if needed
./scripts/start-runtime.ps1

# 4. Web UI (separate terminal)
npm install --prefix frontend
npm run dev --prefix frontend
# → http://localhost:5173

# 5. CLI smoke (optional)
cargo run --release --manifest-path cli/Cargo.toml -- ask "How many Group nodes exist?"
```

Open `http://localhost:5173`. Top-right dropdown switches between `gpt-5.5` and `claude-opus-4-5`.

When you're ready to swap in the real OpenFang binary:

```powershell
irm https://openfang.sh/install.ps1 | iex
./scripts/install.ps1
./scripts/start-openfang.ps1
openfang chat ad-auditor
```

Same skill, same Hand, same Foundry deployments.

---

## Layout

```
runtime/                                   Native Rust orchestrator (OpenFang-compatible)
  src/main.rs                              axum bind 127.0.0.1:50051
  src/server.rs                            /api/health, /api/agent, /v1/chat/completions (SSE)
  src/loop_runner.rs                       ReAct loop with SHA-256 args dedup loop guard
  src/foundry.rs                           AOAI /openai/deployments/{name}/chat/completions
  src/anthropic.rs                         /anthropic/v1/messages adapter for Claude on Foundry
  src/skill.rs                             Node subprocess invoker (OpenFang skill protocol)
  src/agent.rs                             agent.toml + skill.toml loader → OpenAI tool defs
  src/credentials.rs                       Win32 native CredReadW reader
  src/types.rs                             ChatMessage / ToolCall / ToolDef shared shape

skills/migraven-ad/                        Node 20 + TypeScript skill
  skill.toml                               11 tools declared
  src/index.ts                             JSON stdin/stdout dispatcher
  src/schema.ts                            Zod schemas + read-only Cypher checker
  src/credentials.ts                       PowerShell-shim CredMan reader (standalone-mode)
  src/neo4j-client.ts                      pooled bolt driver, EXPLAIN + caps
  src/security-queries.ts                  6 canned audit Cypher queries
  src/models.ts                            Foundry deployment registry
  src/token-budget.ts                      gpt-tokenizer pre-flight
  src/tools/                               11 tool implementations

openfang/                                  Drop-in once you install OpenFang
  config.toml                              default_model + providers + sandbox limits
  agents/ad-auditor/                       Main Hand
    agent.toml                             model, capabilities, tools allowlist, fallback
    SYSTEM_PROMPT.md                       German IT-Security-Consultant persona
  agents/report-writer/                    Sub-Hand for executive reports
    agent.toml
    SYSTEM_PROMPT.md

frontend/                                  Vite + React 18 + TS + TanStack
  src/lib/openfang-api.ts                  SSE OpenAI-compat streaming
  src/components/ChatMessageView.tsx
  src/components/ToolStep.tsx              severity-coloured findings panel
  src/pages/ChatPage.tsx                   model picker, REPL, abort

cli/                                       Rust CLI shim (chat / ask / skill)
scripts/                                   PowerShell install + start + smoke helpers
docs/                                      Architecture, Guardrails, Tool catalog, Setup
```

---

## Guardrails

Eleven layers of defence, see [`docs/GUARDRAILS.md`](docs/GUARDRAILS.md) for the full list. Highlights:

1. **Zod validation** at every tool input and output boundary.
2. **Read-only Cypher checker** that strips strings and comments before keyword matching so `MATCH (n) WHERE n.note = "CREATE me"` is not mistaken for a write query.
3. **EXPLAIN preflight** with 15 s timeout — every Cypher is parsed and planned before it touches data.
4. **Row / char / timeout caps** (`MAX_ROWS=500`, `MAX_CHARS=120000`, `CYPHER_TIMEOUT_MS=15000`).
5. **Loop guard**: SHA-256 of `(tool_name, arguments)` is tracked. 3 identical calls warn, 5 block, 30 total circuit-break, 16 total turns ceiling.
6. **Capability gates** in `agent.toml` — tools not in the Hand's allowlist cannot run, ever.
7. **Network allowlist** in `agent.toml` — runtime refuses to call any endpoint not in `[capabilities].network`.
8. **Secret zeroization** — Foundry API key lives only in memory and `Zeroizing<String>` once we port to OpenFang's native types.
9. **Token budget** pre-flight (`token-budget.ts`, ready to be wired into `loop_runner` for v0.2).
10. **Sub-Hand isolation** — `report-writer` has `tools = []` and cannot touch Neo4j; only sees JSON findings the main agent forwards.
11. **`migRaven.MAX-*` prefix override** — the operator picks the Credential Manager prefix; no hard-coded secrets, ever.

---

## Models

Both Azure Foundry deployments work. Pick from the frontend dropdown or the CLI `--model` flag.

- **gpt-5.5** uses Foundry's Azure OpenAI (AOAI) surface: `POST {endpoint}/openai/deployments/{name}/chat/completions?api-version=2024-12-01-preview`. Reasoning model — no `temperature`, `max_completion_tokens` instead of `max_tokens`.
- **claude-opus-4-5** uses Foundry's Anthropic surface: `POST {endpoint}/anthropic/v1/messages` with the standard Anthropic body shape (`system` top-level, `tool_use` and `tool_result` content blocks, `max_tokens` required). The runtime translates from internal OpenAI-shaped messages to Anthropic and back so the ReAct loop stays format-agnostic.

Both surfaces share one API key — the runtime reads it once from Windows Credential Manager (`migRaven.MAX-AI` by default).

---

## What's not in this MVP

Deliberately out of scope; trivial to add later:

- AD write tools (`disable_user`, `reset_user_password`, `add_user_to_group`, …). These need an action queue — about 80 LOC.
- Artifact generation (HTML / CSV / PDF reports).
- Frontend `<ChatLink>` entity-anchor protocol.
- Streaming token-by-token output (Foundry call is non-streamed at runtime today; the full assistant text comes out as one SSE chunk).
- WASM port of the skill (would drop subprocess cold start from ~150 ms to <10 ms).
- Integration test suite (only protocol-level smoke is present).

See [`CHANGELOG.md`](CHANGELOG.md) for the full release-notes view.

---

## Acknowledgements

- [OpenFang](https://github.com/RightNow-AI/openfang) — agent OS whose Hand + Skill + capability-gate model this MVP follows.
- [Neo4j](https://neo4j.com) — the graph DB that makes the AD audit tractable.
- [Azure AI Foundry](https://learn.microsoft.com/azure/ai-studio/) — host for both `gpt-5.5` and `claude-opus-4-5`.

---

## License

MIT. See [`LICENSE`](LICENSE).
