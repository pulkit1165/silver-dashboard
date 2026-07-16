"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import Scanner from "./Scanner";
import {
  type Row, type Case, type Header, type SlipDoc, type SlipMeta,
  num, fmtDate, buildSlipItems, casesLabel,
} from "@/lib/erp/packing-slip-format";

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
  { key: "pendingQty", label: "Gap Qty", w: "90px" },
];
const EXPORT_HEADERS = ["Sr.No", ...COLS.map((c) => c.label)];
// Columns hidden from the on-screen packing grid (still kept in the row data and
// in the Excel export). Quantity is driven by Qty Dispatched (the scanned qty).
const HIDDEN_COL_KEYS = new Set<keyof Row>(["unit", "mPack", "slipType", "pcs", "quantity"]);
const VISIBLE_COLS = COLS.filter((c) => !HIDDEN_COL_KEYS.has(c.key));
// Compulsory for every scanned row. Qty Dispatched replaces Quantity (which is
// now hidden and mirrors it).
const REQUIRED_ROW_FIELDS: (keyof Row)[] = ["itemCode", "itemDesc", "mrp", "qtyDispatched"];
function rowMissingFields(r: Row): string[] {
  const miss: string[] = [];
  if (!r.itemCode.trim()) miss.push("Item Code");
  if (!r.itemDesc.trim()) miss.push("Item Description");
  if (!String(r.mrp).trim()) miss.push("L.MRP");
  if (!(num(r.qtyDispatched) > 0)) miss.push("Qty Dispatched");
  return miss;
}
const cellMissing = (r: Row, key: keyof Row) =>
  REQUIRED_ROW_FIELDS.includes(key) && (key === "qtyDispatched" ? !(num(r.qtyDispatched) > 0) : !String(r[key]).trim());
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));
const blankRow = (csNo: number | null): Row => ({
  id: uid(), itemCode: "", itemDesc: "", unit: "", mPack: "", mMrp: "", mrp: "", slipType: "",
  csNo: csNo ? String(csNo) : "", pcs: "", quantity: "", qtyOrdered: "", qtyDispatched: "", pendingQty: "",
});
const emptyHeader = (): Header => ({ slipNo: "", billNo: "", salesOrderNo: "", partyName: "", date: new Date().toISOString().slice(0, 10), trType: "PS26", trSno: "", remarks: "" });

type OrderOpt = { id: number; so_no: string; customer_name?: string; status: string };
type SoLineInfo = { sku_code?: string; sku_name?: string; qr_token?: string; qty: number; dispatched_qty: number; mrp: number; std_pack?: number };

