"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { computeInvoice, amountInWords, type LineInput } from "@/lib/erp/invoice-engine";
import { gstStateName } from "@/lib/erp/gst-states";

// JSON shapes returned by getInvoiceFull / the API (snake_case from postgres.js).
interface InvoiceRow {
  id: number; invoice_no: string | null; status: string; so_id: number | null;
  buyer_name: string; buyer_gstin: string; buyer_state_code: string; buyer_address: string;
  buyer_phone: string; buyer_po_no: string; pos_state_code: string;
  seller_state_code: string; tax_type: string; invoice_date: string | null;
  transporter: string; transporter_id: string; vehicle_no: string; lr_no: string; lr_date: string;
  distance_km: number | null; freight_term: string; pvt_mark: string; case_count: number | null;
  booked_by: string; notes: string;
  irn: string; ewb_no: string; ack_no: string; ack_date: string; qr_payload: string;
}
interface LineRow {
  id: number; so_line_id: number | null; sku_id: number | null; sku_code: string | null;
  description: string | null; hsn: string; unit: string; case_no: string; qty: number; mrp: number;
  discount_pct: number; gst_rate: number;
}
interface Company {
  legal_name: string; trade_name: string; gstin: string; state_code: string; address: string;
  city: string; pincode: string; phone: string; email: string; msme_no: string;
  bank_name: string; bank_account: string; bank_ifsc: string; bank_branch: string; terms: string;
  ewb_threshold: number;
}
export interface InvoiceFullProps {
  invoice: InvoiceRow; lines: LineRow[]; company: Company; amountInWords: string;
}

type Line = {
  id: number; soLineId: number | null; skuId: number | null; skuCode: string; description: string;
  hsn: string; unit: string; caseNo: string; qty: number; mrp: number; discountPct: number; gstRate: number;
};

