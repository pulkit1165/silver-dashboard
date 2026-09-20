import "server-only";
import type { Sql } from "postgres";
import { getSql } from "./db";
import {
  computeInvoice,
  resolveDiscountPct,
  amountInWords,
  type LineInput,
  type ComputedLine,
} from "./invoice-engine";

// ── Types ──────────────────────────────────────────────────────────────────
export interface InvoiceRow {
  id: number;
  invoice_no: string | null;
  status: string;
  so_id: number | null;
  customer_id: number | null;
  buyer_name: string;
  buyer_gstin: string;
  buyer_state_code: string;
  buyer_address: string;
  buyer_phone: string;
  buyer_po_no: string;
  pos_state_code: string;
  seller_state_code: string;
  tax_type: string;
  invoice_date: string | null;
  mrp_total: number;
  discount_total: number;
  taxable_total: number;
  igst: number;
  cgst: number;
  sgst: number;
  round_off: number;
  grand_total: number;
  transporter: string;
  transporter_id: string;
  vehicle_no: string;
  lr_no: string;
  lr_date: string;
  distance_km: number | null;
  freight_term: string;
  pvt_mark: string;
  case_count: number | null;
  booked_by: string;
  notes: string;
  irn: string;
  ack_no: string;
  ack_date: string;
  qr_payload: string;
  ewb_no: string;
  ewb_valid_until: string;
  created_by: string | null;
  created_at: string;
}

export interface InvoiceLineRow {
  id: number;
  invoice_id: number;
  so_line_id: number | null;
  sku_id: number | null;
  sku_code: string | null;
  description: string | null;
  hsn: string;
  unit: string;
  case_no: string;
  qty: number;
  mrp: number;
  discount_pct: number;
  taxable_value: number;
  gst_rate: number;
  igst: number;
  cgst: number;
  sgst: number;
  line_total: number;
}

export interface CompanySettings {
  id: number;
  legal_name: string;
  trade_name: string;
  gstin: string;
  state_code: string;
  address: string;
  city: string;
  pincode: string;
  phone: string;
  email: string;
  msme_no: string;
  bank_name: string;
  bank_account: string;
  bank_ifsc: string;
  bank_branch: string;
  invoice_prefix: string;
  invoice_next_no: number;
  terms: string;
  ewb_threshold: number;
  // When true, packing blocks an item whose ERP inventory is short (have < need).
  // Default false — the ERP stock ledger isn't maintained yet, so packing is not
  // gated on it; flip to true once opening stock is loaded / inward is recorded.
  enforce_pack_stock: boolean;
}

// Real SILVER INDUSTRIES seller identity (from the client's GST tax invoice).
// These double as the fallback for any field left blank in company_settings, so
// the printed invoice header/bank block is always correct even before the
// Company Settings screen is filled in on a fresh environment.
const COMPANY_DEFAULT: CompanySettings = {
  id: 1,
  legal_name: "SILVER INDUSTRIES",
  trade_name: "SILVER UP AUTO PARTS",
  gstin: "03ADRFS1695R1Z3",
  state_code: "03",
  address: "B-29-105/1, Zone-C, Oswal Complex, (Adj. Oswal Woolen Mills), Giaspura Road, G.T. Road",
  city: "Ludhiana",
  pincode: "141010",
  phone: "+91-161-5196409, 4678630",
  email: "silverup.ldh@gmail.com",
  msme_no: "PB-12-0003106",
  bank_name: "HDFC BANK LTD.",
  bank_account: "50200032797094",
  bank_ifsc: "HDFC0000634",
  bank_branch: "FEROZE GANDHI MARKET, LUDHIANA",
  invoice_prefix: "GC26/",
  invoice_next_no: 1,
  terms:
    "1. Goods once sold will not be taken back.\n" +
    "2. Subject to Ludhiana jurisdiction only.\n" +
    "3. 18% interest will be charged if the bill is not paid within 30 days.",
  ewb_threshold: 50000,
  enforce_pack_stock: false,
};

