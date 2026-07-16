"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function computeGp(rate: number, purchasePrice: number): number {
  if (!rate || rate <= 0) return 0;
  return ((rate - purchasePrice) / rate) * 100;
}

function applyGpCompensation(rows: Row[], topGpSkus: SkuCandidate[], threshold = 21): Row[] {
  const result = [...rows];
  const inOrder = new Set(rows.map((r) => r.sku?.id).filter(Boolean) as number[]);
  const candidates = topGpSkus.filter((s) => !inOrder.has(s.id));
  let ci = 0;
  for (const row of rows) {
    if (!row.sku || row.auto_added) continue;
    if (computeGp(row.rate, row.sku.purchase_price) < threshold && candidates[ci]) {
      const best = candidates[ci++];
      inOrder.add(best.id);
      result.push({
        key: -(ROW_SEQ + ci),
        raw_text: "(auto-added for GP)",
        qty: 1, rate: best.selling_price, unit: best.unit,
        sku: best, candidates: [best], confidence: "high" as const, auto_added: true,
      });
    }
  }
  return result;
}

type CustomerLite = { id: number; code: string; name: string };
type SalesmanLite = { id: number; name: string; territory: string };
type SkuCandidate = {
  id: number; sku_code: string; name: string; unit: string;
  price: number; selling_price: number; purchase_price: number;
};
type Confidence = "high" | "medium" | "low" | "none";
type DraftLine = {
  raw_text: string; qty: number; rate: number; unit: string;
  sku_id: number | null; suggested: SkuCandidate | null; candidates: SkuCandidate[]; confidence: Confidence;
};
type DraftOrder = {
  customer_hint: string; customer_id: number | null;
  customer_candidates: Array<{ id: number; code: string; name: string }>;
  order_date: string; notes: string; lines: DraftLine[];
};

type Row = {
  key: number;
  raw_text: string;
  qty: number;
  rate: number;
  unit: string;
  sku: SkuCandidate | null;
  candidates: SkuCandidate[];
  confidence: Confidence;
  auto_added?: boolean;
};

let ROW_SEQ = 1;

const inp =
  "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
const tabBtn = (active: boolean) =>
  `px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
    active
      ? "border-[var(--accent)] text-[var(--accent)]"
      : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
  }`;

