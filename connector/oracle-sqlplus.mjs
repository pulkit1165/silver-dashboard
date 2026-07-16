// oracle-sqlplus.mjs — drop-in replacement for oracle.mjs
// Uses sqlplus child process instead of oracledb.
// Works with any Oracle Client architecture / version — no OCI library needed.
import { spawn } from "node:child_process";

const SQLPLUS =
  process.env.ORACLE_SQLPLUS_PATH ||
  "D:\\oracle\\product\\10.2.0\\client_1\\BIN\\sqlplus.exe";
const USER = process.env.ORACLE_USER || "SILVER_2026";
const PASSWORD = process.env.ORACLE_PASSWORD || "SILVER_2026";
const SERVICE = process.env.ORACLE_CONNECT_STRING || "DISH";
const TNS_ADMIN =
  process.env.ORACLE_CONFIG_DIR ||
  "D:\\oracle\\product\\10.2.0\\client_1\\NETWORK\\ADMIN";
const MAX_ROWS = Number(process.env.ORACLE_MAX_ROWS || 500);
const TIMEOUT_MS = Number(process.env.ORACLE_STMT_TIMEOUT_MS || 20000);

function htmlDecode(s) {
  return String(s ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, " ")
    .trim();
}

function parseHtmlTable(html) {
  const cols = [...html.matchAll(/<TH[^>]*>(.*?)<\/TH>/gis)].map((m) =>
    htmlDecode(m[1])
  );
  const rows = [];
  for (const rm of html.matchAll(/<TR[^>]*>(.*?)<\/TR>/gis)) {
    if (/<TH/i.test(rm[1])) continue;
    const vals = [...rm[1].matchAll(/<TD[^>]*>(.*?)<\/TD>/gis)].map((m) =>
      htmlDecode(m[1])
    );
    if (!vals.length) continue;
    const obj = {};
    cols.forEach((c, i) => { obj[c] = vals[i] ?? null; });
    rows.push(obj);
  }
  return { columns: cols, rows: rows.slice(0, MAX_ROWS) };
}

async function runSqlHtml(sql) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, TNS_ADMIN };
    const proc = spawn(SQLPLUS, ["-S", "-L", `${USER}/${PASSWORD}@${SERVICE}`], {
      env,
      windowsHide: true,
    });

    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", (d) => { out += d.toString(); });

    const timer = setTimeout(() => { proc.kill(); reject(new Error("sqlplus timeout")); }, TIMEOUT_MS);

    proc.on("close", () => {
      clearTimeout(timer);
      const oraErr = out.match(/ORA-\d+:[^\n]*/);
      if (oraErr) return reject(new Error(oraErr[0].trim()));
      resolve(out);
    });

    proc.on("error", (e) => { clearTimeout(timer); reject(e); });

    const script =
      "SET MARKUP HTML ON\r\n" +
      "SET PAGESIZE 50000\r\n" +
      "SET FEEDBACK OFF\r\n" +
      "SET ECHO OFF\r\n" +
      "SET VERIFY OFF\r\n" +
      sql.trim().replace(/;\s*$/, "") + ";\r\n" +
      "EXIT;\r\n";

    proc.stdin.write(script);
    proc.stdin.end();
  });
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

export async function ping() {
  try {
    const raw = await runSqlHtml("SELECT banner FROM v$version WHERE rownum = 1");
    const { rows } = parseHtmlTable(raw);
    const banner = rows[0]?.BANNER ?? rows[0]?.banner ?? null;
    return { ok: true, banner };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function runQuery(sql) {
  const clean = assertSelectOnly(sql);
  const started = Date.now();
  const raw = await runSqlHtml(clean);
  const { columns, rows } = parseHtmlTable(raw);
  return {
    columns,
    rows,
    rowCount: rows.length,
    elapsedMs: Date.now() - started,
    truncated: rows.length >= MAX_ROWS,
  };
}

export async function listTables(limit = 500) {
  const raw = await runSqlHtml(
    `SELECT table_name, num_rows FROM user_tables WHERE rownum <= ${Number(limit)} ORDER BY table_name`
  );
  const { rows } = parseHtmlTable(raw);
  return rows.map((r) => ({
    owner: USER,
    table: r.TABLE_NAME ?? r.table_name ?? "",
    rows: r.NUM_ROWS != null ? Number(r.NUM_ROWS) : null,
  }));
}

export async function describeTable(table) {
  if (!/^[A-Za-z0-9_$#]+$/.test(table)) throw new Error("Invalid table name");
  const raw = await runSqlHtml(
    `SELECT column_name, data_type, data_length, nullable FROM user_tab_columns WHERE table_name = '${table.toUpperCase()}' ORDER BY column_id`
  );
  const { rows } = parseHtmlTable(raw);
  return rows.map((r) => {
    const name = r.COLUMN_NAME ?? r.column_name ?? "";
    const type = r.DATA_TYPE ?? r.data_type ?? "";
    const len = r.DATA_LENGTH ?? r.data_length;
    const nullable = (r.NULLABLE ?? r.nullable) === "Y";
    return { name, type: len ? `${type}(${len})` : type, nullable };
  });
}

export async function closePool() {
  // No pool to close for sqlplus approach
}