// ── Company settings ─────────────────────────────────────────────────────────
// GST billing added ewb_threshold after the original db:push for this module;
// the local/prod DB may predate it, so self-migrate idempotently (mirrors
// ensureCustomerCols() in queries.ts) instead of requiring another db:push.
let companySettingsColsEnsured = false;
async function ensureCompanySettingsCols() {
  if (companySettingsColsEnsured) return;
  try {
    await getSql().unsafe(`ALTER TABLE company_settings
      ADD COLUMN IF NOT EXISTS ewb_threshold double precision DEFAULT 50000,
      ADD COLUMN IF NOT EXISTS enforce_pack_stock boolean DEFAULT false`);
    companySettingsColsEnsured = true;
  } catch { /* ignore */ }
}

// Matching the real legacy invoice layout (buyer address/phone/PO no, GR/freight/
// case-mark/booked-by, e-invoice ack date + QR payload) added several fields
// after the original db:push — same self-migration story as ewb_threshold above.
let invoiceExtraColsEnsured = false;
async function ensureInvoiceExtraCols() {
  if (invoiceExtraColsEnsured) return;
  try {
    await getSql().unsafe(`ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS buyer_address text DEFAULT '',
      ADD COLUMN IF NOT EXISTS buyer_phone text DEFAULT '',
      ADD COLUMN IF NOT EXISTS buyer_po_no text DEFAULT '',
      ADD COLUMN IF NOT EXISTS freight_term text DEFAULT '',
      ADD COLUMN IF NOT EXISTS pvt_mark text DEFAULT '',
      ADD COLUMN IF NOT EXISTS case_count integer,
      ADD COLUMN IF NOT EXISTS booked_by text DEFAULT '',
      ADD COLUMN IF NOT EXISTS ack_date text DEFAULT '',
      ADD COLUMN IF NOT EXISTS qr_payload text DEFAULT ''`);
    invoiceExtraColsEnsured = true;
  } catch { /* ignore */ }
}

export async function getCompanySettings(): Promise<CompanySettings> {
  await ensureCompanySettingsCols();
  const [row] = await getSql()`SELECT * FROM company_settings ORDER BY id LIMIT 1`;
  if (!row) return COMPANY_DEFAULT;
  // Fill any blank/missing field from the known SILVER INDUSTRIES defaults, so a
  // partially-seeded settings row still prints a complete invoice header + bank
  // block (real values entered on the Company Settings screen always win).
  const merged: Record<string, unknown> = { ...COMPANY_DEFAULT };
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (v !== null && v !== undefined && v !== "") merged[k] = v;
  }
  return merged as unknown as CompanySettings;
}

export async function saveCompanySettings(patch: Partial<CompanySettings>): Promise<void> {
  await ensureCompanySettingsCols();
  const sql = getSql();
  const cur = await getCompanySettings();
  const next = { ...cur, ...patch };
  await sql`
    INSERT INTO company_settings (id, legal_name, trade_name, gstin, state_code, address, city,
      pincode, phone, email, msme_no, bank_name, bank_account, bank_ifsc, bank_branch,
      invoice_prefix, invoice_next_no, terms, ewb_threshold, enforce_pack_stock)
    VALUES (1, ${next.legal_name}, ${next.trade_name}, ${next.gstin}, ${next.state_code},
      ${next.address}, ${next.city}, ${next.pincode}, ${next.phone}, ${next.email}, ${next.msme_no},
      ${next.bank_name}, ${next.bank_account}, ${next.bank_ifsc}, ${next.bank_branch},
      ${next.invoice_prefix}, ${next.invoice_next_no}, ${next.terms}, ${next.ewb_threshold},
      ${next.enforce_pack_stock ?? false})
    ON CONFLICT (id) DO UPDATE SET
      legal_name=EXCLUDED.legal_name, trade_name=EXCLUDED.trade_name, gstin=EXCLUDED.gstin,
      state_code=EXCLUDED.state_code, address=EXCLUDED.address, city=EXCLUDED.city,
      pincode=EXCLUDED.pincode, phone=EXCLUDED.phone, email=EXCLUDED.email, msme_no=EXCLUDED.msme_no,
      bank_name=EXCLUDED.bank_name, bank_account=EXCLUDED.bank_account, bank_ifsc=EXCLUDED.bank_ifsc,
      bank_branch=EXCLUDED.bank_branch, invoice_prefix=EXCLUDED.invoice_prefix,
      invoice_next_no=EXCLUDED.invoice_next_no, terms=EXCLUDED.terms, ewb_threshold=EXCLUDED.ewb_threshold,
      enforce_pack_stock=EXCLUDED.enforce_pack_stock`;
}

