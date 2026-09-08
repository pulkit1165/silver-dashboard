"use client";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import type { CatalogCompany } from "@/components/erp/ProductCatalog";

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const isNum = (s: string) => s.trim() !== "" && /^-?[\d,]+(\.\d+)?%?$/.test(s.trim());

// Build the branded, print/Word-friendly document for an arbitrary table.
function listHtml(
  headline: string, columns: string[], rows: string[][], numericCol: boolean[],
  co: CatalogCompany, logo: string | null, opts: { autoPrint: boolean }
): string {
  const contact = [
    [co.address, co.city, co.pincode].filter(Boolean).join(", "),
    [co.phone && `Ph: ${co.phone}`, co.email].filter(Boolean).join("  ·  "),
    co.gstin && `GSTIN: ${co.gstin}`,
  ].filter(Boolean).map(esc).join("<br/>");

  const head = `<tr class="colh">${columns.map((c, i) =>
    `<th class="${numericCol[i] ? "r" : ""}">${esc(c)}</th>`).join("")}</tr>`;
  const body = rows.map((r) => `<tr>${columns.map((_, i) =>
    `<td class="${numericCol[i] ? "r" : ""}${i === 0 ? " code" : ""}">${esc(r[i] ?? "")}</td>`).join("")}</tr>`).join("");
  const logoImg = logo ? `<img class="logo" src="${logo}" alt=""/>` : "";
  const title = headline.trim() ? esc(headline) : "PRICE LIST";

  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>${esc(co.name)} — ${title}</title>
<style>
  @page { size: A4 portrait; margin: 10mm 9mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial,"Segoe UI",sans-serif; color:#111; margin:0; font-size:10.5px; }
  .mast { display:flex; align-items:center; justify-content:space-between; gap:14px;
    border-bottom:3px solid #b91c1c; padding:0 2px 8px; margin-bottom:8px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .logo { max-height:52px; max-width:150px; }
  .bigname { font-size:20px; font-weight:800; letter-spacing:.4px; }
  .contact { text-align:right; font-size:9px; color:#4b5563; line-height:1.5; }
  .title { text-align:center; font-size:15px; font-weight:800; letter-spacing:1px; margin:4px 0 2px; text-transform:uppercase; }
  .meta { text-align:center; font-size:9px; color:#6b7280; margin-bottom:10px; }
  table { border-collapse:collapse; width:100%; }
  thead { display:table-header-group; }
  tr { page-break-inside:avoid; }
  .colh th { border:1px solid #111; background:#111; color:#fff; font-weight:800; font-size:10.5px;
    text-transform:uppercase; letter-spacing:.3px; padding:5px 7px; text-align:left; }
  .colh th.r { text-align:right; }
  td { border:1px solid #111; padding:3px 7px; font-size:10.5px; vertical-align:top; }
  td.r { text-align:right; white-space:nowrap; }
  td.code { font-family:"Courier New",monospace; font-weight:700; white-space:nowrap; }
  .foot { margin-top:8px; text-align:center; font-size:8.5px; color:#9ca3af; }
</style></head>
<body${opts.autoPrint ? ' onload="window.focus();window.print()"' : ""}>
  <div class="mast"><div class="brand">${logoImg}<div class="bigname">${esc(co.name)}</div></div>
    <div class="contact">${contact}</div></div>
  <div class="title">${title}</div>
  <div class="meta">${rows.length} rows &nbsp;·&nbsp; ${fmtDate(new Date())}</div>
  <table><thead>${head}</thead><tbody>${body}</tbody></table>
  <div class="foot">${esc(co.name)} · Generated ${fmtDate(new Date())}</div>
</body></html>`;
}

export default function CustomListBuilder({
  company, logo,
}: { company: CatalogCompany; logo: string | null }) {
  const [headline, setHeadline] = useState("");
  const [fileName, setFileName] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [err, setErr] = useState("");

  const numericCol = useMemo(() => columns.map((_, i) => {
    let num = 0, tot = 0;
    for (const r of rows) { const v = (r[i] ?? "").trim(); if (v) { tot++; if (isNum(v)) num++; } }
    return tot > 0 && num / tot >= 0.6;
  }), [columns, rows]);

  function parse(file: File) {
    setErr(""); setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result as ArrayBuffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        // raw:false keeps Excel's displayed formatting (e.g. 100.00, -3.45)
        const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "", raw: false, blankrows: false });
        if (!aoa.length) { setErr("The sheet is empty."); return; }
        const cols = (aoa[0] as unknown[]).map((c) => String(c ?? "").trim());
        const lastCol = Math.max(0, ...cols.map((c, i) => (c ? i : -1))) ;
        const trimmedCols = cols.slice(0, lastCol + 1).map((c, i) => c || `Column ${i + 1}`);
        const data = (aoa.slice(1) as unknown[][])
          .map((r) => trimmedCols.map((_, i) => String(r[i] ?? "").trim()))
          .filter((r) => r.some((v) => v !== ""));
        setColumns(trimmedCols); setRows(data);
      } catch (e2) { setErr(`Could not read the file: ${e2}`); }
    };
    reader.readAsArrayBuffer(file);
  }

  function exportDoc(autoPrint: boolean) {
    const html = listHtml(headline, columns, rows, numericCol, company, logo, { autoPrint });
    if (autoPrint) {
      const w = window.open("", "_blank", "width=940,height=1040");
      if (!w) { alert("Please allow pop-ups for this site to export the PDF."); return; }
      w.document.open(); w.document.write(html); w.document.close();
    } else {
      const blob = new Blob(["﻿", html], { type: "application/msword" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${(headline || "Custom-List").replace(/[^a-z0-9]+/gi, "_")}.doc`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  const inp = "rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm";

  return (
    <div>
      <div className="panel mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex min-w-[280px] flex-1 flex-col gap-1 text-xs font-bold uppercase text-[var(--muted)]">
            Headline (optional) — prints as the title
            <input value={headline} onChange={(e) => setHeadline(e.target.value)}
              placeholder="e.g. AXLE FOUNDATION — Revised Prices Sep 2026" className={inp} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold uppercase text-[var(--muted)]">
            Upload Excel (.xlsx / .csv)
            <input type="file" accept=".xlsx,.xls,.csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) parse(f); }}
              className="text-sm" />
          </label>
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          The <b>first row</b> of the sheet is used as column headers (e.g. CODE · ITEM · NEW MRP · OLD MRP · DIFF).
          Number columns are right-aligned automatically. Whatever columns your file has become the columns in the PDF.
        </p>
        {err && <p className="text-sm font-bold text-[var(--danger)]">{err}</p>}
        {columns.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-[var(--muted)]">
              <b>{fileName}</b> · {rows.length} rows · {columns.length} columns
            </span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => exportDoc(true)} disabled={!rows.length}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">⬇ Export PDF</button>
              <button onClick={() => exportDoc(false)} disabled={!rows.length}
                className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">⬇ Export Word</button>
            </div>
          </div>
        )}
      </div>

      {/* preview */}
      {columns.length > 0 ? (
        <section className="panel !p-0 overflow-hidden">
          {headline.trim() && <div className="bg-[#111] px-4 py-2 text-center text-sm font-extrabold uppercase tracking-wide text-white">{headline}</div>}
          <div className="overflow-x-auto">
            <table className="rtable">
              <thead>
                <tr>{columns.map((c, i) => <th key={i} className={numericCol[i] ? "!text-right" : ""}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r, ri) => (
                  <tr key={ri}>
                    {columns.map((_, ci) => (
                      <td key={ci} className={`${numericCol[ci] ? "num-cell" : ""} ${ci === 0 ? "font-mono text-xs font-bold text-[var(--muted)]" : ""}`}>{r[ci] ?? ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 500 && <p className="p-2 text-xs text-[var(--muted)]">Previewing first 500 of {rows.length} rows — the export includes all.</p>}
        </section>
      ) : (
        <p className="px-1 text-sm text-[var(--muted)]">Upload an Excel file to preview it, then export a branded PDF or Word document.</p>
      )}
    </div>
  );
}
