import "server-only";
import { getSql } from "./db";
import { createPo } from "./po-engine";

// ── Purchase quotation → approval → indent → PO ──────────────────────────────
// Flow (per the client's process):
//   1. Purchase head raises a QUOTATION for items needed by a department, enters
//      each vendor's quote (price / credit days / delivery lead days) per item and
//      picks the recommended vendor per line. Submits for approval.
//   2. ADMIN reviews the comparison and approves/rejects. On approval an INDENT is
//      created from the selected quotes, and PO(s) are generated from the indent
//      (grouped by vendor, reusing createPo()).
// All tables are runtime-ensured (kept out of db:push via tablesFilter).

export type QuoStatus = "draft" | "pending" | "approved" | "rejected" | "ordered";

let ensured: Promise<void> | null = null;
export function ensureQuotationTables(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS quotations (
        id serial PRIMARY KEY,
        quo_no text UNIQUE,
        department text DEFAULT '',
        title text DEFAULT '',
        status text DEFAULT 'draft',
        note text DEFAULT '',
        created_by text, created_at timestamptz DEFAULT now(),
        submitted_at timestamptz,
        decided_by text, decided_at timestamptz, decision_note text DEFAULT '',
        indent_id integer
      )`;
      await sql`CREATE TABLE IF NOT EXISTS quotation_lines (
        id serial PRIMARY KEY,
        quotation_id integer NOT NULL,
        sku_id integer, item_name text DEFAULT '', qty double precision DEFAULT 1,
        uom text DEFAULT 'PCS',
        selected_quote_id integer
      )`;
      await sql`CREATE TABLE IF NOT EXISTS quotation_quotes (
        id serial PRIMARY KEY,
        line_id integer NOT NULL,
        vendor_id integer,
        unit_price double precision DEFAULT 0,
        credit_days integer DEFAULT 0,
        lead_days integer DEFAULT 0,
        moq double precision DEFAULT 0,
        note text DEFAULT ''
      )`;
      await sql`CREATE TABLE IF NOT EXISTS indents (
        id serial PRIMARY KEY,
        indent_no text UNIQUE,
        quotation_id integer,
        status text DEFAULT 'open',
        created_by text, created_at timestamptz DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS indent_lines (
        id serial PRIMARY KEY,
        indent_id integer NOT NULL,
        sku_id integer, item_name text DEFAULT '', qty double precision DEFAULT 1,
        vendor_id integer, unit_price double precision DEFAULT 0,
        credit_days integer DEFAULT 0, lead_days integer DEFAULT 0,
        po_id integer
      )`;
      await sql`CREATE INDEX IF NOT EXISTS quotation_lines_q_idx ON quotation_lines (quotation_id)`;
      await sql`CREATE INDEX IF NOT EXISTS quotation_quotes_l_idx ON quotation_quotes (line_id)`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

async function nextNo(prefix: string, table: string, col: string): Promise<string> {
  const sql = getSql();
  const [{ n }] = (await sql.unsafe(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(${col}, '\\D', '', 'g'), ''))::int, 0) + 1 AS n FROM ${table}`,
  )) as unknown as { n: number }[];
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

// ── Quotation reads ──────────────────────────────────────────────────────────
export interface QuotationRow {
  id: number; quo_no: string; department: string; title: string; status: QuoStatus;
  note: string; created_by: string; created_at: string; decided_by: string | null;
  decision_note: string; indent_id: number | null; lines: number; vendors: number;
}
export async function listQuotations(status?: string): Promise<QuotationRow[]> {
  await ensureQuotationTables();
  const sql = getSql();
  const st = status && status !== "all" ? status : null;
  return (await sql`
    SELECT q.*, to_char(q.created_at,'YYYY-MM-DD HH24:MI') AS created_at,
      (SELECT count(*)::int FROM quotation_lines l WHERE l.quotation_id=q.id) AS lines,
      (SELECT count(DISTINCT vendor_id)::int FROM quotation_quotes qq
         JOIN quotation_lines l ON l.id=qq.line_id WHERE l.quotation_id=q.id) AS vendors
    FROM quotations q
    WHERE (${st}::text IS NULL OR q.status=${st})
    ORDER BY q.id DESC`) as unknown as QuotationRow[];
}

