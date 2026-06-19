import "server-only";
import oracledb from "oracledb";
import fs from "node:fs";
import type { TableInfo, ColumnInfo, QueryResult } from "./types";

/**
 * Read-only Oracle access layer.
 *
 * SAFETY: this module is engineered so the dashboard can NEVER modify the
 * database. Three independent guards:
 *   1. assertSelectOnly() rejects anything that isn't a single SELECT/WITH.
 *   2. Every statement runs inside `SET TRANSACTION READ ONLY` — Oracle itself
 *      will raise ORA-01456 on any attempted write.
 *   3. autoCommit is never enabled and commit() is never called.
 * Plus: a statement timeout and a hard row cap so a query can't hammer the DB.
 *
 * Connection works in either driver mode:
 *   - thin  (default, pure JS) — needs the server's TLS cert trusted via
 *     NODE_EXTRA_CA_CERTS (see .env / certs/).
 *   - thick (set ORACLE_CLIENT_LIB_DIR) — uses an installed Oracle client +
 *     wallet (ORACLE_CONFIG_DIR). Required for legacy servers.
 */

const MAX_ROWS = Number(process.env.ORACLE_MAX_ROWS || 500);
const STMT_TIMEOUT_MS = Number(process.env.ORACLE_STMT_TIMEOUT_MS || 15000);

let initialized = false;

function initThickIfRequested() {
  if (initialized) return;
  initialized = true;
  const libDir = process.env.ORACLE_CLIENT_LIB_DIR;
  if (libDir) {
    oracledb.initOracleClient({
      libDir,
      configDir: process.env.ORACLE_CONFIG_DIR || libDir,
    });
  }
}

// When set, all DB access is delegated to a remote read-only connector
// (connector/serve.mjs) running on a host that can reach Oracle. This lets the
// UI run anywhere while the database stays behind its existing trust boundary.
function remoteBase(): string | null {
  const u = process.env.REMOTE_DATA_URL;
  return u ? u.replace(/\/$/, "") : null;
}

