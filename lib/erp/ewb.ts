import "server-only";
import { getSql } from "./db";
import { getInvoiceFull } from "./invoices";
import { gstStateName } from "./gst-states";

// e-way bills are filed manually for now (no GSP/API account — see
// [[erp-invoicing-module]] handoff). This computes the exact field set the
// EWB-01 form on ewaybillgst.gov.in asks for, from an already-finalized
// invoice, so a person can key it in in under a minute instead of re-deriving
// totals by hand.
export interface EwbPayload {
  invoiceId: number; invoiceNo: string; invoiceDate: string;
  docType: "Tax Invoice"; supplyType: "Outward"; subType: "Supply";
  from: { gstin: string; name: string; address: string; stateCode: string; stateName: string };
  to: { gstin: string; name: string; stateCode: string; stateName: string };
  posStateCode: string; posStateName: string;
  items: Array<{ hsn: string; description: string; qty: number; unit: string; taxableValue: number; gstRate: number }>;
  taxableTotal: number; igst: number; cgst: number; sgst: number; grandTotal: number;
  transporter: { name: string; id: string; vehicleNo: string; distanceKm: number | null };
  docNo: { lrNo: string; lrDate: string };
  existing: { ewbNo: string; ewbValidUntil: string };
}

export async function computeEwbPayload(invoiceId: number): Promise<EwbPayload | undefined> {
  await ensureInvoiceEwbCols();
  const full = await getInvoiceFull(invoiceId);
  if (!full) return undefined;
  const { invoice: inv, lines, company } = full;
  return {
    invoiceId: inv.id, invoiceNo: inv.invoice_no ?? "", invoiceDate: inv.invoice_date ?? "",
    docType: "Tax Invoice", supplyType: "Outward", subType: "Supply",
    from: {
      gstin: company.gstin, name: company.trade_name || company.legal_name,
      address: `${company.address}, ${company.city} ${company.pincode}`.trim(),
      stateCode: company.state_code, stateName: gstStateName(company.state_code),
    },
    to: {
      gstin: inv.buyer_gstin, name: inv.buyer_name,
      stateCode: inv.buyer_state_code, stateName: gstStateName(inv.buyer_state_code),
    },
    posStateCode: inv.pos_state_code, posStateName: gstStateName(inv.pos_state_code),
    items: lines.map((l) => ({ hsn: l.hsn, description: l.description ?? l.sku_code ?? "", qty: l.qty, unit: l.unit, taxableValue: l.taxable_value, gstRate: l.gst_rate })),
    taxableTotal: inv.taxable_total, igst: inv.igst, cgst: inv.cgst, sgst: inv.sgst, grandTotal: inv.grand_total,
    transporter: { name: inv.transporter, id: inv.transporter_id, vehicleNo: inv.vehicle_no, distanceKm: inv.distance_km },
    docNo: { lrNo: inv.lr_no, lrDate: inv.lr_date },
    existing: { ewbNo: inv.ewb_no, ewbValidUntil: inv.ewb_valid_until },
  };
}

export interface EwbQueueRow {
  id: number; invoice_no: string; invoice_date: string; buyer_name: string; grand_total: number;
  vehicle_no: string; transporter: string; ewb_no: string;
}

// Finalized invoices over the threshold, so nothing falls through the cracks.
export async function getEwbQueue(): Promise<EwbQueueRow[]> {
  await ensureInvoiceEwbCols();
  const sql = getSql();
  const [cs] = (await sql`SELECT COALESCE(ewb_threshold,50000) AS t FROM company_settings WHERE id=1`) as unknown as Array<{ t: number }>;
  const threshold = cs?.t ?? 50000;
  return (await sql`
    SELECT id, invoice_no, invoice_date, buyer_name, grand_total, vehicle_no, transporter, ewb_no
    FROM invoices
    WHERE status='final' AND grand_total > ${threshold}
    ORDER BY (ewb_no = '') DESC, invoice_date DESC, id DESC
    LIMIT 300`) as unknown as EwbQueueRow[];
}

let invoiceEwbColsEnsured = false;
async function ensureInvoiceEwbCols() {
  if (invoiceEwbColsEnsured) return;
  try {
    await getSql().unsafe(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ewb_valid_until text DEFAULT ''`);
    invoiceEwbColsEnsured = true;
  } catch { /* ignore */ }
}

export async function saveEwbNumber(invoiceId: number, ewbNo: string, ewbValidUntil: string): Promise<{ ok: true } | { error: string }> {
  await ensureInvoiceEwbCols();
  const sql = getSql();
  const [inv] = await sql`UPDATE invoices SET ewb_no=${ewbNo.trim()}, ewb_valid_until=${ewbValidUntil.trim()} WHERE id=${invoiceId} AND status='final' RETURNING id`;
  if (!inv) return { error: "Invoice not found or not finalized yet." };
  return { ok: true };
}
