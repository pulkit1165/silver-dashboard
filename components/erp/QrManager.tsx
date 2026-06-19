"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Row = {
  sku_id: number; sku_code: string; name: string; category: string; token: string;
  qr_status: string | null; printed: boolean; qty: number; scanned: boolean;
};

export default function QrManager({ items, canWrite }: { items: Row[]; canWrite: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) =>
      i.sku_code.toLowerCase().includes(s) || i.name.toLowerCase().includes(s) || (i.category ?? "").toLowerCase().includes(s));
  }, [items, q]);
  const visible = filtered.slice(0, 300);

  const stats = {
    total: items.length,
    active: items.filter((i) => i.qr_status === "active").length,
    disabled: items.filter((i) => i.qr_status === "disabled").length,
    missing: items.filter((i) => !i.qr_status).length,
    scanned: items.filter((i) => i.scanned).length,
  };

  async function manage(body: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      const r = await fetch("/api/erp/qr/manage", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) alert(d.error || "Failed");
      else router.refresh();
    } finally { setBusy(""); }
  }

  async function download(token: string, code: string) {
    const r = await fetch(`/api/erp/qr/${token}`);
    const d = await r.json();
    if (d.dataUrl) {
      const a = document.createElement("a");
      a.href = d.dataUrl; a.download = `${code}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="SKUs" value={stats.total} />
        <Stat label="Active QR" value={stats.active} />
        <Stat label="Disabled" value={stats.disabled} danger={stats.disabled > 0} />
        <Stat label="Missing QR" value={stats.missing} danger={stats.missing > 0} />
        <Stat label="Scanned" value={stats.scanned} />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU code / name / category"
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" />
        <Link href="/erp/qr/print" className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">🖨 Print labels</Link>
        <Link href="/erp/skus/import" className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">⬆ Import SKUs</Link>
        {canWrite && stats.missing > 0 && (
          <button onClick={() => manage({ action: "generate-missing" }, "gen")} disabled={!!busy}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50">
            {busy === "gen" ? "Generating…" : `Generate ${stats.missing} missing`}
          </button>
        )}
      </div>

      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr><th>SKU</th><th>Category</th><th className="!text-right">On hand</th><th>QR status</th><th>Flags</th><th>Token</th><th className="!text-right">Actions</th></tr>
            </thead>
            <tbody>
              {visible.map((i) => (
                <tr key={i.sku_id}>
                  <td><Link href={`/erp/skus/${i.sku_id}`} className="font-semibold text-[var(--accent)] hover:underline">{i.name}</Link><div className="font-mono text-xs text-[var(--muted)]">{i.sku_code}</div></td>
                  <td>{i.category}</td>
                  <td className="num-cell">{i.qty}</td>
                  <td>
                    {i.qr_status === "active" ? <span className="tag g">active</span>
                      : i.qr_status === "disabled" ? <span className="tag r">disabled</span>
                      : !i.qr_status ? <span className="tag r">none</span>
                      : <span className="tag n">{i.qr_status}</span>}
                  </td>
                  <td className="space-x-1">
                    {i.printed && <span className="tag n">printed</span>}
                    {i.scanned && <span className="tag g">scanned</span>}
                  </td>
                  <td className="font-mono text-[10px] text-[var(--muted)]">{i.token}</td>
                  <td className="num-cell whitespace-nowrap">
                    {i.qr_status && <button onClick={() => download(i.token, i.sku_code)} className="rounded border border-[var(--border)] px-2 py-1 text-xs font-bold hover:bg-[var(--surface-2)]">⤓</button>}
                    {canWrite && i.qr_status === "active" && (
                      <button onClick={() => manage({ action: "disable", token: i.token }, "d" + i.sku_id)} className="ml-1 rounded border border-[var(--border)] px-2 py-1 text-xs font-bold text-[var(--danger)] hover:bg-[var(--danger-bg)]">Disable</button>
                    )}
                    {canWrite && i.qr_status !== "active" && (
                      <button onClick={() => manage({ action: "regenerate", skuId: i.sku_id }, "r" + i.sku_id)} className="ml-1 rounded border border-[var(--border)] px-2 py-1 text-xs font-bold text-[var(--accent-strong)] hover:bg-[var(--accent-bg)]">Regenerate</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[var(--border)] p-2 text-xs text-[var(--muted)]">
          Showing {visible.length} of {filtered.length}{filtered.length > 300 ? " (refine search to see more)" : ""}.
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className={`kpi ${danger ? "alert" : ""}`}>
      <div className="lab">{label}</div>
      <div className="num" style={danger ? { color: "var(--danger)" } : undefined}>{value}</div>
    </div>
  );
}
