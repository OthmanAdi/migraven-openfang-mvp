import { EnumerateRuleMatchesIn, EnumerateRuleMatchesOut } from "../schema.js";
import { runCypher } from "../neo4j-client.js";

const TARGET_LABEL: Record<string, string> = {
  group: "Group",
  user: "User",
  computer: "Computer",
  department: "Department",
};

export async function enumerateRuleMatches(rawInput: unknown): Promise<unknown> {
  const input = EnumerateRuleMatchesIn.parse(rawInput);
  const label = TARGET_LABEL[input.rule_type] ?? "Group";

  let cypher: string;
  let params: Record<string, unknown> = { limit: input.limit };

  switch (input.match_type) {
    case "exact":
      cypher = `MATCH (n:${label}) WHERE n.name = $pat OR n.cn = $pat RETURN n LIMIT $limit`;
      params.pat = input.match_pattern;
      break;
    case "ou":
      cypher = `MATCH (n:${label}) WHERE n.distinguishedName CONTAINS $pat RETURN n LIMIT $limit`;
      params.pat = input.match_pattern;
      break;
    case "prefix":
      cypher = `MATCH (n:${label}) WHERE n.name STARTS WITH $pat OR n.sAMAccountName STARTS WITH $pat RETURN n LIMIT $limit`;
      params.pat = input.match_pattern;
      break;
    case "regex":
      cypher = `MATCH (n:${label}) WHERE n.name =~ $pat OR n.sAMAccountName =~ $pat RETURN n LIMIT $limit`;
      params.pat = input.match_pattern;
      break;
  }

  const result = await runCypher(cypher, { params, rowCap: input.limit });

  const matches = result.rows.map((row) => {
    const node = row.n as { props?: Record<string, unknown> } | Record<string, unknown> | null;
    const props =
      node && typeof node === "object" && "props" in node && node.props
        ? (node.props as Record<string, unknown>)
        : ((node as Record<string, unknown>) ?? {});
    return {
      sam:
        ((props.sAMAccountName ?? props.samAccountName ?? props.sam) as string) ?? null,
      guid: ((props.objectGUID ?? props.guid ?? props.uuid) as string) ?? null,
      name: ((props.name ?? props.cn ?? props.displayName) as string) ?? "(unnamed)",
      dn: ((props.distinguishedName ?? props.dn) as string) ?? null,
    };
  });

  return EnumerateRuleMatchesOut.parse({ matches, total: matches.length });
}
