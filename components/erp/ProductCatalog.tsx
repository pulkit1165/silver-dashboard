"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CatalogGroup } from "@/lib/erp/catalog";

export interface CatalogCompany {
  name: string; address: string; city: string; pincode: string;
  phone: string; email: string; gstin: string;
}

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mrpStr = (n: number) => (n > 0 ? Number(n).toFixed(2) : "");
const mopStr = (n: number) => (n > 0 ? String(Math.round(n)) : "");
const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

// A photo/logo is either an uploaded data-URL (use as-is) or a /catalog-photos path
// (needs the site origin to load inside the popup / Word).
const imgSrc = (p: string, origin: string) => (p.startsWith("data:") ? p : origin + p);

// Downscale + compress an image file to a small data URL (keeps DB rows + exports light).
async function fileToDataUrl(file: File, maxW: number, mime = "image/jpeg", quality = 0.82): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
  const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  if (mime === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(img.src);
  return c.toDataURL(mime, quality);
}

// One self-contained document that reproduces the client's price-list PDF.
function catalogHtml(
  groups: CatalogGroup[], co: CatalogCompany,
  opts: { autoPrint: boolean; scope: string; origin: string; logo: string | null; topNote: string }
): string {
  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);
  const contact = [
    [co.address, co.city, co.pincode].filter(Boolean).join(", "),
    [co.phone && `Ph: ${co.phone}`, co.email].filter(Boolean).join("  ·  "),
    co.gstin && `GSTIN: ${co.gstin}`,
  ].filter(Boolean).map(esc).join("<br/>");

  const body = groups.map((g) => {
    const band = `<tr class="band"><td colspan="4">${esc(g.header)}</td><td class="s"></td></tr>`;
    const photo = g.photo
      ? `<tr class="photo"><td colspan="4"><img src="${imgSrc(g.photo, opts.origin)}" alt=""/></td><td class="s"></td></tr>` : "";
    const rows = g.items.map((it) => `
      <tr class="irow">
        <td class="code">${esc(it.sku_code)}</td>
        <td>${esc(it.name)}</td>
        <td class="r">${mrpStr(it.mrp)}</td>
        <td class="r">${mopStr(it.master_qty)}</td>
        <td class="s"></td>
      </tr>`).join("");
    return band + photo + rows;
  }).join("");

  const logoImg = opts.logo ? `<img class="logo" src="${opts.logo}" alt=""/>` : "";
  const noteBlock = opts.topNote.trim()
    ? `<div class="note">${esc(opts.topNote).replace(/\n/g, "<br/>")}</div>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>${esc(co.name)} — Price List</title>
<style>
  @page { size: A4 portrait; margin: 8mm 7mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, "Segoe UI", sans-serif; color:#111; margin:0; font-size:13px; }
  .mast { display:flex; align-items:center; justify-content:space-between; gap:14px;
    border-bottom:3px solid #b91c1c; padding:0 2px 8px; margin-bottom:8px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .logo { max-height:52px; max-width:150px; }
  .bigname { font-size:20px; font-weight:800; letter-spacing:.4px; line-height:1.05; }
  .contact { text-align:right; font-size:9px; color:#4b5563; line-height:1.5; }
  .title { text-align:center; font-size:18px; font-weight:800; letter-spacing:2px; margin:3px 0; }
  .meta { text-align:center; font-size:11px; color:#6b7280; margin-bottom:8px; }
  .note { border:1px solid #d1d5db; background:#f9fafb; border-left:3px solid #b91c1c;
    padding:7px 11px; margin:0 0 10px; font-size:13px; line-height:1.5; white-space:pre-wrap; }
  table.cat { border-collapse:collapse; width:100%; table-layout:fixed; }
  thead { display:table-header-group; }
  tr { page-break-inside:avoid; }
  /* Narrow ITEM NAME so MRP sits right after the name; the spacer column (col.s)
     is invisible and absorbs the leftover width on the right. */
  col.c { width:11%; } col.n { width:42%; } col.m { width:13%; } col.o { width:10%; } col.s { width:24%; }
  .colh th { border:1px solid #111; background:#f2f2f2; font-weight:700; font-size:12px;
    text-transform:uppercase; letter-spacing:.3px; padding:5px 8px; text-align:left; }
  .colh th.r { text-align:right; }
  .cat td { border-left:1px solid #111; border-right:1px solid #111; }
  .band td { border:1px solid #111; background:#111; color:#fff; text-align:center;
    font-weight:800; font-size:14.5px; letter-spacing:.5px; padding:6px 8px; }
  .photo td { border-left:1px solid #111; border-right:1px solid #111; border-bottom:1px solid #111;
    text-align:center; padding:8px 6px; background:#fff; }
  .photo img { max-height:150px; max-width:52%; }
  .irow td { padding:3.5px 8px; font-size:13.5px; vertical-align:top; }
  .irow td.code { font-family:"Courier New",monospace; font-weight:700; font-size:12.5px; white-space:nowrap; }
  .irow td.r { text-align:right; white-space:nowrap; }
  /* spacer column: invisible, so the visible grid ends cleanly after MOP */
  .cat td.s, .colh th.s { border:none !important; background:transparent !important; }
  tbody tr:last-child td { border-bottom:1px solid #111; }
  tbody tr:last-child td.s { border-bottom:none !important; }
  .foot { margin-top:8px; text-align:center; font-size:10px; color:#9ca3af; }
</style></head>
<body${opts.autoPrint ? ' onload="window.focus();window.print()"' : ""}>
  <div class="mast">
    <div class="brand">${logoImg}<div class="bigname">${esc(co.name)}</div></div>
    <div class="contact">${contact}</div>
  </div>
  <div class="title">PRICE LIST</div>
  <div class="meta">${esc(opts.scope)} &nbsp;·&nbsp; ${totalItems} items · ${groups.length} categories &nbsp;·&nbsp; ${fmtDate(new Date())}</div>
  ${noteBlock}
  <table class="cat">
    <colgroup><col class="c"/><col class="n"/><col class="m"/><col class="o"/><col class="s"/></colgroup>
    <thead><tr class="colh"><th>ITEM CODE</th><th>ITEM NAME</th><th class="r">MRP</th><th class="r">MOP</th><th class="s"></th></tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="foot">${esc(co.name)} · Generated ${fmtDate(new Date())} · MRP inclusive of applicable taxes; prices subject to change.</div>
</body></html>`;
}