export interface QuoteRow {
  id: number; line_id: number; vendor_id: number; vendor_name: string;
  unit_price: number; credit_days: number; lead_days: number; moq: number; note: string;
}
export interface QuoLineRow {
  id: number; sku_id: number | null; sku_code: string | null; item_name: string;
  qty: number; uom: string; selected_quote_id: number | null; quotes: QuoteRow[];
}
export async function getQuotation(id: number): Promise<{ quo: QuotationRow; lines: QuoLineRow[] } | null> {
  await ensureQuotationTables();
  const sql = getSql();
  const [quo] = (await sql`SELECT q.*, to_char(q.created_at,'YYYY-MM-DD HH24:MI') AS created_at,
      to_char(q.decided_at,'YYYY-MM-DD HH24:MI') AS decided_at FROM quotations q WHERE id=${id}`) as unknown as QuotationRow[];
  if (!quo) return null;
  const lines = (await sql`
    SELECT l.*, s.sku_code
    FROM quotation_lines l LEFT JOIN skus s ON s.id=l.sku_id
    WHERE l.quotation_id=${id} ORDER BY l.id`) as unknown as QuoLineRow[];
  const quotes = (await sql`
    SELECT qq.*, COALESCE(v.name,'—') AS vendor_name
    FROM quotation_quotes qq
    JOIN quotation_lines l ON l.id=qq.line_id
    LEFT JOIN vendors v ON v.id=qq.vendor_id
    WHERE l.quotation_id=${id} ORDER BY qq.unit_price NULLS LAST, qq.id`) as unknown as QuoteRow[];
  for (const l of lines) l.quotes = quotes.filter((q) => q.line_id === l.id);
  return { quo, lines };
}

// ── Quotation writes ─────────────────────────────────────────────────────────
export async function createQuotation(input: { department: string; title: string; createdBy: string }): Promise<{ id: number; quoNo: string }> {
  await ensureQuotationTables();
  const sql = getSql();
  const quoNo = await nextNo("QUO", "quotations", "quo_no");
  const [row] = (await sql`INSERT INTO quotations (quo_no, department, title, status, created_by)
    VALUES (${quoNo}, ${input.department || ""}, ${input.title || ""}, 'draft', ${input.createdBy})
    RETURNING id`) as unknown as { id: number }[];
  return { id: row.id, quoNo };
}

