"use client";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Vendor = { id: number; name: string };
type Group = { header: string; group_items: number; vendors: number; priced_items: number };
type PriceRow = { sku_id: number; sku_code: string; name: string; vendor_id: number; vendor_name: string; cp: number };
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const box = "rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4";
const inp = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

export default function VendorCatalogTools({ vendors, groups }: { vendors: Vendor[]; groups: Group[] }) {
  // ── upload a vendor's price list ──────────────────────────────────────────
  const [upVendor, setUpVendor] = useState<string>("");
  const [rows, setRows] = useState<{ sku_code: string; cp: number; moq: number }[]>([]);
  const [upMsg, setUpMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function parseFile(f: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result as ArrayBuffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        const keys = data.length ? Object.keys(data[0]) : [];
        const codeKey = keys.find((k) => /item.?code|sku.?code|\bcode\b|\bsku\b/i.test(k)) ?? keys[0];
        const cpKey = keys.find((k) => /\bcp\b|cost|net.?rate|purchase|rate|price/i.test(k)) ?? keys[1];
        const moqKey = keys.find((k) => /moq|min.?qty|pack/i.test(k));
        const parsed = data.map((r) => ({
          sku_code: String(r[codeKey] ?? "").trim(),
          cp: Number(String(r[cpKey] ?? "").replace(/[^0-9.]/g, "")) || 0,
          moq: moqKey ? Number(r[moqKey]) || 0 : 0,
        })).filter((r) => r.sku_code && r.cp > 0);
        setRows(parsed);
        setUpMsg({ ok: true, text: `${parsed.length} rows ready — column code="${codeKey}", CP="${cpKey}"${moqKey ? `, MOQ="${moqKey}"` : ""}` });
      } catch (err) { setUpMsg({ ok: false, text: `Could not read file: ${err}` }); }
    };
    reader.readAsArrayBuffer(f);
  }
  async function upload() {
    if (!upVendor || !rows.length) return;
    setBusy(true); setUpMsg(null);
    try {
      const r = await fetch("/api/erp/vendors/catalog", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendorId: Number(upVendor), items: rows }) });
      const d = await r.json();
      if (d.ok) { setUpMsg({ ok: true, text: `✓ Saved ${d.upserted} prices${d.unmatched?.length ? ` · ${d.unmatched.length} SKU codes not found (skipped)` : ""}. Reload to see them below.` }); setRows([]); }
      else setUpMsg({ ok: false, text: d.error || "Upload failed" });
    } catch (e) { setUpMsg({ ok: false, text: String(e) }); }
    finally { setBusy(false); }
  }

  // ── group cost optimizer ──────────────────────────────────────────────────
  const [grp, setGrp] = useState("");
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [loadingG, setLoadingG] = useState(false);
  async function loadGroup(h: string) {
    setGrp(h); setPrices([]); setQty({}); if (!h) return;
    setLoadingG(true);
    try {
      const r = await fetch(`/api/erp/vendors/catalog?header=${encodeURIComponent(h)}`);
      const d = await r.json();
      const rr: PriceRow[] = d.rows || [];
      setPrices(rr);
      const q: Record<number, number> = {};
      for (const p of rr) q[p.sku_id] = q[p.sku_id] ?? 1;
      setQty(q);
    } catch { /* ignore */ } finally { setLoadingG(false); }
  }

  const opt = useMemo(() => {
    const skus = new Map<number, { code: string; name: string }>();
    const vendorsInGrp = new Map<number, string>();
    const cp = new Map<string, number>(); // `${skuId}:${vendorId}` -> cp
    for (const p of prices) {
      skus.set(p.sku_id, { code: p.sku_code, name: p.name });
      vendorsInGrp.set(p.vendor_id, p.vendor_name);
      cp.set(`${p.sku_id}:${p.vendor_id}`, p.cp);
    }
    const skuIds = [...skus.keys()];
    const vIds = [...vendorsInGrp.keys()];
    // per-vendor total (only items that vendor prices) + coverage
    const perVendor = vIds.map((vid) => {
      let total = 0, covered = 0;
      for (const sid of skuIds) { const c = cp.get(`${sid}:${vid}`); if (c != null) { total += (qty[sid] ?? 0) * c; covered++; } }
      return { vid, name: vendorsInGrp.get(vid)!, total, covered };
    }).sort((a, b) => a.total - b.total);
    // mixed-optimal (cheapest vendor per item)
    let mixed = 0; const cheapest = new Map<number, { vid: number; cp: number }>();
    for (const sid of skuIds) {
      let best: { vid: number; cp: number } | null = null;
      for (const vid of vIds) { const c = cp.get(`${sid}:${vid}`); if (c != null && (!best || c < best.cp)) best = { vid, cp: c }; }
      if (best) { mixed += (qty[sid] ?? 0) * best.cp; cheapest.set(sid, best); }
    }
    return { skuIds, vIds, vendorsInGrp, cp, skus, perVendor, mixed, cheapest };
  }, [prices, qty]);

  return (
    <div className="flex flex-col gap-5">
      {/* Upload */}
      <div className={box}>
        <h3 className="mb-2 text-sm font-extrabold">1 · Upload a vendor's price list</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select value={upVendor} onChange={(e) => setUpVendor(e.target.value)} className={inp}>
            <option value="">Pick vendor…</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); }} className="text-sm" />
          <button onClick={upload} disabled={busy || !upVendor || !rows.length} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy ? "Uploading…" : `Upload ${rows.length || ""} prices`}
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">Sheet needs an <b>item/SKU code</b> column and a <b>CP</b> (cost/rate/price) column; MOQ optional. Codes are matched to your SKU master.</p>
        {upMsg && <p className={`mt-1 text-xs font-semibold ${upMsg.ok ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{upMsg.text}</p>}
      </div>

      {/* Optimizer */}
      <div className={box}>
        <h3 className="mb-2 text-sm font-extrabold">2 · Group cost optimizer — who to order from</h3>
        <select value={grp} onChange={(e) => loadGroup(e.target.value)} className={`${inp} w-full max-w-md`}>
          <option value="">Pick a product group…</option>
          {groups.map((g) => <option key={g.header} value={g.header}>{g.header} — {g.priced_items}/{g.group_items} items priced · {g.vendors} vendors</option>)}
        </select>

        {loadingG && <p className="mt-3 text-sm text-[var(--muted)]">Loading…</p>}
        {grp && !loadingG && opt.vIds.length > 0 && (
          <>
            {/* vendor totals */}
            <div className="mt-3 flex flex-wrap gap-2">
              {opt.perVendor.map((v, i) => (
                <div key={v.vid} className={`rounded-lg px-3 py-2 text-sm ${i === 0 ? "bg-[var(--accent-2)]/15 font-bold" : "bg-[var(--surface-2)]"}`}>
                  {v.name}: <b>{inr(v.total)}</b> <span className="text-xs text-[var(--muted)]">({v.covered}/{opt.skuIds.length} items{i === 0 ? " · cheapest single" : ""})</span>
                </div>
              ))}
              <div className="rounded-lg bg-[var(--accent)]/15 px-3 py-2 text-sm font-extrabold text-[var(--accent-strong)]">Best MIXED: {inr(opt.mixed)}</div>
            </div>
            {/* per-item matrix */}
            <div className="mt-3 overflow-x-auto">
              <table className="rtable">
                <thead><tr><th>SKU</th><th className="!text-right">Qty</th>{opt.vIds.map((vid) => <th key={vid} className="!text-right">{opt.vendorsInGrp.get(vid)}</th>)}<th>Cheapest</th></tr></thead>
                <tbody>
                  {opt.skuIds.map((sid) => {
                    const cheap = opt.cheapest.get(sid);
                    return (
                      <tr key={sid}>
                        <td className="font-mono text-xs">{opt.skus.get(sid)?.code}<div className="text-[var(--muted)]">{opt.skus.get(sid)?.name}</div></td>
                        <td className="num-cell"><input type="number" min={0} value={qty[sid] ?? 0} onChange={(e) => setQty((q) => ({ ...q, [sid]: Number(e.target.value) || 0 }))} className="w-16 rounded border border-[var(--border)] px-1 py-0.5 text-right" /></td>
                        {opt.vIds.map((vid) => { const c = opt.cp.get(`${sid}:${vid}`); return <td key={vid} className={`num-cell ${cheap?.vid === vid ? "font-bold text-[var(--accent-2)]" : ""}`}>{c != null ? inr(c) : "—"}</td>; })}
                        <td className="text-xs font-bold text-[var(--accent-2)]">{cheap ? opt.vendorsInGrp.get(cheap.vid) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">Set the qty you want to order per item; totals update live. <b>Best MIXED</b> = order each item from its cheapest vendor. A single‑vendor total only counts items that vendor prices ({opt.skuIds.length} items in this group are priced).</p>
          </>
        )}
        {grp && !loadingG && opt.vIds.length === 0 && <p className="mt-3 text-sm text-[var(--muted)]">No vendor prices uploaded for this group yet.</p>}
      </div>
    </div>
  );
}
