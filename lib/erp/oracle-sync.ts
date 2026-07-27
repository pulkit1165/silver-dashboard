import "server-only";
import { getSql } from "./db";

// ── Oracle table definitions ────────────────────────────────────────────────
// keyCol  : column that uniquely identifies a row (used as upsert key).
//           null → key is computed from available columns or snapshot index.
// dateCol : column to filter by date for incremental sync.
//           null → full table synced every time (masters / snapshots).
// snapshot: true → key = SNAP_<date>_<n>  (daily snapshot, no dedup across days)

export interface TableDef {
  name: string;
  label: string;
  keyCol: string | null;
  dateCol: string | null;
  snapshot?: boolean;
}

export const SYNC_TABLES: TableDef[] = [
  { name: "DTC102",          label: "Sales Orders",         keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "DTC201",          label: "Purchase / MRN",       keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "DTC106",          label: "Delivery Orders",      keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "DTC110",          label: "Bank Book",            keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "DTC400",          label: "Cash Receipts",        keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "DTD101",          label: "Cash Journal",         keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_SALE_D",       label: "Sales Detail View",    keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "VW_BANK_D",       label: "Bank by Account",      keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_DR_PENDBILLS", label: "Receivables",          keyCol: null,      dateCol: null, snapshot: true },
  { name: "VW_CR_PENDBILLS", label: "Payables",             keyCol: null,      dateCol: null, snapshot: true },
  { name: "VW_PEND_SO",      label: "Pending Sales Orders", keyCol: null,      dateCol: null, snapshot: true },
  { name: "VW_OPTRIALPOST",  label: "Opening Trial Bal.",   keyCol: "PARTYID", dateCol: null },
  { name: "VW_BANKBOOKPOST", label: "Bank Book Ledger",     keyCol: null,      dateCol: null, snapshot: true },
  { name: "VW_MRPLIST",      label: "Item / MRP Master",    keyCol: "ITEMID",  dateCol: null },
  { name: "A_CURRCPM",       label: "Cost Price Master",    keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_SALE_GST_D",       label: "Sales Lines GST",         keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_STOCK_REQ",        label: "Stock Requirements",      keyCol: "ITEMID",  dateCol: null },
  { name: "A_LABELPRINT",        label: "Item Labels / Categ.",    keyCol: null,      dateCol: null },
  { name: "VW_DELYORDER_2Y",     label: "Delivery Orders 2Y",      keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "VW_DELYORDERDET_2Y",  label: "Delivery Order Details",  keyCol: null,      dateCol: null },
  { name: "VW_MRNDET_2Y",        label: "MRN Line Items 2Y",       keyCol: null,      dateCol: null },
  { name: "VW_LEDGER_2YR",       label: "Ledger 2 Years",          keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_GST_D",            label: "GST Summary",             keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_GST_SALE_ITEM",    label: "GST Sale Items",          keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_GST_PURC_ITEM",    label: "GST Purchase Items",      keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_GST_EINV_D",       label: "GST E-Invoice Details",   keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_GST_EWAY_D",       label: "GST E-Way Bill Details",  keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_HSNCODE_STOCK_2Y", label: "HSN Stock Movement 2Y",   keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_LOTSTORE",         label: "Lot Store",               keyCol: "TRMID",   dateCol: "TRDATE" },
  { name: "A_MRP",               label: "MRP History",             keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_CASHBOOKPOST",     label: "Cash Book Postings",      keyCol: null,      dateCol: "TRDATE" },
  { name: "VW_DO_STATUS",        label: "Delivery Order Status",   keyCol: null,      dateCol: null, snapshot: true },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

const PAGE = 500;          // rows per Oracle fetch (connector hard cap)
const PAGE_DELAY = 400;    // ms between pages — gentle on Oracle
const TABLE_DELAY = 2000;  // ms between tables

type Row = Record<string, string | null>;

function rowKey(row: Row, def: TableDef, snapDate: string, idx: number): string {
  if (def.snapshot) return `SNAP_${snapDate}_${idx}`;
  if (def.keyCol && row[def.keyCol]) return String(row[def.keyCol]);
  const parts: string[] = [];
  for (const c of ["TRMID", "ITEMID", "ITEMCODE", "PARTYID", "SERIES", "A_CODE", "B_CODE"]) {
    if (row[c]) parts.push(row[c]!);
  }
  const d = row[def.dateCol ?? "TRDATE"] ?? row["TRDATE"];
  if (d) parts.push(d);
  return parts.length ? parts.join("|") : `IDX_${snapDate}_${idx}`;
}

function fiscalYear(row: Row, def: TableDef): number | null {
  const raw = row[def.dateCol ?? "TRDATE"] ?? row["TRDATE"];
  if (!raw) return null;
  // Oracle default NLS: "18-JUL-26"  → parse year manually
  const m2 = /(\d{2})-[A-Z]{3}-(\d{2,4})/i.exec(raw);
  if (m2) {
    const yy = Number(m2[2]) % 100;
    const mon = raw.substring(3, 6).toUpperCase();
    const afterMar = ["APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"].includes(mon);
    return afterMar ? (yy + 1) % 100 : yy;
  }
  // ISO format "2026-07-18"
  const m3 = /^(\d{4})-(\d{2})/.exec(raw);
  if (m3) {
    const y = Number(m3[1]), mo = Number(m3[2]);
    return mo >= 4 ? (y + 1) % 100 : y % 100;
  }
  return null;
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function connectorFetch(sql: string): Promise<Row[]> {
  const url = process.env.REMOTE_DATA_URL;
  if (!url) throw new Error("REMOTE_DATA_URL not set");
  const res = await fetch(`${url}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
    body: JSON.stringify({ sql }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Connector HTTP ${res.status}`);
  const json = await res.json() as { rows?: Row[]; error?: string };
  if (json.error) throw new Error(json.error);
  return json.rows ?? [];
}

// ── Core sync function ───────────────────────────────────────────────────────

export interface SyncResult {
  table: string;
  label: string;
  upserted: number;
  pages: number;
  skipped?: boolean;
  error?: string;
}

export async function syncTable(
  def: TableDef,
  opts: { fromDate?: string; toDate?: string } = {}
): Promise<SyncResult> {
  const db = getSql();
  const snapDate = opts.toDate ?? new Date().toISOString().slice(0, 10);
  let upserted = 0, pages = 0, offset = 0;

  try {
    while (true) {
      const lo = offset + 1, hi = offset + PAGE;

      let inner: string;
      if (!def.dateCol || def.snapshot) {
        inner = `SELECT * FROM ${def.name}`;
      } else {
        const from = opts.fromDate
          ? `AND ${def.dateCol} >= TO_DATE('${opts.fromDate}','YYYY-MM-DD')` : "";
        const to = opts.toDate
          ? `AND ${def.dateCol} <= TO_DATE('${opts.toDate}','YYYY-MM-DD')` : "";
        inner = `SELECT * FROM ${def.name} WHERE 1=1 ${from} ${to} ORDER BY ${def.dateCol}`;
      }
      const pageSql = `SELECT * FROM (SELECT q.*, ROWNUM rn FROM (${inner}) q WHERE ROWNUM <= ${hi}) WHERE rn >= ${lo}`;

      const rows = await connectorFetch(pageSql);
      pages++;
      if (!rows.length) break;

      const batch = rows.map((row, i) => ({
        source_table: def.name,
        source_key:   rowKey(row, def, snapDate, offset + i),
        fy:           fiscalYear(row, def),
        data:         row,
      }));

      await db`
        INSERT INTO oracle_raw (source_table, source_key, fy, data)
        SELECT r.source_table, r.source_key, r.fy::smallint, r.data::jsonb
        FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb)
          AS r(source_table text, source_key text, fy int, data jsonb)
        ON CONFLICT (source_table, source_key)
        DO UPDATE SET data = EXCLUDED.data, synced_at = NOW(),
                      fy   = COALESCE(EXCLUDED.fy, oracle_raw.fy)
      `;
      upserted += batch.length;

      if (rows.length < PAGE) break;
      offset += PAGE;
      await sleep(PAGE_DELAY);
    }
  } catch (err) {
    return { table: def.name, label: def.label, upserted, pages, error: String(err) };
  }

  return { table: def.name, label: def.label, upserted, pages };
}

// ── Log helpers ──────────────────────────────────────────────────────────────

export async function logSync(
  mode: string,
  table: string | null,
  fromDate: string | null,
  toDate: string | null
): Promise<number> {
  const db = getSql();
  const [row] = await db<[{ id: number }]>`
    INSERT INTO oracle_sync_log (mode, source_table, from_date, to_date)
    VALUES (${mode}, ${table}, ${fromDate}, ${toDate})
    RETURNING id
  `;
  return row.id;
}

export async function finishLog(
  id: number,
  rowsUpserted: number,
  durationMs: number,
  error?: string
): Promise<void> {
  const db = getSql();
  await db`
    UPDATE oracle_sync_log
    SET rows_upserted = ${rowsUpserted},
        duration_ms   = ${durationMs},
        status        = ${error ? "error" : "done"},
        error         = ${error ?? null}
    WHERE id = ${id}
  `;
}
