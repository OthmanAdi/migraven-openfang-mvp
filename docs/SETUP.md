# Setup & Verification

## Already verified (this session)

- [x] `npm install` for skill (20 deps).
- [x] `npm run build` for skill — TypeScript strict, no errors.
- [x] `npm install` for frontend (74 deps).
- [x] `tsc -p frontend/tsconfig.json` — clean.
- [x] `cargo check` for CLI — clean (1 dead-code warning, harmless).
- [x] Skill protocol smoke: unknown tool → `{ error }` with available list (exit 1).
- [x] Skill protocol smoke: write Cypher → Zod rejects (exit 1).
- [x] Skill protocol smoke: pure-schema tool `update_todos` → roundtrip OK (exit 0).

## Needs your hands (live)

### 1. Install OpenFang on Windows

```powershell
irm https://openfang.sh/install.ps1 | iex
openfang --version
```

### 2. Configure .env

```powershell
cd <path-to-this-repo>
copy .env.example .env
```

Edit `.env` and set:

```
AZURE_FOUNDRY_ENDPOINT=https://YOUR-ACTUAL-FOUNDRY.cognitiveservices.azure.com
AZURE_FOUNDRY_GPT55_DEPLOYMENT=gpt-5.5
AZURE_FOUNDRY_OPUS_DEPLOYMENT=claude-opus-4-5
NEO4J_URI=bolt://localhost:7687
```

Credentials come from Windows Credential Manager, not `.env`. The sibling project already populates these:

| Target                  | Used for                                  |
| ----------------------- | ----------------------------------------- |
| `migRaven.MAX-AI`       | Azure Foundry API key (gpt-5.5 + opus)    |
| `migRaven.MAX-Neo4j`    | Neo4j bolt username + password            |

### 3. Bootstrap

```powershell
./scripts/install.ps1
```

This script:
- Reads `.env` and verifies the two required credential targets exist.
- Renders `~/.openfang/config.toml` with your Foundry endpoint.
- Copies the AD-Auditor + Report-Writer Hands into `~/.openfang/agents/`.
- Builds the skill (`npm install && npm run build`).
- Symlinks the skill into `~/.openfang/skills/migraven-ad` (needs Windows Developer Mode for symlinks).

### 4. Launch

```powershell
# Terminal 1 — OpenFang server with Foundry key injected from CredMan
./scripts/start-openfang.ps1

# Terminal 2 — Web UI
npm install --prefix frontend
npm run dev --prefix frontend
# Open http://localhost:5173
```

### 5. CLI smoke (optional)

```powershell
# Build the Rust CLI
cargo build --manifest-path cli/Cargo.toml --release

# Interactive REPL
./cli/target/release/migraven-ad-cli.exe chat

# Single skill call (no OpenFang needed)
./cli/target/release/migraven-ad-cli.exe skill get_ownership_coverage --input "{}"

# Or via PowerShell helper:
./scripts/test-skill.ps1 -Tool get_ownership_coverage
```

### 6. Verify each tool live

Run the boss's killer prompts to prove tool parity. Each should result in a non-empty audit report:

```
"Was sind die kritischsten Sicherheitslücken in unserem AD?"
"Welche Gruppen haben keinen Owner?"
"Berechne die Ownership Coverage und schlage Cluster vor"
"Wer hat unconstrained delegation?"
"Liste alle kerberoastable Accounts"
```

Expected:
- `audit_security` runs → 6 canned cypher queries → JSON findings → frontend renders coloured cards.
- `get_ownership_coverage` returns 4 buckets → `propose_ownership_clusters` writes batch rules.

### 7. Monitor

OpenFang ships health + audit endpoints:

```powershell
# Public (minimal)
curl http://127.0.0.1:50051/api/health

# Authenticated (full) — set api_key in config.toml first
curl -H "Authorization: Bearer <api_key>" http://127.0.0.1:50051/api/health/detail

# Merkle audit trail (cryptographically linked)
curl -H "Authorization: Bearer <api_key>" http://127.0.0.1:50051/api/audit/recent
```

## Troubleshooting

| Symptom                                          | Cause / Fix                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| Skill exits with "Credential 'migRaven.MAX-Neo4j' not found" | Add with `cmdkey /add:migRaven.MAX-Neo4j /user:neo4j /pass:<password>`     |
| OpenFang refuses gpt-5.5 (`model may not exist`) | Confirm Foundry deployment name in `.env` matches portal. Use ARM REST API to list. |
| 400 from Foundry with "Unterminated string"      | Body cap — frontend or CLI sent oversized history. OpenFang Session Repair should handle it; if not, drop oldest turns. |
| `MERGE/DELETE` rejected even though you wrote `MATCH ... RETURN` | The Cypher contains those keywords inside a string. The skill strips strings before checking, so check your actual query is read-only. |
| Skill subprocess hangs                           | Node 20+ required. Check `node --version`. Also: Neo4j must be reachable on `NEO4J_URI`. |