// ── List / read ──────────────────────────────────────────────────────────────
export interface InvoiceFilter { party?: string; from?: string; to?: string; status?: string }
export async function listInvoices(f: InvoiceFilter = {}) {
  const sql = getSql();
  const party = f.party?.trim() ? `%${f.party.trim()}%` : null;
  return (await sql`
    SELECT i.id, i.invoice_no, i.status, i.invoice_date, i.buyer_name, i.tax_type,
           i.grand_total, i.so_id, so.so_no, i.created_at
    FROM invoices i
    LEFT JOIN sales_orders so ON so.id = i.so_id
    WHERE (${party}::text IS NULL OR i.buyer_name ILIKE ${party})
      AND (${f.from ?? null}::text IS NULL OR i.invoice_date >= ${f.from ?? null})
      AND (${f.to ?? null}::text IS NULL OR i.invoice_date <= ${f.to ?? null})
      AND (${f.status ?? null}::text IS NULL OR i.status = ${f.status ?? null})
    ORDER BY i.id DESC LIMIT 200`) as unknown as Array<
    Pick<InvoiceRow, "id" | "invoice_no" | "status" | "invoice_date" | "buyer_name" | "tax_type" | "grand_total" | "so_id" | "created_at"> & { so_no: string | null }
  >;
}

export interface InvoiceFull {
  invoice: InvoiceRow;
  lines: InvoiceLineRow[];
  company: CompanySettings;
  amountInWords: string;
}

export async function getInvoiceFull(idOrNo: string | number): Promise<InvoiceFull | undefined> {
  await ensureInvoiceExtraCols();
  const sql = getSql();
  const byId = typeof idOrNo === "number" || /^\d+$/.test(String(idOrNo));
  const [invoice] = byId
    ? await sql`SELECT * FROM invoices WHERE id=${Number(idOrNo)}`
    : await sql`SELECT * FROM invoices WHERE invoice_no=${String(idOrNo)}`;
  if (!invoice) return undefined;
  const inv = invoice as InvoiceRow;
  const lines = (await sql`SELECT * FROM invoice_lines WHERE invoice_id=${inv.id} ORDER BY id`) as unknown as InvoiceLineRow[];
  const company = await getCompanySettings();
  return { invoice: inv, lines, company, amountInWords: amountInWords(inv.grand_total) };
}

// ── Build a draft from a sales order's dispatched-but-uninvoiced qty ──────────
interface DraftLine extends LineInput {
  skuCode: string;
  description: string;
}

