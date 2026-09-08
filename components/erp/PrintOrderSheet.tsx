"use client";
import { useState } from "react";

interface SheetLine { sr: number; code: string; name: string; foc: number; kQty: number; bin: string; mrp: number; qty: number; fg: string; rm: string; dqty: number; caseNo: string; }
interface Sheet {
  soNo: string; customer: string; orderDate: string; billType: string; salesman: string;
  total: number; pendingQty: number; deliveringQty: number; pendingAmt: number; deliveringAmt: number;
  transporter: string; partyLevel: string; paymentTerms: string;
  creditLimit: number; outstanding: number; availableCredit: number; oldestPendingDays: number | null;
  lines: SheetLine[];
}

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (v: number) => (v ? String(v % 1 === 0 ? v : v.toFixed(2)) : "");
const inr = (v: number) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function sheetHtml(s: Sheet): string {
  const rows = s.lines.map((l) => `
    <tr>
      <td class="c">${l.sr}</td>
      <td class="code">${esc(l.code)}</td>
      <td class="des">${esc(l.name)}</td>
      <td class="r">${n(l.foc)}</td>
      <td class="r">${n(l.kQty)}</td>
      <td>${esc(l.bin)}</td>
      <td class="r">${n(l.mrp)}</td>
      <td class="r b">${n(l.qty)}</td>
      <td class="r">${esc(l.fg)}</td>
      <td class="r">${esc(l.rm)}</td>
      <td class="r">${n(l.dqty)}</td>
      <td class="cs">${esc(l.caseNo)}</td>
    </tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>Sales Order ${esc(s.soNo)}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, "Segoe UI", sans-serif; color:#111; margin:0; font-size:11px; }
  .mast { display:flex; align-items:flex-end; justify-content:space-between; gap:12px;
    border-bottom:2px solid #111; padding-bottom:6px; margin-bottom:6px; }
  .co { font-size:18px; font-weight:800; letter-spacing:.4px; }
  .doc { font-size:13px; font-weight:800; letter-spacing:2px; }
  .meta { font-size:11px; line-height:1.5; }
  .meta b { display:inline-block; min-width:70px; }
  .pbar { display:flex; flex-wrap:wrap; gap:14px; border:1px solid #111; padding:4px 8px; margin:6px 0 6px; font-size:11px; background:#f2f2f2; }
  .pbar b { font-weight:800; }
  .plevel { display:inline-block; border:1.5px solid #111; padding:0 6px; font-weight:800; }
  .kpis { display:flex; gap:8px; margin:6px 0 8px; }
  .kpi { flex:1; border:1px solid #111; padding:5px 8px; }
  .kpi .k { font-size:10px; font-weight:700; color:#444; letter-spacing:.5px; }
  .kpi .v { font-size:15px; font-weight:800; }
  .kpi .s { font-size:9px; color:#555; }
  table { border-collapse:collapse; width:100%; }
  thead { display:table-header-group; }
  th, td { border:1px solid #111; padding:3px 5px; }
  th { background:#111; color:#fff; font-size:10px; text-transform:uppercase; letter-spacing:.3px; }
  td { font-size:11px; vertical-align:top; }
  td.c { text-align:center; width:26px; }
  td.code, th.code { font-family:"Courier New",monospace; font-weight:700; white-space:nowrap; }
  td.des { }
  td.r { text-align:right; white-space:nowrap; }
  td.b { font-weight:800; }
  td.cs { font-size:10px; }
  col.des { width:30%; }
  .foot { margin-top:8px; font-size:9px; color:#666; display:flex; justify-content:space-between; }
</style></head>
<body onload="window.focus();window.print()">
  <div class="mast">
    <div><div class="co">SILVER INDUSTRIES</div><div class="doc">SALES ORDER</div></div>
    <div class="meta">
      <div><b>SO No</b> ${esc(s.soNo)}${s.partyLevel ? ` &nbsp;·&nbsp; <b>P · Level</b> <span class="plevel">${esc(s.partyLevel)}</span>` : ""}</div>
      <div><b>Party</b> ${esc(s.customer) || "—"}${s.billType ? ` &nbsp;·&nbsp; <b>Bill</b> ${esc(s.billType)}` : ""}</div>
      <div><b>Date</b> ${esc(s.orderDate) || "—"}${s.salesman ? ` &nbsp;·&nbsp; <b>Salesman</b> ${esc(s.salesman)}` : ""}</div>
      <div><b>Transporter</b> ${esc(s.transporter) || "—"}</div>
    </div>
  </div>
  <div class="pbar">
    <span><b>Credit Line</b> ${inr(s.creditLimit)}</span>
    <span><b>Old pending</b> ${inr(s.outstanding)}${s.oldestPendingDays != null ? ` · ${s.oldestPendingDays}d old` : ""}</span>
    <span><b>Available</b> ${inr(s.availableCredit)}</span>
    ${s.paymentTerms ? `<span><b>Terms</b> ${esc(s.paymentTerms)}</span>` : ""}
  </div>
  <div class="kpis">
    <div class="kpi"><div class="k">T · TOTAL ORDER</div><div class="v">${inr(s.total)}</div></div>
    <div class="kpi"><div class="k">P · PENDING TO DISPATCH</div><div class="v">${n(s.pendingQty) || 0} pcs</div><div class="s">${inr(s.pendingAmt)}</div></div>
    <div class="kpi"><div class="k">D · DELIVERING NOW</div><div class="v">${n(s.deliveringQty) || 0} pcs</div><div class="s">${inr(s.deliveringAmt)}</div></div>
  </div>
  <table>
    <colgroup><col/><col/><col class="des"/><col/><col/><col/><col/><col/><col/><col/><col/><col/></colgroup>
    <thead><tr>
      <th>SR</th><th class="code">CODE</th><th>ITEM DES</th><th>F</th><th>S</th><th>BIN</th>
      <th>MRP</th><th>QTY</th><th>FG</th><th>RM</th><th>DQTY</th><th>C/S NO</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="foot"><span>F = FOC · S = Silver-retailer (K) qty · FG = Finished goods · RM = Raw material · C/S No = Case/pack no</span><span>Printed ${new Date().toLocaleString("en-GB")}</span></div>
</body></html>`;
}

export default function PrintOrderSheet({ soId }: { soId: number }) {
  const [busy, setBusy] = useState(false);
  async function print() {
    setBusy(true);
    try {
      const r = await fetch(`/api/erp/sales-orders/${soId}/order-sheet`);
      const d = await r.json();
      if (!d.ok) { alert(d.error || "Could not load order sheet."); return; }
      const w = window.open("", "_blank", "width=1100,height=800");
      if (!w) { alert("Please allow pop-ups to print the order sheet."); return; }
      w.document.open(); w.document.write(sheetHtml(d.sheet)); w.document.close();
    } catch (e) { alert(String(e)); } finally { setBusy(false); }
  }
  return (
    <button onClick={print} disabled={busy}
      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)] disabled:opacity-50 no-print">
      {busy ? "…" : "🖨 Print"}
    </button>
  );
}
