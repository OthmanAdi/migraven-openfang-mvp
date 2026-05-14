# Tool Catalog

All tools are defined in `skills/migraven-ad/skill.toml`. Schemas in `src/schema.ts`. Implementations in `src/tools/*.ts`. Every input + output passes Zod parsing — bad shape = thrown error returned as JSON.

## execute_cypher

Read-only Cypher with EXPLAIN pre-flight, row cap, char cap, timeout. Boss monolith equivalent: `ai_chat.rs:10847`.

**Input**

```json
{
  "cypher": "MATCH (g:Group) WHERE g.name STARTS WITH 'admin_' RETURN g.name, g.distinguishedName LIMIT 50",
  "row_cap": 200,
  "timeout_secs": 30,
  "params": {}
}
```

**Output**

```json
{ "rows": [...], "truncated": false, "elapsedMs": 412, "explainOk": true }
```

## batch_queries

1-5 parallel read-only queries with shared timeout budget.

**Input**

```json
{
  "queries": [
    { "name": "groupCount",   "cypher": "MATCH (g:Group) RETURN count(g) AS n" },
    { "name": "userCount",    "cypher": "MATCH (u:User)  RETURN count(u) AS n" },
    { "name": "computerCount","cypher": "MATCH (c:Computer) RETURN count(c) AS n" }
  ]
}
```

**Output**

```json
{
  "results": [
    { "name": "groupCount",   "ok": true, "rows": [...], "elapsedMs": 80 },
    { "name": "userCount",    "ok": true, "rows": [...], "elapsedMs": 92 },
    { "name": "computerCount","ok": false, "error": "...", "elapsedMs": 0 }
  ],
  "totalElapsedMs": 220
}
```

## search_fulltext

Neo4j fulltext index search.

**Input**

```json
{ "index": "group_search", "query": "domain admins", "limit": 25 }
```

**Output**

```json
{
  "hits": [
    { "guid": "...", "sam": "Domain Admins", "name": "Domain Admins", "description": "...", "score": 12.4 }
  ],
  "total": 1
}
```

## count_matching_objects

Pre-flight counter. Validates the query has a `count(...)` aggregator.

**Input**

```json
{ "cypher": "MATCH (u:User) WHERE u.servicePrincipalName IS NOT NULL RETURN count(u) AS n" }
```

**Output**

```json
{ "count": 47, "elapsedMs": 12 }
```

## enumerate_rule_matches

Lists objects matching an ownership rule pattern. Maps `rule_type` → Neo4j label, `match_type` → Cypher predicate.

**Input**

```json
{ "rule_type": "group", "match_type": "prefix", "match_pattern": "rg_", "limit": 100 }
```

**Output**

```json
{
  "matches": [
    { "sam": "rg_finance", "guid": "...", "name": "rg_finance", "dn": "CN=rg_finance,OU=..." }
  ],
  "total": 1
}
```

## get_ownership_coverage

Returns coverage breakdown for all four object kinds. Pflicht-Erstaufruf in ownership missions.

**Input**

```json
{}
```

**Output**

```json
{
  "group":      { "total": 1521, "typed": 412, "pct": 27.1 },
  "user":       { "total": 12044, "typed": 9876, "pct": 82.0 },
  "computer":   { "total": 2102, "typed": 1850, "pct": 88.0 },
  "department": { "total": 41, "typed": 41, "pct": 100.0 }
}
```

## save_ownership_rule

Creates a new `_GroupOwnershipRule` (or User/Computer/Department variant). MERGE by `(match_type, match_pattern)` so calling twice with the same pattern is idempotent.

**Input**

```json
{
  "rule_type": "group",
  "match_type": "prefix",
  "name": "RG-Finance",
  "match_pattern": "rg_finance_",
  "description": "Finance role-based groups",
  "sample_sams": ["rg_finance_apreports", "rg_finance_payroll"]
}
```

**Output**

```json
{ "ok": true, "rule_id": 412, "rule_type": "group", "match_type": "prefix", "match_pattern": "rg_finance_" }
```

## assign_owner_to_rule

Sets `owner_sams[]` on an existing rule.

**Input**

```json
{ "rule_id": 412, "owner_sams": ["t.mueller", "a.schmidt"] }
```

**Output**

```json
{ "ok": true, "rule_id": 412, "owner_sams": ["t.mueller", "a.schmidt"] }
```

## propose_ownership_clusters

Batch-creates up to 20 ownership rules in one call. Optionally assigns owners. Used in the ownership-assistant mission.

**Input**

```json
{
  "proposals": [
    { "rule_type": "group", "name": "RG-Finance", "match_type": "prefix", "match_pattern": "rg_finance_", "suggested_owner_sams": ["t.mueller"] },
    { "rule_type": "group", "name": "RG-HR",      "match_type": "prefix", "match_pattern": "rg_hr_" }
  ]
}
```

**Output**

```json
{
  "created": [
    { "rule_id": 412, "rule_type": "group", "name": "RG-Finance", "match_pattern": "rg_finance_", "ok": true },
    { "rule_id": 413, "rule_type": "group", "name": "RG-HR",      "match_pattern": "rg_hr_",      "ok": true }
  ]
}
```

## audit_security

Canonical security bundle. Runs canned Cypher queries (see `src/security-queries.ts`) for:

- `admin_sprawl` — too many direct members in privileged groups
- `unconstrained_delegation` — accounts with TRUSTED_FOR_DELEGATION flag
- `weak_password_policy` — passwordNeverExpires / passwordNotRequired
- `orphan_sids` — group memberships with unresolvable SIDs
- `stale_accounts` — enabled accounts with no logon in 180 days
- `kerberoastable` — enabled service accounts (User + SPN)

**Input**

```json
{ "include": ["all"] }
```

**Output**

```json
{
  "findings": [
    {
      "id": "unconstrained_delegation",
      "check": "unconstrained_delegation",
      "severity": "critical",
      "title": "Accounts with unconstrained delegation",
      "detail": "3 betroffene Eintraege gefunden.",
      "affected": [{ "kind": ["User"], "account": "svc_legacy_app", "dn": "CN=svc_legacy_app,..." }],
      "remediation": "Convert to constrained delegation or remove..."
    }
  ],
  "severitySummary": { "critical": 1, "high": 2, "medium": 1, "low": 0, "info": 0 },
  "elapsedMs": 980
}
```

## update_todos

Working-memory mission list. Frontend renders this as a progress panel.

**Input**

```json
{
  "todos": [
    { "content": "Coverage feststellen",     "status": "in_progress" },
    { "content": "Cluster vorschlagen",      "status": "pending"     },
    { "content": "Owner-Vorschlaege rendern","status": "pending"     }
  ]
}
```

**Output**

```json
{ "ok": true, "todos": [...] }
```