async function gatherDraft(sql: Sql, soId: number) {
  const [so] = (await sql`
    SELECT so.id, so.so_no, c.id AS customer_id, c.name AS customer_name, c.gst AS buyer_gstin,
           c.state_code AS buyer_state_code, c.pos_state_code, c.discount_class_id, c.discount_pct,
           c.billing AS buyer_address, c.phone AS buyer_phone
    FROM sales_orders so JOIN customers c ON c.id = so.customer_id
    WHERE so.id = ${soId}`) as unknown as Array<{
    id: number; so_no: string; customer_id: number; customer_name: string; buyer_gstin: string | null;
    buyer_state_code: string | null; pos_state_code: string | null; discount_class_id: number | null;
    discount_pct: number | null; buyer_address: string | null; buyer_phone: string | null;
  }>;
  if (!so) return undefined;

  // Discount class context.
  let classWholeOrderPct: number | null = null;
  const classSkuPct = new Map<number, number>();
  if (so.discount_class_id) {
    const [dc] = (await sql`SELECT whole_order_pct FROM discount_classes WHERE id=${so.discount_class_id}`) as unknown as Array<{ whole_order_pct: number }>;
    classWholeOrderPct = dc?.whole_order_pct ?? null;
    const overrides = (await sql`SELECT sku_id, pct FROM discount_class_skus WHERE class_id=${so.discount_class_id}`) as unknown as Array<{ sku_id: number; pct: number }>;
    for (const o of overrides) classSkuPct.set(o.sku_id, o.pct);
  }

  // Billable lines = qty on VERIFIED delivery orders - already-invoiced (> 0).
  // A Delivery Order (packed case) has to be verified before it counts.
  const rows = (await sql`
    SELECT l.id AS so_line_id, l.sku_id,
           GREATEST(COALESCE(vp.verified_qty,0) - COALESCE(l.invoiced_qty,0), 0) AS billable,
           s.sku_code, s.name AS description, s.price AS mrp, s.hsn, s.unit, s.gst_rate
    FROM so_lines l JOIN skus s ON s.id = l.sku_id
    LEFT JOIN (
      SELECT pl.so_line_id, SUM(pl.qty)::float8 AS verified_qty
      FROM package_lines pl JOIN packages p ON p.id = pl.package_id
      WHERE p.status = 'verified'
      GROUP BY pl.so_line_id
    ) vp ON vp.so_line_id = l.id
    WHERE l.so_id = ${soId}
      -- Retailer (K) lines are billed by the other firm, never here.
      AND NOT COALESCE(l.is_k, false)
      AND COALESCE((SELECT bill_type FROM sales_orders WHERE id = ${soId}), '') <> 'K'
    ORDER BY l.id`) as unknown as Array<{
    so_line_id: number; sku_id: number; billable: number; sku_code: string; description: string;
    mrp: number; hsn: string; unit: string; gst_rate: number;
  }>;

  const posStateCode = (so.pos_state_code || so.buyer_state_code || "").trim();
  const draftLines: DraftLine[] = rows
    .filter((r) => r.billable > 0)
    .map((r) => ({
      skuId: r.sku_id,
      soLineId: r.so_line_id,
      skuCode: r.sku_code,
      description: r.description,
      hsn: r.hsn ?? "",
      unit: r.unit ?? "PCS",
      qty: r.billable,
      mrp: r.mrp ?? 0,
      gstRate: r.gst_rate ?? 18,
      discountPct: resolveDiscountPct({
        skuId: r.sku_id,
        customerPct: so.discount_pct,
        classWholeOrderPct,
        classSkuPct,
      }),
    }));

  return { so, posStateCode, draftLines };
}

/**
 * The TRUE billable qty on a sales order: qty on VERIFIED delivery orders minus
 * already-invoiced, excluding K/retailer lines — i.e. exactly what
 * createDraftFromSalesOrder would bill. The "Bill" button should gate on this
 * (not on dispatched qty), so it never appears when there's nothing to invoice.
 */
export async function getSoBillableQty(soId: number): Promise<number> {
  const sql = getSql();
  const [row] = (await sql`
    SELECT COALESCE(SUM(GREATEST(COALESCE(vp.verified_qty,0) - COALESCE(l.invoiced_qty,0), 0)), 0)::float8 AS billable
    FROM so_lines l
    LEFT JOIN (
      SELECT pl.so_line_id, SUM(pl.qty)::float8 AS verified_qty
      FROM package_lines pl JOIN packages p ON p.id = pl.package_id
      WHERE p.status = 'verified'
      GROUP BY pl.so_line_id
    ) vp ON vp.so_line_id = l.id
    WHERE l.so_id = ${soId}
      AND NOT COALESCE(l.is_k, false)
      AND COALESCE((SELECT bill_type FROM sales_orders WHERE id = ${soId}), '') <> 'K'`) as unknown as Array<{ billable: number }>;
  return Number(row?.billable) || 0;
}

