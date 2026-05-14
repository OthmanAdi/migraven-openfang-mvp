import { SearchFulltextIn, SearchFulltextOut } from "../schema.js";
import { runCypher } from "../neo4j-client.js";

export async function searchFulltext(rawInput: unknown): Promise<unknown> {
  const input = SearchFulltextIn.parse(rawInput);
  const cypher = `
    CALL db.index.fulltext.queryNodes($index, $query) YIELD node, score
    WITH node, score
    ORDER BY score DESC
    LIMIT $limit
    RETURN
      coalesce(node.objectGUID, node.guid, node.uuid)               AS guid,
      coalesce(node.sAMAccountName, node.samAccountName, node.sam)  AS sam,
      coalesce(node.name, node.cn, node.displayName, '')            AS name,
      coalesce(node.description, node.info, null)                   AS description,
      score
  `;
  const result = await runCypher(cypher, {
    params: { index: input.index, query: input.query, limit: input.limit },
    rowCap: input.limit,
  });

  const hits = result.rows.map((row) => ({
    guid: row.guid as string | null,
    sam: row.sam as string | null,
    name: (row.name as string) || "(unnamed)",
    description: (row.description as string | null) ?? null,
    score: Number(row.score ?? 0),
  }));

  return SearchFulltextOut.parse({ hits, total: hits.length });
}