export default function ProductCatalog({
  groups, company, canEdit, topNote, logo,
}: { groups: CatalogGroup[]; company: CatalogCompany; canEdit: boolean; topNote: string; logo: string | null }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [note, setNote] = useState(topNote);
  const [busy, setBusy] = useState<string>("");
  const [msg, setMsg] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

  const totalItems = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);
  const headers = useMemo(() => groups.map((g) => g.header), [groups]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: CatalogGroup[] = [];
    for (const g of groups) {
      if (cat !== "all" && g.header !== cat) continue;
      const items = needle
        ? g.items.filter((it) => it.sku_code.toLowerCase().includes(needle) || it.name.toLowerCase().includes(needle))
        : g.items;
      if (items.length) out.push({ header: g.header, items, photo: g.photo });
    }
    return out;
  }, [groups, q, cat]);

  const shownItems = useMemo(() => visible.reduce((n, g) => n + g.items.length, 0), [visible]);
  const scope = cat === "all" ? (q ? `Search: “${q}”` : "All categories") : cat;

  async function api(body: Record<string, unknown>) {
    const r = await fetch("/api/erp/catalog", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return r.json();
  }
  async function flash(t: string) { setMsg(t); setTimeout(() => setMsg(""), 2200); }

  async function saveNote() {
    setBusy("note");
    const d = await api({ kind: "note", text: note });
    setBusy(""); if (d.ok) { flash("Top text saved ✓"); router.refresh(); } else flash(d.error || "Failed");
  }
  async function onLogo(file?: File | null, remove = false) {
    setBusy("logo");
    try {
      const dataUrl = remove ? "" : file ? await fileToDataUrl(file, 420, "image/png", 0.9) : "";
      const d = await api({ kind: "logo", dataUrl });
      if (d.ok) { flash(remove ? "Logo removed ✓" : "Logo updated ✓"); router.refresh(); } else flash(d.error || "Failed");
    } catch { flash("Could not read image"); } finally { setBusy(""); }
  }
  async function onPhoto(header: string, file?: File | null, remove = false) {
    setBusy("photo:" + header);
    try {
      const dataUrl = remove ? "" : file ? await fileToDataUrl(file, 360, "image/jpeg", 0.82) : "";
      const d = await api({ kind: "photo", header, dataUrl });
      if (d.ok) { flash(remove ? "Photo removed ✓" : "Photo updated ✓"); router.refresh(); } else flash(d.error || "Failed");
    } catch { flash("Could not read image"); } finally { setBusy(""); }
  }
  async function addSku(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    setBusy("addsku");
    const r = await fetch("/api/erp/skus", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    setBusy("");
    if (d.ok) { flash("Product added ✓"); setAddOpen(false); router.refresh(); } else flash(d.error || "Failed to add");
  }

  function exportPdf() {
    const html = catalogHtml(visible, company, { autoPrint: true, scope, origin: window.location.origin, logo, topNote: note });
    const w = window.open("", "_blank", "width=940,height=1040");
    if (!w) { alert("Please allow pop-ups for this site to export the PDF."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }
  function exportWord() {
    const html = catalogHtml(visible, company, { autoPrint: false, scope, origin: window.location.origin, logo, topNote: note });
    const blob = new Blob(["﻿", html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `PriceList${cat !== "all" ? "-" + cat.replace(/[^a-z0-9]+/gi, "_") : ""}.doc`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const inp = "rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm";

  return (
    <div>
      {/* editor panel (admins) */}
      {canEdit && (
        <div className="panel mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-4">
            {/* logo */}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase text-[var(--muted)]">Logo (top-left)</span>
              <div className="flex items-center gap-2">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="logo" className="max-h-12 max-w-[130px] rounded border border-[var(--border)] bg-white p-1" />
                ) : <span className="text-xs text-[var(--muted-2)]">No logo — none shown</span>}
                <input ref={logoInput} type="file" accept="image/*" hidden
                  onChange={(e) => onLogo(e.target.files?.[0], false)} />
                <button onClick={() => logoInput.current?.click()} disabled={busy === "logo"}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-bold hover:bg-gray-50 disabled:opacity-50">
                  {busy === "logo" ? "…" : logo ? "Replace" : "Upload logo"}
                </button>
                {logo && <button onClick={() => onLogo(null, true)} className="text-xs font-bold text-[var(--danger)] hover:underline">Remove</button>}
              </div>
            </div>
            {/* top note */}
            <div className="flex min-w-[280px] flex-1 flex-col gap-1">
              <span className="text-xs font-bold uppercase text-[var(--muted)]">Special text on top (shows on the catalogue &amp; exports)</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                placeholder="e.g. Prices effective 1 Sep 2026 · Diwali offer · Terms…"
                className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm" />
              <div className="flex items-center gap-2">
                <button onClick={saveNote} disabled={busy === "note"}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                  {busy === "note" ? "Saving…" : "Save top text"}
                </button>
                {msg && <span className="text-xs font-bold text-[var(--accent-2)]">{msg}</span>}
              </div>
            </div>
            {/* add SKU */}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase text-[var(--muted)]">Add product</span>
              <button onClick={() => setAddOpen((o) => !o)}
                className="rounded-lg bg-[var(--accent-2)] px-3 py-1.5 text-xs font-bold text-white">
                {addOpen ? "Cancel" : "+ New SKU"}
              </button>
            </div>
          </div>
          {addOpen && (
            <form onSubmit={addSku} className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:grid-cols-6">
              <label className="flex flex-col gap-0.5 text-[11px] font-bold text-[var(--muted)]">SKU code *
                <input name="sku_code" required placeholder="SU35010" className={inp} /></label>
              <label className="col-span-2 flex flex-col gap-0.5 text-[11px] font-bold text-[var(--muted)]">Name *
                <input name="name" required placeholder="GEAR BOX SPROCKET APCHE 14-T" className={inp} /></label>
              <label className="flex flex-col gap-0.5 text-[11px] font-bold text-[var(--muted)]">Category (header)
                <input name="header" list="cat-headers" placeholder="pick / type" className={inp} />
                <datalist id="cat-headers">{headers.map((h) => <option key={h} value={h} />)}</datalist></label>
              <label className="flex flex-col gap-0.5 text-[11px] font-bold text-[var(--muted)]">MRP
                <input name="price" type="number" step="0.01" placeholder="75" className={inp} /></label>
              <label className="flex flex-col gap-0.5 text-[11px] font-bold text-[var(--muted)]">Master qty
                <input name="master_qty" type="number" placeholder="10" className={inp} /></label>
              <div className="col-span-2 sm:col-span-6">
                <button disabled={busy === "addsku"} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                  {busy === "addsku" ? "Adding…" : "Add to catalogue"}
                </button>
                <span className="ml-2 text-[11px] text-[var(--muted)]">Give it a Category so it appears in that group. Barcode/QR are created automatically.</span>
              </div>
            </form>
          )}
        </div>
      )}

      {/* filter + export controls */}
      <div className="panel mb-4 flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item — code or name…"
          className="min-w-[220px] flex-1 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm">
          <option value="all">All categories ({groups.length})</option>
          {groups.map((g) => <option key={g.header} value={g.header}>{g.header} ({g.items.length})</option>)}
        </select>
        <span className="text-sm text-[var(--muted)]">{shownItems.toLocaleString("en-IN")} / {totalItems.toLocaleString("en-IN")} items</span>
        <div className="ml-auto flex gap-2">
          <button onClick={exportPdf} className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90">⬇ Export PDF</button>
          <button onClick={exportWord} className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50">⬇ Export Word</button>
        </div>
      </div>

      {note.trim() && (
        <div className="mb-4 rounded-lg border border-[var(--border)] border-l-4 border-l-[var(--accent)] bg-[var(--surface-2)] px-4 py-2 text-sm whitespace-pre-wrap">{note}</div>
      )}

      {/* on-screen catalogue */}
      {visible.length === 0 ? (
        <p className="px-1 text-sm text-[var(--muted)]">No products match this filter.</p>
      ) : (
        visible.map((g) => (
          <section key={g.header} className="panel mb-4 overflow-hidden !p-0">
            <div className="flex items-center justify-between gap-3 bg-[#111] px-4 py-2 text-white">
              <h3 className="text-sm font-extrabold tracking-wide">{g.header}</h3>
              <span className="text-xs text-gray-300">{g.items.length} items</span>
            </div>
            {(g.photo || canEdit) && (
              <div className="flex flex-col items-center gap-2 border-b border-[var(--border)] bg-white py-3">
                {g.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.photo} alt={g.header} className="max-h-32 object-contain" />
                )}
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-bold hover:bg-gray-50">
                      {busy === "photo:" + g.header ? "…" : g.photo ? "Replace photo" : "＋ Add photo"}
                      <input type="file" accept="image/*" hidden onChange={(e) => onPhoto(g.header, e.target.files?.[0], false)} />
                    </label>
                    {g.photo && <button onClick={() => onPhoto(g.header, null, true)} className="text-xs font-bold text-[var(--danger)] hover:underline">Remove</button>}
                  </div>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="rtable">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>Item Code</th><th>Item Name</th>
                    <th className="!text-right" style={{ width: 90 }}>MRP</th>
                    <th className="!text-right" style={{ width: 70 }}>MOP</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it) => (
                    <tr key={it.sku_code}>
                      <td className="font-mono text-xs font-bold text-[var(--muted)]">{it.sku_code}</td>
                      <td>{it.name}</td>
                      <td className="num-cell font-semibold">{it.mrp > 0 ? it.mrp.toFixed(2) : "—"}</td>
                      <td className="num-cell">{it.master_qty > 0 ? Math.round(it.master_qty) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
