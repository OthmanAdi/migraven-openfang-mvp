import { z } from "zod";

export const ToolPayload = z.object({
  tool: z.string(),
  input: z.record(z.unknown()).default({}),
  agent_id: z.string().optional(),
  agent_name: z.string().optional(),
});
export type ToolPayload = z.infer<typeof ToolPayload>;

const writeKeywords = /\b(CREATE|MERGE|DELETE|DETACH|REMOVE|DROP|SET|FOREACH|LOAD\s+CSV|CALL\s+apoc\.refactor)\b/i;
const explainProfile = /^\s*(EXPLAIN|PROFILE)\b/i;

export function isReadOnlyCypher(cypher: string): boolean {
  const stripped = stripStringsAndComments(cypher);
  return !writeKeywords.test(stripped) && !explainProfile.test(cypher);
}

export function stripStringsAndComments(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    const n = input[i + 1];
    if (c === "/" && n === "/") {
      while (i < input.length && input[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) {
        out += input[i] === "\n" ? "\n" : " ";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      out += " ";
      i++;
      while (i < input.length) {
        if (input[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (input[i] === quote) {
          out += " ";
          i++;
          break;
        }
        out += input[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    out += c ?? "";
    i++;
  }
  return out;
}

const CypherText = z
  .string()
  .min(1)
  .max(32_000)
  .refine(isReadOnlyCypher, {
    message: "Cypher muss read-only sein. CREATE/MERGE/DELETE/SET/REMOVE/DETACH/DROP/FOREACH/LOAD CSV sind gesperrt.",
  });

export const ExecuteCypherIn = z.object({
  cypher: CypherText,
  row_cap: z.number().int().min(1).max(5000).optional(),
  timeout_secs: z.number().int().min(1).max(120).optional(),
  params: z.record(z.unknown()).optional(),
});
export const ExecuteCypherOut = z.object({
  rows: z.array(z.record(z.unknown())),
  truncated: z.boolean(),
  elapsedMs: z.number(),
  explainOk: z.boolean(),
});

export const BatchQueriesIn = z.object({
  queries: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        cypher: CypherText,
        row_cap: z.number().int().min(1).max(5000).optional(),
        params: z.record(z.unknown()).optional(),
      })
    )
    .min(1)
    .max(5),
});
export const BatchQueriesOut = z.object({
  results: z.array(
    z.object({
      name: z.string(),
      ok: z.boolean(),
      rows: z.array(z.record(z.unknown())).optional(),
      truncated: z.boolean().optional(),
      error: z.string().optional(),
      elapsedMs: z.number(),
    })
  ),
  totalElapsedMs: z.number(),
});

export const SearchFulltextIn = z.object({
  index: z.enum(["group_search", "user_search", "computer_search"]),
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(200).default(50),
});
export const SearchFulltextOut = z.object({
  hits: z.array(
    z.object({
      guid: z.string().nullable(),
      sam: z.string().nullable(),
      name: z.string(),
      description: z.string().nullable(),
      score: z.number(),
    })
  ),
  total: z.number(),
});

export const CountMatchingIn = z.object({ cypher: CypherText });
export const CountMatchingOut = z.object({ count: z.number(), elapsedMs: z.number() });

export const RuleTypeEnum = z.enum(["group", "user", "computer", "department"]);
export const MatchTypeEnum = z.enum(["exact", "ou", "prefix", "regex"]);

export const EnumerateRuleMatchesIn = z.object({
  rule_type: RuleTypeEnum,
  match_type: MatchTypeEnum,
  match_pattern: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(500).default(200),
});
export const EnumerateRuleMatchesOut = z.object({
  matches: z.array(
    z.object({
      sam: z.string().nullable(),
      guid: z.string().nullable(),
      name: z.string(),
      dn: z.string().nullable(),
    })
  ),
  total: z.number(),
});

export const GetOwnershipCoverageIn = z.object({});
export const GetOwnershipCoverageOut = z.object({
  group: z.object({ total: z.number(), typed: z.number(), pct: z.number() }),
  user: z.object({ total: z.number(), typed: z.number(), pct: z.number() }),
  computer: z.object({ total: z.number(), typed: z.number(), pct: z.number() }),
  department: z.object({ total: z.number(), typed: z.number(), pct: z.number() }),
});

export const SaveOwnershipRuleIn = z.object({
  rule_type: RuleTypeEnum,
  match_type: MatchTypeEnum,
  name: z.string().min(1).max(256),
  match_pattern: z.string().min(1).max(2000),
  description: z.string().max(4000).optional(),
  sample_sams: z.array(z.string()).max(50).optional(),
});
export const SaveOwnershipRuleOut = z.object({
  ok: z.boolean(),
  rule_id: z.number(),
  rule_type: RuleTypeEnum,
  match_type: MatchTypeEnum,
  match_pattern: z.string(),
});

export const AssignOwnerIn = z.object({
  rule_id: z.number().int().nonnegative(),
  owner_sams: z.array(z.string().min(1).max(256)).min(1).max(20),
});
export const AssignOwnerOut = z.object({
  ok: z.boolean(),
  rule_id: z.number(),
  owner_sams: z.array(z.string()),
});

export const ProposeClustersIn = z.object({
  proposals: z
    .array(
      z.object({
        rule_type: RuleTypeEnum,
        name: z.string().min(1).max(256),
        description: z.string().max(4000).optional(),
        match_type: MatchTypeEnum,
        match_pattern: z.string().min(1).max(2000),
        sample_sams: z.array(z.string()).max(50).optional(),
        suggested_owner_sams: z.array(z.string()).max(20).optional(),
      })
    )
    .min(1)
    .max(20),
});
export const ProposeClustersOut = z.object({
  created: z.array(
    z.object({
      rule_id: z.number(),
      rule_type: RuleTypeEnum,
      name: z.string(),
      match_pattern: z.string(),
      ok: z.boolean(),
      error: z.string().optional(),
    })
  ),
});

export const AuditSecurityIn = z.object({
  include: z
    .array(
      z.enum([
        "admin_sprawl",
        "unconstrained_delegation",
        "weak_password_policy",
        "orphan_sids",
        "stale_accounts",
        "kerberoastable",
        "all",
      ])
    )
    .default(["all"]),
});
export const AuditSecurityOut = z.object({
  findings: z.array(
    z.object({
      id: z.string(),
      check: z.string(),
      severity: z.enum(["info", "low", "medium", "high", "critical"]),
      title: z.string(),
      detail: z.string(),
      affected: z.array(z.record(z.unknown())),
      remediation: z.string(),
    })
  ),
  severitySummary: z.record(z.number()),
  elapsedMs: z.number(),
});

export const UpdateTodosIn = z.object({
  todos: z
    .array(
      z.object({
        content: z.string().min(1).max(500),
        status: z.enum(["pending", "in_progress", "completed"]),
        activeForm: z.string().min(1).max(500).optional(),
      })
    )
    .min(1)
    .max(30),
});
export const UpdateTodosOut = z.object({
  ok: z.boolean(),
  todos: z.array(
    z.object({
      content: z.string(),
      status: z.string(),
      activeForm: z.string().optional(),
    })
  ),
});