/**
 * Create a persisted DRAFT invoice from a sales order. Pulls every line that
 * has dispatched qty not yet invoiced; the undispatched balance is untouched
 * and remains a pending SO line. Returns null if nothing is billable.
 */
export async function createDraftFromSalesOrder(
  soId: number,
  opts: { createdBy?: string | null; packingSlipId?: number | null } = {},
): Promise<{ id: number } | { error: string }> {
  await ensureInvoiceExtraCols();
  const sql = getSql();
  const company = await getCompanySettings();

  return await sql.begin(async (tx) => {
    const g = await gatherDraft(tx as unknown as Sql, soId);
    if (!g) return { error: "Sales order not found." };
    if (g.draftLines.length === 0) {
      return { error: "Nothing to invoice — no dispatched qty remaining on this order." };
    }

    const computed = computeInvoice(g.draftLines, {
      sellerStateCode: company.state_code,
      posStateCode: g.posStateCode,
    });

    const [inv] = await tx`
      INSERT INTO invoices (status, so_id, packing_slip_id, customer_id, seller_state_code,
        buyer_name, buyer_gstin, buyer_state_code, buyer_address, buyer_phone, pos_state_code,
        tax_type, invoice_date, discount_class_id, mrp_total, discount_total, taxable_total,
        igst, cgst, sgst, round_off, grand_total, created_by)
      VALUES ('draft', ${soId}, ${opts.packingSlipId ?? null}, ${g.so.customer_id},
        ${company.state_code}, ${g.so.customer_name}, ${g.so.buyer_gstin ?? ""},
        ${g.so.buyer_state_code ?? ""}, ${g.so.buyer_address ?? ""}, ${g.so.buyer_phone ?? ""},
        ${g.posStateCode}, ${computed.taxType},
        ${today()}, ${g.so.discount_class_id ?? null}, ${computed.mrpTotal}, ${computed.discountTotal},
        ${computed.taxableTotal}, ${computed.igst}, ${computed.cgst}, ${computed.sgst},
        ${computed.roundOff}, ${computed.grandTotal}, ${opts.createdBy ?? null})
      RETURNING id`;
    const invoiceId = (inv as { id: number }).id;

    await insertLines(tx as unknown as Sql, invoiceId, computed.lines, g.draftLines);
    return { id: invoiceId };
  });
}

/**
 * Create a DRAFT invoice DIRECTLY from a packing slip that has NO Sales Order —
 * a "manual" slip (party + dispatched lines). Prices each line at the party's
 * standing discount off MRP (no SO/net-rate overrides), computes GST, and stores an
 * SO-less invoice (so_id NULL, so_line_id NULL — both are guarded downstream). Used
 * for slips whose so_no doesn't resolve to a Sales Order.
 */