export default function SalesDecoder({
  customers,
  salesmen,
  aiReady,
}: {
  customers: CustomerLite[];
  salesmen: SalesmanLite[];
  aiReady: boolean;
}) {
  const [inputTab, setInputTab] = useState<"file" | "text">("file");
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string>("");
  const [kind, setKind] = useState<"image" | "sheet" | null>(null);
  const [fileB64, setFileB64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [orderText, setOrderText] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [customerId, setCustomerId] = useState<number | "">("");
  const [orderDate, setOrderDate] = useState<string>("");
  const [remarks, setRemarks] = useState<string>("");
  const [hint, setHint] = useState<string>("");
  const [salesmanId, setSalesmanId] = useState<number | "">("");
  const [source, setSource] = useState<string>("manual");
  const [topGpSkus, setTopGpSkus] = useState<SkuCandidate[]>([]);

  const [punching, setPunching] = useState(false);
  const [creditWarn, setCreditWarn] = useState<string | null>(null);
  const [done, setDone] = useState<{ so_no: string } | null>(null);

  // Fetch high-GP SKUs once for auto-compensation
  useEffect(() => {
    fetch("/api/erp/skus/top-gp")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.skus)) setTopGpSkus(d.skus); })
      .catch(() => {});
  }, []);

  function onFile(file: File | undefined) {
    if (!file) return;
    setError(null); setRows(null); setDone(null);
    const name = file.name || "";
    const isSheet = /\.(xlsx|xls|csv)$/i.test(name) || /sheet|excel|csv/i.test(file.type);
    setFileName(name);
    const reader = new FileReader();
    if (isSheet) {
      setKind("sheet"); setDataUrl(null); setSource("file");
      reader.onload = () => setFileB64(String(reader.result));
    } else {
      setKind("image"); setFileB64(null); setMediaType(file.type || "image/jpeg"); setSource("ai_photo");
      reader.onload = () => setDataUrl(String(reader.result));
    }
    reader.readAsDataURL(file);
  }

  function loadDraft(draft: DraftOrder, src: string) {
    setHint(draft.customer_hint);
    setCustomerId(draft.customer_id ?? "");
    setOrderDate(draft.order_date || new Date().toISOString().slice(0, 10));
    setRemarks(draft.notes || "");
    setSource(src);
    const baseRows: Row[] = draft.lines.map((l) => ({
      key: ROW_SEQ++, raw_text: l.raw_text, qty: l.qty, rate: l.rate, unit: l.unit,
      sku: l.suggested, candidates: l.candidates, confidence: l.confidence,
    }));
    const withGp = applyGpCompensation(baseRows, topGpSkus) as Row[];
    setRows(withGp);
  }

  async function decode() {
    setBusy(true); setError(null); setDone(null);
    try {
      let d: { ok: boolean; error?: string; draft?: DraftOrder };
      if (inputTab === "text") {
        if (!orderText.trim()) { setBusy(false); return; }
        if (!aiReady) { setError("Text decode needs an ANTHROPIC_API_KEY on the server."); setBusy(false); return; }
        const r = await fetch("/api/erp/sales/decode-text", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: orderText, customer_hint: hint || undefined }),
        });
        d = await r.json();
        if (d.ok && d.draft) loadDraft(d.draft, "ai_text");
      } else if (kind === "sheet") {
        if (!fileB64) { setBusy(false); return; }
        const r = await fetch("/api/erp/sales/import", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_base64: fileB64 }),
        });
        d = await r.json();
        if (d.ok && d.draft) loadDraft(d.draft, "file");
      } else {
        if (!dataUrl) { setBusy(false); return; }
        if (!aiReady) { setError("Reading a photo needs an ANTHROPIC_API_KEY on the server. Upload an Excel/CSV file instead."); setBusy(false); return; }
        const r = await fetch("/api/erp/sales/decode", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image_base64: dataUrl, media_type: mediaType }),
        });
        d = await r.json();
        if (d.ok && d.draft) loadDraft(d.draft, "ai_photo");
      }
      if (!d.ok || !d.draft) setError(d.error ?? "Could not read the order.");
    } catch {
      setError("Network error. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  function patchRow(key: number, patch: Partial<Row>) {
    setRows((rs) => (rs ? rs.map((r) => (r.key === key ? { ...r, ...patch } : r)) : rs));
  }
  function removeRow(key: number) {
    setRows((rs) => (rs ? rs.filter((r) => r.key !== key) : rs));
  }
  function addRow() {
    setRows((rs) => [
      ...(rs ?? []),
      { key: ROW_SEQ++, raw_text: "(added manually)", qty: 1, rate: 0, unit: "", sku: null, candidates: [], confidence: "none" },
    ]);
  }

  const total = (rows ?? []).reduce((s, r) => s + r.qty * r.rate, 0);
  const unmatched = (rows ?? []).filter((r) => !r.sku).length;
  const canPunch = !!customerId && (rows?.length ?? 0) > 0 && unmatched === 0 && (rows ?? []).every((r) => r.qty > 0);

  async function punch(allowOverCredit = false) {
    if (!rows || !customerId) return;
    setPunching(true); setError(null); setCreditWarn(null);
    try {
      const r = await fetch("/api/erp/sales-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          order_date: orderDate || undefined,
          remarks: remarks || undefined,
          allow_over_credit_limit: allowOverCredit,
          salesman_id: salesmanId || undefined,
          source,
          lines: rows.filter((r) => r.sku).map((r) => ({ sku_id: r.sku!.id, qty: r.qty, price: r.rate })),
        }),
      });
      const d = await r.json();
      if (r.status === 422 && d.creditLimitExceeded) { setCreditWarn(d.error ?? "Credit limit would be exceeded."); return; }
      if (!d.ok) { setError(d.error ?? "Could not punch the order."); return; }
      setDone({ so_no: d.order.so_no });
    } catch {
      setError("Network error while punching the order. Please retry.");
    } finally {
      setPunching(false);
    }
  }

  if (done) {
    return (
      <section className="panel">
        <div className="p-6 text-center">
          <div className="text-4xl">✓</div>
          <div className="mt-2 text-lg font-extrabold" style={{ color: "var(--accent-2)" }}>
            Sales order {done.so_no} created (draft)
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Review it under Sales Orders and confirm it to hand it to the warehouse.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <a href="/erp/sales" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)]">
              Go to Sales Orders
            </a>
            <button
              onClick={() => { setDone(null); setRows(null); setDataUrl(null); setFileB64(null); setKind(null); setFileName(""); setOrderText(""); }}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--surface-2)]"
            >
              Enter another order
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr]">
      {/* Input panel */}
      <section className="panel self-start">
        <div className="flex border-b border-[var(--border)]">
          <button onClick={() => setInputTab("file")} className={tabBtn(inputTab === "file")}>Photo / File</button>
          <button onClick={() => setInputTab("text")} className={tabBtn(inputTab === "text")}>Text / Voice</button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          {inputTab === "file" ? (
            <>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--border)] p-6 text-center hover:border-[var(--accent)]">
                <input type="file" accept="image/*,.xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0])} />
                {kind === "image" && dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={dataUrl} alt="slip" className="max-h-72 w-full rounded-lg object-contain" />
                ) : kind === "sheet" ? (
                  <><span className="text-3xl opacity-70">📄</span><span className="break-all text-sm font-semibold">{fileName}</span><span className="text-xs text-[var(--muted)]">Excel/CSV order — no AI needed</span></>
                ) : (
                  <><span className="text-3xl opacity-70">⬆</span><span className="text-sm font-semibold">Upload a sales-order file or photograph a slip</span><span className="text-xs text-[var(--muted)]">Excel/CSV (recommended) · JPG/PNG photo (AI)</span></>
                )}
              </label>
              <button onClick={decode} disabled={busy || (kind === "sheet" ? !fileB64 : !dataUrl)}
                className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50">
                {busy ? "Reading…" : rows ? "Re-read" : kind === "sheet" ? "Read order file" : "Decode slip"}
              </button>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
                Party / customer (optional hint)
                <input className={inp} value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. Sharma Cycles" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
                Order description
                <textarea rows={7} className={`${inp} resize-y`} value={orderText} onChange={(e) => setOrderText(e.target.value)}
                  placeholder={"Type or paste the order:\n200 chain 5spd\n50 brake shoe rear HH\n12 clutch plate CT100 ES\n…"} />
              </label>
              <button onClick={decode} disabled={busy || !orderText.trim()}
                className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50">
                {busy ? "Reading…" : rows ? "Re-decode" : "Decode order"}
              </button>
              {!aiReady && <p className="text-xs text-[var(--muted)]">Text decode is off (no AI key).</p>}
            </>
          )}

          {busy && <p className="text-xs text-[var(--muted)]">{inputTab === "text" ? "The AI is parsing your order and matching items to your SKU master…" : kind === "sheet" ? "Parsing the file and matching items…" : "The AI is transcribing the handwriting and matching items…"}</p>}
          {error && <p className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>{error}</p>}
        </div>
      </section>

      {/* Verify + punch */}
      <section className="panel">
        <div className="panel-hd flex items-center justify-between">
          <span>Verify &amp; punch</span>
          {rows && <span className="text-xs font-semibold text-[var(--muted)]">{rows.length} line(s){rows.some((r) => r.auto_added) ? " · some auto-added for GP" : ""}</span>}
        </div>

        {!rows ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">
            {inputTab === "text" ? "Type the order and press Decode — the draft appears here to verify, then punch." : "Upload a file or slip photo and press Read — the draft appears here to verify, then punch."}
          </div>
        ) : (
          <div className="p-4">
            {/* Order header */}
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
                Customer {hint && <span className="font-normal">· read as "{hint}"</span>}
                <select className={inp} value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">— select customer —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
                Order date
                <input type="date" className={inp} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
                Taken by (salesman)
                <select className={inp} value={salesmanId} onChange={(e) => setSalesmanId(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">— walk-in / self —</option>
                  {salesmen.map((s) => <option key={s.id} value={s.id}>{s.name}{s.territory ? ` (${s.territory})` : ""}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
                Remarks
                <input className={inp} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="transport / notes" />
              </label>
            </div>

            <div className="overflow-x-auto">
              <table className="rtable">
                <thead>
                  <tr>
                    <th>Read from order</th>
                    <th>Item (SKU)</th>
                    <th className="!text-right">Qty</th>
                    <th className="!text-right">Rate ₹</th>
                    <th className="!text-right">GP%</th>
                    <th className="!text-right">Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const gp = r.sku ? computeGp(r.rate, r.sku.purchase_price) : null;
                    const rowStyle = r.auto_added
                      ? { background: "var(--warn-bg, #fff7ed)" }
                      : !r.sku
                      ? { background: "var(--danger-bg)" }
                      : undefined;
                    return (
                      <tr key={r.key} style={rowStyle}>
                        <td className="align-top">
                          <div className="font-medium">{r.raw_text}</div>
                          {r.auto_added
                            ? <span className="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "var(--warn-bg, #fff7ed)", color: "var(--warn, #b45309)", border: "1px solid var(--warn, #b45309)" }}>auto-added · GP</span>
                            : <ConfidenceBadge c={r.confidence} matched={!!r.sku} />
                          }
                        </td>
                        <td className="align-top">
                          <SkuPicker row={r} onPick={(sku) => patchRow(r.key, { sku, rate: r.rate > 0 ? r.rate : sku.selling_price, unit: r.unit || sku.unit })} />
                        </td>
                        <td className="num-cell align-top">
                          <input type="number" min={0} step="any" value={r.qty}
                            onChange={(e) => patchRow(r.key, { qty: Number(e.target.value) })}
                            className={`${inp} w-20 text-right`} />
                        </td>
                        <td className="num-cell align-top">
                          <input type="number" min={0} step="any" value={r.rate}
                            onChange={(e) => patchRow(r.key, { rate: Number(e.target.value) })}
                            className={`${inp} w-24 text-right`} />
                        </td>
                        <td className="num-cell align-top">
                          {gp !== null ? <GpBadge gp={gp} /> : <span className="text-[var(--muted)]">—</span>}
                        </td>
                        <td className="num-cell align-top tabular-nums">{(r.qty * r.rate).toFixed(2)}</td>
                        <td className="align-top">
                          <button onClick={() => removeRow(r.key)} title="Remove line"
                            className="rounded-md px-2 py-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--danger)]">✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="!text-right font-semibold">Total</td>
                    <td className="num-cell font-extrabold tabular-nums">₹{total.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <button onClick={addRow} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--surface-2)]">
                + Add line
              </button>
              {unmatched > 0 && (
                <span className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
                  {unmatched} line(s) still need a SKU before you can punch.
                </span>
              )}
            </div>

            {creditWarn && (
              <div className="mt-4 rounded-xl border px-4 py-3 text-sm"
                style={{ borderColor: "var(--danger)", background: "var(--danger-bg)", color: "var(--danger)" }}>
                <div className="font-bold">Credit limit warning</div>
                <div className="mt-1">{creditWarn}</div>
                <button onClick={() => punch(true)} disabled={punching}
                  className="mt-2 rounded-lg bg-[var(--danger)] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
                  Punch anyway
                </button>
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-3">
              {!canPunch && !customerId && <span className="text-sm text-[var(--muted)]">Select a customer to continue.</span>}
              <button onClick={() => punch(false)} disabled={!canPunch || punching}
                className="rounded-lg bg-[var(--accent-2)] px-5 py-2.5 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50">
                {punching ? "Punching…" : "Confirm & punch sales order"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function GpBadge({ gp }: { gp: number }) {
  const pct = gp.toFixed(1);
  if (gp >= 25) {
    return <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "var(--accent-2-bg)", color: "var(--accent-2)" }}>{pct}%</span>;
  }
  if (gp >= 21) {
    return <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "var(--warn-bg, #fff7ed)", color: "var(--warn, #b45309)" }}>{pct}%</span>;
  }
  return <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>{pct}%</span>;
}

function ConfidenceBadge({ c, matched }: { c: Confidence; matched: boolean }) {
  if (!matched) {
    return <span className="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>NO MATCH — pick a SKU</span>;
  }
  const map: Record<Confidence, { bg: string; fg: string; label: string }> = {
    high: { bg: "var(--accent-2-bg)", fg: "var(--accent-2)", label: "high confidence" },
    medium: { bg: "var(--warn-bg, #fff7ed)", fg: "var(--warn, #b45309)", label: "check match" },
    low: { bg: "var(--danger-bg)", fg: "var(--danger)", label: "low — verify" },
    none: { bg: "var(--danger-bg)", fg: "var(--danger)", label: "verify" },
  };
  const s = map[c];
  return <span className="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: s.bg, color: s.fg }}>{s.label}</span>;
}

function SkuPicker({ row, onPick }: { row: Row; onPick: (sku: SkuCandidate) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SkuCandidate[]>(row.candidates);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const search = useCallback(async (term: string) => {
    setQ(term);
    if (term.trim().length < 2) { setResults(row.candidates); return; }
    setSearching(true);
    try {
      const r = await fetch(`/api/erp/skus?q=${encodeURIComponent(term.trim())}`);
      const d = await r.json();
      const skus = Array.isArray(d.skus) ? d.skus : [];
      setResults(skus.slice(0, 25).map((s: Record<string, unknown>) => ({
        id: Number(s.id), sku_code: String(s.sku_code), name: String(s.name), unit: String(s.unit ?? ""),
        price: Number(s.price) || 0, selling_price: Number(s.selling_price) || Number(s.price) || 0,
        purchase_price: Number(s.purchase_price) || 0,
      })));
    } catch { /* keep prior results */ } finally { setSearching(false); }
  }, [row.candidates]);

  return (
    <div ref={boxRef} className="relative min-w-[240px]">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={`w-full rounded-lg border px-2.5 py-1.5 text-left text-sm ${row.sku ? "border-[var(--border)]" : "border-[var(--danger)]"} bg-[var(--surface)] hover:border-[var(--accent)]`}>
        {row.sku ? (
          <span><span className="font-mono text-xs">{row.sku.sku_code}</span> · {row.sku.name}</span>
        ) : (
          <span className="font-semibold text-[var(--danger)]">— pick a SKU —</span>
        )}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-[min(420px,80vw)] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg">
          <input autoFocus value={q} onChange={(e) => search(e.target.value)} placeholder="Search code or name…"
            className={`${inp} mb-2 w-full`} />
          <div className="max-h-64 overflow-auto">
            {searching && <div className="px-2 py-1 text-xs text-[var(--muted)]">Searching…</div>}
            {results.length === 0 && !searching && <div className="px-2 py-1 text-xs text-[var(--muted)]">Type at least 2 characters.</div>}
            {results.map((s) => (
              <button key={s.id} type="button"
                onClick={() => { onPick(s); setOpen(false); }}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)]">
                <span><span className="font-mono text-xs">{s.sku_code}</span> · {s.name}</span>
                <span className="shrink-0 text-xs text-[var(--muted)]">₹{s.selling_price}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
