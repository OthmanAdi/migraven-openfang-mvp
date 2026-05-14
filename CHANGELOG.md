# Changelog

## v0.1.0 — 2026-05-14

Initial public release. End-to-end verified live against a real Active Directory graph in Neo4j with both Azure Foundry deployments (`gpt-5.5` and `claude-opus-4-5`).

### Highlights

- Native Rust runtime (`runtime/`) speaks the OpenAI-compatible `/v1/chat/completions` wire, swappable 1:1 with OpenFang.
- 11 tools for AD, Berechtigung (permission) and security audit, every one Zod-validated on input and output.
- ReAct loop with a SHA-256 args dedup loop guard (3 warn, 5 block, 30 circuit break, 16 turn ceiling).
- Anthropic Messages API adapter so Claude on Azure Foundry works via `/anthropic/v1/messages`.
- Azure Foundry routing via the legacy AOAI surface (`/openai/deployments/{name}/chat/completions`).
- Cypher read-only checker that strips strings and comments before keyword matching, plus EXPLAIN preflight.
- 6 canned security audit Cypher queries: admin sprawl, unconstrained delegation, weak password policy, orphan SIDs, stale accounts, kerberoastable accounts.
- Vite + React 18 + TypeScript + TanStack Query web UI with SSE streaming, model picker, severity-coloured findings panel.
- Rust CLI shim with `chat`, `ask`, and `skill` subcommands.
- Sub-agent (`report-writer`) Hand for executive Markdown reports.
- Windows Credential Manager native reader: pulls Foundry key from `migRaven.MAX-AI` (or whatever prefix the operator picks).

### Boss-vs-MVP collapse

| Concern              | Original monolith                            | This MVP                                         |
| -------------------- | -------------------------------------------- | ------------------------------------------------ |
| Tool dispatch        | ~700 LOC of `match` arms                     | `HashMap<String, ToolFn>` (~30 LOC)              |
| Loop guard           | None                                         | SHA-256 args dedup, 4-stage thresholds           |
| Body cap survival    | 7-tier ad-hoc compaction (~600 LOC)          | Declarative max-turns + fallback model           |
| Schema validation    | None                                         | Zod at every tool boundary                       |
| Provider routing     | 200+ LOC of detection helpers                | `is_anthropic_model()` (5 LOC)                   |
| Persona / prompts    | ~700 LOC across multiple files               | One `SYSTEM_PROMPT.md`                           |

### Known limitations

- Node skill subprocess per tool call (~150 ms cold start). WASM port deferred to v0.2.
- Foundry call itself is not streamed yet; runtime emits the assistant text as one chunk after Foundry replies.
- No integration test suite — only protocol-level smoke (`scripts/test-skill.ps1`).
- AD write tools (`disable_user`, `reset_user_password`, etc.) deliberately out of scope for MVP.
- No artifact generation (HTML/CSV/PDF).