export async function createDraftFromPackingSlip(opts: {
  packingSlipId: number;
  party: string;
  lines: Array<{ code: string; qty: number; mrp?: number; unit?: string; desc?: string }>;
  createdBy?: string | null;
}): Promise<{ id: number } | { error: string }> {
  await ensureInvoiceExtraCols();
  const sql = getSql();
  const company = await getCompanySettings();
  const party = (opts.party || "").trim();
  if (!party) return { error: "This slip has no party/customer to bill." };

  const [cust] = (await sql`
    SELECT id, name, gst, state_code, pos_state_code, COALESCE(discount_pct,0)::float8 AS discount_pct,
           billing, phone
      FROM customers WHERE name = ${party} OR name ILIKE ${party}
     ORDER BY (name = ${party}) DESC LIMIT 1`) as unknown as Array<{
    id: number; name: string; gst: string | null; state_code: string | null; pos_state_code: string | null;
    discount_pct: number; billing: string | null; phone: string | null;
  }>;
  if (!cust) return { error: `Customer "${party}" isn't in the master — add them first, then bill.` };

  const wanted = opts.lines.filter((l) => l.code && l.qty > 0);
  if (!wanted.length) return { error: "This slip has no dispatched quantities to bill." };
  const codes = Array.from(new Set(wanted.map((l) => l.code.toUpperCase())));
  const skuRows = (await sql`
    SELECT id, upper(sku_code) AS code, name, COALESCE(price,0)::float8 AS price, hsn, unit, COALESCE(gst_rate,18)::float8 AS gst_rate
      FROM skus WHERE upper(sku_code) = ANY(${codes})`) as unknown as
    Array<{ id: number; code: string; name: string; price: number; hsn: string | null; unit: string | null; gst_rate: number }>;
  const byCode = new Map(skuRows.map((s) => [s.code, s]));

  const disc = Number(cust.discount_pct) || 0;
  const draftLines: DraftLine[] = [];
  for (const l of wanted) {
    const s = byCode.get(l.code.toUpperCase());
    if (!s) continue; // item not in the SKU master → skip (reported by count mismatch)
    draftLines.push({
      skuId: s.id, skuCode: s.code, description: (l.desc || s.name || s.code),
      hsn: s.hsn ?? "", unit: l.unit || s.unit || "PCS",
      qty: l.qty, mrp: l.mrp && l.mrp > 0 ? l.mrp : s.price,
      gstRate: s.gst_rate ?? 18, discountPct: disc,
    });
  }
  if (!draftLines.length) return { error: "None of the slip's items are in the SKU master." };

  const posStateCode = (cust.pos_state_code || cust.state_code || "").trim();
  const computed = computeInvoice(draftLines, { sellerStateCode: company.state_code, posStateCode });

  return await sql.begin(async (tx) => {
    const [inv] = await tx`
      INSERT INTO invoices (status, so_id, packing_slip_id, customer_id, seller_state_code,
        buyer_name, buyer_gstin, buyer_state_code, buyer_address, buyer_phone, pos_state_code,
        tax_type, invoice_date, mrp_total, discount_total, taxable_total,
        igst, cgst, sgst, round_off, grand_total, created_by)
      VALUES ('draft', NULL, ${opts.packingSlipId}, ${cust.id}, ${company.state_code},
        ${cust.name}, ${cust.gst ?? ""}, ${cust.state_code ?? ""}, ${cust.billing ?? ""}, ${cust.phone ?? ""},
        ${posStateCode}, ${computed.taxType}, ${today()}, ${computed.mrpTotal}, ${computed.discountTotal},
        ${computed.taxableTotal}, ${computed.igst}, ${computed.cgst}, ${computed.sgst},
        ${computed.roundOff}, ${computed.grandTotal}, ${opts.createdBy ?? null})
      RETURNING id`;
    const invoiceId = (inv as { id: number }).id;
    await insertLines(tx as unknown as Sql, invoiceId, computed.lines, draftLines);
    return { id: invoiceId };
  });
}

async function insertLines(sql: Sql, invoiceId: number, computed: ComputedLine[], src: DraftLine[]) {
  for (let i = 0; i < computed.length; i++) {
    const l = computed[i];
    const s = src[i];
    await sql`
      INSERT INTO invoice_lines (invoice_id, so_line_id, sku_id, sku_code, description, hsn, unit,
        case_no, qty, mrp, discount_pct, taxable_value, gst_rate, igst, cgst, sgst, line_total)
      VALUES (${invoiceId}, ${s.soLineId ?? null}, ${l.skuId}, ${s.skuCode}, ${s.description},
        ${l.hsn ?? ""}, ${l.unit ?? "PCS"}, ${l.caseNo ?? ""}, ${l.qty}, ${l.mrp}, ${l.discountPct},
        ${l.taxableValue}, ${l.gstRate}, ${l.igst}, ${l.cgst}, ${l.sgst}, ${l.lineTotal})`;
  }
}

