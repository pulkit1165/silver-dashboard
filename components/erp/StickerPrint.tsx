"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { STICKER_SIZES } from "@/lib/erp/stickerSizes";
import { type LabelDoc, type LabelFill } from "@/lib/erp/labelDoc";
import { renderDocToTSPL, ensureFontsLoaded } from "@/lib/erp/labelRender";

export type AbbrevItem = {
  sku_code: string; line1: string; line2: string; unit: string;
  masterPack: number; singlePack: number;
};
type Br = { id: string; pc: string; name: string; online: boolean; code?: string };
type Sel = { code: string; copies: number };
type Tier = "single" | "master";

// Print ABBREVIATION stickers: pick SKUs (trade name + size from the sticker master),
// a size + printer, Single/Master, then print. Reuses the QR + render engine +
// /print-raster exactly like the normal labels — separate design (`sticker-*`).
export default function StickerPrint({ items, companyAddress = "" }: { items: AbbrevItem[]; companyAddress?: string }) {
  const byCode = useMemo(() => {
    const m = new Map<string, AbbrevItem>();
    for (const it of items) m.set(it.sku_code.toUpperCase(), it);
    return m;
  }, [items]);

  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Sel[]>([]);
  const [sizeId, setSizeId] = useState(STICKER_SIZES[2]?.id ?? STICKER_SIZES[0].id); // default green-65x35
  const [tier, setTier] = useState<Tier>("single");
  const [speed, setSpeed] = useState(4);
  const [brPrinters, setBrPrinters] = useState<Br[]>([]);
  const [brPrinterId, setBrPrinterId] = useState("");
  const [approvedDoc, setApprovedDoc] = useState<LabelDoc | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const selRef = useRef(sel); selRef.current = sel;

  const size = useMemo(() => STICKER_SIZES.find((s) => s.id === sizeId) ?? STICKER_SIZES[0], [sizeId]);

  // printers
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/erp/print/printers", { cache: "no-store" });
        const d = await r.json();
        const list: Br[] = d.printers || d || [];
        setBrPrinters(list);
        const on = list.find((p) => p.online);
        if (on) setBrPrinterId(on.id);
      } catch { /* ignore */ }
    })();
  }, []);

  // approved sticker design for the chosen size
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`/api/erp/labels/design?sizeId=${encodeURIComponent(sizeId)}`, { cache: "no-store" });
        const d = await r.json();
        if (cancel) return;
        setApprovedDoc(d.design?.approved_doc ?? null);
      } catch { if (!cancel) setApprovedDoc(null); }
    })();
    return () => { cancel = true; };
  }, [sizeId]);

  const matches = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!s) return items.slice(0, 40);
    return items.filter((it) =>
      it.sku_code.toUpperCase().includes(s) || it.line1.toUpperCase().includes(s) || it.line2.toUpperCase().includes(s)
    ).slice(0, 40);
  }, [q, items]);

  const addSel = (code: string) => setSel((s) => (s.some((x) => x.code === code) ? s : [...s, { code, copies: 1 }]));
  const setCopies = (code: string, n: number) => setSel((s) => s.map((x) => (x.code === code ? { ...x, copies: Math.max(1, Math.round(n) || 1) } : x)));
  const removeSel = (code: string) => setSel((s) => s.filter((x) => x.code !== code));

  async function printAll() {
    if (!approvedDoc) { setMsg({ ok: false, text: "No approved sticker design for this size yet — design & approve it first." }); return; }
    if (!brPrinterId) { setMsg({ ok: false, text: "Pick a printer." }); return; }
    const list = selRef.current.filter((x) => x.copies > 0);
    if (!list.length) { setMsg({ ok: false, text: "Add at least one item to print." }); return; }
    setBusy(true); setMsg(null);
    try {
      const name = brPrinters.find((p) => p.id === brPrinterId)?.name || "";
      const dpi = /\b34[5-9]\b|300\s*?dpi/i.test(name) ? 300 : 203;
      const dp = dpi === 203 ? 8 : dpi / 25.4;
      await ensureFontsLoaded(approvedDoc);
      let done = 0;
      for (const it of list) {
        const abbr = byCode.get(it.code.toUpperCase());
        if (!abbr) continue;
        // Real QR + MRP + lot/rack/pkd for this SKU (same bulk endpoint the labels use).
        const br = await fetch("/api/erp/labels/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codes: [it.code] }) }).then((r) => r.json()).catch(() => ({}));
        const l = (br.labels || [])[0] || {};
        const fill: LabelFill = {
          sku_code: it.code,
          abbr1: abbr.line1, abbr2: abbr.line2,
          unit: abbr.unit || l.unit || "PCS",
          tier,
          singleQty: abbr.singlePack || 1,
          masterQty: abbr.masterPack || abbr.singlePack || 1,
          price: l.price,
          lot: l.lot, rack: l.rack, pkd: l.pkd,
          qrMatrix: tier === "master" ? (l.qrMatrixMaster ?? l.qrMatrixSingle) : l.qrMatrixSingle,
          qrSvg: tier === "master" ? (l.qrSvgMaster ?? l.qrSvg) : (l.qrSvgSingle ?? l.qrSvg),
          address: companyAddress,
        };
        const bmp = await renderDocToTSPL(approvedDoc, fill, dp);
        const r = await fetch("/api/erp/labels/print-raster", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ printerId: brPrinterId, sizeId, w: approvedDoc.w, h: approvedDoc.h, copies: it.copies, skuCode: it.code, speed: Number(speed) || 4, density: 10, ...bmp }),
        });
        const d = await r.json();
        if (d.ok) done += it.copies; else { setMsg({ ok: false, text: `${it.code}: ${d.error || "print failed"}` }); }
      }
      if (done > 0) setMsg({ ok: true, text: `🖨 Sent ${done} sticker(s) to the printer.` });
    } catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setBusy(false); }
  }

  const inp = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

  return (
    <div className="flex flex-col gap-4">
      {/* controls */}
      <section className="panel">
        <div className="panel-hd">1 · Size, printer & mode</div>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">Sticker size
            <select value={sizeId} onChange={(e) => setSizeId(e.target.value)} className={inp}>
              {STICKER_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">Printer
            <select value={brPrinterId} onChange={(e) => setBrPrinterId(e.target.value)} className={inp}>
              <option value="">Pick a printer…</option>
              {brPrinters.map((p) => <option key={p.id} value={p.id} disabled={!p.online}>{(p.code || p.name)}{p.online ? "" : " (offline)"}</option>)}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">Pack
            <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
              {(["single", "master"] as const).map((t) => (
                <button key={t} onClick={() => setTier(t)} className={`px-3 py-2 text-sm font-bold ${tier === t ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)]"}`}>{t === "single" ? "Single" : "Master"}</button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">Speed (ips)
            <input type="number" min={1} max={4} value={speed} onChange={(e) => setSpeed(Math.max(1, Math.min(4, Number(e.target.value) || 4)))} className={`${inp} w-20`} />
          </label>
          {!approvedDoc && <span className="text-xs font-bold text-[var(--danger)]">⚠ No approved sticker design for this size — <a className="underline" href="/erp/stickers/design">design it first</a>.</span>}
        </div>
      </section>

      {/* pick items */}
      <section className="panel">
        <div className="panel-hd">2 · Pick items ({items.length} in the sticker master)</div>
        <div className="flex flex-col gap-3 p-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item code or name…" className={inp} />
          <div className="max-h-64 overflow-auto rounded-lg border border-[var(--border)]">
            <table className="rtable">
              <thead><tr><th>Code</th><th>Line 1</th><th>Line 2</th><th>Unit</th><th></th></tr></thead>
              <tbody>
                {matches.length === 0 && <tr><td colSpan={5} className="!py-6 text-center text-[var(--muted)]">No items match.</td></tr>}
                {matches.map((it) => (
                  <tr key={it.sku_code}>
                    <td className="font-mono text-xs">{it.sku_code}</td>
                    <td className="font-semibold">{it.line1}</td>
                    <td className="text-[var(--muted)]">{it.line2}</td>
                    <td>{it.unit}</td>
                    <td className="!text-right"><button onClick={() => addSel(it.sku_code)} className="rounded border border-[var(--accent)] px-2 py-0.5 text-xs font-bold text-[var(--accent)]">Add</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* to print */}
      <section className="panel">
        <div className="panel-hd">3 · To print ({sel.length})</div>
        <div className="flex flex-col gap-3 p-4">
          {sel.length === 0 ? <p className="text-sm text-[var(--muted)]">Add items above.</p> : (
            <div className="overflow-x-auto">
              <table className="rtable">
                <thead><tr><th>Code</th><th>Sticker text</th><th>Qty on label</th><th className="!text-right">Copies</th><th></th></tr></thead>
                <tbody>
                  {sel.map((x) => {
                    const it = byCode.get(x.code.toUpperCase());
                    const packQty = tier === "master" ? (it?.masterPack || 1) : (it?.singlePack || 1);
                    return (
                      <tr key={x.code}>
                        <td className="font-mono text-xs">{x.code}</td>
                        <td className="font-semibold">{it?.line1} <span className="text-[var(--muted)]">{it?.line2}</span></td>
                        <td className="text-[var(--muted)]">Qty. {packQty} {it?.unit}</td>
                        <td className="!text-right"><input type="number" min={1} value={x.copies} onChange={(e) => setCopies(x.code, Number(e.target.value))} className={`${inp} w-20 text-right`} /></td>
                        <td className="!text-right"><button onClick={() => removeSel(x.code)} className="text-[var(--danger)]">✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button onClick={printAll} disabled={busy || sel.length === 0} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50">{busy ? "Printing…" : "🖨 Print stickers"}</button>
            {msg && <span className="text-sm font-bold" style={{ color: msg.ok ? "var(--accent-2)" : "var(--danger)" }}>{msg.text}</span>}
          </div>
        </div>
      </section>
    </div>
  );
}
