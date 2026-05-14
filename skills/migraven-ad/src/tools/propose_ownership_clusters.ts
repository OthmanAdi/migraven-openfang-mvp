import { ProposeClustersIn, ProposeClustersOut } from "../schema.js";
import { saveOwnershipRule } from "./save_ownership_rule.js";
import { assignOwnerToRule } from "./assign_owner_to_rule.js";

export async function proposeOwnershipClusters(rawInput: unknown): Promise<unknown> {
  const input = ProposeClustersIn.parse(rawInput);
  const created: Array<{
    rule_id: number;
    rule_type: "group" | "user" | "computer" | "department";
    name: string;
    match_pattern: string;
    ok: boolean;
    error?: string;
  }> = [];

  for (const p of input.proposals) {
    try {
      const ruleResult = (await saveOwnershipRule({
        rule_type: p.rule_type,
        match_type: p.match_type,
        name: p.name,
        match_pattern: p.match_pattern,
        description: p.description,
        sample_sams: p.sample_sams,
      })) as { rule_id: number; ok: boolean };

      if (p.suggested_owner_sams && p.suggested_owner_sams.length > 0) {
        await assignOwnerToRule({
          rule_id: ruleResult.rule_id,
          owner_sams: p.suggested_owner_sams,
        });
      }

      created.push({
        rule_id: ruleResult.rule_id,
        rule_type: p.rule_type,
        name: p.name,
        match_pattern: p.match_pattern,
        ok: ruleResult.ok,
      });
    } catch (err) {
      created.push({
        rule_id: -1,
        rule_type: p.rule_type,
        name: p.name,
        match_pattern: p.match_pattern,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return ProposeClustersOut.parse({ created });
}
