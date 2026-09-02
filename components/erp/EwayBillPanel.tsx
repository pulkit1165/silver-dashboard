"use client";

import { useEffect, useState } from "react";
import type { EwbPayload, EwbQueueRow } from "@/lib/erp/ewb";

export default function EwayBillPanel() {
  const [rows, setRows] = useState<EwbQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [payload, setPayload] = useState<EwbPayload | null>(null);
  const [form, setForm] = useState({ ewb_no: "", ewb_valid_until: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/erp/gst/eway-bills", { cache: "no-store" });
      const d = await r.json();
      if (d.ok) setRows(d.queue);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function open(id: number) {
    setOpenId(id); setPayload(null);
    const r = await fetch(`/api/erp/invoices/${id}/ewb`);
    const d = await r.json();
    if (d.ok) { setPayload(d.payload); setForm({ ewb_no: d.payload.existing.ewbNo, ewb_valid_until: d.payload.existing.ewbValidUntil }); }
  }

  async function save() {
    if (!openId) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/erp/invoices/${openId}/ewb`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { setMsg({ ok: false, text: d.error || "Could not save." }); return; }
      setMsg({ ok: true, text: "Saved." });
      setOpenId(null); load();
    } catch { setMsg({ ok: false, text: "Network error." }); } finally { setBusy(false); }
  }

  const view = filter === "pending" ? rows.filter((r) => !r.ewb_no) : rows;
  const inp = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm outline-none focus:border-[var(--accent)]";

  return (
    <>
      <section className="panel">
        <div className="panel-hd flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>Invoices needing an e-way bill</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className={inp}>
              <option value="pending">Pending only</option>
              <option value="all">All (incl. recorded)</option>
            </select>
          </div>
          <span className="text-xs font-semibold text-[var(--muted)]">{rows.filter((r) => !r.ewb_no).length} pending</span>
        </div>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>Invoice</th><th>Date</th><th>Buyer</th><th className="!text-right">Value</th><th>Vehicle</th><th>Transporter</th><th>EWB status</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="!py-6 text-center text-[var(--muted)]">Loading…</td></tr>}
              {!loading && view.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.invoice_no}</td>
                  <td className="text-xs">{r.invoice_date}</td>
                  <td className="font-semibold">{r.buyer_name}</td>
                  <td className="num-cell">₹{r.grand_total.toLocaleString("en-IN")}</td>
                  <td className="text-xs">{r.vehicle_no || <span className="text-[var(--danger)]">missing</span>}</td>
                  <td className="text-xs">{r.transporter || "—"}</td>
                  <td>{r.ewb_no ? <span className="tag g">{r.ewb_no}</span> : <span className="tag">pending</span>}</td>
                  <td className="text-right">
                    <button onClick={() => open(r.id)} className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)]">Open</button>
                  </td>
                </tr>
              ))}
              {!loading && view.length === 0 && <tr><td colSpan={8} className="!py-6 text-center text-[var(--muted)]">Nothing here.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {openId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpenId(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-extrabold">EWB-01 field sheet {payload ? `· ${payload.invoiceNo}` : ""}</h2>
              <button onClick={() => setOpenId(null)} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-sm font-bold hover:bg-[var(--surface-2)]">✕</button>
            </div>

            {!payload ? <p className="text-sm text-[var(--muted)]">Loading…</p> : (
              <div className="flex flex-col gap-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Document type"><span>{payload.docType}</span></Field>
                  <Field label="Supply type"><span>{payload.supplyType} · {payload.subType}</span></Field>
                  <Field label="Document no. / date"><span>{payload.invoiceNo} · {payload.invoiceDate}</span></Field>
                  <Field label="Place of supply"><span>{payload.posStateCode} — {payload.posStateName}</span></Field>
                </div>

                <div className="rounded-lg border border-[var(--border)] p-3">
                  <div className="mb-2 text-xs font-extrabold uppercase text-[var(--muted)]">From (consignor)</div>
                  <div>{payload.from.name} — GSTIN {payload.from.gstin || "—"}</div>
                  <div className="text-xs text-[var(--muted)]">{payload.from.address}</div>
                  <div className="text-xs text-[var(--muted)]">State: {payload.from.stateCode} — {payload.from.stateName}</div>
                </div>
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <div className="mb-2 text-xs font-extrabold uppercase text-[var(--muted)]">To (consignee)</div>
                  <div>{payload.to.name} — GSTIN {payload.to.gstin || "— (unregistered)"}</div>
                  <div className="text-xs text-[var(--muted)]">State: {payload.to.stateCode} — {payload.to.stateName}</div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="rtable">
                    <thead><tr><th>HSN</th><th>Description</th><th className="!text-right">Qty</th><th>Unit</th><th className="!text-right">Rate</th><th className="!text-right">Taxable</th></tr></thead>
                    <tbody>
                      {payload.items.map((it, i) => (
                        <tr key={i}><td className="font-mono text-xs">{it.hsn || "—"}</td><td>{it.description}</td>
                          <td className="num-cell">{it.qty}</td><td>{it.unit}</td><td className="num-cell">{it.gstRate}%</td><td className="num-cell">{it.taxableValue.toFixed(2)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-4">
                  <Stat label="Taxable" value={payload.taxableTotal} /><Stat label="IGST" value={payload.igst} />
                  <Stat label="CGST+SGST" value={payload.cgst + payload.sgst} /><Stat label="Grand total" value={payload.grandTotal} />
                </div>

                <div className="rounded-lg border border-[var(--border)] p-3">
                  <div className="mb-2 text-xs font-extrabold uppercase text-[var(--muted)]">Transport details</div>
                  {!payload.transporter.name && !payload.transporter.vehicleNo ? (
                    <p className="text-xs font-semibold text-[var(--danger)]">Missing — fill in Transporter/Vehicle no. on the invoice before filing.</p>
                  ) : (
                    <>
                      <div>{payload.transporter.name || "—"} {payload.transporter.id ? `(${payload.transporter.id})` : ""}</div>
                      <div className="text-xs text-[var(--muted)]">Vehicle: {payload.transporter.vehicleNo || "—"} · Distance: {payload.transporter.distanceKm ?? "—"} km</div>
                      <div className="text-xs text-[var(--muted)]">LR/GR: {payload.docNo.lrNo || "—"} {payload.docNo.lrDate ? `dt ${payload.docNo.lrDate}` : ""}</div>
                    </>
                  )}
                </div>

                <div className="rounded-lg border border-dashed border-[var(--accent)] p-3">
                  <div className="mb-2 text-xs font-extrabold uppercase text-[var(--muted)]">Once generated on ewaybillgst.gov.in, record it here</div>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">EWB number
                      <input className={inp} value={form.ewb_no} onChange={(e) => setForm({ ...form, ewb_no: e.target.value })} placeholder="12-digit EWB no." /></label>
                    <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Valid until
                      <input type="date" className={inp} value={form.ewb_valid_until} onChange={(e) => setForm({ ...form, ewb_valid_until: e.target.value })} /></label>
                    <button onClick={save} disabled={busy} className="rounded-lg bg-[var(--accent-2)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
                  </div>
                  {msg && <p className={`mt-2 text-xs font-bold ${msg.ok ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{msg.ok ? "✓ " : "✕ "}{msg.text}</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[10px] font-bold uppercase text-[var(--muted-2)]">{label}</div>{children}</div>;
}
function Stat({ label, value }: { label: string; value: number }) {
  return <div><div className="text-[10px] font-bold uppercase text-[var(--muted-2)]">{label}</div><div className="font-extrabold">₹{value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div></div>;
}