const inr = (n: number) => (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => (n ?? 0).toLocaleString("en-IN");

export default function InvoiceEditor({ data, canEdit, qrImage }: { data: InvoiceFullProps; canEdit: boolean; qrImage: string | null }) {
  const router = useRouter();
  const { company } = data;
  const isDraft = data.invoice.status === "draft";
  const editable = canEdit && isDraft;

  const [lines, setLines] = useState<Line[]>(
    data.lines.map((l) => ({
      id: l.id, soLineId: l.so_line_id, skuId: l.sku_id, skuCode: l.sku_code ?? "",
      description: l.description ?? "", hsn: l.hsn ?? "", unit: l.unit ?? "PCS", caseNo: l.case_no ?? "",
      qty: l.qty ?? 0, mrp: l.mrp ?? 0, discountPct: l.discount_pct ?? 0, gstRate: l.gst_rate ?? 18,
    })),
  );
  const [hdr, setHdr] = useState({
    posStateCode: data.invoice.pos_state_code ?? "",
    invoiceDate: data.invoice.invoice_date ?? "",
    buyerAddress: data.invoice.buyer_address ?? "",
    buyerPhone: data.invoice.buyer_phone ?? "",
    buyerPoNo: data.invoice.buyer_po_no ?? "",
    transporter: data.invoice.transporter ?? "",
    transporterId: data.invoice.transporter_id ?? "",
    vehicleNo: data.invoice.vehicle_no ?? "",
    lrNo: data.invoice.lr_no ?? "",
    lrDate: data.invoice.lr_date ?? "",
    distanceKm: data.invoice.distance_km ?? ("" as number | ""),
    freightTerm: data.invoice.freight_term ?? "",
    pvtMark: data.invoice.pvt_mark ?? "",
    caseCount: data.invoice.case_count ?? ("" as number | ""),
    bookedBy: data.invoice.booked_by ?? "",
    notes: data.invoice.notes ?? "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // e-Invoice (IRN/QR) — recorded manually once available, mirrors the e-way bill flow.
  const [einv, setEinv] = useState({
    irn: data.invoice.irn ?? "", ackNo: data.invoice.ack_no ?? "",
    ackDate: data.invoice.ack_date ?? "", qrPayload: data.invoice.qr_payload ?? "",
  });
  const [einvBusy, setEinvBusy] = useState(false);
  const [einvMsg, setEinvMsg] = useState<string | null>(null);

  // Live totals mirror the server engine exactly (same pure module).
  const computed = useMemo(() => {
    const inputs: LineInput[] = lines.map((l) => ({
      skuId: l.skuId ?? 0, skuCode: l.skuCode, description: l.description, hsn: l.hsn, unit: l.unit,
      caseNo: l.caseNo, qty: l.qty, mrp: l.mrp, discountPct: l.discountPct, gstRate: l.gstRate, soLineId: l.soLineId,
    }));
    return computeInvoice(inputs, { sellerStateCode: company.state_code, posStateCode: hdr.posStateCode });
  }, [lines, hdr.posStateCode, company.state_code]);

  const setLine = (id: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  async function save() {
    setBusy("save"); setMsg(null);
    const res = await fetch(`/api/erp/invoices/${data.invoice.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...hdr,
        distanceKm: hdr.distanceKm === "" ? null : Number(hdr.distanceKm),
        caseCount: hdr.caseCount === "" ? null : Number(hdr.caseCount),
        lines: lines.map((l) => ({ id: l.id, qty: l.qty, discountPct: l.discountPct })),
      }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "Network error" }));
    setBusy(null);
    if (!res.ok) { setMsg(res.error ?? "Save failed"); return; }
    setMsg("Saved."); router.refresh();
  }

  async function saveEInvoice() {
    setEinvBusy(true); setEinvMsg(null);
    const res = await fetch(`/api/erp/invoices/${data.invoice.id}/einvoice`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ irn: einv.irn, ack_no: einv.ackNo, ack_date: einv.ackDate, qr_payload: einv.qrPayload }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "Network error" }));
    setEinvBusy(false);
    if (!res.ok) { setEinvMsg(res.error ?? "Save failed"); return; }
    setEinvMsg("Saved."); router.refresh();
  }

  async function finalize() {
    if (!confirm("Finalize this invoice? It will get an invoice number and the dispatched qty will be locked as billed.")) return;
    setBusy("finalize"); setMsg(null);
    // Persist edits first, then lock.
    await save();
    const res = await fetch(`/api/erp/invoices/${data.invoice.id}/finalize`, { method: "POST" })
      .then((r) => r.json()).catch(() => ({ ok: false, error: "Network error" }));
    setBusy(null);
    if (!res.ok) { setMsg(res.error ?? "Finalize failed"); return; }
    router.refresh();
  }

  async function remove() {
    if (!confirm("Delete this draft invoice? The dispatched qty stays billable.")) return;
    setBusy("delete");
    const res = await fetch(`/api/erp/invoices/${data.invoice.id}`, { method: "DELETE" })
      .then((r) => r.json()).catch(() => ({ ok: false, error: "Network error" }));
    if (!res.ok) { setBusy(null); setMsg(res.error ?? "Delete failed"); return; }
    router.push("/erp/invoices");
  }

  const interState = computed.taxType === "IGST";
  // Only label the tax rows "@ X%" when every line shares one rate — mixed-rate
  // invoices show the split without a single misleading percentage.
  const gstRates = new Set(lines.map((l) => l.gstRate));
  const uniformGstRate = gstRates.size === 1 ? [...gstRates][0] : null;
  const needsEwb = computed.grandTotal > (company.ewb_threshold || 50000);
  const ewbIncomplete = needsEwb && (!hdr.vehicleNo.trim() && !hdr.transporter.trim());

  return (
    <>
      {editable && needsEwb && (
        <div className="no-print mb-4 rounded-lg border border-dashed border-amber-500 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          ⚠ This invoice is over the e-way bill threshold (₹{(company.ewb_threshold || 50000).toLocaleString("en-IN")}) —
          {ewbIncomplete ? " fill in transporter/vehicle details below, then " : " "}
          generate the e-way bill from the <a href="/erp/gst/eway-bills" className="underline">e-Way Bills</a> screen after finalizing.
        </div>
      )}
      {/* ── Editor toolbar (screen only) ──────────────────────────────── */}
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <button onClick={() => window.print()} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">🖨 Print / PDF</button>
        {editable && (
          <>
            <button onClick={save} disabled={!!busy} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">{busy === "save" ? "Saving…" : "💾 Save draft"}</button>
            <button onClick={finalize} disabled={!!busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">{busy === "finalize" ? "Finalizing…" : "✓ Finalize"}</button>
            <button onClick={remove} disabled={!!busy} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-bold text-red-600 hover:bg-red-50">🗑 Delete draft</button>
          </>
        )}
        {!isDraft && <span className="tag g">Finalized — locked</span>}
        {!isDraft && (
          <a href="/erp/gst/eway-bills" className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-bold text-white hover:opacity-90">🚚 Generate e-Way Bill</a>
        )}
        {msg && <span className="text-sm font-semibold text-[var(--muted)]">{msg}</span>}
      </div>

      {editable && (
        <section className="panel no-print mb-4">
          <div className="panel-hd">Invoice details (editable while draft)</div>
          <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-4">
            <Field label="Invoice date"><input type="date" className="ctl" value={hdr.invoiceDate} onChange={(e) => setHdr({ ...hdr, invoiceDate: e.target.value })} /></Field>
            <Field label="Place of supply (state code)" hint={`Seller ${company.state_code || "?"} → ${interState ? "IGST" : "CGST+SGST"}`}><input className="ctl" value={hdr.posStateCode} onChange={(e) => setHdr({ ...hdr, posStateCode: e.target.value })} placeholder="e.g. 33" /></Field>
            <Field label="Buyer address"><input className="ctl" value={hdr.buyerAddress} onChange={(e) => setHdr({ ...hdr, buyerAddress: e.target.value })} /></Field>
            <Field label="Buyer phone"><input className="ctl" value={hdr.buyerPhone} onChange={(e) => setHdr({ ...hdr, buyerPhone: e.target.value })} /></Field>
            <Field label="Buyer's PO No."><input className="ctl" value={hdr.buyerPoNo} onChange={(e) => setHdr({ ...hdr, buyerPoNo: e.target.value })} /></Field>
            <Field label="Transporter"><input className="ctl" value={hdr.transporter} onChange={(e) => setHdr({ ...hdr, transporter: e.target.value })} /></Field>
            <Field label="Transporter ID (GSTIN)"><input className="ctl" value={hdr.transporterId} onChange={(e) => setHdr({ ...hdr, transporterId: e.target.value })} /></Field>
            <Field label="Vehicle no"><input className="ctl" value={hdr.vehicleNo} onChange={(e) => setHdr({ ...hdr, vehicleNo: e.target.value })} /></Field>
            <Field label="GR / LR no"><input className="ctl" value={hdr.lrNo} onChange={(e) => setHdr({ ...hdr, lrNo: e.target.value })} /></Field>
            <Field label="GR / LR date"><input type="date" className="ctl" value={hdr.lrDate} onChange={(e) => setHdr({ ...hdr, lrDate: e.target.value })} /></Field>
            <Field label="Distance (km)"><input type="number" className="ctl" value={hdr.distanceKm} onChange={(e) => setHdr({ ...hdr, distanceKm: e.target.value === "" ? "" : Number(e.target.value) })} /></Field>
            <Field label="Freight"><select className="ctl" value={hdr.freightTerm} onChange={(e) => setHdr({ ...hdr, freightTerm: e.target.value })}>
              <option value="">—</option><option value="TO PAY">TO PAY</option><option value="PAID">PAID</option><option value="FOR">FOR</option>
            </select></Field>
            <Field label="Pvt mark"><input className="ctl" value={hdr.pvtMark} onChange={(e) => setHdr({ ...hdr, pvtMark: e.target.value })} placeholder="e.g. 464/24" /></Field>
            <Field label="Case count"><input type="number" className="ctl" value={hdr.caseCount} onChange={(e) => setHdr({ ...hdr, caseCount: e.target.value === "" ? "" : Number(e.target.value) })} /></Field>
            <Field label="Booked by"><input className="ctl" value={hdr.bookedBy} onChange={(e) => setHdr({ ...hdr, bookedBy: e.target.value })} /></Field>
          </div>
        </section>
      )}

      {!isDraft && canEdit && (
        <section className="panel no-print mb-4">
          <div className="panel-hd flex items-center justify-between">
            <span>e-Invoice (IRN) — record once generated</span>
            {einvMsg && <span className="text-xs font-bold text-[var(--accent-2)]">{einvMsg}</span>}
          </div>
          <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-4">
            <Field label="IRN"><input className="ctl font-mono" value={einv.irn} onChange={(e) => setEinv({ ...einv, irn: e.target.value })} placeholder="64-char hash" /></Field>
            <Field label="Ack No."><input className="ctl" value={einv.ackNo} onChange={(e) => setEinv({ ...einv, ackNo: e.target.value })} /></Field>
            <Field label="Ack Date"><input type="date" className="ctl" value={einv.ackDate} onChange={(e) => setEinv({ ...einv, ackDate: e.target.value })} /></Field>
            <Field label="QR payload (from the IRP)"><input className="ctl" value={einv.qrPayload} onChange={(e) => setEinv({ ...einv, qrPayload: e.target.value })} /></Field>
          </div>
          <div className="px-3 pb-3">
            <button onClick={saveEInvoice} disabled={einvBusy} className="rounded-lg bg-[var(--accent-2)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">{einvBusy ? "Saving…" : "Save e-Invoice details"}</button>
          </div>
        </section>
      )}

      {/* ── Printable tax invoice ─────────────────────────────────────── */}
      {/* Force A4 PORTRAIT for the invoice (the global @page sets no orientation, so
          it would otherwise inherit the printer/browser default, e.g. landscape). */}
      <style dangerouslySetInnerHTML={{ __html: `@media print { @page { size: A4 portrait; margin: 8mm; } }` }} />
      <section className="print-area inv-doc">
        <div className="border border-black bg-white p-3 text-[11px] leading-tight text-black">
          {/* Header — GST/State/QR box · company letterhead · invoice marker */}
          <div className="flex items-start justify-between gap-3 border-b border-black pb-2">
            <div className="w-32 shrink-0">
              <div>GST No.:</div>
              <div className="font-bold">{company.gstin || "—"}</div>
              <div className="mt-1">State Code:</div>
              <div className="font-bold">{gstStateName(company.state_code)} ({company.state_code || "—"})</div>
              <div className="mt-1 flex h-16 w-16 items-center justify-center border border-dashed border-gray-400 bg-white">
                {qrImage ? <img src={qrImage} alt="e-Invoice QR" className="h-full w-full" /> : <span className="text-center text-[8px] text-gray-400">{data.invoice.irn ? "QR" : "QR after e-invoice"}</span>}
              </div>
            </div>
            <div className="flex-1 text-center">
              <div className="text-2xl font-extrabold tracking-wide" style={{ color: "#c1121f" }}>{company.legal_name}</div>
              {company.trade_name && <div className="font-semibold">{company.trade_name}</div>}
              <div>{company.address}{company.city ? `, ${company.city}` : ""}{company.pincode ? ` - ${company.pincode}` : ""}</div>
              {(company.phone || company.email) && <div>{company.phone ? `Ph.: ${company.phone}` : ""}{company.phone && company.email ? " · " : ""}{company.email ? `E-mail: ${company.email}` : ""}</div>}
            </div>
            <div className="w-28 shrink-0 text-right">
              <div className="text-sm font-extrabold">INVOICE</div>
              <div className="text-[9px] text-gray-500">1 of 1</div>
              <div className="mt-1 inline-block rounded border-2 px-2 py-0.5 text-right leading-none" style={{ borderColor: "#c1121f" }}>
                <div className="text-base font-extrabold" style={{ color: "#c1121f" }}>SILVER UP</div>
                <div className="text-[7px] font-bold tracking-[0.2em]" style={{ color: "#c1121f" }}>AUTO PARTS</div>
              </div>
            </div>
          </div>

          {company.msme_no && <div className="border-b border-black py-0.5">MSME NO : <b>{company.msme_no}</b></div>}

          {/* IRN row */}
          <div className="border-b border-black py-0.5">
            IRN No.: <span className="font-mono">{data.invoice.irn || "— (e-invoice pending)"}</span>
            {data.invoice.ack_no && <span> &nbsp;·&nbsp; Ack No.: {data.invoice.ack_no}{data.invoice.ack_date ? ` dt ${data.invoice.ack_date}` : ""}</span>}
          </div>

          {/* Receiver / Transport details */}
          <div className="grid grid-cols-2 gap-x-3 border-b border-black py-1">
            <div>
              <div className="font-bold underline">Details of Receiver / Billed to :</div>
              <KV k="Name" v={data.invoice.buyer_name || "—"} bold />
              <KV k="Add" v={hdr.buyerAddress || "—"} />
              <div className="flex justify-between"><span>GST No.: {data.invoice.buyer_gstin || "—"}</span><span>StateCode : {data.invoice.buyer_state_code || "—"}</span></div>
              <KV k="PH No" v={hdr.buyerPhone || "—"} />
              <div className="flex justify-between"><span>Place of Supply : {hdr.posStateCode || "—"}</span><span>Distance : {hdr.distanceKm === "" ? "—" : `${hdr.distanceKm} KMS`}</span></div>
            </div>
            <div>
              <div className="flex justify-between font-bold">
                <span>Invoice No {data.invoice.invoice_no ?? `(draft #${data.invoice.id})`}</span>
                <span>DT {hdr.invoiceDate || "—"}</span>
              </div>
              <KV k="Transport" v={hdr.transporter || "—"} />
              <KV k="Tpt ID" v={hdr.transporterId || "—"} />
              {hdr.vehicleNo && <KV k="Vehicle" v={hdr.vehicleNo} />}
              <div className="flex justify-between"><span>Pvt Mark : {hdr.pvtMark || "—"}</span><span>{hdr.caseCount === "" ? "" : `${hdr.caseCount} CS`}</span></div>
              <KV k="Book By" v={hdr.bookedBy || "—"} />
              <KV k="E-Way" v={data.invoice.ewb_no || "— (pending)"} />
              <div className="flex justify-between"><span>GR No : {hdr.lrNo || "—"}</span><span>GR Dt : {hdr.lrDate || "—"}</span></div>
              <KV k="Freight" v={hdr.freightTerm || "—"} />
              <KV k="PoNo." v={hdr.buyerPoNo || "—"} />
            </div>
          </div>

          {/* Items */}
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="border-b border-black [&>th]:border-r [&>th]:border-black [&>th]:px-1 [&>th]:py-0.5 [&>th]:text-left">
                <th className="w-8">S.No</th>
                <th>Code</th>
                <th>Description of Goods/Services</th>
                <th>HSN Code / GST Rate</th>
                <th className="!text-right">Qty</th>
                <th>Unit</th>
                <th className="!text-right">Mrp</th>
                <th className="!text-right">Sch.(%)</th>
                <th className="!text-right">Taxable Value</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id} className="border-b border-gray-300 [&>td]:border-r [&>td]:border-gray-300 [&>td]:px-1 [&>td]:py-0.5 align-top">
                  <td>{i + 1}</td>
                  <td className="font-mono">{l.skuCode}</td>
                  <td>{l.description}</td>
                  <td className="whitespace-nowrap">{l.hsn || "—"} / {l.gstRate}%</td>
                  <td className="!text-right">
                    {editable
                      ? <input type="number" className="w-14 border border-gray-300 px-1 text-right no-print-border" value={l.qty} onChange={(e) => setLine(l.id, { qty: Number(e.target.value) })} />
                      : num(l.qty)}
                  </td>
                  <td>{l.unit}</td>
                  <td className="!text-right">{inr(l.mrp)}</td>
                  <td className="!text-right">
                    {editable
                      ? <input type="number" step="0.01" className="w-14 border border-gray-300 px-1 text-right no-print-border" value={l.discountPct} onChange={(e) => setLine(l.id, { discountPct: Number(e.target.value) })} />
                      : `${l.discountPct}`}
                  </td>
                  <td className="!text-right">{inr(computed.lines[i]?.taxableValue ?? 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black font-bold [&>td]:border-r [&>td]:border-black [&>td]:px-1 [&>td]:py-1">
                <td colSpan={4} className="text-right">Total</td>
                <td className="!text-right">{num(lines.reduce((a, l) => a + (l.qty || 0), 0))}</td>
                <td colSpan={3} className="text-right">Sale Amount</td>
                <td className="!text-right">{inr(computed.taxableTotal)}</td>
              </tr>
            </tfoot>
          </table>

          {/* Totals */}
          <div className="mt-2 flex justify-between gap-4">
            <div className="max-w-[40%]">
              <div className="font-bold">Amount in words:</div>
              <div className="italic">{amountInWords(computed.grandTotal)}</div>
              <div className="mt-2 border-t border-black pt-1">
                <div className="font-bold">Bank Name: {company.bank_name || "—"}</div>
                <div>Account No: {company.bank_account || "—"}</div>
                <div>IFSC CODE: {company.bank_ifsc || "—"}</div>
                <div>Branch: {company.bank_branch}</div>
              </div>
              <div className="mt-2 border-t border-black pt-1">
                <div className="font-bold">Promotional Items</div>
              </div>
            </div>
            <div className="max-w-[30%]">
              <div className="font-bold">Amount − Discount = Taxable + GST Amt = Total Amt</div>
              <div className="tabular-nums">
                {inr(computed.mrpTotal)} − {inr(computed.discountTotal)} = {inr(computed.taxableTotal)} + {inr(computed.igst + computed.cgst + computed.sgst)}
                {uniformGstRate != null ? ` (@ ${uniformGstRate})` : ""} = {inr(computed.grandTotal - computed.roundOff)}
              </div>
              <div className="mt-0.5 font-semibold">
                Disc. on GST {uniformGstRate ?? 18} @ {computed.mrpTotal > 0 ? Math.round((computed.discountTotal / computed.mrpTotal) * 1000) / 10 : 0} % + GST
              </div>
            </div>
            <div className="min-w-[210px]">
              <Row k="Net Taxable" v={inr(computed.taxableTotal)} bold />
              <Row k={`CGST${uniformGstRate != null ? ` @ ${uniformGstRate / 2}%` : ""}`} v={inr(computed.cgst)} />
              <Row k={`SGST${uniformGstRate != null ? ` @ ${uniformGstRate / 2}%` : ""}`} v={inr(computed.sgst)} />
              <Row k={`IGST${uniformGstRate != null ? ` @ ${uniformGstRate}%` : ""}`} v={inr(computed.igst)} />
              <Row k="Round Off" v={inr(computed.roundOff)} />
              <div className="mt-1 border-t-2 border-black pt-1">
                <Row k="Grand Total" v={inr(computed.grandTotal)} bold big />
              </div>
              <div className="mt-6 text-right text-[11px] font-bold" style={{ color: "#c1121f" }}>For {company.legal_name}</div>
              <div className="mt-4 text-right text-[10px]">Authorised Sign.</div>
            </div>
          </div>

          {/* Terms & Conditions / E.&O.E. footer */}
          <div className="mt-2 flex items-end justify-between gap-3 border-t border-black pt-1">
            <div className="max-w-[55%] text-[9px] leading-snug">
              <div className="font-bold">TERMS &amp; CONDITIONS</div>
              <div className="whitespace-pre-line">
                {company.terms || "1. Goods once sold will not be taken back.\n2. Subject to Ludhiana jurisdiction only.\n3. 18% Interest will be charged if the bill is not paid within 30 days."}
              </div>
            </div>
            <div className="text-[10px] font-semibold">E. &amp; O.E.</div>
            <div className="text-[10px]">Prepared By</div>
          </div>
        </div>
      </section>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="font-semibold text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

function Row({ k, v, bold, big }: { k: string; v: string; bold?: boolean; big?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${bold ? "font-bold" : ""} ${big ? "text-sm" : ""}`}>
      <span>{k}</span><span>{v}</span>
    </div>
  );
}

/** One "Label : value" line on the printed receiver/transport block. */
function KV({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return <div>{k} : <span className={bold ? "font-semibold" : ""}>{v}</span></div>;
}
