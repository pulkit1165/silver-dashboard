"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import type { Gstr2bUploadRow, ReconcileRow, ReconcileStatus } from "@/lib/erp/gstr2b";

const STATUS_META: Record<ReconcileStatus, { label: string; tag: string; hint: string }> = {
  matched: { label: "Matched", tag: "tag g", hint: "Found in both GSTR-2B and your vendor bills, amounts agree." },
  amount_mismatch: { label: "Amount mismatch", tag: "tag n", hint: "Same invoice on both sides, but the value differs — check for a data entry error." },
  missing_in_books: { label: "Missing in books", tag: "tag", hint: "GSTN has this invoice from the supplier, but there's no matching vendor bill entered — ITC being offered on record; enter the bill so it's tracked." },
  missing_in_2b: { label: "Missing in 2B", tag: "tag", hint: "You have a vendor bill on file this month, but the supplier hasn't (yet) reported it — ITC is at risk until they file." },
};

function thisMonthPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function Gstr2bPanel() {
  const [uploads, setUploads] = useState<Gstr2bUploadRow[]>([]);
  const [period, setPeriod] = useState(thisMonthPeriod());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [rows, setRows] = useState<ReconcileRow[]>([]);
  const [summary, setSummary] = useState<Record<ReconcileStatus, number> | null>(null);
  const [filter, setFilter] = useState<"all" | ReconcileStatus>("all");
  const [loadingRecon, setLoadingRecon] = useState(false);

  async function loadUploads() {
    try {
      const r = await fetch("/api/erp/gst/gstr2b", { cache: "no-store" });
      const d = await r.json();
      if (d.ok) setUploads(d.uploads);
    } catch { /* ignore */ }
  }
  useEffect(() => { loadUploads(); }, []);

  async function onFile(file: File) {
    setBusy(true); setMsg(null);
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const r = await fetch("/api/erp/gst/gstr2b", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ period, fileName: file.name, raw }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { setMsg({ ok: false, text: d.error || "Upload failed." }); return; }
      setMsg({ ok: true, text: `Uploaded ${d.count} record(s).` });
      loadUploads(); openReconcile(d.id);
    } catch { setMsg({ ok: false, text: "Could not read that file — is it valid JSON?" }); } finally { setBusy(false); }
  }

  async function openReconcile(uploadId: number) {
    setSelected(uploadId); setLoadingRecon(true); setRows([]); setSummary(null);
    try {
      const r = await fetch(`/api/erp/gst/gstr2b/${uploadId}/reconcile`);
      const d = await r.json();
      if (d.ok) { setRows(d.rows); setSummary(d.summary); }
    } finally { setLoadingRecon(false); }
  }

  function exportMismatches() {
    const bad = rows.filter((r) => r.status !== "matched");
    const aoa = [["Status", "Supplier GSTIN", "Supplier", "Invoice No", "Invoice Date", "GSTR-2B Value", "Book Value"],
      ...bad.map((r) => [STATUS_META[r.status].label, r.supplierGstin, r.supplierName, r.invoiceNo, r.invoiceDate, r.gstr2bValue ?? "", r.bookValue ?? ""])];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Mismatches");
    XLSX.writeFile(wb, `gstr2b-mismatches-${period}.xlsx`);
  }

  const view = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const inp = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm outline-none focus:border-[var(--accent)]";

  return (
    <div className="flex flex-col gap-4">
      <section className="panel p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Return period (YYYYMM)
            <input value={period} onChange={(e) => setPeriod(e.target.value.replace(/\D/g, "").slice(0, 6))} className={inp} placeholder="202609" /></label>
          <div>
            <div className="mb-1 text-xs font-bold text-[var(--muted)]">Upload GSTR-2B JSON (from the GST portal)</div>
            <input type="file" accept=".json" disabled={busy || !/^\d{6}$/.test(period)}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
              className="block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:px-3 file:py-2 file:text-sm file:font-bold file:text-white disabled:opacity-50" />
          </div>
        </div>
        {msg && <p className={`mt-2 text-sm font-bold ${msg.ok ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{msg.ok ? "✓ " : "✕ "}{msg.text}</p>}
      </section>

      <section className="panel">
        <div className="panel-hd">Past uploads</div>
        <table className="rtable">
          <thead><tr><th>Period</th><th>File</th><th>Uploaded by</th><th>When</th><th className="!text-right">Records</th><th></th></tr></thead>
          <tbody>
            {uploads.map((u) => (
              <tr key={u.id} className={selected === u.id ? "bg-[var(--surface-2)]" : ""}>
                <td className="font-mono text-xs">{u.period}</td><td className="text-xs">{u.file_name}</td>
                <td className="text-xs">{u.uploaded_by || "—"}</td><td className="text-xs">{u.created_at}</td>
                <td className="num-cell">{u.record_count}</td>
                <td className="text-right"><button onClick={() => openReconcile(u.id)} className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)]">Reconcile</button></td>
              </tr>
            ))}
            {uploads.length === 0 && <tr><td colSpan={6} className="!py-6 text-center text-[var(--muted)]">No uploads yet.</td></tr>}
          </tbody>
        </table>
      </section>

      {selected != null && (
        <section className="panel">
          <div className="panel-hd flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span>Reconciliation</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className={inp}>
                <option value="all">All ({rows.length})</option>
                {(Object.keys(STATUS_META) as ReconcileStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_META[s].label} ({summary?.[s] ?? 0})</option>
                ))}
              </select>
            </div>
            <button onClick={exportMismatches} disabled={rows.length === 0} className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)] disabled:opacity-50">⬇ Export mismatches</button>
          </div>

          {summary && (
            <div className="grid grid-cols-2 gap-3 border-b border-[var(--border)] p-4 sm:grid-cols-4">
              {(Object.keys(STATUS_META) as ReconcileStatus[]).map((s) => (
                <div key={s} title={STATUS_META[s].hint}>
                  <div className="text-[10px] font-bold uppercase text-[var(--muted-2)]">{STATUS_META[s].label}</div>
                  <div className="text-lg font-extrabold">{summary[s]}</div>
                </div>
              ))}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="rtable">
              <thead><tr><th>Status</th><th>Supplier</th><th>GSTIN</th><th>Invoice</th><th>Date</th><th className="!text-right">GSTR-2B value</th><th className="!text-right">Book value</th></tr></thead>
              <tbody>
                {loadingRecon && <tr><td colSpan={7} className="!py-6 text-center text-[var(--muted)]">Reconciling…</td></tr>}
                {!loadingRecon && view.map((r, i) => (
                  <tr key={i}>
                    <td><span className={STATUS_META[r.status].tag} title={STATUS_META[r.status].hint}>{STATUS_META[r.status].label}</span></td>
                    <td className="font-semibold">{r.supplierName || "—"}</td><td className="font-mono text-xs">{r.supplierGstin}</td>
                    <td>{r.invoiceNo}</td><td className="text-xs">{r.invoiceDate}</td>
                    <td className="num-cell">{r.gstr2bValue != null ? r.gstr2bValue.toFixed(2) : "—"}</td>
                    <td className="num-cell">{r.bookValue != null ? r.bookValue.toFixed(2) : "—"}</td>
                  </tr>
                ))}
                {!loadingRecon && view.length === 0 && <tr><td colSpan={7} className="!py-6 text-center text-[var(--muted)]">Nothing in this bucket.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
