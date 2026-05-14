# Architecture

```
                       +-------------------+
                       |   Web UI (Vite)   |
                       |  React + TanStack |
                       |   localhost:5173  |
                       +---------+---------+
                                 |
                                 |  POST /v1/chat/completions  (SSE)
                                 v
+-----------+        +-----------+-----------+
|  CLI Rust |  --->  |   OpenFang Agent OS   |  <--- `openfang chat ad-auditor`
| (one-shot,|        |   Rust binary, :50051 |
|  REPL,    |        |   16 sec. systems     |
|  skill)   |        |   - capability gates  |
+-----------+        |   - WASM dual meter   |
                     |   - Loop guard SHA256 |
                     |   - Merkle audit hash |
                     |   - Taint tracking    |
                     |   - Session repair    |
                     +-----+-----------+-----+
                           |           |
                           v           v
                  +--------+---+   +---+-------+
                  |  ad-auditor|   | report-   |
                  |  (Hand)    |   | writer    |
                  |            |   | (sub-Hand)|
                  +-----+------+   +-----------+
                        |
                        |  spawns subprocess per tool call (JSON over stdin/stdout)
                        v
              +---------+--------+
              |  Skill: migraven-ad     |  ~/.openfang/skills/migraven-ad
              |  Node 20 + TypeScript   |
              |  Zod schemas everywhere |
              +---------+---------------+
                        |
                        +-> Neo4j driver  --> bolt://localhost:7687 (shared with sibling project)
                        |
                        +-> Windows Credential Manager via PowerShell shim
                        |     migRaven.MAX-AI    (Azure Foundry key)
                        |     migRaven.MAX-Neo4j (bolt creds)
                        |
                        +-> Azure Foundry  --> OpenAI-compatible /v1/chat/completions
                                                 deployments: gpt-5.5, claude-opus-4-5
```

## Why this proves the framework approach

| Concern             | Boss monolith (~10k LOC)                                          | OpenFang MVP                            |
| ------------------- | ----------------------------------------------------------------- | --------------------------------------- |
| Tool dispatch       | giant `match tc.name.as_str()` in `ai_chat.rs:5731`               | declarative `[[tools.provided]]` block  |
| Loop guard          | not implemented; observed runaway retries in prod                 | OpenFang Loop Guard, SHA-256 tool args  |
| Body cap survival   | 7-tier ad-hoc compaction (`ai_chat.rs:7334-7920`)                 | OpenFang Session Repair (3-phase)       |
| Secret handling     | custom Rust `ldap/credentials.rs` reader                          | OpenFang `Zeroizing<String>` on every key |
| Sandboxing          | none                                                              | WASM fuel + epoch interrupt (skills)    |
| Audit log           | informal file logs                                                | Merkle hash chain, tamper-evident       |
| Schema validation   | none on tool I/O — many bugs from raw `serde_json::Value`         | Zod at every tool boundary              |
| Provider routing    | 200+ LOC of `is_responses_api_model`, `is_foundry_context`, etc.  | `provider="openai" + base_url=foundry`  |
| Sub-agents          | not implemented                                                   | `report-writer` Hand, mailbox via `agent_message` |

## Data flow for an audit prompt

1. User asks: "*Run a full AD security audit*".
2. Frontend → SSE POST `/v1/chat/completions`.
3. OpenFang `ad-auditor` Hand loads `SYSTEM_PROMPT.md`.
4. LLM (gpt-5.5 on Foundry) decides to call `update_todos` then `audit_security`.
5. OpenFang capability gate verifies `audit_security` is in the Hand's tool list.
6. OpenFang spawns the `migraven-ad` skill subprocess with `{tool: "audit_security", input: {include: ["all"]}}`.
7. Skill validates input via Zod, runs 6 canned cypher queries against Neo4j, validates output via Zod, returns JSON.
8. OpenFang's Merkle audit appends the (input_hash, output_hash, agent_id) record.
9. Loop Guard checks the call wasn't a duplicate (SHA-256 of `tool_name + args`).
10. LLM streams the final answer back to the frontend over SSE.
11. (Optional) `ad-auditor` may delegate report writing to `report-writer` sub-Hand via `agent_message`.

## Component versions (pinned at MVP)

- OpenFang: latest stable (`irm https://openfang.sh/install.ps1 | iex`)
- Node: 20.x
- TypeScript: 5.7
- React: 18.3
- TanStack Query: 5.62
- Rust: 1.75+
- Neo4j driver (JS): 5.27
- Zod: 3.23
