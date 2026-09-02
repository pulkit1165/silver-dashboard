"use client";

import { useState } from "react";
import type { Gstr1Result } from "@/lib/erp/gstr1";

function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const from = `${ym}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${ym}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}
function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function Gstr1Panel() {
  const [period, setPeriod] = useState(thisMonth());
  const [advanced, setAdvanced] = useState(false);
  const [range, setRange] = useState(monthBounds(thisMonth()));
  const [data, setData] = useState<Gstr1Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"b2b" | "b2cl" | "b2cs" | "hsn">("b2b");

  const { from, to } = advanced ? range : monthBounds(period);

  async function loadPreview() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/erp/gst/gstr1?from=${from}&to=${to}&format=preview`);
      const d = await r.json();
      if (!r.ok || !d.ok) { setErr(d.error || "Could not build the report."); setData(null); return; }
      setData(d.data);
    } catch { setErr("Network error."); } finally { setBusy(false); }
  }

  function download(format: "json" | "xlsx") {
    window.location.href = `/api/erp/gst/gstr1?from=${from}&to=${to}&format=${format}`;
  }

  const inp = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm outline-none focus:border-[var(--accent)]";

  return (
    <div className="flex flex-col gap-4">
      <section className="panel p-4">
        <div className="flex flex-wrap items-end gap-3">
          {!advanced ? (
            <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Return period
              <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className={inp} /></label>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">From
                <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className={inp} /></label>
              <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">To
                <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className={inp} /></label>
            </>
          )}
          <label className="flex items-center gap-1.5 pb-2 text-xs font-semibold text-[var(--muted)]">
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} /> Custom date range (quarterly filers)
          </label>
          <button onClick={loadPreview} disabled={busy} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-60">
            {busy ? "Building…" : "Build report"}
          </button>
          {data && (
            <>
              <button onClick={() => download("xlsx")} className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">⬇ Excel (all sheets)</button>
              <button onClick={() => download("json")} className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">⬇ JSON</button>
            </>
          )}
        </div>
        {err && <p className="mt-3 text-sm font-bold text-[var(--danger)]">✕ {err}</p>}
      </section>

      {data && (
        <>
          <section className="panel grid grid-cols-2 gap-4 p-4 md:grid-cols-5">
            <Stat label="Invoices" value={data.summary.invoiceCount} />
            <Stat label="B2B lines" value={data.summary.b2bCount} />
            <Stat label="B2C large" value={data.summary.b2clCount} />
            <Stat label="Taxable value" value={`₹${data.summary.taxableTotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
            <Stat label="Total tax" value={`₹${data.summary.taxTotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
          </section>

          {data.warnings.length > 0 && (
            <section className="panel border-l-4 border-l-[var(--danger)] p-4">
              <div className="mb-1 text-xs font-extrabold uppercase text-[var(--danger)]">⚠ {data.warnings.length} warning(s) — review before filing</div>
              <ul className="list-inside list-disc text-xs text-[var(--muted)]">
                {data.warnings.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </section>
          )}

          <section className="panel">
            <div className="flex gap-1 border-b border-[var(--border)] p-2">
              {(["b2b", "b2cl", "b2cs", "hsn"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase ${tab === t ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:bg-[var(--surface-2)]"}`}>
                  {t === "b2b" ? "B2B" : t === "b2cl" ? "B2C Large" : t === "b2cs" ? "B2C Summary" : "HSN Summary"}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              {tab === "b2b" && (
                <table className="rtable">
                  <thead><tr><th>GSTIN</th><th>Invoice</th><th>Date</th><th>POS</th><th className="!text-right">Value</th><th className="!text-right">Rate</th><th className="!text-right">Taxable</th><th className="!text-right">IGST</th><th className="!text-right">CGST</th><th className="!text-right">SGST</th></tr></thead>
                  <tbody>
                    {data.b2b.flatMap((g) => g.invoices.flatMap((inv) => inv.items.map((it, i) => (
                      <tr key={`${inv.inum}-${it.rt}-${i}`}>
                        <td className="font-mono text-xs">{g.ctin}</td><td>{inv.inum}</td><td className="text-xs">{inv.idt}</td><td>{inv.pos}</td>
                        <td className="num-cell">{inv.val.toLocaleString("en-IN")}</td><td className="num-cell">{it.rt}%</td>
                        <td className="num-cell">{it.txval.toFixed(2)}</td><td className="num-cell">{it.iamt.toFixed(2)}</td><td className="num-cell">{it.camt.toFixed(2)}</td><td className="num-cell">{it.samt.toFixed(2)}</td>
                      </tr>
                    ))))}
                    {data.b2b.length === 0 && <tr><td colSpan={10} className="!py-6 text-center text-[var(--muted)]">No B2B invoices in this period.</td></tr>}
                  </tbody>
                </table>
              )}
              {tab === "b2cl" && (
                <table className="rtable">
                  <thead><tr><th>POS</th><th>Invoice</th><th>Date</th><th className="!text-right">Value</th><th className="!text-right">Rate</th><th className="!text-right">Taxable</th><th className="!text-right">IGST</th></tr></thead>
                  <tbody>
                    {data.b2cl.flatMap((g) => g.invoices.flatMap((inv) => inv.items.map((it, i) => (
                      <tr key={`${inv.inum}-${it.rt}-${i}`}>
                        <td>{g.pos}</td><td>{inv.inum}</td><td className="text-xs">{inv.idt}</td>
                        <td className="num-cell">{inv.val.toLocaleString("en-IN")}</td><td className="num-cell">{it.rt}%</td>
                        <td className="num-cell">{it.txval.toFixed(2)}</td><td className="num-cell">{it.iamt.toFixed(2)}</td>
                      </tr>
                    ))))}
                    {data.b2cl.length === 0 && <tr><td colSpan={7} className="!py-6 text-center text-[var(--muted)]">No B2C-large invoices in this period.</td></tr>}
                  </tbody>
                </table>
              )}
              {tab === "b2cs" && (
                <table className="rtable">
                  <thead><tr><th>POS</th><th className="!text-right">Rate</th><th className="!text-right">Taxable</th><th className="!text-right">IGST</th><th className="!text-right">CGST</th><th className="!text-right">SGST</th></tr></thead>
                  <tbody>
                    {data.b2cs.map((r, i) => (
                      <tr key={i}><td>{r.pos}</td><td className="num-cell">{r.rt}%</td><td className="num-cell">{r.txval.toFixed(2)}</td>
                        <td className="num-cell">{r.iamt.toFixed(2)}</td><td className="num-cell">{r.camt.toFixed(2)}</td><td className="num-cell">{r.samt.toFixed(2)}</td></tr>
                    ))}
                    {data.b2cs.length === 0 && <tr><td colSpan={6} className="!py-6 text-center text-[var(--muted)]">No B2C invoices in this period.</td></tr>}
                  </tbody>
                </table>
              )}
              {tab === "hsn" && (
                <table className="rtable">
                  <thead><tr><th>HSN</th><th>UQC</th><th className="!text-right">Qty</th><th className="!text-right">Rate</th><th className="!text-right">Taxable</th><th className="!text-right">IGST</th><th className="!text-right">CGST</th><th className="!text-right">SGST</th></tr></thead>
                  <tbody>
                    {data.hsn.map((h, i) => (
                      <tr key={i}><td className="font-mono text-xs">{h.hsn}</td><td>{h.uqc}</td><td className="num-cell">{h.qty}</td><td className="num-cell">{h.rt}%</td>
                        <td className="num-cell">{h.txval.toFixed(2)}</td><td className="num-cell">{h.iamt.toFixed(2)}</td><td className="num-cell">{h.camt.toFixed(2)}</td><td className="num-cell">{h.samt.toFixed(2)}</td></tr>
                    ))}
                    {data.hsn.length === 0 && <tr><td colSpan={8} className="!py-6 text-center text-[var(--muted)]">No lines in this period.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase text-[var(--muted-2)]">{label}</div>
      <div className="text-lg font-extrabold">{value}</div>
    </div>
  );
}
