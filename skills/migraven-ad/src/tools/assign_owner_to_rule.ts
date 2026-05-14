import { AssignOwnerIn, AssignOwnerOut } from "../schema.js";
import { writeCypher } from "../neo4j-client.js";

export async function assignOwnerToRule(rawInput: unknown): Promise<unknown> {
  const input = AssignOwnerIn.parse(rawInput);
  const cypher = `
    MATCH (r) WHERE id(r) = $rule_id AND any(l IN labels(r) WHERE l ENDS WITH 'OwnershipRule')
    SET r.owner_sams = $owner_sams,
        r.owner_assigned_at = datetime()
    RETURN id(r) AS rule_id, r.owner_sams AS owner_sams
  `;
  const r = await writeCypher(cypher, { rule_id: input.rule_id, owner_sams: input.owner_sams });
  const row = (r.rows[0] as Record<string, unknown>) ?? null;
  if (!row) {
    throw new Error(`OwnershipRule mit rule_id=${input.rule_id} nicht gefunden.`);
  }
  return AssignOwnerOut.parse({
    ok: true,
    rule_id: Number(row.rule_id),
    owner_sams: (row.owner_sams as string[]) ?? input.owner_sams,
  });
}