// ── Edit a draft (qty / discount overrides + header / transport) ─────────────
export interface InvoicePatch {
  posStateCode?: string;
  invoiceDate?: string;
  buyerAddress?: string;
  buyerPhone?: string;
  buyerPoNo?: string;
  transporter?: string;
  transporterId?: string;
  vehicleNo?: string;
  lrNo?: string;
  lrDate?: string;
  distanceKm?: number | null;
  freightTerm?: string;
  pvtMark?: string;
  caseCount?: number | null;
  bookedBy?: string;
  notes?: string;
  lines?: Array<{ id: number; qty?: number; discountPct?: number }>;
}

export async function updateDraftInvoice(id: number, patch: InvoicePatch): Promise<{ ok: true } | { error: string }> {
  await ensureInvoiceExtraCols();
  const sql = getSql();
  const company = await getCompanySettings();

  return await sql.begin(async (tx) => {
    const [inv] = (await tx`SELECT * FROM invoices WHERE id=${id}`) as unknown as InvoiceRow[];
    if (!inv) return { error: "Invoice not found." };
    if (inv.status !== "draft") return { error: "Only draft invoices can be edited." };

    const lines = (await tx`SELECT * FROM invoice_lines WHERE invoice_id=${id} ORDER BY id`) as unknown as InvoiceLineRow[];
    const edits = new Map((patch.lines ?? []).map((e) => [e.id, e]));

    const posStateCode = patch.posStateCode != null ? patch.posStateCode.trim() : inv.pos_state_code;

    const inputs: (LineInput & { _id: number })[] = lines.map((row) => {
      const e = edits.get(row.id);
      return {
        _id: row.id,
        skuId: row.sku_id ?? 0,
        skuCode: row.sku_code,
        description: row.description,
        hsn: row.hsn,
        unit: row.unit,
        caseNo: row.case_no,
        qty: e?.qty != null ? e.qty : row.qty,
        mrp: row.mrp,
        discountPct: e?.discountPct != null ? e.discountPct : row.discount_pct,
        gstRate: row.gst_rate,
        soLineId: row.so_line_id,
      };
    });

    const computed = computeInvoice(inputs, { sellerStateCode: company.state_code, posStateCode });

    for (let i = 0; i < computed.lines.length; i++) {
      const l = computed.lines[i];
      const rid = inputs[i]._id;
      await tx`
        UPDATE invoice_lines SET qty=${l.qty}, discount_pct=${l.discountPct},
          taxable_value=${l.taxableValue}, gst_rate=${l.gstRate}, igst=${l.igst},
          cgst=${l.cgst}, sgst=${l.sgst}, line_total=${l.lineTotal}
        WHERE id=${rid}`;
    }

    await tx`
      UPDATE invoices SET
        pos_state_code=${posStateCode}, tax_type=${computed.taxType},
        invoice_date=${patch.invoiceDate ?? inv.invoice_date},
        buyer_address=${patch.buyerAddress ?? inv.buyer_address},
        buyer_phone=${patch.buyerPhone ?? inv.buyer_phone},
        buyer_po_no=${patch.buyerPoNo ?? inv.buyer_po_no},
        transporter=${patch.transporter ?? inv.transporter},
        transporter_id=${patch.transporterId ?? inv.transporter_id},
        vehicle_no=${patch.vehicleNo ?? inv.vehicle_no},
        lr_no=${patch.lrNo ?? inv.lr_no}, lr_date=${patch.lrDate ?? inv.lr_date},
        distance_km=${patch.distanceKm !== undefined ? patch.distanceKm : inv.distance_km},
        freight_term=${patch.freightTerm ?? inv.freight_term},
        pvt_mark=${patch.pvtMark ?? inv.pvt_mark},
        case_count=${patch.caseCount !== undefined ? patch.caseCount : inv.case_count},
        booked_by=${patch.bookedBy ?? inv.booked_by},
        notes=${patch.notes ?? inv.notes},
        mrp_total=${computed.mrpTotal}, discount_total=${computed.discountTotal},
        taxable_total=${computed.taxableTotal}, igst=${computed.igst}, cgst=${computed.cgst},
        sgst=${computed.sgst}, round_off=${computed.roundOff}, grand_total=${computed.grandTotal}
      WHERE id=${id}`;

    return { ok: true as const };
  });
}

