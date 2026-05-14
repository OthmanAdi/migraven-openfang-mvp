import { SaveOwnershipRuleIn, SaveOwnershipRuleOut } from "../schema.js";
import { writeCypher } from "../neo4j-client.js";

const RULE_LABEL: Record<string, string> = {
  group: "_GroupOwnershipRule",
  user: "_UserOwnershipRule",
  computer: "_ComputerOwnershipRule",
  department: "_DepartmentOwnershipRule",
};

export async function saveOwnershipRule(rawInput: unknown): Promise<unknown> {
  const input = SaveOwnershipRuleIn.parse(rawInput);
  const label = RULE_LABEL[input.rule_type];
  const cypher = `
    MERGE (r:${label} {
      match_type: $match_type,
      match_pattern: $match_pattern
    })
    ON CREATE SET
      r.id            = coalesce(r.id, randomUUID()),
      r.name          = $name,
      r.description   = $description,
      r.created_at    = datetime(),
      r.sample_sams   = $sample_sams
    ON MATCH SET
      r.name          = $name,
      r.description   = coalesce($description, r.description),
      r.updated_at    = datetime(),
      r.sample_sams   = coalesce($sample_sams, r.sample_sams)
    RETURN id(r) AS rule_id
  `;
  const params = {
    name: input.name,
    description: input.description ?? null,
    match_type: input.match_type,
    match_pattern: input.match_pattern,
    sample_sams: input.sample_sams ?? null,
  };
  const r = await writeCypher(cypher, params);
  const ruleId = Number((r.rows[0] as Record<string, unknown>)?.rule_id ?? -1);
  return SaveOwnershipRuleOut.parse({
    ok: ruleId >= 0,
    rule_id: ruleId,
    rule_type: input.rule_type,
    match_type: input.match_type,
    match_pattern: input.match_pattern,
  });
}
