"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddSku({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    body.batch_tracked = fd.get("batch_tracked") ? "1" : "";
    body.serial_tracked = fd.get("serial_tracked") ? "1" : "";
    const r = await fetch("/api/erp/skus", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json();
    setBusy(false);
    if (d.ok) { setOpen(false); router.refresh(); }
    else setErr(d.error ?? "Failed to create SKU");
  }

  if (!canCreate) return null;

  return (
    <div className="mb-4">
      <button onClick={() => setOpen((o) => !o)} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)]">
        {open ? "Cancel" : "+ New SKU"}
      </button>
      {open && (
        <form onSubmit={submit} className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-3">
          <F label="SKU code *"><input name="sku_code" required className={inp} placeholder="BRK-PAD-013" /></F>
          <F label="Name *"><input name="name" required className={inp} placeholder="Brake Pad" /></F>
          <F label="Category"><input name="category" className={inp} /></F>
          <F label="Brand"><input name="brand" className={inp} /></F>
          <F label="Unit"><input name="unit" defaultValue="PCS" className={inp} /></F>
          <F label="Price"><input name="price" type="number" step="0.01" className={inp} /></F>
          <F label="Min stock"><input name="min_stock" type="number" className={inp} /></F>
          <F label="Reorder level"><input name="reorder_level" type="number" className={inp} /></F>
          <div className="flex items-end gap-4 text-sm">
            <label className="flex items-center gap-1.5"><input type="checkbox" name="batch_tracked" /> Batch</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" name="serial_tracked" /> Serial</label>
          </div>
          <div className="col-span-2 flex items-center gap-3 sm:col-span-3">
            <button disabled={busy} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {busy ? "Saving…" : "Create SKU + QR"}
            </button>
            {err && <span className="text-sm font-semibold text-[var(--danger)]">{err}</span>}
            <span className="text-xs text-[var(--muted)]">A unique QR token is generated automatically.</span>
          </div>
        </form>
      )}
    </div>
  );
}

const inp = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">{label}{children}</label>;
}