export async function addLine(quotationId: number, l: { skuId?: number | null; itemName: string; qty: number; uom?: string }): Promise<void> {
  await ensureQuotationTables();
  await getSql()`INSERT INTO quotation_lines (quotation_id, sku_id, item_name, qty, uom)
    VALUES (${quotationId}, ${l.skuId ?? null}, ${l.itemName || ""}, ${Math.max(0, l.qty) || 1}, ${l.uom || "PCS"})`;
}
export async function deleteLine(lineId: number): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM quotation_quotes WHERE line_id=${lineId}`;
  await sql`DELETE FROM quotation_lines WHERE id=${lineId}`;
}
export async function addQuote(lineId: number, q: { vendorId: number; unitPrice: number; creditDays: number; leadDays: number; moq?: number; note?: string }): Promise<void> {
  await ensureQuotationTables();
  await getSql()`INSERT INTO quotation_quotes (line_id, vendor_id, unit_price, credit_days, lead_days, moq, note)
    VALUES (${lineId}, ${q.vendorId}, ${q.unitPrice || 0}, ${q.creditDays || 0}, ${q.leadDays || 0}, ${q.moq || 0}, ${q.note || ""})`;
}
export async function deleteQuote(quoteId: number): Promise<void> {
  const sql = getSql();
  await sql`UPDATE quotation_lines SET selected_quote_id=NULL WHERE selected_quote_id=${quoteId}`;
  await sql`DELETE FROM quotation_quotes WHERE id=${quoteId}`;
}
export async function selectQuote(lineId: number, quoteId: number): Promise<void> {
  await getSql()`UPDATE quotation_lines SET selected_quote_id=${quoteId} WHERE id=${lineId}`;
}

export async function submitForApproval(quotationId: number): Promise<{ ok: boolean; error?: string }> {
  await ensureQuotationTables();
  const sql = getSql();
  const data = await getQuotation(quotationId);
  if (!data) return { ok: false, error: "Quotation not found." };
  if (data.lines.length === 0) return { ok: false, error: "Add at least one item." };
  const unpicked = data.lines.filter((l) => !l.selected_quote_id);
  if (unpicked.length) return { ok: false, error: `Pick a vendor for every item (${unpicked.length} still unselected).` };
  await sql`UPDATE quotations SET status='pending', submitted_at=now() WHERE id=${quotationId}`;
  return { ok: true };
}

// Admin decision. On approve → create indent + indent_lines from selected quotes.
export async function decideQuotation(quotationId: number, approve: boolean, note: string, actor: string): Promise<{ ok: boolean; error?: string; indentNo?: string }> {
  await ensureQuotationTables();
  const sql = getSql();
  const data = await getQuotation(quotationId);
  if (!data) return { ok: false, error: "Quotation not found." };
  if (data.quo.status !== "pending") return { ok: false, error: `Quotation is '${data.quo.status}', not awaiting approval.` };

  if (!approve) {
    await sql`UPDATE quotations SET status='rejected', decided_by=${actor}, decided_at=now(), decision_note=${note || ""} WHERE id=${quotationId}`;
    return { ok: true };
  }

  const indentNo = await nextNo("IND", "indents", "indent_no");
  const [ind] = (await sql`INSERT INTO indents (indent_no, quotation_id, status, created_by)
    VALUES (${indentNo}, ${quotationId}, 'open', ${actor}) RETURNING id`) as unknown as { id: number }[];
  for (const l of data.lines) {
    const q = l.quotes.find((x) => x.id === l.selected_quote_id);
    if (!q) continue;
    await sql`INSERT INTO indent_lines (indent_id, sku_id, item_name, qty, vendor_id, unit_price, credit_days, lead_days)
      VALUES (${ind.id}, ${l.sku_id ?? null}, ${l.item_name || ""}, ${l.qty}, ${q.vendor_id}, ${q.unit_price}, ${q.credit_days}, ${q.lead_days})`;
  }
  await sql`UPDATE quotations SET status='approved', decided_by=${actor}, decided_at=now(), decision_note=${note || ""}, indent_id=${ind.id} WHERE id=${quotationId}`;
  return { ok: true, indentNo };
}

// ── Indents ──────────────────────────────────────────────────────────────────
export interface IndentRow {
  id: number; indent_no: string; quotation_id: number; quo_no: string | null;
  status: string; created_by: string; created_at: string; lines: number; vendors: number; ordered: number;
}
export async function listIndents(): Promise<IndentRow[]> {
  await ensureQuotationTables();
  const sql = getSql();
  return (await sql`
    SELECT i.*, to_char(i.created_at,'YYYY-MM-DD HH24:MI') AS created_at, q.quo_no,
      (SELECT count(*)::int FROM indent_lines il WHERE il.indent_id=i.id) AS lines,
      (SELECT count(DISTINCT vendor_id)::int FROM indent_lines il WHERE il.indent_id=i.id) AS vendors,
      (SELECT count(*)::int FROM indent_lines il WHERE il.indent_id=i.id AND il.po_id IS NOT NULL) AS ordered
    FROM indents i LEFT JOIN quotations q ON q.id=i.quotation_id
    ORDER BY i.id DESC`) as unknown as IndentRow[];
}
export interface IndentLineRow {
  id: number; sku_id: number | null; sku_code: string | null; item_name: string; qty: number;
  vendor_id: number; vendor_name: string; unit_price: number; credit_days: number; lead_days: number;
  po_id: number | null; po_no: string | null;
}
export async function getIndent(id: number): Promise<{ ind: IndentRow; lines: IndentLineRow[] } | null> {
  await ensureQuotationTables();
  const sql = getSql();
  const [ind] = (await sql`SELECT i.*, to_char(i.created_at,'YYYY-MM-DD HH24:MI') AS created_at, q.quo_no
    FROM indents i LEFT JOIN quotations q ON q.id=i.quotation_id WHERE i.id=${id}`) as unknown as IndentRow[];
  if (!ind) return null;
  const lines = (await sql`
    SELECT il.*, s.sku_code, COALESCE(v.name,'—') AS vendor_name, po.po_no
    FROM indent_lines il
    LEFT JOIN skus s ON s.id=il.sku_id
    LEFT JOIN vendors v ON v.id=il.vendor_id
    LEFT JOIN purchase_orders po ON po.id=il.po_id
    WHERE il.indent_id=${id} ORDER BY il.vendor_id, il.id`) as unknown as IndentLineRow[];
  return { ind, lines };
}

// Generate PO(s) from an indent: group not-yet-ordered lines by vendor, one PO each.
export async function generatePOsFromIndent(indentId: number, userId: number): Promise<{ ok: boolean; error?: string; pos: { poNo: string; total: number; lines: number }[] }> {
  await ensureQuotationTables();
  const sql = getSql();
  const data = await getIndent(indentId);
  if (!data) return { ok: false, error: "Indent not found.", pos: [] };
  const pending = data.lines.filter((l) => !l.po_id && l.sku_id && l.qty > 0);
  if (pending.length === 0) return { ok: false, error: "Nothing left to order (lines need a linked SKU).", pos: [] };

  const byVendor = new Map<number, IndentLineRow[]>();
  for (const l of pending) { (byVendor.get(l.vendor_id) ?? byVendor.set(l.vendor_id, []).get(l.vendor_id)!).push(l); }

  const pos: { poNo: string; total: number; lines: number }[] = [];
  for (const [vendorId, lines] of byVendor) {
    const res = await createPo(vendorId, lines.map((l) => ({ skuId: l.sku_id!, qty: l.qty, price: l.unit_price })), userId);
    const [po] = (await sql`SELECT id FROM purchase_orders WHERE po_no=${res.poNo}`) as unknown as { id: number }[];
    if (po) for (const l of lines) await sql`UPDATE indent_lines SET po_id=${po.id} WHERE id=${l.id}`;
    pos.push(res);
  }
  const [{ left }] = (await sql`SELECT count(*)::int AS left FROM indent_lines WHERE indent_id=${indentId} AND po_id IS NULL AND sku_id IS NOT NULL`) as unknown as { left: number }[];
  await sql`UPDATE indents SET status=${left > 0 ? "partial" : "ordered"} WHERE id=${indentId}`;
  if (data.ind.quotation_id) await sql`UPDATE quotations SET status='ordered' WHERE id=${data.ind.quotation_id} AND status='approved'`;
  return { ok: true, pos };
}
