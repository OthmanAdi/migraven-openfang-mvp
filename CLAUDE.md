# migRaven AD Auditor — OpenFang MVP

## Stack

- **Agent runtime:** OpenFang (Rust). Local API at `http://127.0.0.1:50051` (OpenAI-compatible) when `openfang start` runs.
- **Custom skill:** `skills/migraven-ad/` Node 20 + TypeScript. JSON stdin/stdout protocol. Zod schemas for every tool boundary.
- **Hand:** `openfang/agents/ad-auditor/agent.toml` declares the AD-Auditor persona, model, and capability grants.
- **Frontend:** `frontend/` Vite + React 18 + TS + TanStack Query, SSE streaming.
- **DB:** Neo4j at `bolt://localhost:7687` (shared with any existing migRaven workspace).
- **LLM:** Azure AI Foundry — both models required, never silently fail to one.
- **Secrets:** Windows Credential Store under prefix `migRaven.MAX-`:
  - `migRaven.MAX-AI` → Foundry API key
  - `migRaven.MAX-Neo4j` → Neo4j username/password
  - `migRaven.MAX-Azure-ARM` → ARM client secret (for deployment listing)

## Critical Rules (NEVER VIOLATE)

1. Zod-validate every tool input AND output. No raw `JSON.parse(...)` reaches the LLM.
2. Cypher tools enforce: row cap (`MAX_ROWS=500`), char cap (`MAX_CHARS=120000`), wall clock (`CYPHER_TIMEOUT_MS=15000`).
3. **No hardcoded secrets.** All keys come from Windows Credential Manager via `credentials.ts`.
4. System prompt is German. Match boss monolith's tone, headings, ChatLink anchor protocol.
5. Token budget pre-check: every LLM call MUST go through `token-budget.ts` first.
6. Only two Foundry deployments matter: `gpt-5.5` and `claude-opus-4-5`. Both must work, no silent fallback.

## Layout

```
openfang/config.toml                       # default_model + providers
openfang/agents/ad-auditor/agent.toml      # Hand manifest
openfang/agents/ad-auditor/SYSTEM_PROMPT.md
skills/migraven-ad/skill.toml              # Skill manifest
skills/migraven-ad/src/index.ts            # protocol entry
skills/migraven-ad/src/tools/*.ts          # one file per tool
skills/migraven-ad/src/neo4j-client.ts
skills/migraven-ad/src/credentials.ts
skills/migraven-ad/src/schema.ts
skills/migraven-ad/src/token-budget.ts
skills/migraven-ad/src/models.ts
frontend/src/main.tsx + App.tsx + pages/
cli/src/main.rs
scripts/install.ps1
```

## Build / Run

```powershell
# OpenFang (one-time install)
irm https://openfang.sh/install.ps1 | iex

# Bootstrap (creates ~/.openfang/config.toml, installs skill, registers hand)
./scripts/install.ps1

# Skill
cd skills/migraven-ad; npm install; npm run build

# Frontend
cd ../../frontend; npm install; npm run dev

# Runtime
openfang start              # API + dashboard
openfang chat ad-auditor    # CLI session
```

## Tools (mapped from boss monolith)

| Boss tool                       | Our tool                  | Output schema                     |
| ------------------------------- | ------------------------- | --------------------------------- |
| `run_cypher`                    | `run_cypher`              | `{rows, summary, elapsed_ms}`     |
| `search_fulltext`               | `search_fulltext`         | `{hits[], total}`                 |
| `count_matching_objects`        | `count_matching_objects`  | `{count, kind}`                   |
| `enumerate_rule_matches`        | `enumerate_rule_matches`  | `{ruleId, matches[]}`             |
| `get_ownership_coverage`        | `get_ownership_coverage`  | `{covered, missing, totals}`      |
| `assign_owner_to_rule`          | `assign_owner_to_rule`    | `{ok, ruleId, ownerCn}`           |
| `propose_ownership_clusters`    | `propose_ownership_clusters` | `{clusters[]}`                 |
| `batch_queries`                 | `batch_queries`           | `{results[]}` (parallel + cap)    |
| `audit_security_findings`      | `audit_security`          | `{findings[], severity_summary}`  |

All schemas live in `src/schema.ts`. All tools must declare `inputSchema` + `outputSchema`.

## Code Style

- **TypeScript:** strict mode, `import type` for types, no `any`.
- **Naming:** camelCase TS, snake_case tool names (matches boss monolith for prompt portability).
- **Commits:** `type(scope): subject`. No Co-Authored-By.
- **No comments unless WHY is non-obvious.** Code self-documents.

## Environment

- Windows 11 Pro, PowerShell.
- Neo4j at `bolt://localhost:7687`.
- OpenFang at `http://127.0.0.1:50051` after `openfang start`.
- Frontend dev at `http://localhost:5173`.
