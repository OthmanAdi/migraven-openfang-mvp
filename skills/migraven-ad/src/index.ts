import { ToolPayload } from "./schema.js";
import { closeDriver } from "./neo4j-client.js";
import { executeCypher } from "./tools/execute_cypher.js";
import { batchQueries } from "./tools/batch_queries.js";
import { searchFulltext } from "./tools/search_fulltext.js";
import { countMatchingObjects } from "./tools/count_matching_objects.js";
import { enumerateRuleMatches } from "./tools/enumerate_rule_matches.js";
import { getOwnershipCoverage } from "./tools/get_ownership_coverage.js";
import { saveOwnershipRule } from "./tools/save_ownership_rule.js";
import { assignOwnerToRule } from "./tools/assign_owner_to_rule.js";
import { proposeOwnershipClusters } from "./tools/propose_ownership_clusters.js";
import { auditSecurity } from "./tools/audit_security.js";
import { updateTodos } from "./tools/update_todos.js";

type ToolFn = (input: unknown) => Promise<unknown>;

const TOOLS: Record<string, ToolFn> = {
  execute_cypher: executeCypher,
  batch_queries: batchQueries,
  search_fulltext: searchFulltext,
  count_matching_objects: countMatchingObjects,
  enumerate_rule_matches: enumerateRuleMatches,
  get_ownership_coverage: getOwnershipCoverage,
  save_ownership_rule: saveOwnershipRule,
  assign_owner_to_rule: assignOwnerToRule,
  propose_ownership_clusters: proposeOwnershipClusters,
  audit_security: auditSecurity,
  update_todos: updateTodos,
};

async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += String(chunk);
  return data;
}

function writeResult(result: unknown): void {
  process.stdout.write(JSON.stringify({ result }));
}

function writeError(message: string): void {
  process.stdout.write(JSON.stringify({ error: message }));
}

async function main(): Promise<void> {
  try {
    const raw = await readStdin();
    if (!raw.trim()) {
      writeError("Empty stdin payload.");
      process.exit(1);
    }
    const payload = ToolPayload.parse(JSON.parse(raw));
    const fn = TOOLS[payload.tool];
    if (!fn) {
      writeError(`Unknown tool '${payload.tool}'. Available: ${Object.keys(TOOLS).join(", ")}`);
      process.exit(1);
    }
    const out = await fn(payload.input);
    writeResult(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeError(message);
    process.exit(1);
  } finally {
    await closeDriver();
  }
}

main();
