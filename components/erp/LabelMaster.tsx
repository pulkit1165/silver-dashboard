"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Sku = { sku_code: string; name: string; unit: string; category: string };
type Row = { line1: string; line2: string; line3: string; units: string; lot: string; rack: string };
const BLANK: Row = { line1: "", line2: "", line3: "", units: "", lot: "", rack: "" };

// Split a full name into up to 3 balanced-ish lines by words (a starting point the
// operator can tweak) — mirrors how the label would auto-wrap.
function autoSplit(name: string, per = 18): Row {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = []; let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (t.length > per && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return { ...BLANK, line1: lines[0] || "", line2: lines[1] || "", line3: lines.slice(2).join(" ") || "" };
}

export default function LabelMaster({
  skus, master, editable, q, total, cap,
}: {
  skus: Sku[]; master: Record<string, Row>; editable: boolean; q: string; total: number; cap: number;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, Row>>(master);
  const [sel, setSel] = useState<string | null>(skus[0]?.sku_code ?? null);
  const [draft, setDraft] = useState<Row>(master[skus[0]?.sku_code ?? ""] ?? BLANK);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selSku = useMemo(() => skus.find((s) => s.sku_code === sel) ?? null, [skus, sel]);
  const dirty = sel != null && JSON.stringify(draft) !== JSON.stringify(rows[sel] ?? BLANK);

  function pick(code: string) {
    setSel(code); setDraft(rows[code] ?? BLANK); setMsg(null);
  }
  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/erp/masters/label${searchRef.current?.value.trim() ? `?q=${encodeURIComponent(searchRef.current.value.trim())}` : ""}`);
  }
  async function save() {
    if (!sel) return;
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/erp/labels/master", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ skuCode: sel, ...draft }),
      });
      const d = await r.json();
      if (d.ok) { setRows((m) => ({ ...m, [sel]: draft })); setMsg("Saved ✓"); setTimeout(() => setMsg(null), 1800); }
      else setMsg(d.error || "Save failed");
    } catch (e) { setMsg(String(e)); }
    finally { setSaving(false); }
  }

  const isSet = (code: string) => { const r = rows[code]; return !!r && Object.values(r).some(Boolean); };
  const lines = [draft.line1, draft.line2, draft.line3].filter(Boolean);
  const previewName = lines.length ? lines : (selSku ? [selSku.name] : []);

  const inp = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* left: search + SKU list */}
      <div className="lg:w-[46%]">
        <form onSubmit={submitSearch} className="mb-3 flex gap-2">
          <input ref={searchRef} defaultValue={q} placeholder="Search code or name…" className={inp} />
          <button className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white">Search</button>
          {q && <button type="button" onClick={() => router.push("/erp/masters/label")} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold">Clear</button>}
        </form>
        {total >= cap && <p className="mb-2 text-xs font-semibold text-[var(--muted)]">Showing {cap} items — search to find any part.</p>}
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--surface-2)] text-left text-xs uppercase text-[var(--muted)]">
              <tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-center">Label</th></tr>
            </thead>
            <tbody>
              {skus.map((s) => (
                <tr key={s.sku_code} onClick={() => pick(s.sku_code)}
                  className={`cursor-pointer border-t border-[var(--border)] ${sel === s.sku_code ? "bg-[var(--accent-bg)]" : "hover:bg-[var(--surface-2)]"}`}>
                  <td className="px-3 py-2 font-mono font-bold">{s.sku_code}</td>
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2 text-center">{isSet(s.sku_code) ? <span className="text-[var(--accent-2)]">✓</span> : <span className="text-[var(--muted-2)]">—</span>}</td>
                </tr>
              ))}
              {skus.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-[var(--muted)]">No parts found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* right: editor + live preview */}
      <div className="lg:flex-1">
        {selSku ? (
          <div className="sticky top-4 flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-lg font-extrabold">{selSku.sku_code}</div>
                <div className="text-sm text-[var(--muted)]">{selSku.name}</div>
              </div>
              <button type="button" disabled={!editable} onClick={() => setDraft(autoSplit(selSku.name))}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)] disabled:opacity-50"
                title="Split the full name into 3 lines as a starting point">↳ Auto-split name</button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-bold uppercase text-[var(--muted)] sm:col-span-2">Line 1 (Label Desc.)
                <input value={draft.line1} disabled={!editable} onChange={(e) => setDraft((d) => ({ ...d, line1: e.target.value }))} className={inp} /></label>
              <label className="flex flex-col gap-1 text-xs font-bold uppercase text-[var(--muted)] sm:col-span-2">Line 2 (Label Desc.1)
                <input value={draft.line2} disabled={!editable} onChange={(e) => setDraft((d) => ({ ...d, line2: e.target.value }))} className={inp} /></label>
              <label className="flex flex-col gap-1 text-xs font-bold uppercase text-[var(--muted)] sm:col-span-2">Line 3 (Label Desc.2)
                <input value={draft.line3} disabled={!editable} onChange={(e) => setDraft((d) => ({ ...d, line3: e.target.value }))} className={inp} /></label>
              <label className="flex flex-col gap-1 text-xs font-bold uppercase text-[var(--muted)]">Units
                <input value={draft.units} disabled={!editable} placeholder={selSku.unit} onChange={(e) => setDraft((d) => ({ ...d, units: e.target.value }))} className={inp} /></label>
              <label className="flex flex-col gap-1 text-xs font-bold uppercase text-[var(--muted)]">Lot No
                <input value={draft.lot} disabled={!editable} onChange={(e) => setDraft((d) => ({ ...d, lot: e.target.value }))} className={inp} /></label>
              <label className="flex flex-col gap-1 text-xs font-bold uppercase text-[var(--muted)]">Rack No
                <input value={draft.rack} disabled={!editable} onChange={(e) => setDraft((d) => ({ ...d, rack: e.target.value }))} className={inp} /></label>
            </div>

            {/* live preview (green stock) */}
            <div>
              <div className="mb-1 text-xs font-bold uppercase text-[var(--muted)]">Label preview</div>
              <div className="rounded-md border-2 border-[var(--border)] bg-[#8cc63f] p-3 font-mono text-black" style={{ maxWidth: 360 }}>
                <div className="text-[15px] font-extrabold">CODE:{selSku.sku_code}</div>
                {previewName.map((l, i) => <div key={i} className="text-[15px] font-bold leading-tight">{l}</div>)}
                <div className="mt-0.5 text-[12px]">Qty.1 {draft.units || selSku.unit || "PCS"}</div>
                <div className="text-[12px]">MRP.Rs.—/-</div>
                <div className="text-[11px]">(Incl. of All Taxes)</div>
                <div className="text-[11px]">Lot No:{draft.lot ? ` ${draft.lot}` : ""}</div>
                <div className="text-[11px]">Rack No:{draft.rack ? ` ${draft.rack}` : ""}</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={save} disabled={!editable || saving || !dirty}
                className="rounded-lg bg-[var(--accent-2)] px-5 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
              <button type="button" disabled={!editable} onClick={() => setDraft(BLANK)}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold hover:bg-[var(--surface-2)] disabled:opacity-50">Clear (use full name)</button>
              {msg && <span className="text-sm font-bold text-[var(--accent-2)]">{msg}</span>}
              {!editable && <span className="text-xs text-[var(--muted)]">Read-only for your role.</span>}
            </div>
            <p className="text-[11px] text-[var(--muted-2)]">Lines print in order as the product name on every label size. Blank = the part&apos;s full name is auto-wrapped. Shared across all ERP PCs.</p>
          </div>
        ) : <div className="rounded-xl border border-[var(--border)] p-8 text-center text-[var(--muted)]">Pick a part on the left to structure its label.</div>}
      </div>
    </div>
  );
}
