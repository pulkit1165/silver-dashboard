"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import Scanner from "./Scanner";

type Row = {
  id: string;
  itemCode: string; itemDesc: string; unit: string;
  mPack: string; mMrp: string; mrp: string; slipType: string;
  csNo: string; pcs: string; quantity: string;
  qtyOrdered: string; qtyDispatched: string; pendingQty: string;
};
type Case = { caseNo: number; rows: Row[] };
type Header = {
  slipNo: string; salesOrderNo: string; partyName: string; date: string;
  trType: string; trSno: string; remarks: string;
};

const COLS: { key: keyof Row; label: string; w: string; req?: boolean }[] = [
  { key: "itemCode", label: "Item Code", w: "110px" },
  { key: "itemDesc", label: "Item Description", w: "240px" },
  { key: "unit", label: "Unit", w: "64px" },
  { key: "mPack", label: "M.Pack", w: "72px" },
  { key: "mMrp", label: "M.MRP", w: "78px" },
  { key: "mrp", label: "MRP", w: "78px" },
  { key: "slipType", label: "Slip Type", w: "90px" },
  { key: "csNo", label: "C/S No", w: "70px" },
  { key: "pcs", label: "Pcs", w: "64px" },
  { key: "quantity", label: "Quantity", w: "80px" },
  { key: "qtyOrdered", label: "Qty Ordered", w: "90px" },
  { key: "qtyDispatched", label: "Qty Dispatched", w: "95px" },
  { key: "pendingQty", label: "Pending Qty", w: "90px" },
];
const EXPORT_HEADERS = ["Sr.No", ...COLS.map((c) => c.label)];
const STORE_KEY = "erp_packing_slip_draft_v1";
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));
const blankRow = (csNo: number | null): Row => ({
  id: uid(), itemCode: "", itemDesc: "", unit: "", mPack: "", mMrp: "", mrp: "", slipType: "",
  csNo: csNo ? String(csNo) : "", pcs: "", quantity: "", qtyOrdered: "", qtyDispatched: "", pendingQty: "",
});
const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };

