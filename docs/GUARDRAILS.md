# Guardrails (what saves us when the LLM goes wild)

## Layer 1 — Schema validation (Zod)

Every tool input and output passes through Zod parsers in `src/schema.ts`. Bad input → exception → returned as `{ error }` to OpenFang → LLM gets the error and self-corrects.

```ts
const input = ExecuteCypherIn.parse(rawInput); // throws on bad shape
```

Output equally strict:

```ts
return ExecuteCypherOut.parse({ rows, truncated, elapsedMs, explainOk: true });
```

## Layer 2 — Read-only cypher check (custom)

`isReadOnlyCypher()` in `src/schema.ts` strips strings + comments BEFORE keyword matching (boss monolith approach, ported verbatim). Blocks: `CREATE`, `MERGE`, `DELETE`, `DETACH`, `REMOVE`, `DROP`, `SET`, `FOREACH`, `LOAD CSV`. Strings and comments are stripped first to avoid bypass via `WHERE n.description = "CREATE me"`.

## Layer 3 — EXPLAIN pre-flight (Neo4j)

Every `execute_cypher` and `batch_queries` runs `EXPLAIN <query>` first with a 15-second timeout. Catches syntax errors and bad cardinality plans before touching real data.

## Layer 4 — Row + char + timeout caps

`neo4j-client.ts` enforces three caps:

| Env var             | Default  | What it bounds                                  |
| ------------------- | -------- | ----------------------------------------------- |
| `MAX_ROWS`          | 500      | Hard row cap per query                          |
| `MAX_CHARS`         | 120 000  | JSON-serialised result size cap                 |
| `CYPHER_TIMEOUT_MS` | 15 000   | Wall clock for a single query                   |

Soft-truncates with `truncated: true` flag so the LLM knows it didn't see everything.

## Layer 5 — OpenFang Capability Gates

`openfang/agents/ad-auditor/agent.toml` lists every allowed tool, every allowed network destination, every memory namespace. **Tools NOT in the list cannot be invoked**, even if the LLM tries.

```toml
[capabilities]
tools = ["execute_cypher", "audit_security", ...]
network = ["127.0.0.1:7687", "*.cognitiveservices.azure.com:443"]
shell = []   # explicitly empty — no shell exec
```

## Layer 6 — OpenFang Loop Guard

SHA-256 hash of `tool_name + JSON.stringify(args)` is tracked. 3 identical calls → warning. 5 → block. 30 total → circuit break (kill the agent loop). Boss monolith has observed runaway retries that this prevents.

## Layer 7 — OpenFang WASM Fuel Metering

When we migrate the skill to WASM (post-MVP), fuel + epoch interrupt kill runaway loops at the binary level. Node subprocess phase already has a 60-second `timeout_secs` config gate.

## Layer 8 — OpenFang Taint Tracking

Neo4j responses are labeled `ExternalNetwork`. If the LLM ever tries to pipe a Cypher result into `shell_exec` (which we don't grant anyway), the taint sink rejects.

## Layer 9 — Secret Zeroization

Foundry API key is read from Windows Credential Manager into a `Zeroizing<String>` via OpenFang's provider config. Memory is overwritten on drop.

## Layer 10 — Token Budget (pre-flight)

`src/token-budget.ts` measures prompt tokens via `gpt-tokenizer` against the per-deployment context window:

```ts
const check = preflightBudget("gpt-5.5", prompt);
if (!check.ok) throw new Error(check.recommendation);
```

Used to abort early before Foundry returns a 400 for an oversize body (the boss monolith's empirical 82 KB Foundry cap is just one symptom of this category of bug).

## Layer 11 — Sub-Agent Isolation

The `report-writer` Hand has `tools = []` and `network = ["*.cognitiveservices.azure.com:443"]`. It cannot touch Neo4j directly. It only sees the JSON findings the main agent forwards through `agent_message`.

## What's NOT a guardrail

- Temperature: 0.3 is a vibe knob, not a safety measure.
- "Please don't write to Neo4j": this is a prompt suggestion. The actual block is Layer 2.
- Token caps in the agent.toml `[resources]` block: rate-limit, not safety.

The point of using OpenFang is that **Layers 5, 6, 7, 8, 9 are mandatory and free** — boss monolith re-implements ~1.5 of them, badly.
