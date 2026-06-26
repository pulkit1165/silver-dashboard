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
  notes: string;
  irn: string;
  ack_no: string;
  ewb_no: string;
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
}

const COMPANY_DEFAULT: CompanySettings = {
  id: 1, legal_name: "SILVER INDUSTRIES", trade_name: "", gstin: "", state_code: "",
  address: "", city: "", pincode: "", phone: "", email: "", msme_no: "",
  bank_name: "", bank_account: "", bank_ifsc: "", bank_branch: "",
  invoice_prefix: "GC26/", invoice_next_no: 1, terms: "",
};

// ── Company settings ─────────────────────────────────────────────────────────
export async function getCompanySettings(): Promise<CompanySettings> {
  const [row] = await getSql()`SELECT * FROM company_settings ORDER BY id LIMIT 1`;
  return (row as CompanySettings | undefined) ?? COMPANY_DEFAULT;
}

export async function saveCompanySettings(patch: Partial<CompanySettings>): Promise<void> {
  const sql = getSql();
  const cur = await getCompanySettings();
  const next = { ...cur, ...patch };
  await sql`
    INSERT INTO company_settings (id, legal_name, trade_name, gstin, state_code, address, city,
      pincode, phone, email, msme_no, bank_name, bank_account, bank_ifsc, bank_branch,
      invoice_prefix, invoice_next_no, terms)
    VALUES (1, ${next.legal_name}, ${next.trade_name}, ${next.gstin}, ${next.state_code},
      ${next.address}, ${next.city}, ${next.pincode}, ${next.phone}, ${next.email}, ${next.msme_no},
      ${next.bank_name}, ${next.bank_account}, ${next.bank_ifsc}, ${next.bank_branch},
      ${next.invoice_prefix}, ${next.invoice_next_no}, ${next.terms})
    ON CONFLICT (id) DO UPDATE SET
      legal_name=EXCLUDED.legal_name, trade_name=EXCLUDED.trade_name, gstin=EXCLUDED.gstin,
      state_code=EXCLUDED.state_code, address=EXCLUDED.address, city=EXCLUDED.city,
      pincode=EXCLUDED.pincode, phone=EXCLUDED.phone, email=EXCLUDED.email, msme_no=EXCLUDED.msme_no,
      bank_name=EXCLUDED.bank_name, bank_account=EXCLUDED.bank_account, bank_ifsc=EXCLUDED.bank_ifsc,
      bank_branch=EXCLUDED.bank_branch, invoice_prefix=EXCLUDED.invoice_prefix,
      invoice_next_no=EXCLUDED.invoice_next_no, terms=EXCLUDED.terms`;
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
           c.state_code AS buyer_state_code, c.pos_state_code, c.discount_class_id, c.discount_pct
    FROM sales_orders so JOIN customers c ON c.id = so.customer_id
    WHERE so.id = ${soId}`) as unknown as Array<{
    id: number; so_no: string; customer_id: number; customer_name: string; buyer_gstin: string | null;
    buyer_state_code: string | null; pos_state_code: string | null; discount_class_id: number | null;
    discount_pct: number | null;
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

  // Billable lines = dispatched - already-invoiced (> 0).
  const rows = (await sql`
    SELECT l.id AS so_line_id, l.sku_id,
           GREATEST(COALESCE(l.dispatched_qty,0) - COALESCE(l.invoiced_qty,0), 0) AS billable,
           s.sku_code, s.name AS description, s.price AS mrp, s.hsn, s.unit, s.gst_rate
    FROM so_lines l JOIN skus s ON s.id = l.sku_id
    WHERE l.so_id = ${soId}
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
 * Create a persisted DRAFT invoice from a sales order. Pulls every line that
 * has dispatched qty not yet invoiced; the undispatched balance is untouched
 * and remains a pending SO line. Returns null if nothing is billable.
 */
export async function createDraftFromSalesOrder(
  soId: number,
  opts: { createdBy?: string | null; packingSlipId?: number | null } = {},
): Promise<{ id: number } | { error: string }> {
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
        buyer_name, buyer_gstin, buyer_state_code, pos_state_code, tax_type, invoice_date,
        discount_class_id, mrp_total, discount_total, taxable_total, igst, cgst, sgst,
        round_off, grand_total, created_by)
      VALUES ('draft', ${soId}, ${opts.packingSlipId ?? null}, ${g.so.customer_id},
        ${company.state_code}, ${g.so.customer_name}, ${g.so.buyer_gstin ?? ""},
        ${g.so.buyer_state_code ?? ""}, ${g.posStateCode}, ${computed.taxType},
        ${today()}, ${g.so.discount_class_id ?? null}, ${computed.mrpTotal}, ${computed.discountTotal},
        ${computed.taxableTotal}, ${computed.igst}, ${computed.cgst}, ${computed.sgst},
        ${computed.roundOff}, ${computed.grandTotal}, ${opts.createdBy ?? null})
      RETURNING id`;
    const invoiceId = (inv as { id: number }).id;

    await insertLines(tx as unknown as Sql, invoiceId, computed.lines, g.draftLines);
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
  transporter?: string;
  transporterId?: string;
  vehicleNo?: string;
  lrNo?: string;
  lrDate?: string;
  distanceKm?: number | null;
  notes?: string;
  lines?: Array<{ id: number; qty?: number; discountPct?: number }>;
}

export async function updateDraftInvoice(id: number, patch: InvoicePatch): Promise<{ ok: true } | { error: string }> {
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
        transporter=${patch.transporter ?? inv.transporter},
        transporter_id=${patch.transporterId ?? inv.transporter_id},
        vehicle_no=${patch.vehicleNo ?? inv.vehicle_no},
        lr_no=${patch.lrNo ?? inv.lr_no}, lr_date=${patch.lrDate ?? inv.lr_date},
        distance_km=${patch.distanceKm !== undefined ? patch.distanceKm : inv.distance_km},
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
