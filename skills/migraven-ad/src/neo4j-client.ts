import neo4j, { Driver, Session, Record as Neo4jRecord } from "neo4j-driver";
import { getNeo4jCredentials } from "./credentials.js";

const URI = process.env.NEO4J_URI?.trim() || "bolt://localhost:7687";
const DATABASE = process.env.NEO4J_DATABASE?.trim() || "neo4j";
export const MAX_ROWS = Number(process.env.MAX_ROWS) || 500;
export const MAX_CHARS = Number(process.env.MAX_CHARS) || 120_000;
export const CYPHER_TIMEOUT_MS = Number(process.env.CYPHER_TIMEOUT_MS) || 15_000;

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (driver) return driver;
  const { username, password } = getNeo4jCredentials();
  driver = neo4j.driver(URI, neo4j.auth.basic(username, password), {
    maxConnectionPoolSize: 10,
    connectionAcquisitionTimeout: 10_000,
    connectionTimeout: 5_000,
    disableLosslessIntegers: true,
  });
  return driver;
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

export type CypherRunOptions = {
  params?: Record<string, unknown>;
  rowCap?: number;
  charCap?: number;
  timeoutMs?: number;
};

export type CypherRunResult = {
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
  elapsedMs: number;
  nodesTouched: number;
  relsTouched: number;
};

export async function explainCypher(cypher: string, params: Record<string, unknown> = {}): Promise<void> {
  const session: Session = getDriver().session({
    database: DATABASE,
    defaultAccessMode: neo4j.session.READ,
  });
  try {
    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("EXPLAIN timeout after 15s")), 15_000)
    );
    await Promise.race([session.run("EXPLAIN " + cypher, params as Record<string, unknown>), timer]);
  } finally {
    await session.close().catch(() => {});
  }
}

export async function writeCypher(cypher: string, params: Record<string, unknown> = {}): Promise<CypherRunResult> {
  const session: Session = getDriver().session({
    database: DATABASE,
    defaultAccessMode: neo4j.session.WRITE,
  });
  const started = Date.now();
  try {
    const result = await session.run(cypher, params as Record<string, unknown>);
    const rows = result.records.map(recordToObject);
    const summary = result.summary;
    return {
      rows,
      truncated: false,
      elapsedMs: Date.now() - started,
      // @ts-expect-error neo4j ResultSummary types
      nodesTouched: summary?.counters?._stats?.nodesCreated ?? 0,
      // @ts-expect-error neo4j ResultSummary types
      relsTouched: summary?.counters?._stats?.relationshipsCreated ?? 0,
    };
  } finally {
    await session.close().catch(() => {});
  }
}

function recordToObject(rec: Neo4jRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of rec.keys) {
    out[String(key)] = sanitise(rec.get(key));
  }
  return out;
}

function sanitise(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(sanitise);
  const anyV = v as { properties?: Record<string, unknown>; labels?: string[]; type?: string };
  if (anyV.properties && (anyV.labels || anyV.type)) {
    const labels = anyV.labels ?? (anyV.type ? [anyV.type] : []);
    return { __kind: anyV.labels ? "node" : "relationship", labels, props: sanitise(anyV.properties) };
  }
  if (Object.prototype.toString.call(v) === "[object Object]") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = sanitise(val);
    }
    return out;
  }
  return String(v);
}

export async function runCypher(cypher: string, opts: CypherRunOptions = {}): Promise<CypherRunResult> {
  const rowCap = opts.rowCap ?? MAX_ROWS;
  const charCap = opts.charCap ?? MAX_CHARS;
  const timeoutMs = opts.timeoutMs ?? CYPHER_TIMEOUT_MS;
  const params = opts.params ?? {};

  const session: Session = getDriver().session({ database: DATABASE, defaultAccessMode: neo4j.session.READ });
  const started = Date.now();
  const rows: Array<Record<string, unknown>> = [];
  let truncated = false;
  let charBudget = charCap;

  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Cypher timeout after ${timeoutMs}ms`)), timeoutMs)
  );

  try {
    const work = (async () => {
      const result = session.run(cypher, params as Record<string, unknown>);
      for await (const rec of result) {
        if (rows.length >= rowCap) {
          truncated = true;
          break;
        }
        const obj = recordToObject(rec);
        const size = JSON.stringify(obj).length;
        if (size > charBudget) {
          truncated = true;
          break;
        }
        charBudget -= size;
        rows.push(obj);
      }
      const summary = await result.summary();
      return summary;
    })();

    const summary = await Promise.race([work, timer]);
    return {
      rows,
      truncated,
      elapsedMs: Date.now() - started,
      nodesTouched:
        // @ts-expect-error neo4j ResultSummary types
        summary?.counters?._stats?.nodesCreated ?? 0,
      relsTouched:
        // @ts-expect-error neo4j ResultSummary types
        summary?.counters?._stats?.relationshipsCreated ?? 0,
    };
  } finally {
    await session.close().catch(() => {});
  }
}
