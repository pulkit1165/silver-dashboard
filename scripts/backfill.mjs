#!/usr/bin/env node
// One-time historical backfill: pulls ALL Oracle data since 2024-01-01
// and upserts into your PostgreSQL (oracle_raw table).
//
// Usage:
//   node scripts/backfill.mjs
//   node scripts/backfill.mjs --from 2024-01-01 --to 2025-03-31   (custom range)
//   node scripts/backfill.mjs --table DTC102                       (one table only)
//
// Runs locally — no Vercel timeout. Safe: 400 ms between pages, 3 s between tables.

import postgres from "postgres";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Load .env.local ──────────────────────────────────────────────────────────
function loadEnv() {
  try {
    const lines = readFileSync(resolve(__dir, "../.env.local"), "utf8").split("\n");
    for (const line of lines) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch { /* .env.local may not exist in prod */ }
}
loadEnv();

const CONNECTOR_URL = process.env.REMOTE_DATA_URL;
const DATABASE_URL  = process.env.DATABASE_URL;
if (!CONNECTOR_URL) { console.error("REMOTE_DATA_URL not set"); process.exit(1); }
if (!DATABASE_URL)  { console.error("DATABASE_URL not set");  process.exit(1); }

// ── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg  = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const FROM  = arg("--from")  ?? "2024-01-01";
const TO    = arg("--to")    ?? new Date().toISOString().slice(0, 10);
const ONLY  = arg("--table") ?? null;

// ── Table definitions (mirrors lib/erp/oracle-sync.ts) ──────────────────────
const SYNC_TABLES = [
  { name: "DTC102",          keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "DTC201",          keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "DTC106",          keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "DTC110",          keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "DTC400",          keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "DTD101",          keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_SALE_D",       keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "VW_BANK_D",       keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_DR_PENDBILLS", keyCol: null,      dateCol: null, snapshot: true },
  { name: "VW_CR_PENDBILLS", keyCol: null,      dateCol: null, snapshot: true },
  { name: "VW_PEND_SO",      keyCol: null,      dateCol: null, snapshot: true },
  { name: "VW_OPTRIALPOST",  keyCol: "PARTYID", dateCol: null },
  { name: "VW_BANKBOOKPOST", keyCol: null,      dateCol: null, snapshot: true },
  { name: "VW_MRPLIST",      keyCol: "ITEMID",  dateCol: null },
  { name: "A_CURRCPM",       keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_SALE_GST_D",       keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_STOCK_REQ",        keyCol: "ITEMID",  dateCol: null },
  { name: "A_LABELPRINT",        keyCol: null,      dateCol: null },
  { name: "VW_DELYORDER_2Y",     keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "VW_DELYORDERDET_2Y",  keyCol: null,      dateCol: null },
  { name: "VW_MRNDET_2Y",        keyCol: null,      dateCol: null },
  { name: "VW_LEDGER_2YR",       keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_GST_D",            keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_GST_SALE_ITEM",    keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_GST_PURC_ITEM",    keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_GST_EINV_D",       keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_GST_EWAY_D",       keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_HSNCODE_STOCK_2Y", keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_LOTSTORE",         keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "A_MRP",               keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_CASHBOOKPOST",     keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_DO_STATUS",        keyCol: null,      dateCol: null, snapshot: true },
];

const PAGE = 500, PAGE_DELAY = 400, TABLE_DELAY = 3000;

// ── Helpers ──────────────────────────────────────────────────────────────────
function rowKey(row, def, snapDate, idx) {
  if (def.snapshot) return `SNAP_${snapDate}_${idx}`;
  if (def.keyCol && row[def.keyCol]) return String(row[def.keyCol]);
  const parts = [];
  for (const c of ["TRMID","ITEMID","ITEMCODE","PARTYID","SERIES","A_CODE","B_CODE"]) {
    if (row[c]) parts.push(row[c]);
  }
  const d = row[def.dateCol ?? "TRDATE"] ?? row["TRDATE"];
  if (d) parts.push(d);
  // Always include global idx as tiebreaker to prevent duplicate-key errors
  parts.push(String(idx));
  return parts.length ? parts.join("|") : `IDX_${snapDate}_${idx}`;
}

function fiscalYear(row, def) {
  const raw = row[def.dateCol ?? "TRDATE"] ?? row["TRDATE"];
  if (!raw) return null;
  const m2 = /(\d{2})-([A-Z]{3})-(\d{2,4})/i.exec(raw);
  if (m2) {
    const yy = Number(m2[3]) % 100;
    const afterMar = ["APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]
      .includes(m2[2].toUpperCase());
    return afterMar ? (yy + 1) % 100 : yy;
  }
  const m3 = /^(\d{4})-(\d{2})/.exec(raw);
  if (m3) { const y=Number(m3[1]),mo=Number(m3[2]); return mo>=4?(y+1)%100:y%100; }
  return null;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function oracleQuery(sql) {
  const res = await fetch(`${CONNECTOR_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j.rows ?? [];
}

// ── Main ─────────────────────────────────────────────────────────────────────
const db = postgres(DATABASE_URL, { max: 3, prepare: false });

const tables = ONLY ? SYNC_TABLES.filter(t => t.name === ONLY) : SYNC_TABLES;
console.log(`\nBackfill  ${FROM} → ${TO}`);
console.log(`Tables   : ${tables.map(t => t.name).join(", ")}\n`);

// Ensure tables exist
await db.unsafe(readFileSync(resolve(__dir, "create-oracle-sync-tables.sql"), "utf8"));

let grandTotal = 0;

for (const def of tables) {
  console.log(`\n▶ ${def.name}`);
  const snapDate = TO;
  let offset = 0, tableTotal = 0;

  while (true) {
    const lo = offset + 1, hi = offset + PAGE;
    let inner;
    if (!def.dateCol || def.snapshot) {
      inner = `SELECT * FROM ${def.name}`;
    } else {
      inner = `SELECT * FROM ${def.name} WHERE 1=1`
        + ` AND ${def.dateCol} >= TO_DATE('${FROM}','YYYY-MM-DD')`
        + ` AND ${def.dateCol} <= TO_DATE('${TO}','YYYY-MM-DD')`
        + ` ORDER BY ${def.dateCol}`;
    }
    const pageSql = `SELECT * FROM (SELECT q.*, ROWNUM rn FROM (${inner}) q WHERE ROWNUM <= ${hi}) WHERE rn >= ${lo}`;

    let rows;
    try { rows = await oracleQuery(pageSql); }
    catch(e) { console.error(`  ✗ page ${lo}-${hi}: ${e.message}`); break; }

    if (!rows.length) break;

    const batch = rows.map((row, i) => ({
      source_table: def.name,
      source_key:   rowKey(row, def, snapDate, offset + i),
      fy:           fiscalYear(row, def),
      data:         row,
    }));

    try {
      await db.unsafe(`
        INSERT INTO oracle_raw (source_table, source_key, fy, data)
        SELECT r.source_table, r.source_key, r.fy::smallint, r.data::jsonb
        FROM jsonb_to_recordset('${JSON.stringify(batch).replace(/'/g,"''")}'::jsonb)
          AS r(source_table text, source_key text, fy int, data jsonb)
        ON CONFLICT (source_table, source_key)
        DO UPDATE SET data = EXCLUDED.data, synced_at = NOW(),
                      fy   = COALESCE(EXCLUDED.fy, oracle_raw.fy)
      `);
    } catch(e) { console.error(`  ✗ upsert page ${lo}-${hi}: ${e.message}`); break; }

    tableTotal += batch.length;
    process.stdout.write(`  rows ${offset + 1}–${offset + rows.length} (${tableTotal} total)\r`);

    if (rows.length < PAGE) break;
    offset += PAGE;
    await sleep(PAGE_DELAY);
  }

  console.log(`  ✓ ${tableTotal} rows upserted`);
  grandTotal += tableTotal;

  if (tables.indexOf(def) < tables.length - 1) await sleep(TABLE_DELAY);
}

console.log(`\n✅ Done — ${grandTotal} rows total\n`);
await db.end();
