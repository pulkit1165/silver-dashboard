// Standalone read-only Oracle helpers (ESM). Mirrors the dashboard's safety
// guarantees so this connector can NEVER modify the database:
//   1. assertSelectOnly() — single SELECT/WITH only.
//   2. SET TRANSACTION READ ONLY — Oracle rejects any write (ORA-01456).
//   3. autoCommit never enabled; commit() never called.
// Plus statement timeout + row cap.
import oracledb from "oracledb";
import fs from "node:fs";

const MAX_ROWS = Number(process.env.ORACLE_MAX_ROWS || 500);
const STMT_TIMEOUT_MS = Number(process.env.ORACLE_STMT_TIMEOUT_MS || 15000);

let pool = null;
let inited = false;

function initThick() {
  if (inited) return;
  inited = true;
  const libDir = process.env.ORACLE_CLIENT_LIB_DIR;
  if (libDir) {
    oracledb.initOracleClient({
      libDir,
      configDir: process.env.ORACLE_CONFIG_DIR || libDir,
    });
    console.log(`[connector] thick mode via ${libDir}`);
  } else {
    console.log("[connector] thin mode (set ORACLE_CLIENT_LIB_DIR for thick)");
  }
}

function connectString() {
  if (process.env.ORACLE_CONNECT_STRING) return process.env.ORACLE_CONNECT_STRING;
  const host = process.env.ORACLE_HOST;
  const port = process.env.ORACLE_PORT || "8152";
  const service = process.env.ORACLE_SERVICE || "DISH";
  const proto = process.env.ORACLE_PROTOCOL || "TCPS";
  const dn = process.env.ORACLE_SSL_DN_MATCH || "FALSE";
  return (
    `(DESCRIPTION=(ADDRESS=(PROTOCOL=${proto})(HOST=${host})(PORT=${port}))` +
    `(CONNECT_DATA=(SERVICE_NAME=${service}))(SECURITY=(SSL_SERVER_DN_MATCH=${dn})))`
  );
}

async function getPool() {
  if (pool) return pool;
  initThick();
  const caPath = process.env.ORACLE_CA_CERT;
  if (caPath && fs.existsSync(caPath) && !process.env.ORACLE_CLIENT_LIB_DIR) {
    process.env.NODE_EXTRA_CA_CERTS ||= caPath;
  }
  pool = await oracledb.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: connectString(),
    poolMin: 0,
    poolMax: Number(process.env.ORACLE_POOL_MAX || 4),
    poolTimeout: 60,
    queueTimeout: 8000,
  });
  return pool;
}

const FORBIDDEN =
  /\b(insert|update|delete|merge|drop|create|alter|truncate|grant|revoke|begin|declare|call|exec(?:ute)?|comment|rename|lock|flashback|purge|savepoint|into)\b/i;

export function assertSelectOnly(sql) {
  const t = String(sql || "").trim().replace(/;\s*$/, "");
  if (!t) throw new Error("Empty query");
  if (t.includes(";")) throw new Error("Only a single statement is allowed");
  if (!/^(select|with)\b/i.test(t)) throw new Error("Only SELECT / WITH permitted (read-only)");
  if (/\bfor\s+update\b/i.test(t)) throw new Error("FOR UPDATE is not allowed");
  if (FORBIDDEN.test(t)) throw new Error("Query contains a non-read-only keyword and was blocked");
  return t;
}

async function withConn(fn) {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    conn.callTimeout = STMT_TIMEOUT_MS;
    await conn.execute("SET TRANSACTION READ ONLY");
    return await fn(conn);
  } finally {
    try {
      await conn.close();
    } catch {}
  }
}

function normalize(row) {
  const o = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) o[k] = v.toISOString();
    else if (typeof v === "bigint") o[k] = v.toString();
    else o[k] = v;
  }
  return o;
}

export async function runQuery(sql) {
  const clean = assertSelectOnly(sql);
  const started = Date.now();
  return withConn(async (conn) => {
    const res = await conn.execute(clean, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      maxRows: MAX_ROWS + 1,
      fetchArraySize: 100,
    });
    const rows = res.rows ?? [];
    const truncated = rows.length > MAX_ROWS;
    const out = (truncated ? rows.slice(0, MAX_ROWS) : rows).map(normalize);
    return {
      columns: (res.metaData ?? []).map((m) => m.name),
      rows: out,
      rowCount: out.length,
      elapsedMs: Date.now() - started,
      truncated,
    };
  });
}

export async function ping() {
  try {
    const r = await withConn((conn) =>
      conn.execute("select banner as b from v$version where rownum = 1", [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      }),
    );
    return { ok: true, banner: r.rows?.[0]?.B };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function listTables(limit = 500) {
  return withConn(async (conn) => {
    const r = await conn.execute(
      `select owner, table_name, num_rows
         from all_tables
        where owner = sys_context('userenv','current_schema')
        order by table_name
        fetch first :lim rows only`,
      { lim: limit },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return r.rows.map((x) => ({ owner: x.OWNER, table: x.TABLE_NAME, rows: x.NUM_ROWS ?? null }));
  });
}

export async function describeTable(table) {
  if (!/^[A-Za-z0-9_$#]+$/.test(table)) throw new Error("Invalid table name");
  return withConn(async (conn) => {
    const r = await conn.execute(
      `select column_name, data_type, data_length, nullable
         from all_tab_columns
        where table_name = :t and owner = sys_context('userenv','current_schema')
        order by column_id`,
      { t: table.toUpperCase() },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return r.rows.map((x) => ({
      name: x.COLUMN_NAME,
      type: x.DATA_LENGTH ? `${x.DATA_TYPE}(${x.DATA_LENGTH})` : x.DATA_TYPE,
      nullable: x.NULLABLE === "Y",
    }));
  });
}

export async function closePool() {
  if (pool) await pool.close(0);
}
