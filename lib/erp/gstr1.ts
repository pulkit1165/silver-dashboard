import "server-only";
import { getSql } from "./db";
import { getCompanySettings } from "./invoices";

// GSTR-1 (outward supplies return) is generated FROM our own sales data — no
// external API needed. Government rule: inter-state B2C invoices over this
// value go in B2CL instead of the B2CS summary bucket (statutory threshold,
// currently ₹1,00,000 — revisit if the rule changes).
const B2CL_THRESHOLD = 100000;

interface InvoiceForGstr1 {
  id: number; invoice_no: string; invoice_date: string; buyer_gstin: string;
  buyer_state_code: string; pos_state_code: string; tax_type: string;
  taxable_total: number; igst: number; cgst: number; sgst: number; grand_total: number;
}
interface LineForGstr1 {
  invoice_id: number; hsn: string; unit: string; qty: number;
  taxable_value: number; gst_rate: number; igst: number; cgst: number; sgst: number;
}

export interface Gstr1Result {
  period: { from: string; to: string };
  company: { gstin: string; legalName: string };
  summary: { invoiceCount: number; b2bCount: number; b2clCount: number; b2csRows: number; taxableTotal: number; taxTotal: number };
  warnings: string[]; // e.g. invoices missing HSN or a GSTIN that isn't 15 chars
  b2b: Array<{ ctin: string; invoices: Array<{ inum: string; idt: string; val: number; pos: string; items: RateSplit[] }> }>;
  b2cl: Array<{ pos: string; invoices: Array<{ inum: string; idt: string; val: number; items: RateSplit[] }> }>;
  b2cs: Array<{ pos: string; rt: number; txval: number; iamt: number; camt: number; samt: number }>;
  hsn: Array<{ hsn: string; uqc: string; qty: number; txval: number; rt: number; iamt: number; camt: number; samt: number }>;
  docSummary: { from: string; to: string; count: number; fromNo: string; toNo: string };
}
interface RateSplit { rt: number; txval: number; iamt: number; camt: number; samt: number }

function ratesplitFromLines(lines: LineForGstr1[]): RateSplit[] {
  const byRate = new Map<number, RateSplit>();
  for (const l of lines) {
    const cur = byRate.get(l.gst_rate) ?? { rt: l.gst_rate, txval: 0, iamt: 0, camt: 0, samt: 0 };
    cur.txval += l.taxable_value; cur.iamt += l.igst; cur.camt += l.cgst; cur.samt += l.sgst;
    byRate.set(l.gst_rate, cur);
  }
  return [...byRate.values()];
}

export async function getGstr1Data(from: string, to: string): Promise<Gstr1Result> {
  const sql = getSql();
  const company = await getCompanySettings();

  const invoices = (await sql`
    SELECT id, invoice_no, invoice_date, buyer_gstin, buyer_state_code, pos_state_code,
           tax_type, taxable_total, igst, cgst, sgst, grand_total
    FROM invoices
    WHERE status='final' AND invoice_date >= ${from} AND invoice_date <= ${to}
    ORDER BY invoice_no`) as unknown as InvoiceForGstr1[];

  const invoiceIds = invoices.map((i) => i.id);
  const lines = invoiceIds.length === 0 ? [] : (await sql`
    SELECT invoice_id, hsn, unit, qty, taxable_value, gst_rate, igst, cgst, sgst
    FROM invoice_lines WHERE invoice_id IN ${sql(invoiceIds)}`) as unknown as LineForGstr1[];

  const linesByInvoice = new Map<number, LineForGstr1[]>();
  for (const l of lines) {
    const arr = linesByInvoice.get(l.invoice_id) ?? [];
    arr.push(l); linesByInvoice.set(l.invoice_id, arr);
  }

  const warnings: string[] = [];
  const b2bByGstin = new Map<string, Gstr1Result["b2b"][number]>();
  const b2clByPos = new Map<string, Gstr1Result["b2cl"][number]>();
  const b2csByKey = new Map<string, Gstr1Result["b2cs"][number]>();
  const hsnByKey = new Map<string, Gstr1Result["hsn"][number]>();

  for (const inv of invoices) {
    const invLines = linesByInvoice.get(inv.id) ?? [];
    if (invLines.length === 0) { warnings.push(`${inv.invoice_no}: no line items — skipped.`); continue; }
    if (invLines.some((l) => !l.hsn)) warnings.push(`${inv.invoice_no}: one or more lines are missing an HSN code.`);

    const items = ratesplitFromLines(invLines);
    const gstin = (inv.buyer_gstin || "").trim().toUpperCase();
    const pos = inv.pos_state_code || inv.buyer_state_code || "";

    if (gstin) {
      if (gstin.length !== 15) warnings.push(`${inv.invoice_no}: buyer GSTIN "${gstin}" is not 15 characters.`);
      const bucket = b2bByGstin.get(gstin) ?? { ctin: gstin, invoices: [] };
      bucket.invoices.push({ inum: inv.invoice_no, idt: inv.invoice_date, val: inv.grand_total, pos, items });
      b2bByGstin.set(gstin, bucket);
    } else if (inv.tax_type === "IGST" && inv.grand_total > B2CL_THRESHOLD) {
      const bucket = b2clByPos.get(pos) ?? { pos, invoices: [] };
      bucket.invoices.push({ inum: inv.invoice_no, idt: inv.invoice_date, val: inv.grand_total, items });
      b2clByPos.set(pos, bucket);
    } else {
      for (const r of items) {
        const key = `${pos}|${r.rt}`;
        const cur = b2csByKey.get(key) ?? { pos, rt: r.rt, txval: 0, iamt: 0, camt: 0, samt: 0 };
        cur.txval += r.txval; cur.iamt += r.iamt; cur.camt += r.camt; cur.samt += r.samt;
        b2csByKey.set(key, cur);
      }
    }

    for (const l of invLines) {
      const key = `${l.hsn}|${l.unit}|${l.gst_rate}`;
      const cur = hsnByKey.get(key) ?? { hsn: l.hsn || "(missing)", uqc: l.unit || "PCS", qty: 0, txval: 0, rt: l.gst_rate, iamt: 0, camt: 0, samt: 0 };
      cur.qty += l.qty; cur.txval += l.taxable_value; cur.iamt += l.igst; cur.camt += l.cgst; cur.samt += l.sgst;
      hsnByKey.set(key, cur);
    }
  }

  const taxableTotal = invoices.reduce((a, i) => a + i.taxable_total, 0);
  const taxTotal = invoices.reduce((a, i) => a + i.igst + i.cgst + i.sgst, 0);
  const b2clCount = [...b2clByPos.values()].reduce((a, b) => a + b.invoices.length, 0);

  return {
    period: { from, to },
    company: { gstin: company.gstin, legalName: company.legal_name },
    summary: { invoiceCount: invoices.length, b2bCount: [...b2bByGstin.values()].reduce((a, b) => a + b.invoices.length, 0), b2clCount, b2csRows: b2csByKey.size, taxableTotal, taxTotal },
    warnings,
    b2b: [...b2bByGstin.values()],
    b2cl: [...b2clByPos.values()],
    b2cs: [...b2csByKey.values()],
    hsn: [...hsnByKey.values()],
    docSummary: {
      from, to, count: invoices.length,
      fromNo: invoices[0]?.invoice_no ?? "", toNo: invoices[invoices.length - 1]?.invoice_no ?? "",
    },
  };
}
