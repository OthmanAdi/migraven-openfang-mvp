import { GetOwnershipCoverageIn, GetOwnershipCoverageOut } from "../schema.js";
import { runCypher } from "../neo4j-client.js";

type Bucket = "group" | "user" | "computer" | "department";

const TARGETS: Record<Bucket, { label: string; ruleLabel: string }> = {
  group: { label: "Group", ruleLabel: "_GroupOwnershipRule" },
  user: { label: "User", ruleLabel: "_UserOwnershipRule" },
  computer: { label: "Computer", ruleLabel: "_ComputerOwnershipRule" },
  department: { label: "Department", ruleLabel: "_DepartmentOwnershipRule" },
};

async function coverageFor(bucket: Bucket): Promise<{ total: number; typed: number; pct: number }> {
  const { label, ruleLabel } = TARGETS[bucket];
  const totalCypher = `MATCH (n:${label}) RETURN count(n) AS total`;
  const typedCypher = `
    MATCH (n:${label})
    WHERE EXISTS {
      MATCH (r:${ruleLabel})
      WHERE (r)-[:COVERS]->(n) OR (n)-[:OWNED_BY|MEMBER_OF*0..1]-(:User { sAMAccountName: r.owner_sams[0] })
    }
    RETURN count(DISTINCT n) AS typed
  `;
  const [t, ty] = await Promise.all([
    runCypher(totalCypher, { rowCap: 1 }),
    runCypher(typedCypher, { rowCap: 1 }).catch(() => ({ rows: [{ typed: 0 }] })),
  ]);
  const total = Number((t.rows[0] as Record<string, unknown>)?.total ?? 0);
  const typed = Number((ty.rows[0] as Record<string, unknown>)?.typed ?? 0);
  const pct = total === 0 ? 0 : Math.round((typed / total) * 1000) / 10;
  return { total, typed, pct };
}

export async function getOwnershipCoverage(rawInput: unknown): Promise<unknown> {
  GetOwnershipCoverageIn.parse(rawInput);
  const [group, user, computer, department] = await Promise.all([
    coverageFor("group"),
    coverageFor("user"),
    coverageFor("computer"),
    coverageFor("department"),
  ]);
  return GetOwnershipCoverageOut.parse({ group, user, computer, department });
}
