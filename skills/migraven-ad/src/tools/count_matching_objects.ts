import { CountMatchingIn, CountMatchingOut } from "../schema.js";
import { runCypher, explainCypher } from "../neo4j-client.js";

export async function countMatchingObjects(rawInput: unknown): Promise<unknown> {
  const input = CountMatchingIn.parse(rawInput);
  if (!/\bcount\s*\(/i.test(input.cypher)) {
    throw new Error("count_matching_objects erwartet eine Query mit RETURN count(*).");
  }
  await explainCypher(input.cypher);
  const t0 = Date.now();
  const result = await runCypher(input.cypher, { rowCap: 1 });
  const firstRow = result.rows[0] ?? {};
  const numeric = Object.values(firstRow).find((v) => typeof v === "number");
  if (typeof numeric !== "number") {
    throw new Error("count_matching_objects: keine numerische Spalte im ersten Ergebnis gefunden.");
  }
  return CountMatchingOut.parse({ count: numeric, elapsedMs: Date.now() - t0 });
}