export default function PackingSlip({ orders = [], parties = [] }: { orders?: OrderOpt[]; parties?: string[] }) {
  const [hdr, setHdr] = useState<Header>(emptyHeader());
  const [activeCaseNo, setActiveCaseNo] = useState<number | null>(null);
  const [activeRows, setActiveRows] = useState<Row[]>([]);
  // A scan is previewed here first; it's only added to the case when the user
  // clicks "Add scanned item" — this stops fast/repeat detections from inserting
  // the same code multiple times.
  const [pendingScan, setPendingScan] = useState<{
    skuCode: string; name: string; unit: string; mrp: string;
    tier: "single" | "master"; addQty: number; orderedStr: string; unknown: boolean;
  } | null>(null);
  const [completed, setCompleted] = useState<Case[]>([]);
  const [pickCase, setPickCase] = useState<number>(1);
  const [slips, setSlips] = useState<SlipMeta[]>([]);
  const [slipId, setSlipId] = useState<number | null>(null);
  const [save, setSave] = useState<"idle" | "saving" | "saved">("idle");
  const [collab, setCollab] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  // `${rowId}:qtyDispatched` while a scan-driven cell is being hand-edited (double-click).
  const [editCell, setEditCell] = useState<string | null>(null);
  // Real-order linkage: selecting a SO seeds rows from its actual lines and,
  // on Done Case, packs for real (deducts stock, creates the Delivery Order)
  // instead of just building the Excel document.
  const [soId, setSoId] = useState<number | null>(null);
  const [soLines, setSoLines] = useState<SoLineInfo[]>([]);
  const [qrByCode, setQrByCode] = useState<Record<string, string>>({});
  const [packing, setPacking] = useState(false);

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
      if (d.ok) {
        applyDoc(d.slip.data as SlipDoc); setSlipId(d.slip.id); serverAtRef.current = d.slip.updated_at; dirtyRef.current = false;
        setSoId(null); setSoLines([]); // reopening a saved doc doesn't carry the live SO link back
        flash(true, `Opened ${d.slip.slip_no}`);
      }
    } catch { /* ignore */ }
  }

  async function assignNewSlipNo() {
    try {
      const r = await fetch("/api/erp/packing-slips/next-no", { cache: "no-store" });
      const d = await r.json();
      if (d.ok) setHdr((h) => ({
        ...h,
        slipNo: h.slipNo.trim() ? h.slipNo : d.slipNo ?? h.slipNo,
        billNo: h.billNo.trim() ? h.billNo : d.billNo ?? h.billNo,
      }));
    } catch { /* ignore — manual entry still works */ }
  }

  async function selectSo(id: number) {
    setSoId(id);
    touch();
    try {
      const r = await fetch(`/api/erp/sales-orders/${id}`, { cache: "no-store" });
      const d = await r.json();
      if (d.ok && d.order) {
        setHdr((h) => ({ ...h, salesOrderNo: d.order.so_no, partyName: d.order.customer_name || h.partyName }));
        const lines: SoLineInfo[] = d.order.lines || [];
        setSoLines(lines);
        const map: Record<string, string> = {};
        for (const l of lines) if (l.sku_code && l.qr_token) map[l.sku_code] = l.qr_token;
        setQrByCode((m) => ({ ...m, ...map }));
        flash(true, `Loaded ${d.order.so_no}`);
      } else flash(false, "Could not load that order.");
    } catch { flash(false, "Could not load that order."); }
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

  // load list + last opened slip (a ?open=<id> in the URL — e.g. from the Saved Slips
  // archive — wins over the last-opened-locally slip)
  useEffect(() => {
    refreshList();
    let openId: number | null = null;
    try {
      const p = new URLSearchParams(window.location.search).get("open");
      if (p && /^\d+$/.test(p)) openId = Number(p);
    } catch { /* ignore */ }
    if (openId == null) {
      const last = (() => { try { return localStorage.getItem("erp_ps_last_id"); } catch { return null; } })();
      if (last) openId = Number(last);
    }
    if (openId != null) openById(openId);
    else assignNewSlipNo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (slipId) { try { localStorage.setItem("erp_ps_last_id", String(slipId)); } catch { /* ignore */ } } }, [slipId]);

  // autosave (when the local user changed something) + live poll (pull others' changes)
  useEffect(() => {
    const saver = setInterval(() => {
      if (dirtyRef.current && stateRef.current.hdr.slipNo.trim()) { dirtyRef.current = false; doSave(); }
    }, 800);
    let tick = 0;
    const poller = setInterval(async () => {
      // keep the "Open slip" dropdown fresh so slips created on another device show up
      if (tick++ % 3 === 0) refreshList();
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
    }, 1500);
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
  const slipOrdered = useMemo(() => slipItems.reduce((a, it) => a + it.ordered, 0), [slipItems]);
  const slipDispatched = useMemo(() => slipItems.reduce((a, it) => a + it.dispatched, 0), [slipItems]);

  const setHeader = (field: keyof Header, value: string) => { setHdr((h) => ({ ...h, [field]: value })); touch(); };

  // Already-entered qty for a SKU across cases closed so far this session —
  // used to suggest what's actually still left when seeding a new case.
  function remainingForLine(l: SoLineInfo): number {
    const already = completed.flatMap((c) => c.rows).filter((r) => r.itemCode === l.sku_code).reduce((a, r) => a + num(r.quantity), 0);
    return Math.max(0, l.qty - l.dispatched_qty - already);
  }
  function startCase() {
    if (activeCaseNo) { flash(false, "Finish the current case first (Done Case)."); return; }
    if (usedCases.has(pickCase)) { flash(false, `Case ${pickCase} already exists for this slip — use Edit to change it.`); return; }
    const seeded: Row[] = soLines.filter((l) => remainingForLine(l) > 0).map((l) => ({
      ...blankRow(pickCase),
      itemCode: l.sku_code ?? "", itemDesc: l.sku_name ?? "",
      mrp: l.mrp != null ? String(l.mrp) : "", mMrp: l.mrp != null ? String(l.mrp) : "",
      mPack: l.std_pack ? String(l.std_pack) : "",
      // Ordered auto-fetched from the Sales Order; Dispatched fills in as items
      // are scanned into this case; Gap = Ordered − Dispatched.
      qtyOrdered: String(l.qty), qtyDispatched: "", quantity: "",
      pendingQty: String(l.qty),
    }));
    setActiveCaseNo(pickCase); setActiveRows(seeded); touch();
  }
  // A scan only PREVIEWS the item — it is not added to the case until the user
  // clicks "Add scanned item" (confirmScan). This prevents the same QR being
  // inserted multiple times from rapid/continuous detections.
  async function handleScan(code: string) {
    if (!activeCaseNo) return;
    try {
      const r = await fetch("/api/erp/scan/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await r.json();
      if (d.ok && d.sku) {
        if (d.sku.qr_token) setQrByCode((m) => ({ ...m, [d.sku.sku_code]: d.sku.qr_token }));
        // A master QR adds a full carton (master_qty); a single QR adds single_qty.
        const tier = d.tier === "master" ? "master" : "single";
        const addQty = tier === "master" ? (Number(d.sku.master_qty) || 1) : (Number(d.sku.single_qty) || 1);
        const skuCode = d.sku.sku_code as string;
        const soLine = soLines.find((l) => l.sku_code === skuCode);
        setPendingScan({
          skuCode, name: d.sku.name || "", unit: d.sku.unit || "",
          mrp: d.sku.price != null ? String(d.sku.price) : "",
          tier, addQty, orderedStr: soLine ? String(soLine.qty) : "", unknown: false,
        });
      } else {
        setPendingScan({ skuCode: code, name: "", unit: "", mrp: "", tier: "single", addQty: 1, orderedStr: "", unknown: true });
      }
    } catch {
      setPendingScan({ skuCode: code, name: "", unit: "", mrp: "", tier: "single", addQty: 1, orderedStr: "", unknown: true });
    }
  }

  // Insert the previewed scan into the active case.
  function confirmScan() {
    const p = pendingScan;
    if (!p || !activeCaseNo) return;
    touch();
    if (p.unknown) {
      setActiveRows((rows) => [...rows, { ...blankRow(activeCaseNo), itemCode: p.skuCode }]);
      flash(false, `Not in master — added "${p.skuCode}" to fill manually`);
    } else {
      setActiveRows((rows) => {
        const idx = rows.findIndex((row) => row.itemCode === p.skuCode);
        if (idx >= 0) {
          return rows.map((row, i) => {
            if (i !== idx) return row;
            const disp = num(row.qtyDispatched) + p.addQty;
            const ordered = row.qtyOrdered || p.orderedStr;
            return { ...row, qtyDispatched: String(disp), quantity: String(disp), qtyOrdered: ordered, pendingQty: String(num(ordered) - disp) };
          });
        }
        return [...rows, {
          ...blankRow(activeCaseNo),
          itemCode: p.skuCode, itemDesc: p.name, unit: p.unit,
          mrp: p.mrp, mMrp: p.mrp,
          qtyOrdered: p.orderedStr, qtyDispatched: String(p.addQty), quantity: String(p.addQty),
          pendingQty: String(num(p.orderedStr) - p.addQty),
        }];
      });
      flash(true, `${p.skuCode}: +${p.addQty} dispatched (${p.tier})`);
    }
    setPendingScan(null);
  }
  const updateRow = (id: string, key: keyof Row, value: string) => {
    setActiveRows((rows) => rows.map((r) => {
      if (r.id !== id) return r;
      const nr = { ...r, [key]: value };
      // Quantity (hidden) mirrors the scanned/entered Qty Dispatched.
      if (key === "qtyDispatched") nr.quantity = value;
      // Gap auto-calculates as Ordered − Dispatched whenever either changes.
      if (key === "qtyOrdered" || key === "qtyDispatched") nr.pendingQty = String(num(nr.qtyOrdered) - num(nr.qtyDispatched));
      return nr;
    }));
    touch();
  };
  const deleteRow = (id: string) => { setActiveRows((rows) => rows.filter((r) => r.id !== id)); touch(); };
  const autoPending = () => { setActiveRows((rows) => rows.map((r) => ({ ...r, pendingQty: String(num(r.qtyOrdered) - num(r.qtyDispatched)) }))); touch(); };

  // Resolve a row's scannable token: cached from the SO lines / a prior scan,
  // or a fresh lookup by exact sku_code match.
  async function tokenFor(itemCode: string): Promise<string | null> {
    if (qrByCode[itemCode]) return qrByCode[itemCode];
    try {
      const r = await fetch(`/api/erp/skus?q=${encodeURIComponent(itemCode)}`, { cache: "no-store" });
      const d = await r.json();
      const match = (d.skus || []).find((s: { sku_code: string; qr_token: string }) => s.sku_code === itemCode);
      if (match?.qr_token) { setQrByCode((m) => ({ ...m, [itemCode]: match.qr_token })); return match.qr_token; }
    } catch { /* ignore */ }
    return null;
  }

  async function doneCase() {
    if (!activeCaseNo) return;
    // Only rows that actually got a dispatched qty (scanned or hand-entered) are
    // packed — unscanned pre-seeded lines are dropped from the case.
    const scanned = activeRows.filter((r) => num(r.qtyDispatched) > 0);
    if (scanned.length === 0) { flash(false, "Scan an item (or enter Qty Dispatched) before closing the case."); return; }
    const incomplete = scanned.filter((r) => rowMissingFields(r).length > 0);
    if (incomplete.length) { flash(false, `${incomplete.length} item(s) missing required fields (Item Code, Description, L.MRP, Qty Dispatched) — fill the highlighted cells.`); return; }
    if (completed.some((c) => c.caseNo === activeCaseNo)) { flash(false, `Case ${activeCaseNo} already exists — can't duplicate. Use Edit instead.`); return; }

    // No real Sales Order linked (manual/legacy use) — keep this an Excel-only
    // document, exactly as before.
    if (!soId) {
      setCompleted((cs) => [...cs, { caseNo: activeCaseNo, rows: scanned }].sort((a, b) => a.caseNo - b.caseNo));
      setActiveCaseNo(null); setActiveRows([]); touch();
      flash(true, `Case ${activeCaseNo} closed`);
      return;
    }

    // A real SO is linked — pack each row for real (deducts stock, creates the
    // Delivery Order) via the same endpoint Pack & Dispatch uses. The user
    // already typed an exact qty per row, so overpack is allowed without an
    // extra confirm step (unlike scan-by-scan packing).
    setPacking(true);
    const toPack = scanned;
    const failures: string[] = [];
    let skippedNoSku = 0;
    for (const r of toPack) {
      const token = await tokenFor(r.itemCode);
      if (!token) { skippedNoSku++; continue; }
      try {
        const pr = await fetch("/api/erp/scan/action", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: token, action: "pack_case", refDoc: hdr.salesOrderNo,
            packageNo: String(activeCaseNo), qty: num(r.quantity), device: "packing-slip", allowOverpack: true,
          }),
        });
        const pd = await pr.json();
        if (!pd.ok) failures.push(`${r.itemCode}: ${pd.error ?? "failed"}`);
      } catch { failures.push(`${r.itemCode}: network error`); }
    }
    setPacking(false);

    if (failures.length) {
      flash(false, `Case ${activeCaseNo}: ${failures.length} item(s) failed to pack — fix and retry. ${failures.slice(0, 2).join("; ")}`);
      return; // keep the case open so the user can fix and retry
    }

    setCompleted((cs) => [...cs, { caseNo: activeCaseNo, rows: scanned }].sort((a, b) => a.caseNo - b.caseNo));
    setActiveCaseNo(null); setActiveRows([]); touch();
    flash(true, `Case ${activeCaseNo} packed for real — now in Delivery Orders${skippedNoSku ? ` (${skippedNoSku} item(s) not in SKU master, Excel-only)` : ""}`);
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
    setSoId(null); setSoLines([]);
    serverAtRef.current = null; dirtyRef.current = false;
    try { localStorage.removeItem("erp_ps_last_id"); } catch { /* ignore */ }
    assignNewSlipNo();
  }

  function validate(): string[] {
    const e: string[] = [];
    if (!hdr.slipNo.trim()) e.push("Packing Slip No. is required.");
    if (!hdr.salesOrderNo.trim()) e.push("Sales Order No. is required.");
    if (!hdr.partyName.trim()) e.push("Customer / Party Name is required.");
    if (!hdr.date.trim()) e.push("Date is required.");
    if (completed.length === 0) e.push("Add at least one completed case.");
    completed.forEach((c) => {
      if (c.rows.length === 0) { e.push(`Case ${c.caseNo} has no items.`); return; }
      c.rows.forEach((r, i) => {
        const miss = rowMissingFields(r);
        if (miss.length) e.push(`Case ${c.caseNo}, item ${i + 1} (${r.itemCode || "?"}): missing ${miss.join(", ")}.`);
      });
    });
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
    aoa.push(["Sr No", "Item Code", "Item Description", "L.MRP", "Case No", "Qty Ordered", "Qty Dispatched", "Gap Qty", "Quantity"]);
    items.forEach((it, i) => aoa.push([i + 1, it.code, it.desc, it.mrp ? num(it.mrp) : "", casesLabel(it.cases), it.ordered || "", it.dispatched || "", (it.ordered - it.dispatched) || "", it.qty]));
    const totOrdered = items.reduce((a, it) => a + it.ordered, 0);
    const totDispatched = items.reduce((a, it) => a + it.dispatched, 0);
    aoa.push(["", "", "", "", "TOTAL", totOrdered || "", totDispatched || "", (totOrdered - totDispatched) || "", grandQty]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 46 }, { wch: 9 }, { wch: 11 }, { wch: 11 }, { wch: 13 }, { wch: 9 }, { wch: 9 }];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];

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
        <a href="/erp/packing-slip/live" target="_blank" rel="noopener" title="Open a read-only big-screen view that mirrors live scanning" className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)]">📺 Live View</a>
        <a href="/erp/packing-slip/saved" title="Browse all saved packing slips, filter by customer or date" className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)]">🗂 Saved slips</a>
        <a href="/erp/sales/decode" title="Upload a Sales Order (Excel/CSV or photo) — it becomes an order you can pack here" className="rounded-lg border border-[var(--accent)] bg-[var(--accent-bg)] px-3 py-1.5 text-xs font-bold text-[var(--accent-strong)] hover:bg-[var(--accent)] hover:text-white">⬆ Upload Sales Order</a>
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
          <Field label="Sales Order" req>
            <select className="ctl" value={soId ?? ""} onChange={(e) => e.target.value && selectSo(Number(e.target.value))}>
              <option value="">— select unpacked order —</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.so_no} — {o.customer_name ?? "—"} ({o.status})</option>)}
            </select>
            {hdr.salesOrderNo && !soId && <div className="mt-1 text-xs text-[var(--muted)]">From saved slip: <b>{hdr.salesOrderNo}</b> (not in the live unpacked list)</div>}
          </Field>
          <Field label="Customer / Party Name" req>
            <input className="ctl" list="ps-party-list" value={hdr.partyName} onChange={(e) => setHeader("partyName", e.target.value)} placeholder="Type to search a party…" autoComplete="off" />
            <datalist id="ps-party-list">{parties.map((p) => <option key={p} value={p} />)}</datalist>
          </Field>
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
                <Scanner onDetect={handleScan} continuous manual beep cooldownMs={800} />

                {/* Scan preview — nothing is added until "Add scanned item" is clicked */}
                {pendingScan ? (
                  <div className={`mt-3 rounded-xl border-2 p-3 ${pendingScan.unknown ? "border-[var(--danger)] bg-[var(--danger-bg)]" : "border-[var(--accent-2)] bg-[var(--accent-2-bg)]"}`}>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">Scanned — review, then add</div>
                    <div className="mt-1 text-sm font-extrabold">{pendingScan.skuCode}</div>
                    {pendingScan.unknown ? (
                      <div className="text-xs text-[var(--danger)]">Not in master — will be added as a manual row to fill in.</div>
                    ) : (
                      <div className="text-xs text-[var(--ink-2)]">
                        {pendingScan.name}
                        <div className="mt-0.5 font-semibold">+{pendingScan.addQty} to dispatch ({pendingScan.tier})</div>
                      </div>
                    )}
                    <div className="mt-2 flex gap-2">
                      <button onClick={confirmScan} className="rounded-lg bg-[var(--accent-2)] px-4 py-2 text-sm font-bold text-white hover:opacity-90">✓ Add scanned item</button>
                      <button onClick={() => setPendingScan(null)} className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-bold text-[var(--muted)] hover:bg-[var(--surface-2)]">Clear</button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-[var(--muted)]">Line up the box in the frame, tap <b>🔍 Scan box</b> (you&apos;ll hear a beep), review it, then click <b>Add scanned item</b> to insert it below.</p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => { setActiveRows((r) => [...r, blankRow(activeCaseNo)]); touch(); }} className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)]">+ Manual row</button>
                  <button onClick={autoPending} className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)]" title="Gap = Ordered − Dispatched (auto-fills as you type; click to recalc all rows)">Recalc gap</button>
                </div>
              </div>
              <div className="min-w-0">
                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="rtable" style={{ minWidth: "1100px" }}>
                    <thead><tr><th>#</th>{VISIBLE_COLS.map((c) => <th key={c.key}>{c.label}{REQUIRED_ROW_FIELDS.includes(c.key) && <span className="text-[var(--accent)]"> *</span>}</th>)}<th></th></tr></thead>
                    <tbody>
                      {activeRows.length === 0 && <tr><td colSpan={VISIBLE_COLS.length + 2} className="!py-6 text-center text-[var(--muted)]">Scan an item or add a manual row.</td></tr>}
                      {activeRows.map((r, i) => (
                        <tr key={r.id}>
                          <td className="text-[var(--muted)]">{i + 1}</td>
                          {VISIBLE_COLS.map((c) => {
                            const cellStyle = { minWidth: c.w };
                            // Ordered (from SO) and Gap (computed) are read-only.
                            if (c.key === "qtyOrdered" || c.key === "pendingQty") {
                              return <td key={c.key} style={cellStyle}><div className={`${cellCls} flex items-center bg-[var(--surface-2)]`} style={cellStyle}>{r[c.key] || "—"}</div></td>;
                            }
                            // Qty Dispatched is scan-driven — locked until double-clicked to edit.
                            if (c.key === "qtyDispatched") {
                              const editing = editCell === `${r.id}:qtyDispatched`;
                              if (!editing) {
                                return (
                                  <td key={c.key} style={cellStyle} onDoubleClick={() => setEditCell(`${r.id}:qtyDispatched`)} title="Auto-filled by scanning · double-click to edit">
                                    <div className={`${cellCls} flex cursor-pointer items-center font-bold ${cellMissing(r, c.key) ? "!border-[var(--danger)] !bg-[var(--danger-bg)]" : "bg-[var(--surface-2)]"}`} style={cellStyle}>{r[c.key] || "0"}</div>
                                  </td>
                                );
                              }
                              return (
                                <td key={c.key} style={cellStyle}>
                                  <input autoFocus onBlur={() => setEditCell(null)} className={`${cellCls} ${cellMissing(r, c.key) ? "!border-[var(--danger)] !bg-[var(--danger-bg)]" : ""}`} style={cellStyle} value={r[c.key]} onChange={(e) => updateRow(r.id, c.key, e.target.value)} />
                                </td>
                              );
                            }
                            return (
                              <td key={c.key} style={cellStyle}>
                                <input className={`${cellCls} ${cellMissing(r, c.key) ? "!border-[var(--danger)] !bg-[var(--danger-bg)]" : ""}`} style={cellStyle} value={r[c.key]} onChange={(e) => updateRow(r.id, c.key, e.target.value)} />
                              </td>
                            );
                          })}
                          <td><button onClick={() => deleteRow(r.id)} className="rounded px-2 py-1 text-xs font-bold text-[var(--danger)] hover:bg-[var(--danger-bg)]">✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">Scan items to fill <b>Qty Dispatched</b> (single = 1, master = full carton) — double-click it to edit. Required per item: <b>Item Code, Item Description, L.MRP, Qty Dispatched</b>.</p>
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={doneCase} disabled={packing} className="rounded-lg bg-[var(--accent-2)] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">{packing ? "Packing…" : `✓ Done Case ${activeCaseNo}`}</button>
                  <span className="text-xs text-[var(--muted)]">{activeRows.length} item(s) in this case · {activeRows.filter((r) => rowMissingFields(r).length === 0).length} ready</span>
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
                  <thead><tr><th>#</th>{VISIBLE_COLS.map((c2) => <th key={c2.key}>{c2.label}</th>)}</tr></thead>
                  <tbody>{c.rows.map((r, i) => <tr key={r.id}><td>{i + 1}</td>{VISIBLE_COLS.map((c2) => <td key={c2.key} className="text-xs">{r[c2.key] || "—"}</td>)}</tr>)}</tbody>
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
              <table className="rtable" style={{ minWidth: "1000px" }}>
                <thead><tr><th>Sr No</th><th>Item Code</th><th>Item Description</th><th className="!text-right">L.MRP</th><th className="!text-center">Case No</th><th className="!text-right">Qty Ordered</th><th className="!text-right">Qty Dispatched</th><th className="!text-right">Gap Qty</th><th className="!text-right">Quantity</th></tr></thead>
                <tbody>
                  {slipItems.map((it, i) => (
                    <tr key={it.code}>
                      <td className="text-[var(--muted)]">{i + 1}</td>
                      <td className="font-semibold">{it.code}</td>
                      <td>{it.desc || "—"}</td>
                      <td className="text-right tabular-nums">{it.mrp ? num(it.mrp).toFixed(2) : "—"}</td>
                      <td className="text-center tabular-nums">{casesLabel(it.cases)}</td>
                      <td className="text-right tabular-nums">{it.ordered || "—"}</td>
                      <td className="text-right tabular-nums">{it.dispatched || "—"}</td>
                      <td className="text-right tabular-nums">{(it.ordered - it.dispatched) || "—"}</td>
                      <td className="text-right tabular-nums">{it.qty}</td>
                    </tr>
                  ))}
                  <tr className="font-extrabold">
                    <td colSpan={5} className="!text-right">TOTAL</td>
                    <td className="text-right tabular-nums">{slipOrdered || "—"}</td>
                    <td className="text-right tabular-nums">{slipDispatched || "—"}</td>
                    <td className="text-right tabular-nums">{(slipOrdered - slipDispatched) || "—"}</td>
                    <td className="text-right tabular-nums">{slipQty}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              One line per item, quantity summed across all cases. “Case No” lists the exact cases an item is packed in — e.g. “6-8” means case 6 and case 8 (not 7). <b>Gap Qty auto-calculates as Qty Ordered − Qty Dispatched.</b> The Excel file adds a second <b>Case Detail</b> sheet with every attribute broken out per case.
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
