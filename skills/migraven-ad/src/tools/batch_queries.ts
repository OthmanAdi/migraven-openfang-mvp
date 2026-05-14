import { BatchQueriesIn, BatchQueriesOut } from "../schema.js";
import { runCypher, explainCypher, CYPHER_TIMEOUT_MS } from "../neo4j-client.js";

export async function batchQueries(rawInput: unknown): Promise<unknown> {
  const input = BatchQueriesIn.parse(rawInput);
  const t0 = Date.now();

  const settled = await Promise.allSettled(
    input.queries.map(async (q) => {
      const started = Date.now();
      try {
        await explainCypher(q.cypher, q.params ?? {});
        const r = await runCypher(q.cypher, {
          params: q.params,
          rowCap: q.row_cap,
          timeoutMs: CYPHER_TIMEOUT_MS,
        });
        return {
          name: q.name,
          ok: true,
          rows: r.rows,
          truncated: r.truncated,
          elapsedMs: r.elapsedMs,
        };
      } catch (err) {
        return {
          name: q.name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          elapsedMs: Date.now() - started,
        };
      }
    })
  );

  const results = settled.map((s) =>
    s.status === "fulfilled"
      ? s.value
      : { name: "unknown", ok: false, error: String(s.reason), elapsedMs: 0 }
  );

  return BatchQueriesOut.parse({
    results,
    totalElapsedMs: Date.now() - t0,
  });
}
