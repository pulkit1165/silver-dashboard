"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const DEPTS = ["Production", "Assembly", "Stores", "Maintenance", "Sales", "Dispatch", "Admin", "Other"];

export default function NewQuotation() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dept, setDept] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function create() {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/erp/purchase/quotations", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", department: dept, title }),
      });
      const d = await r.json();
      if (d.ok) router.push(`/erp/purchase/quotations/${d.id}`);
      else setErr(d.error || "Failed");
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  const inp = "rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm";
  if (!open) return (
    <div className="mb-4"><button onClick={() => setOpen(true)} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:opacity-90">+ New Quotation</button></div>
  );
  return (
    <div className="panel mb-4 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Requesting department
        <input list="depts" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="e.g. Production" className={inp} />
        <datalist id="depts">{DEPTS.map((d) => <option key={d} value={d} />)}</datalist>
      </label>
      <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs font-bold text-[var(--muted)]">Title / note (optional)
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Monthly bearings & fasteners" className={inp} />
      </label>
      <button onClick={create} disabled={busy} className="rounded-lg bg-[var(--accent-2)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "Creating…" : "Create & add items"}</button>
      <button onClick={() => setOpen(false)} className="text-xs font-semibold text-[var(--muted)] hover:underline">Cancel</button>
      {err && <span className="text-xs font-bold text-[var(--danger)]">{err}</span>}
    </div>
  );
}
