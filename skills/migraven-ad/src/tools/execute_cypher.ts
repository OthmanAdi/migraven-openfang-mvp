import { ExecuteCypherIn, ExecuteCypherOut, isReadOnlyCypher } from "../schema.js";
import { explainCypher, runCypher } from "../neo4j-client.js";

export async function executeCypher(rawInput: unknown): Promise<unknown> {
  const input = ExecuteCypherIn.parse(rawInput);
  if (!isReadOnlyCypher(input.cypher)) {
    throw new Error("Cypher muss read-only sein.");
  }
  await explainCypher(input.cypher, input.params ?? {});
  const result = await runCypher(input.cypher, {
    params: input.params,
    rowCap: input.row_cap,
    timeoutMs: input.timeout_secs ? input.timeout_secs * 1000 : undefined,
  });
  return ExecuteCypherOut.parse({
    rows: result.rows,
    truncated: result.truncated,
    elapsedMs: result.elapsedMs,
    explainOk: true,
  });
}