async function remoteJson(path: string, init?: RequestInit): Promise<unknown> {
  const base = remoteBase()!;
  const res = await fetch(base + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "bypass-tunnel-reminder": "1",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Remote ${res.status}`);
  return body;
}

export function isConfigured(): boolean {
  if (remoteBase()) return true;
  return Boolean(
    process.env.ORACLE_USER &&
      process.env.ORACLE_PASSWORD &&
      (process.env.ORACLE_CONNECT_STRING || process.env.ORACLE_HOST),
  );
}

function connectString(): string {
  if (process.env.ORACLE_CONNECT_STRING) return process.env.ORACLE_CONNECT_STRING;
  const host = process.env.ORACLE_HOST!;
  const port = process.env.ORACLE_PORT || "8152";
  const service = process.env.ORACLE_SERVICE || "DISH";
  const proto = process.env.ORACLE_PROTOCOL || "TCPS";
  const dnMatch = process.env.ORACLE_SSL_DN_MATCH || "FALSE";
  return (
    `(DESCRIPTION=(ADDRESS=(PROTOCOL=${proto})(HOST=${host})(PORT=${port}))` +
    `(CONNECT_DATA=(SERVICE_NAME=${service}))(SECURITY=(SSL_SERVER_DN_MATCH=${dnMatch})))`
  );
}

// Cache the pool across hot-reloads in dev.
const g = globalThis as unknown as { __oraPool?: oracledb.Pool };

async function getPool(): Promise<oracledb.Pool> {
  if (g.__oraPool) return g.__oraPool;
  initThickIfRequested();

  // In thin mode, allow trusting the server cert from a file without env var.
  const caPath = process.env.ORACLE_CA_CERT;
  if (caPath && fs.existsSync(caPath) && !process.env.ORACLE_CLIENT_LIB_DIR) {
    // node-oracledb thin uses Node's TLS; surfacing the cert this way is a
    // best-effort fallback. NODE_EXTRA_CA_CERTS remains the supported path.
    process.env.NODE_EXTRA_CA_CERTS ||= caPath;
  }

  g.__oraPool = await oracledb.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: connectString(),
    poolMin: 0,
    poolMax: Number(process.env.ORACLE_POOL_MAX || 4),
    poolTimeout: 60,
    queueTimeout: 8000,
  });
  return g.__oraPool;
}

const FORBIDDEN =
  /\b(insert|update|delete|merge|drop|create|alter|truncate|grant|revoke|begin|declare|call|exec(?:ute)?|comment|rename|lock|flashback|purge|savepoint|into)\b/i;

export function assertSelectOnly(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (!trimmed) throw new Error("Empty query");
  if (trimmed.includes(";")) throw new Error("Only a single statement is allowed");
  if (!/^(select|with)\b/i.test(trimmed))
    throw new Error("Only SELECT / WITH queries are permitted (read-only)");
  if (/\bfor\s+update\b/i.test(trimmed))
    throw new Error("FOR UPDATE is not allowed (read-only)");
  if (FORBIDDEN.test(trimmed))
    throw new Error("Query contains a non-read-only keyword and was blocked");
  return trimmed;
}

async function withReadOnlyConn<T>(fn: (c: oracledb.Connection) => Promise<T>): Promise<T> {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    conn.callTimeout = STMT_TIMEOUT_MS;
    // Defense in depth: Oracle rejects ANY write in this transaction.
    await conn.execute("SET TRANSACTION READ ONLY");
    return await fn(conn);
  } finally {
    try {
      await conn.close();
    } catch {
      /* ignore */
    }
  }
}

/** Run an arbitrary, validated read-only SELECT. */
export async function runQuery(sql: string): Promise<QueryResult> {
  const clean = assertSelectOnly(sql);
  if (remoteBase())
    return (await remoteJson("/query", { method: "POST", body: JSON.stringify({ sql: clean }) })) as QueryResult;
  const started = Date.now();
  return withReadOnlyConn(async (conn) => {
    const res = await conn.execute(clean, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      maxRows: MAX_ROWS + 1,
      fetchArraySize: 100,
    });
    const rows = (res.rows as Array<Record<string, unknown>>) ?? [];
    const truncated = rows.length > MAX_ROWS;
    const out = truncated ? rows.slice(0, MAX_ROWS) : rows;
    return {
      columns: (res.metaData ?? []).map((m) => m.name),
      rows: out.map(normalizeRow),
      rowCount: out.length,
      elapsedMs: Date.now() - started,
      truncated,
    };
  });
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) o[k] = v.toISOString();
    else if (typeof v === "bigint") o[k] = v.toString();
    else o[k] = v;
  }
  return o;
}

/** Connectivity + version check. Read-only. */
export async function ping(): Promise<{ ok: boolean; banner?: string; error?: string }> {
  if (remoteBase()) {
    try {
      return (await remoteJson("/health")) as { ok: boolean; banner?: string };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  try {
    const r = await withReadOnlyConn((conn) =>
      conn.execute(
        "select banner as b from v$version where rownum = 1",
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      ),
    );
    const banner = (r.rows as Array<{ B: string }>)?.[0]?.B;
    return { ok: true, banner };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** List tables visible to the connected user (read-only). */
export async function listTables(limit = 300): Promise<TableInfo[]> {
  if (remoteBase()) return ((await remoteJson("/schema")) as { tables: TableInfo[] }).tables;
  return withReadOnlyConn(async (conn) => {
    const r = await conn.execute(
      `select owner, table_name, num_rows from (
         select owner, table_name, num_rows
           from all_tables
          where owner = sys_context('userenv','current_schema')
          order by table_name
       ) where rownum <= :lim`,
      { lim: limit },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (r.rows as Array<{ OWNER: string; TABLE_NAME: string; NUM_ROWS: number | null }>).map(
      (x) => ({ owner: x.OWNER, table: x.TABLE_NAME, rows: x.NUM_ROWS ?? null }),
    );
  });
}

/** Describe a table's columns (read-only). Identifier is whitelisted, not interpolated as data. */
export async function describeTable(table: string): Promise<ColumnInfo[]> {
  if (!/^[A-Za-z0-9_$#]+$/.test(table)) throw new Error("Invalid table name");
  if (remoteBase())
    return ((await remoteJson(`/schema/${encodeURIComponent(table)}`)) as { columns: ColumnInfo[] })
      .columns;
  return withReadOnlyConn(async (conn) => {
    const r = await conn.execute(
      `select column_name, data_type, data_length, nullable
         from all_tab_columns
        where table_name = :t
          and owner = sys_context('userenv','current_schema')
        order by column_id`,
      { t: table.toUpperCase() },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (
      r.rows as Array<{ COLUMN_NAME: string; DATA_TYPE: string; DATA_LENGTH: number; NULLABLE: string }>
    ).map((x) => ({
      name: x.COLUMN_NAME,
      type: x.DATA_LENGTH ? `${x.DATA_TYPE}(${x.DATA_LENGTH})` : x.DATA_TYPE,
      nullable: x.NULLABLE === "Y",
    }));
  });
}