export default function PackingSlip() {
  const today = new Date().toISOString().slice(0, 10);
  const [hdr, setHdr] = useState<Header>({ slipNo: "", salesOrderNo: "", partyName: "", date: today, trType: "PS26", trSno: "", remarks: "" });
  const [activeCaseNo, setActiveCaseNo] = useState<number | null>(null);
  const [activeRows, setActiveRows] = useState<Row[]>([]);
  const [completed, setCompleted] = useState<Case[]>([]);
  const [pickCase, setPickCase] = useState<number>(1);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  // load + autosave draft
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.hdr) setHdr(d.hdr);
        if (d.activeCaseNo != null) setActiveCaseNo(d.activeCaseNo);
        if (Array.isArray(d.activeRows)) setActiveRows(d.activeRows);
        if (Array.isArray(d.completed)) setCompleted(d.completed);
      }
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ hdr, activeCaseNo, activeRows, completed })); } catch { /* ignore */ }
  }, [hdr, activeCaseNo, activeRows, completed, loaded]);

  const usedCases = useMemo(() => new Set([...completed.map((c) => c.caseNo), ...(activeCaseNo ? [activeCaseNo] : [])]), [completed, activeCaseNo]);
  const available = useMemo(() => Array.from({ length: 200 }, (_, i) => i + 1).filter((n) => !usedCases.has(n)), [usedCases]);

  const totals = useMemo(() => {
    const all = [...completed.flatMap((c) => c.rows), ...activeRows];
    const qty = all.reduce((a, r) => a + num(r.quantity), 0);
    const box = completed.length + (activeCaseNo && activeRows.length ? 1 : 0);
    return { box, qty };
  }, [completed, activeRows, activeCaseNo]);

  function flash(ok: boolean, text: string) { setMsg({ ok, text }); setTimeout(() => setMsg(null), 2500); }

  function startCase() {
    if (activeCaseNo) { flash(false, "Finish the current case first (Done Case)."); return; }
    setActiveCaseNo(pickCase);
    setActiveRows([]);
  }

  async function handleScan(code: string) {
    if (!activeCaseNo) return;
    try {
      const r = await fetch("/api/erp/scan/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await r.json();
      if (d.ok && d.sku) {
        setActiveRows((rows) => [...rows, {
          ...blankRow(activeCaseNo),
          itemCode: d.sku.sku_code, itemDesc: d.sku.name, unit: d.sku.unit || "",
          mrp: d.sku.price != null ? String(d.sku.price) : "", mMrp: d.sku.price != null ? String(d.sku.price) : "",
        }]);
        flash(true, `Added ${d.sku.sku_code}`);
      } else {
        setActiveRows((rows) => [...rows, { ...blankRow(activeCaseNo), itemCode: code }]);
        flash(false, `Not in master — added "${code}" to fill manually`);
      }
    } catch {
      setActiveRows((rows) => [...rows, { ...blankRow(activeCaseNo), itemCode: code }]);
      flash(false, "Offline — added scanned code to fill manually");
    }
  }

  const updateRow = (id: string, key: keyof Row, value: string) =>
    setActiveRows((rows) => rows.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  const deleteRow = (id: string) => setActiveRows((rows) => rows.filter((r) => r.id !== id));
  const autoPending = () =>
    setActiveRows((rows) => rows.map((r) => ({ ...r, pendingQty: String(num(r.qtyOrdered) - num(r.qtyDispatched)) })));

  function doneCase() {
    if (!activeCaseNo) return;
    if (activeRows.length === 0) { flash(false, "Add at least one item before closing the case."); return; }
    setCompleted((cs) => [...cs, { caseNo: activeCaseNo, rows: activeRows }].sort((a, b) => a.caseNo - b.caseNo));
    setActiveCaseNo(null); setActiveRows([]);
    flash(true, `Case ${activeCaseNo} closed`);
  }

  function editCase(caseNo: number) {
    if (activeCaseNo) { flash(false, "Finish the current case before editing another."); return; }
    if (!confirm(`Are you sure you want to edit Case ${caseNo}? It will reopen for scanning/editing.`)) return;
    const c = completed.find((x) => x.caseNo === caseNo);
    if (!c) return;
    setCompleted((cs) => cs.filter((x) => x.caseNo !== caseNo));
    setActiveCaseNo(caseNo); setActiveRows(c.rows);
  }
  function deleteCase(caseNo: number) {
    if (!confirm(`Delete Case ${caseNo} and all its items?`)) return;
    setCompleted((cs) => cs.filter((x) => x.caseNo !== caseNo));
  }
  function resetSlip() {
    if (!confirm("Start a new packing slip? This clears the current draft.")) return;
    setHdr({ slipNo: "", salesOrderNo: "", partyName: "", date: today, trType: "PS26", trSno: "", remarks: "" });
    setActiveCaseNo(null); setActiveRows([]); setCompleted([]);
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  }

  function validate(): string[] {
    const e: string[] = [];
    if (!hdr.slipNo.trim()) e.push("Packing Slip No. is required.");
    if (!hdr.salesOrderNo.trim()) e.push("Sales Order No. is required.");
    if (!hdr.partyName.trim()) e.push("Customer / Party Name is required.");
    if (!hdr.date.trim()) e.push("Date is required.");
    if (completed.length === 0) e.push("Add at least one completed case.");
    completed.forEach((c) => { if (c.rows.length === 0) e.push(`Case ${c.caseNo} has no items.`); });
    if (activeCaseNo) e.push(`Case ${activeCaseNo} is still open — click "Done Case" first.`);
    return e;
  }

  function exportExcel() {
    const e = validate();
    setErrors(e);
    if (e.length) { flash(false, "Fix the highlighted issues before exporting."); return; }
    const aoa: (string | number)[][] = [];
    aoa.push(["SILVER INDUSTRIES — PACKING SLIP"]);
    aoa.push([]);
    aoa.push(["Packing Slip No.", hdr.slipNo, "", "Date", hdr.date]);
    aoa.push(["Sales Order No.", hdr.salesOrderNo, "", "Tr Type", hdr.trType]);
    aoa.push(["Party Name", hdr.partyName, "", "Tr Sno", hdr.trSno]);
    aoa.push(["Remarks", hdr.remarks, "", "Total Box", totals.box]);
    aoa.push(["", "", "", "Total Qty", totals.qty]);
    aoa.push([]);
    aoa.push(EXPORT_HEADERS);
    for (const c of completed) {
      aoa.push([`CASE ${c.caseNo}`]);
      c.rows.forEach((r, i) => {
        aoa.push([i + 1, r.itemCode, r.itemDesc, r.unit, r.mPack, r.mMrp, r.mrp, r.slipType, r.csNo, r.pcs, r.quantity, r.qtyOrdered, r.qtyDispatched, r.pendingQty]);
      });
      aoa.push([]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 12 }, { wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 8 }, { wch: 7 }, { wch: 9 }, { wch: 11 }, { wch: 13 }, { wch: 11 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Packing Slip");
    XLSX.writeFile(wb, `PackingSlip_${hdr.slipNo || "draft"}.xlsx`);
    flash(true, "Exported to Excel");
  }

  return (
    <div className="flex flex-col gap-5">
      {msg && (
        <div className="fixed right-4 top-20 z-50 rounded-lg px-4 py-2 text-sm font-bold shadow-lg"
          style={{ background: msg.ok ? "var(--accent-2-bg)" : "var(--danger-bg)", color: msg.ok ? "var(--accent-2)" : "var(--danger)" }}>
          {msg.ok ? "✓ " : "✕ "}{msg.text}
        </div>
      )}

      {/* HEADER */}
      <section className="panel">
        <div className="panel-hd justify-between">
          <span>Packing Slip Details</span>
          <div className="flex gap-2">
            <button onClick={resetSlip} className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold normal-case tracking-normal text-[var(--muted)] hover:bg-[var(--surface-2)]">New slip</button>
            <button onClick={exportExcel} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold normal-case tracking-normal text-white hover:bg-[var(--accent-strong)]">⤓ Export to Excel</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
          <Field label="Packing Slip No." req><input className="ctl" value={hdr.slipNo} onChange={(e) => setHdr({ ...hdr, slipNo: e.target.value })} placeholder="PS26/0001" /></Field>
          <Field label="Sales Order No." req><input className="ctl" value={hdr.salesOrderNo} onChange={(e) => setHdr({ ...hdr, salesOrderNo: e.target.value })} placeholder="SO26/000283" /></Field>
          <Field label="Customer / Party Name" req><input className="ctl" value={hdr.partyName} onChange={(e) => setHdr({ ...hdr, partyName: e.target.value })} placeholder="SAMY AUTO PARTS" /></Field>
          <Field label="Packing Slip Date" req><input type="date" className="ctl" value={hdr.date} onChange={(e) => setHdr({ ...hdr, date: e.target.value })} /></Field>
          <Field label="Tr Type"><input className="ctl" value={hdr.trType} onChange={(e) => setHdr({ ...hdr, trType: e.target.value })} /></Field>
          <Field label="Tr Sno"><input className="ctl" value={hdr.trSno} onChange={(e) => setHdr({ ...hdr, trSno: e.target.value })} /></Field>
          <Field label="Remarks"><input className="ctl" value={hdr.remarks} onChange={(e) => setHdr({ ...hdr, remarks: e.target.value })} /></Field>
          <div className="flex items-end gap-2">
            <div className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"><div className="text-[10px] font-bold uppercase text-[var(--muted-2)]">Total Box</div><div className="text-lg font-extrabold tabular-nums">{totals.box}</div></div>
            <div className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"><div className="text-[10px] font-bold uppercase text-[var(--muted-2)]">Total Qty</div><div className="text-lg font-extrabold tabular-nums">{totals.qty}</div></div>
          </div>
        </div>
        {errors.length > 0 && (
          <div className="mx-4 mb-4 rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
            <b>Cannot export:</b>
            <ul className="ml-4 list-disc">{errors.map((er, i) => <li key={i}>{er}</li>)}</ul>
          </div>
        )}
      </section>

      {/* ACTIVE CASE */}
      <section className="panel">
        <div className="panel-hd">{activeCaseNo ? `Packing Case ${activeCaseNo}` : "Start a Case"}</div>
        <div className="p-4">
          {!activeCaseNo ? (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Case Number (1–200)">
                <select className="ctl" value={pickCase} onChange={(e) => setPickCase(Number(e.target.value))}>
                  {available.map((n) => <option key={n} value={n}>Case {n}</option>)}
                </select>
              </Field>
              <button onClick={startCase} disabled={available.length === 0} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50">Start Case {pickCase}</button>
              <span className="text-xs text-[var(--muted)]">Pick a case, then scan items into it.</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
              <div>
                <Scanner onDetect={handleScan} continuous />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => setActiveRows((r) => [...r, blankRow(activeCaseNo)])} className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)]">+ Manual row</button>
                  <button onClick={autoPending} className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)]" title="Pending = Ordered − Dispatched">Auto pending</button>
                </div>
              </div>
              <div className="min-w-0">
                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="rtable" style={{ minWidth: "1100px" }}>
                    <thead>
                      <tr>
                        <th>#</th>
                        {COLS.map((c) => <th key={c.key}>{c.label}</th>)}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeRows.length === 0 && <tr><td colSpan={COLS.length + 2} className="!py-6 text-center text-[var(--muted)]">Scan an item or add a manual row.</td></tr>}
                      {activeRows.map((r, i) => (
                        <tr key={r.id}>
                          <td className="text-[var(--muted)]">{i + 1}</td>
                          {COLS.map((c) => (
                            <td key={c.key} style={{ minWidth: c.w }}>
                              <input className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
                                style={{ minWidth: c.w }} value={r[c.key]} onChange={(e) => updateRow(r.id, c.key, e.target.value)} />
                            </td>
                          ))}
                          <td><button onClick={() => deleteRow(r.id)} className="rounded px-2 py-1 text-xs font-bold text-[var(--danger)] hover:bg-[var(--danger-bg)]">✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={doneCase} className="rounded-lg bg-[var(--accent-2)] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90">✓ Done Case {activeCaseNo}</button>
                  <span className="text-xs text-[var(--muted)]">{activeRows.length} item(s) in this case</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* COMPLETED CASES */}
      <section className="panel">
        <div className="panel-hd">Completed Cases ({completed.length})</div>
        <div className="flex flex-col gap-2 p-3">
          {completed.length === 0 && <p className="p-3 text-sm text-[var(--muted)]">No cases closed yet. Close a case above and it appears here.</p>}
          {completed.map((c) => (
            <details key={c.caseNo} className="rounded-lg border border-[var(--border)]">
              <summary className="flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm font-bold">
                <span>Case {c.caseNo} <span className="ml-2 font-medium text-[var(--muted)]">· {c.rows.length} item(s) · {c.rows.reduce((a, r) => a + num(r.quantity), 0)} qty</span></span>
                <span className="flex gap-2">
                  <button onClick={(e) => { e.preventDefault(); editCase(c.caseNo); }} className="rounded border border-[var(--border)] bg-white px-3 py-1 text-xs font-bold text-[var(--accent-strong)] hover:bg-[var(--accent-bg)]">Edit</button>
                  <button onClick={(e) => { e.preventDefault(); deleteCase(c.caseNo); }} className="rounded border border-[var(--border)] bg-white px-3 py-1 text-xs font-bold text-[var(--danger)] hover:bg-[var(--danger-bg)]">Delete</button>
                </span>
              </summary>
              <div className="overflow-x-auto border-t border-[var(--border)]">
                <table className="rtable" style={{ minWidth: "1000px" }}>
                  <thead><tr><th>#</th>{COLS.map((c2) => <th key={c2.key}>{c2.label}</th>)}</tr></thead>
                  <tbody>
                    {c.rows.map((r, i) => (
                      <tr key={r.id}><td>{i + 1}</td>{COLS.map((c2) => <td key={c2.key} className="text-xs">{r[c2.key] || "—"}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

function Field({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
      <span>{label}{req && <span className="text-[var(--accent)]"> *</span>}</span>
      {children}
    </label>
  );
}
