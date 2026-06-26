"use client";

import { useState } from "react";

// A single editable numeric cell — click to edit, Enter/blur to save, Esc to
// cancel. Used for the Party-wise / Item-wise net rate master tables where
// the team edits one value at a time directly in the table.
export default function EditableRate({
  value,
  endpoint,
  field,
  suffix,
}: {
  value: number;
  endpoint: string;
  field: string;
  suffix?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saved, setSaved] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const num = Number(draft);
    if (!Number.isFinite(num) || num < 0) { setErr("Invalid number"); return; }
    if (num === saved) { setEditing(false); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: num }),
      });
      const d = await r.json();
      if (d.ok) { setSaved(num); setEditing(false); }
      else setErr(d.error ?? "Save failed");
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(String(saved)); setEditing(true); setErr(null); }}
        className="rounded px-2 py-1 text-right font-semibold tabular-nums hover:bg-[var(--surface-2)]"
        title="Click to edit"
      >
        {saved.toFixed(2)}{suffix}
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      <input
        type="number"
        step="0.01"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={save}
        disabled={busy}
        className="w-24 rounded border border-[var(--accent)] bg-[var(--surface)] px-2 py-1 text-right text-sm outline-none"
      />
      {err && <span className="text-xs font-semibold text-[var(--danger)]">{err}</span>}
    </div>
  );
}
