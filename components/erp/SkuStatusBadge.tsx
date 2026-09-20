"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SkuStatusBadge({ id, status, editable }: { id: number; status: string; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function reactivate() {
    setBusy(true);
    try {
      const r = await fetch(`/api/erp/skus/${id}/active`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: true }),
      });
      const d = await r.json();
      if (d.ok) router.refresh();
    } finally { setBusy(false); }
  }

  if (status === "archived") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded px-2 py-0.5 text-[11px] font-bold bg-[var(--surface-2)] text-[var(--muted)]" title="Archived — hidden from normal browse/pick lists, still findable by search">Archived</span>
        {editable && (
          <button type="button" onClick={reactivate} disabled={busy}
            className="rounded px-2 py-0.5 text-[11px] font-bold bg-[var(--accent-2-bg)] text-[var(--accent-2)] hover:opacity-80 disabled:opacity-50">
            {busy ? "…" : "↺ Reactivate"}
          </button>
        )}
      </span>
    );
  }
  if (status === "inactive") {
    return <span className="rounded px-2 py-0.5 text-[11px] font-bold bg-[var(--danger-bg)] text-[var(--danger)]">Inactive</span>;
  }
  return <span className="rounded px-2 py-0.5 text-[11px] font-bold bg-[var(--accent-2-bg)] text-[var(--accent-2)]">Active</span>;
}
