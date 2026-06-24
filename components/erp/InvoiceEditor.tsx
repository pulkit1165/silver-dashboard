"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { computeInvoice, amountInWords, type LineInput } from "@/lib/erp/invoice-engine";

// JSON shapes returned by getInvoiceFull / the API (snake_case from postgres.js).
interface InvoiceRow {
  id: number; invoice_no: string | null; status: string; so_id: number | null;
  buyer_name: string; buyer_gstin: string; buyer_state_code: string; pos_state_code: string;
  seller_state_code: string; tax_type: string; invoice_date: string | null;
  transporter: string; transporter_id: string; vehicle_no: string; lr_no: string; lr_date: string;
  distance_km: number | null; notes: string; irn: string; ewb_no: string; ack_no: string;
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

export default function InvoiceEditor({ data, canEdit }: { data: InvoiceFullProps; canEdit: boolean }) {
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
    transporter: data.invoice.transporter ?? "",
    transporterId: data.invoice.transporter_id ?? "",
    vehicleNo: data.invoice.vehicle_no ?? "",
    lrNo: data.invoice.lr_no ?? "",
    lrDate: data.invoice.lr_date ?? "",
    distanceKm: data.invoice.distance_km ?? ("" as number | ""),
    notes: data.invoice.notes ?? "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

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
        ...hdr, distanceKm: hdr.distanceKm === "" ? null : Number(hdr.distanceKm),
        lines: lines.map((l) => ({ id: l.id, qty: l.qty, discountPct: l.discountPct })),
      }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "Network error" }));
    setBusy(null);
    if (!res.ok) { setMsg(res.error ?? "Save failed"); return; }
    setMsg("Saved."); router.refresh();
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

  return (
    <>
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
        {msg && <span className="text-sm font-semibold text-[var(--muted)]">{msg}</span>}
      </div>

      {editable && (
        <section className="panel no-print mb-4">
          <div className="panel-hd">Invoice details (editable while draft)</div>
          <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-4">
            <Field label="Invoice date"><input type="date" className="ctl" value={hdr.invoiceDate} onChange={(e) => setHdr({ ...hdr, invoiceDate: e.target.value })} /></Field>
            <Field label="Place of supply (state code)" hint={`Seller ${company.state_code || "?"} → ${interState ? "IGST" : "CGST+SGST"}`}><input className="ctl" value={hdr.posStateCode} onChange={(e) => setHdr({ ...hdr, posStateCode: e.target.value })} placeholder="e.g. 33" /></Field>
            <Field label="Transporter"><input className="ctl" value={hdr.transporter} onChange={(e) => setHdr({ ...hdr, transporter: e.target.value })} /></Field>
            <Field label="Transporter ID (GSTIN)"><input className="ctl" value={hdr.transporterId} onChange={(e) => setHdr({ ...hdr, transporterId: e.target.value })} /></Field>
            <Field label="Vehicle no"><input className="ctl" value={hdr.vehicleNo} onChange={(e) => setHdr({ ...hdr, vehicleNo: e.target.value })} /></Field>
            <Field label="LR / GR no"><input className="ctl" value={hdr.lrNo} onChange={(e) => setHdr({ ...hdr, lrNo: e.target.value })} /></Field>
            <Field label="LR / GR date"><input type="date" className="ctl" value={hdr.lrDate} onChange={(e) => setHdr({ ...hdr, lrDate: e.target.value })} /></Field>
            <Field label="Distance (km)"><input type="number" className="ctl" value={hdr.distanceKm} onChange={(e) => setHdr({ ...hdr, distanceKm: e.target.value === "" ? "" : Number(e.target.value) })} /></Field>
          </div>
        </section>
      )}

      {/* ── Printable tax invoice ─────────────────────────────────────── */}
      <section className="print-area inv-doc">
        <div className="border border-black bg-white p-3 text-[11px] leading-tight text-black">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-black pb-2">
            <div>
              <div className="text-base font-extrabold tracking-wide">{company.legal_name}</div>
              {company.trade_name && <div className="font-semibold">{company.trade_name}</div>}
              <div>{company.address}{company.city ? `, ${company.city}` : ""}{company.pincode ? ` - ${company.pincode}` : ""}</div>
              <div>GSTIN: <b>{company.gstin || "—"}</b> · State Code: {company.state_code || "—"}</div>
              {company.phone && <div>Ph: {company.phone}</div>}
              {company.msme_no && <div>MSME: {company.msme_no}</div>}
            </div>
            <div className="text-right">
              <div className="text-base font-extrabold">TAX INVOICE</div>
              <div>Invoice No: <b>{data.invoice.invoice_no ?? `(draft #${data.invoice.id})`}</b></div>
              <div>Date: <b>{hdr.invoiceDate || "—"}</b></div>
              {/* QR slot — filled after e-invoicing */}
              <div className="mt-1 ml-auto flex h-16 w-16 items-center justify-center border border-dashed border-gray-400 text-center text-[8px] text-gray-400">
                {data.invoice.irn ? "e-Invoice QR" : "QR after e-invoice"}
              </div>
            </div>
          </div>

          {/* IRN / e-way row */}
          <div className="grid grid-cols-3 gap-2 border-b border-black py-1">
            <div>IRN: <span className="font-mono">{data.invoice.irn || "— (e-invoice pending)"}</span></div>
            <div>Ack No: {data.invoice.ack_no || "—"}</div>
            <div>e-Way Bill: {data.invoice.ewb_no || "— (pending)"}</div>
          </div>

          {/* Parties */}
          <div className="grid grid-cols-2 gap-2 border-b border-black py-2">
            <div>
              <div className="font-bold underline">Billed to</div>
              <div className="font-semibold">{data.invoice.buyer_name || "—"}</div>
              <div>GSTIN: {data.invoice.buyer_gstin || "—"} · State: {data.invoice.buyer_state_code || "—"}</div>
              <div>Place of Supply (POS): <b>{hdr.posStateCode || "—"}</b></div>
            </div>
            <div>
              <div className="font-bold underline">Transport</div>
              <div>{hdr.transporter || "—"} {hdr.transporterId ? `(${hdr.transporterId})` : ""}</div>
              <div>Vehicle: {hdr.vehicleNo || "—"} · LR/GR: {hdr.lrNo || "—"} {hdr.lrDate ? `dt ${hdr.lrDate}` : ""}</div>
              <div>Distance: {hdr.distanceKm === "" ? "—" : `${hdr.distanceKm} km`}</div>
            </div>
          </div>

          {/* Items */}
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="border-b border-black [&>th]:border-r [&>th]:border-black [&>th]:px-1 [&>th]:py-0.5 [&>th]:text-left">
                <th className="w-8">S.No</th>
                <th>Code</th>
                <th>Description</th>
                <th>HSN / GST%</th>
                <th className="!text-right">Qty</th>
                <th>Unit</th>
                <th className="!text-right">MRP</th>
                <th className="!text-right">Disc%</th>
                <th className="!text-right">Taxable</th>
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
          </table>

          {/* Totals */}
          <div className="mt-2 flex justify-between gap-4">
            <div className="max-w-[55%]">
              <div className="font-bold">Amount in words:</div>
              <div className="italic">{amountInWords(computed.grandTotal)}</div>
              <div className="mt-2 border-t border-black pt-1">
                <div className="font-bold">Bank: {company.bank_name || "—"}</div>
                <div>A/c: {company.bank_account || "—"} · IFSC: {company.bank_ifsc || "—"}</div>
                <div>{company.bank_branch}</div>
              </div>
              {company.terms && <div className="mt-2 whitespace-pre-line text-[9px] text-gray-700">{company.terms}</div>}
            </div>
            <div className="min-w-[230px]">
              <Row k="Total Qty" v={num(lines.reduce((a, l) => a + (l.qty || 0), 0))} />
              <Row k="MRP Value" v={`₹${inr(computed.mrpTotal)}`} />
              <Row k="Discount" v={`− ₹${inr(computed.discountTotal)}`} />
              <Row k="Taxable Value" v={`₹${inr(computed.taxableTotal)}`} bold />
              {interState ? (
                <Row k="IGST @ 18%" v={`₹${inr(computed.igst)}`} />
              ) : (
                <>
                  <Row k="CGST @ 9%" v={`₹${inr(computed.cgst)}`} />
                  <Row k="SGST @ 9%" v={`₹${inr(computed.sgst)}`} />
                </>
              )}
              <Row k="Round Off" v={`₹${inr(computed.roundOff)}`} />
              <div className="mt-1 border-t-2 border-black pt-1">
                <Row k="GRAND TOTAL" v={`₹${inr(computed.grandTotal)}`} bold big />
              </div>
              <div className="mt-6 text-right text-[10px]">For {company.legal_name}</div>
              <div className="mt-4 text-right text-[10px]">Authorised Signatory</div>
            </div>
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
