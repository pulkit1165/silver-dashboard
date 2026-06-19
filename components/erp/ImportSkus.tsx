"use client";

import { useState } from "react";
import * as XLSX from "xlsx";

type Row = Record<string, unknown>;
type Err = { row: number; sku_code: string; reason: string };

export default function ImportSkus() {
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<{ willImport: number; errors: Err[] } | null>(null);
  const [result, setResult] = useState<{ inserted: number; skipped: number; errors: Err[] } | null>(null);
  const [busy, setBusy] = useState("");

  function ingest(wb: XLSX.WorkBook) {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<Row>(ws, { defval: "" });
    setRows(data);
    setPreview(null);
    setResult(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const buf = await f.arrayBuffer();
    ingest(XLSX.read(buf, { type: "array" }));
  }

  function onPaste(text: string) {
    if (!text.trim()) { setRows([]); return; }
    setFileName("pasted data");
    ingest(XLSX.read(text, { type: "string" }));
  }

  async function run(dryRun: boolean) {
    if (rows.length === 0) return;
    setBusy(dryRun ? "Validating…" : "Importing…");
    try {
      const r = await fetch("/api/erp/skus/import", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows, dryRun }),
      });
      const d = await r.json();
      if (!d.ok) { alert(d.error || "Failed"); return; }
      if (dryRun) setPreview({ willImport: d.willImport, errors: d.errors });
      else { setResult({ inserted: d.inserted, skipped: d.skipped, errors: d.errors }); setPreview(null); }
    } finally {
      setBusy("");
    }
  }

  const headers = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <div className="flex flex-col gap-5">
      <section className="panel">
        <div className="panel-hd">1 · Upload or paste</div>
        <div className="flex flex-col gap-3 p-4">
          <input type="file" accept=".csv,.xlsx,.xls" onChange={onFile}
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:px-4 file:py-2 file:font-bold file:text-white" />
          <div className="text-xs text-[var(--muted)]">Accepts Excel (.xlsx) or CSV. Your price-list columns (ITEM CODE, ITEM NAME, MRP) are auto-detected — or include category, brand, unit, hsn, purchase price, opening stock, reorder level.</div>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-[var(--accent)]">…or paste rows (CSV)</summary>
            <textarea
              onChange={(e) => onPaste(e.target.value)}
              placeholder={"ITEM CODE,ITEM NAME,MRP\nSU00005,ACCELATOR CUT NIPPLE METAL SKI,5.05"}
              className="mt-2 h-32 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs outline-none focus:border-[var(--accent)]"
            />
          </details>
        </div>
      </section>

      {rows.length > 0 && (
        <section className="panel">
          <div className="panel-hd">2 · Preview ({rows.length} rows from {fileName})</div>
          <div className="overflow-x-auto p-1">
            <table className="rtable">
              <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={i}>{headers.map((h) => <td key={h}>{String(r[h] ?? "")}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {rows.length > 8 && <div className="p-2 text-xs text-[var(--muted)]">…and {rows.length - 8} more</div>}
          </div>
          <div className="flex gap-2 border-t border-[var(--border)] p-3">
            <button onClick={() => run(true)} disabled={!!busy} className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">
              Validate
            </button>
            <button onClick={() => run(false)} disabled={!!busy || !preview} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50">
              {busy || `Import ${preview ? preview.willImport : ""} SKUs + generate QR`}
            </button>
            {!preview && <span className="self-center text-xs text-[var(--muted)]">Validate first.</span>}
          </div>
        </section>
      )}

      {preview && !result && (
        <section className="panel">
          <div className="panel-hd">3 · Validation</div>
          <div className="p-4">
            <p className="text-sm"><b className="text-[var(--accent-2)]">{preview.willImport}</b> rows will import. <b className="text-[var(--danger)]">{preview.errors.length}</b> skipped.</p>
            {preview.errors.length > 0 && <ErrTable errors={preview.errors} />}
          </div>
        </section>
      )}

      {result && (
        <section className="panel">
          <div className="panel-hd">Import complete</div>
          <div className="p-4">
            <div className="mb-3 rounded-xl border px-4 py-3 text-sm font-bold" style={{ borderColor: "var(--accent-2)", background: "var(--accent-2-bg)", color: "var(--accent-2)" }}>
              ✓ Imported {result.inserted} SKUs with unique QR codes. {result.skipped > 0 && `${result.skipped} skipped.`}
            </div>
            {result.errors.length > 0 && <ErrTable errors={result.errors} />}
            <div className="mt-3 flex gap-2">
              <a href="/erp/qr" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white">Manage QR codes →</a>
              <a href="/erp/skus" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">SKU Master</a>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function ErrTable({ errors }: { errors: Err[] }) {
  return (
    <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-[var(--border)]">
      <table className="rtable">
        <thead><tr><th>Row</th><th>SKU</th><th>Reason</th></tr></thead>
        <tbody>
          {errors.slice(0, 200).map((e, i) => (
            <tr key={i}><td>{e.row || "—"}</td><td className="font-mono text-xs">{e.sku_code || "—"}</td><td className="text-[var(--danger)]">{e.reason}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
