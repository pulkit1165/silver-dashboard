"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EditLabelInfo({
  skuId, masterQty, singleQty, barcodeCode, canEdit,
}: { skuId: number; masterQty: number; singleQty: number; barcodeCode: string; canEdit: boolean }) {
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
    const r = await fetch(`/api/erp/skus/${skuId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json();
    setBusy(false);
    if (d.ok) { setOpen(false); router.refresh(); }
    else setErr(d.error ?? "Failed to save");
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>
          Barcode: <span className="font-mono">{barcodeCode || "(uses SKU code)"}</span>
          {" · "}Single qty: <b>{singleQty || 1}</b>
          {" · "}Master qty: <b>{masterQty || "—"}</b>
        </span>
        {canEdit && (
          <button onClick={() => setOpen(true)} className="text-xs font-semibold text-[var(--accent)] hover:underline">Edit</button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
        Barcode code
        <input name="barcode_code" defaultValue={barcodeCode} placeholder="defaults to SKU code"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
        Single (unit) qty
        <input name="single_qty" type="number" defaultValue={singleQty || 1} placeholder="1"
          className="w-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
        Master carton qty
        <input name="master_qty" type="number" defaultValue={masterQty || ""} placeholder="e.g. 10"
          className="w-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]" />
      </label>
      <button disabled={busy} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60">
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-[var(--muted)] hover:underline">Cancel</button>
      {err && <span className="text-xs font-semibold text-[var(--danger)]">{err}</span>}
    </form>
  );
}