// ── Finalize: assign invoice no, advance invoiced_qty, lock the invoice ───────
export async function finalizeInvoice(id: number): Promise<{ ok: true; invoiceNo: string } | { error: string }> {
  const sql = getSql();
  return await sql.begin(async (tx) => {
    const [inv] = (await tx`SELECT * FROM invoices WHERE id=${id} FOR UPDATE`) as unknown as InvoiceRow[];
    if (!inv) return { error: "Invoice not found." };
    if (inv.status !== "draft") return { error: "Invoice is already finalized." };

    const lines = (await tx`SELECT * FROM invoice_lines WHERE invoice_id=${id}`) as unknown as InvoiceLineRow[];
    if (lines.length === 0) return { error: "Cannot finalize an empty invoice." };

    // Atomically take the next number from the company counter.
    const [cs] = (await tx`SELECT invoice_prefix, invoice_next_no FROM company_settings WHERE id=1 FOR UPDATE`) as unknown as Array<{ invoice_prefix: string; invoice_next_no: number }>;
    const prefix = cs?.invoice_prefix ?? "GC26/";
    const nextNo = cs?.invoice_next_no ?? 1;
    const invoiceNo = `${prefix}${nextNo}`;
    await tx`UPDATE company_settings SET invoice_next_no=${nextNo + 1} WHERE id=1`;

    await tx`UPDATE invoices SET status='final', invoice_no=${invoiceNo} WHERE id=${id}`;

    // Advance invoiced_qty on each source SO line so the qty can't be billed twice.
    for (const l of lines) {
      if (l.so_line_id) {
        await tx`UPDATE so_lines SET invoiced_qty = COALESCE(invoiced_qty,0) + ${l.qty} WHERE id=${l.so_line_id}`;
      }
    }
    // Stamp the SO with the (latest) invoice number for quick reference.
    if (inv.so_id) {
      await tx`UPDATE sales_orders SET invoice_no=${invoiceNo} WHERE id=${inv.so_id}`;
    }
    return { ok: true as const, invoiceNo };
  });
}

// ── e-Invoice (IRN/QR) — recorded manually for now ────────────────────────────
// Same story as the e-way bill: no GSP/API account, so this is filled in by
// hand once the accountant runs it through the existing Tally/Busy/Marg
// e-invoicing flow (or a future direct integration) — this just stores the
// result so it prints correctly (see [[erp-invoice-print-fidelity]]).
export async function saveEInvoiceDetails(
  id: number,
  input: { irn: string; ackNo: string; ackDate: string; qrPayload: string },
): Promise<{ ok: true } | { error: string }> {
  await ensureInvoiceExtraCols();
  const sql = getSql();
  const [inv] = await sql`
    UPDATE invoices SET irn=${input.irn.trim()}, ack_no=${input.ackNo.trim()},
      ack_date=${input.ackDate.trim()}, qr_payload=${input.qrPayload.trim()}
    WHERE id=${id} AND status='final' RETURNING id`;
  if (!inv) return { error: "Invoice not found or not finalized yet." };
  return { ok: true };
}

export async function cancelDraftInvoice(id: number): Promise<{ ok: true } | { error: string }> {
  const sql = getSql();
  const [inv] = (await sql`SELECT status FROM invoices WHERE id=${id}`) as unknown as Array<{ status: string }>;
  if (!inv) return { error: "Invoice not found." };
  if (inv.status === "final") return { error: "A finalized invoice cannot be deleted (cancel it instead)." };
  await sql`DELETE FROM invoice_lines WHERE invoice_id=${id}`;
  await sql`DELETE FROM invoices WHERE id=${id}`;
  return { ok: true };
}

function today(): string {
  // Asia/Kolkata calendar date — invoices are dated in IST.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
