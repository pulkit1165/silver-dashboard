"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  slipNo: string; billNo: string; salesOrderNo: string; partyName: string; date: string;
  trType: string; trSno: string; remarks: string;
};
type SlipDoc = { hdr: Header; activeCaseNo: number | null; activeRows: Row[]; completed: Case[] };
type SlipMeta = { id: number; slip_no: string; party: string | null; updated_by: string | null; updated_at: string };

const COLS: { key: keyof Row; label: string; w: string }[] = [
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
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));
const blankRow = (csNo: number | null): Row => ({
  id: uid(), itemCode: "", itemDesc: "", unit: "", mPack: "", mMrp: "", mrp: "", slipType: "",
  csNo: csNo ? String(csNo) : "", pcs: "", quantity: "", qtyOrdered: "", qtyDispatched: "", pendingQty: "",
});
const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };
const emptyHeader = (): Header => ({ slipNo: "", billNo: "", salesOrderNo: "", partyName: "", date: new Date().toISOString().slice(0, 10), trType: "PS26", trSno: "", remarks: "" });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-06-10" -> "10-Jun-26" to match the printed slip.
const fmtDate = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${m[3]}-${MONTHS[+m[2] - 1]}-${m[1].slice(2)}` : (iso || ""); };

// The finished slip is item-wise (not case-wise): one line per item, quantity summed
// across every case, and the set of cases it lives in shown in the "Case No" column.
type SlipItem = { code: string; desc: string; mrp: string; cases: number[]; qty: number };
function buildSlipItems(cases: Case[]): SlipItem[] {
  const map = new Map<string, SlipItem>();
  for (const c of cases) for (const r of c.rows) {
    const code = r.itemCode.trim() || "(blank)";
    const qty = num(r.quantity) || num(r.pcs);
    const ex = map.get(code);
    if (ex) {
      ex.qty += qty;
      if (!ex.cases.includes(c.caseNo)) ex.cases.push(c.caseNo);
      if (!ex.desc && r.itemDesc) ex.desc = r.itemDesc;
      if (!ex.mrp && (r.mrp || r.mMrp)) ex.mrp = r.mrp || r.mMrp;
    } else {
      map.set(code, { code, desc: r.itemDesc, mrp: r.mrp || r.mMrp, cases: [c.caseNo], qty });
    }
  }
  const items = [...map.values()];
  items.forEach((it) => it.cases.sort((a, b) => a - b));
  // Group like the legacy slip: by the 2-digit part-category embedded in the code, then by code.
  const cat = (code: string) => { const m = /^[A-Za-z]{2}(\d{2})/.exec(code); return m ? +m[1] : 999; };
  items.sort((a, b) => cat(a.code) - cat(b.code) || a.code.localeCompare(b.code));
  return items;
}
// Compress sorted case numbers into slip style: [6,7,8] -> "6-8", [1,6] -> "1, 6", [2,3] -> "2-3".
function casesLabel(cases: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < cases.length; ) {
    let j = i;
    while (j + 1 < cases.length && cases[j + 1] === cases[j] + 1) j++;
    out.push(i === j ? String(cases[i]) : `${cases[i]}-${cases[j]}`);
    i = j + 1;
  }
  return out.join(", ");
}

export default function PackingSlip() {
  const [hdr, setHdr] = useState<Header>(emptyHeader());
  const [activeCaseNo, setActiveCaseNo] = useState<number | null>(null);
  const [activeRows, setActiveRows] = useState<Row[]>([]);
  const [completed, setCompleted] = useState<Case[]>([]);
  const [pickCase, setPickCase] = useState<number>(1);
  const [slips, setSlips] = useState<SlipMeta[]>([]);
  const [slipId, setSlipId] = useState<number | null>(null);
  const [save, setSave] = useState<"idle" | "saving" | "saved">("idle");
  const [collab, setCollab] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  // refs so interval callbacks read fresh values without stale closures
  const stateRef = useRef<SlipDoc>({ hdr, activeCaseNo, activeRows, completed });
  const slipIdRef = useRef<number | null>(null);
  const serverAtRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const lastEditRef = useRef(0);
  useEffect(() => { stateRef.current = { hdr, activeCaseNo, activeRows, completed }; }, [hdr, activeCaseNo, activeRows, completed]);
  useEffect(() => { slipIdRef.current = slipId; }, [slipId]);

  const touch = () => { dirtyRef.current = true; lastEditRef.current = Date.now(); };
  function flash(ok: boolean, text: string) { setMsg({ ok, text }); setTimeout(() => setMsg(null), 2500); }

  const refreshList = async () => {
    try { const r = await fetch("/api/erp/packing-slips", { cache: "no-store" }); const d = await r.json(); setSlips(d.slips || []); } catch { /* ignore */ }
  };
  function applyDoc(doc: SlipDoc) {
    setHdr({ ...emptyHeader(), ...(doc.hdr || {}) });
    setActiveCaseNo(doc.activeCaseNo ?? null);
    setActiveRows(doc.activeRows || []);
    setCompleted(doc.completed || []);
  }
  async function openById(id: number) {
    try {
      const r = await fetch(`/api/erp/packing-slips/${id}`, { cache: "no-store" });
      const d = await r.json();
      if (d.ok) { applyDoc(d.slip.data as SlipDoc); setSlipId(d.slip.id); serverAtRef.current = d.slip.updated_at; dirtyRef.current = false; flash(true, `Opened ${d.slip.slip_no}`); }
    } catch { /* ignore */ }
  }

  async function doSave() {
    const s = stateRef.current;
    if (!s.hdr.slipNo.trim()) return;
    setSave("saving");
    try {
      const r = await fetch("/api/erp/packing-slips", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slipNo: s.hdr.slipNo.trim(), soNo: s.hdr.salesOrderNo, party: s.hdr.partyName, data: s }),
      });
      const d = await r.json();
      if (d.ok) { setSlipId(d.id); serverAtRef.current = d.updated_at; setSave("saved"); }
      else setSave("idle");
    } catch { setSave("idle"); }
  }

  // load list + last opened slip
  useEffect(() => {
    refreshList();
    const last = (() => { try { return localStorage.getItem("erp_ps_last_id"); } catch { return null; } })();
    if (last) openById(Number(last));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (slipId) { try { localStorage.setItem("erp_ps_last_id", String(slipId)); } catch { /* ignore */ } } }, [slipId]);

  // autosave (when the local user changed something) + live poll (pull others' changes)
  useEffect(() => {
    const saver = setInterval(() => {
      if (dirtyRef.current && stateRef.current.hdr.slipNo.trim()) { dirtyRef.current = false; doSave(); }
    }, 1200);
    const poller = setInterval(async () => {
      const id = slipIdRef.current;
      if (!id) return;
      try {
        const r = await fetch(`/api/erp/packing-slips/${id}`, { cache: "no-store" });
        const d = await r.json();
        if (d.ok && d.slip.updated_at !== serverAtRef.current) {
          // only adopt remote changes when this user is idle (don't clobber active typing)
          if (!dirtyRef.current && Date.now() - lastEditRef.current > 2600) {
            applyDoc(d.slip.data as SlipDoc);
            serverAtRef.current = d.slip.updated_at;
            setCollab(`Updated live by ${d.slip.updated_by || "another user"}`);
            setTimeout(() => setCollab(null), 4000);
          }
        }
      } catch { /* ignore */ }
    }, 2500);
    return () => { clearInterval(saver); clearInterval(poller); };
  }, []);

  const usedCases = useMemo(() => new Set([...completed.map((c) => c.caseNo), ...(activeCaseNo ? [activeCaseNo] : [])]), [completed, activeCaseNo]);
  const available = useMemo(() => Array.from({ length: 200 }, (_, i) => i + 1).filter((n) => !usedCases.has(n)), [usedCases]);
  // Keep the picker on a case number that is still free (a done case is never re-selectable).
  useEffect(() => { if (!available.includes(pickCase) && available.length) setPickCase(available[0]); }, [available, pickCase]);
  const totals = useMemo(() => {
    const all = [...completed.flatMap((c) => c.rows), ...activeRows];
    return { box: completed.length + (activeCaseNo && activeRows.length ? 1 : 0), qty: all.reduce((a, r) => a + num(r.quantity), 0) };
  }, [completed, activeRows, activeCaseNo]);
  const slipItems = useMemo(() => buildSlipItems(completed), [completed]);
  const slipQty = useMemo(() => slipItems.reduce((a, it) => a + it.qty, 0), [slipItems]);

  const setHeader = (field: keyof Header, value: string) => { setHdr((h) => ({ ...h, [field]: value })); touch(); };

  function startCase() {
    if (activeCaseNo) { flash(false, "Finish the current case first (Done Case)."); return; }
    if (usedCases.has(pickCase)) { flash(false, `Case ${pickCase} already exists for this slip — use Edit to change it.`); return; }
    setActiveCaseNo(pickCase); setActiveRows([]); touch();
  }
  async function handleScan(code: string) {
    if (!activeCaseNo) return;
    touch();
    try {
      const r = await fetch("/api/erp/scan/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await r.json();
      if (d.ok && d.sku) {
        setActiveRows((rows) => [...rows, { ...blankRow(activeCaseNo), itemCode: d.sku.sku_code, itemDesc: d.sku.name, unit: d.sku.unit || "", mrp: d.sku.price != null ? String(d.sku.price) : "", mMrp: d.sku.price != null ? String(d.sku.price) : "" }]);
        flash(true, `Added ${d.sku.sku_code}`);
      } else { setActiveRows((rows) => [...rows, { ...blankRow(activeCaseNo), itemCode: code }]); flash(false, `Not in master — added "${code}" to fill manually`); }
    } catch { setActiveRows((rows) => [...rows, { ...blankRow(activeCaseNo), itemCode: code }]); }
  }
  const updateRow = (id: string, key: keyof Row, value: string) => { setActiveRows((rows) => rows.map((r) => (r.id === id ? { ...r, [key]: value } : r))); touch(); };
  const deleteRow = (id: string) => { setActiveRows((rows) => rows.filter((r) => r.id !== id)); touch(); };
  const autoPending = () => { setActiveRows((rows) => rows.map((r) => ({ ...r, pendingQty: String(num(r.qtyOrdered) - num(r.qtyDispatched)) }))); touch(); };

  function doneCase() {
    if (!activeCaseNo) return;
    if (activeRows.length === 0) { flash(false, "Add at least one item before closing the case."); return; }
    if (completed.some((c) => c.caseNo === activeCaseNo)) { flash(false, `Case ${activeCaseNo} already exists — can't duplicate. Use Edit instead.`); return; }
    setCompleted((cs) => [...cs, { caseNo: activeCaseNo, rows: activeRows }].sort((a, b) => a.caseNo - b.caseNo));
    setActiveCaseNo(null); setActiveRows([]); touch();
    flash(true, `Case ${activeCaseNo} closed`);
  }
  function editCase(caseNo: number) {
    if (activeCaseNo) { flash(false, "Finish the current case before editing another."); return; }
    if (!confirm(`Are you sure you want to edit Case ${caseNo}? It will reopen for scanning/editing.`)) return;
    const c = completed.find((x) => x.caseNo === caseNo); if (!c) return;
    setCompleted((cs) => cs.filter((x) => x.caseNo !== caseNo)); setActiveCaseNo(caseNo); setActiveRows(c.rows); touch();
  }
  function deleteCase(caseNo: number) { if (!confirm(`Delete Case ${caseNo}?`)) return; setCompleted((cs) => cs.filter((x) => x.caseNo !== caseNo)); touch(); }
  function newSlip() {
    if (!confirm("Start a new packing slip?")) return;
    setHdr(emptyHeader()); setActiveCaseNo(null); setActiveRows([]); setCompleted([]); setSlipId(null);
    serverAtRef.current = null; dirtyRef.current = false;
    try { localStorage.removeItem("erp_ps_last_id"); } catch { /* ignore */ }
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
    const e = validate(); setErrors(e);
    if (e.length) { flash(false, "Fix the highlighted issues before exporting."); return; }
    const items = buildSlipItems(completed);
    const grandQty = items.reduce((a, it) => a + it.qty, 0);

    // ---- Sheet 1: "Packing Slip" — the printed, item-wise slip ----
    const aoa: (string | number)[][] = [];
    aoa.push(["Packing Slip"]);
    aoa.push(["Bill No", hdr.billNo || hdr.slipNo, "", "Bill Date", fmtDate(hdr.date)]);
    aoa.push(["Party", hdr.partyName, "", "Sales Order", hdr.salesOrderNo]);
    aoa.push([]);
    aoa.push(["Sr No", "Item Code", "Item Description", "L.MRP", "Case No", "Quantity"]);
    items.forEach((it, i) => aoa.push([i + 1, it.code, it.desc, it.mrp ? num(it.mrp) : "", casesLabel(it.cases), it.qty]));
    aoa.push(["", "", "", "", "TOTAL", grandQty]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 46 }, { wch: 9 }, { wch: 11 }, { wch: 9 }];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];

    // ---- Sheet 2: "Case Detail" — every attribute, broken out per case ----
    const det: (string | number)[][] = [];
    det.push(["Packing Slip — Case Detail"], [],
      ["Bill No", hdr.billNo || hdr.slipNo, "", "Bill Date", fmtDate(hdr.date)],
      ["Slip No", hdr.slipNo, "", "Sales Order", hdr.salesOrderNo],
      ["Party", hdr.partyName, "", "Remarks", hdr.remarks],
      ["Total Box", totals.box, "", "Total Qty", grandQty], [], EXPORT_HEADERS);
    for (const c of completed) {
      det.push([`CASE ${c.caseNo}`]);
      c.rows.forEach((r, i) => det.push([i + 1, r.itemCode, r.itemDesc, r.unit, r.mPack, r.mMrp, r.mrp, r.slipType, r.csNo, r.pcs, r.quantity, r.qtyOrdered, r.qtyDispatched, r.pendingQty]));
      det.push([]);
    }
    const wsd = XLSX.utils.aoa_to_sheet(det);
    wsd["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 8 }, { wch: 7 }, { wch: 9 }, { wch: 11 }, { wch: 13 }, { wch: 11 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Packing Slip");
    XLSX.utils.book_append_sheet(wb, wsd, "Case Detail");
    XLSX.writeFile(wb, `PackingSlip_${(hdr.billNo || hdr.slipNo || "draft").replace(/[^\w-]+/g, "-")}.xlsx`);
    flash(true, "Exported to Excel");
  }

  const cellCls = "w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]";

  return (
    <div className="flex flex-col gap-5">
      {msg && (
        <div className="fixed right-4 top-20 z-50 rounded-lg px-4 py-2 text-sm font-bold shadow-lg"
          style={{ background: msg.ok ? "var(--accent-2-bg)" : "var(--danger-bg)", color: msg.ok ? "var(--accent-2)" : "var(--danger)" }}>
          {msg.ok ? "✓ " : "✕ "}{msg.text}
        </div>
      )}

      {/* slip bar: open existing / new / save status */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Open slip</span>
        <select className="ctl !w-auto" value={slipId ?? ""} onChange={(e) => e.target.value && openById(Number(e.target.value))}>
          <option value="">— select —</option>
          {slips.map((s) => <option key={s.id} value={s.id}>{s.slip_no} · {s.party || "—"} · {s.updated_by || ""}</option>)}
        </select>
        <button onClick={newSlip} className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)]">+ New slip</button>
        <span className="ml-auto flex items-center gap-3 text-xs">
          {collab && <span className="rounded-full bg-[var(--accent-bg)] px-2 py-1 font-bold text-[var(--accent-strong)]">{collab}</span>}
          <span className="font-semibold text-[var(--muted)]">
            {save === "saving" ? "Saving…" : save === "saved" ? "✓ Saved · shared live" : hdr.slipNo ? "Enter a Slip No. saves & shares it" : "Not saved"}
          </span>
        </span>
      </div>

      {/* HEADER */}
      <section className="panel">
        <div className="panel-hd justify-between">
          <span>Packing Slip Details</span>
          <button onClick={exportExcel} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold normal-case tracking-normal text-white hover:bg-[var(--accent-strong)]">⤓ Export to Excel</button>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
          <Field label="Packing Slip No." req><input className="ctl" value={hdr.slipNo} onChange={(e) => setHeader("slipNo", e.target.value)} placeholder="PS26/0001" /></Field>
          <Field label="Bill No."><input className="ctl" value={hdr.billNo} onChange={(e) => setHeader("billNo", e.target.value)} placeholder="GC26/000227" /></Field>
          <Field label="Sales Order No." req><input className="ctl" value={hdr.salesOrderNo} onChange={(e) => setHeader("salesOrderNo", e.target.value)} placeholder="SO26/000283" /></Field>
          <Field label="Customer / Party Name" req><input className="ctl" value={hdr.partyName} onChange={(e) => setHeader("partyName", e.target.value)} placeholder="SAMY AUTO PARTS" /></Field>
          <Field label="Packing Slip Date" req><input type="date" className="ctl" value={hdr.date} onChange={(e) => setHeader("date", e.target.value)} /></Field>
          <Field label="Tr Type"><input className="ctl" value={hdr.trType} onChange={(e) => setHeader("trType", e.target.value)} /></Field>
          <Field label="Tr Sno"><input className="ctl" value={hdr.trSno} onChange={(e) => setHeader("trSno", e.target.value)} /></Field>
          <Field label="Remarks"><input className="ctl" value={hdr.remarks} onChange={(e) => setHeader("remarks", e.target.value)} /></Field>
          <div className="flex items-end gap-2">
            <div className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"><div className="text-[10px] font-bold uppercase text-[var(--muted-2)]">Total Box</div><div className="text-lg font-extrabold tabular-nums">{totals.box}</div></div>
            <div className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"><div className="text-[10px] font-bold uppercase text-[var(--muted-2)]">Total Qty</div><div className="text-lg font-extrabold tabular-nums">{totals.qty}</div></div>
          </div>
        </div>
        {errors.length > 0 && (
          <div className="mx-4 mb-4 rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
            <b>Cannot export:</b><ul className="ml-4 list-disc">{errors.map((er, i) => <li key={i}>{er}</li>)}</ul>
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
              {completed.length > 0 && (
                <span className="w-full text-xs text-[var(--muted)]">
                  Already done (can&apos;t reuse — use <b>Edit</b> to change): {completed.map((c) => `Case ${c.caseNo}`).join(", ")}
                </span>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
              <div>
                <Scanner onDetect={handleScan} continuous />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => { setActiveRows((r) => [...r, blankRow(activeCaseNo)]); touch(); }} className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)]">+ Manual row</button>
                  <button onClick={autoPending} className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)]" title="Pending = Ordered − Dispatched">Auto pending</button>
                </div>
              </div>
              <div className="min-w-0">
                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="rtable" style={{ minWidth: "1100px" }}>
                    <thead><tr><th>#</th>{COLS.map((c) => <th key={c.key}>{c.label}</th>)}<th></th></tr></thead>
                    <tbody>
                      {activeRows.length === 0 && <tr><td colSpan={COLS.length + 2} className="!py-6 text-center text-[var(--muted)]">Scan an item or add a manual row.</td></tr>}
                      {activeRows.map((r, i) => (
                        <tr key={r.id}>
                          <td className="text-[var(--muted)]">{i + 1}</td>
                          {COLS.map((c) => (
                            <td key={c.key} style={{ minWidth: c.w }}>
                              <input className={cellCls} style={{ minWidth: c.w }} value={r[c.key]} onChange={(e) => updateRow(r.id, c.key, e.target.value)} />
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
          {completed.length === 0 && <p className="p-3 text-sm text-[var(--muted)]">No cases closed yet.</p>}
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
                  <tbody>{c.rows.map((r, i) => <tr key={r.id}><td>{i + 1}</td>{COLS.map((c2) => <td key={c2.key} className="text-xs">{r[c2.key] || "—"}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* FINAL PACKING SLIP — item-wise, matches the printed slip */}
      {slipItems.length > 0 && (
        <section className="panel">
          <div className="panel-hd justify-between">
            <span>Final Packing Slip — preview</span>
            <button onClick={exportExcel} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold normal-case tracking-normal text-white hover:bg-[var(--accent-strong)]">⤓ Export to Excel</button>
          </div>
          <div className="p-4">
            <div className="mb-3 text-center">
              <div className="text-lg font-extrabold">Packing Slip</div>
              <div className="text-xs text-[var(--muted)]">
                Bill No <b>{hdr.billNo || hdr.slipNo || "—"}</b> · Bill Date <b>{fmtDate(hdr.date) || "—"}</b>
                {hdr.partyName ? <> · {hdr.partyName}</> : null}
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="rtable" style={{ minWidth: "720px" }}>
                <thead><tr><th>Sr No</th><th>Item Code</th><th>Item Description</th><th className="!text-right">L.MRP</th><th className="!text-center">Case No</th><th className="!text-right">Quantity</th></tr></thead>
                <tbody>
                  {slipItems.map((it, i) => (
                    <tr key={it.code}>
                      <td className="text-[var(--muted)]">{i + 1}</td>
                      <td className="font-semibold">{it.code}</td>
                      <td>{it.desc || "—"}</td>
                      <td className="text-right tabular-nums">{it.mrp ? num(it.mrp).toFixed(2) : "—"}</td>
                      <td className="text-center tabular-nums">{casesLabel(it.cases)}</td>
                      <td className="text-right tabular-nums">{it.qty}</td>
                    </tr>
                  ))}
                  <tr className="font-extrabold">
                    <td colSpan={5} className="!text-right">TOTAL</td>
                    <td className="text-right tabular-nums">{slipQty}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              One line per item, quantity summed across all cases. A case range like “6-8” means the item is split across cases 6, 7 and 8. The Excel file adds a second <b>Case Detail</b> sheet with every attribute (unit, pcs, ordered/dispatched/pending) broken out per case.
            </p>
          </div>
        </section>
      )}
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
