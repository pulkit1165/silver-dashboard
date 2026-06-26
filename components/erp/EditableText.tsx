"use client";

import { useState } from "react";

// Text-field sibling of EditableRate — click to edit, Enter/blur to save.
export default function EditableText({
  value,
  endpoint,
  field,
  placeholder,
}: {
  value: string;
  endpoint: string;
  field: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (draft === saved) { setEditing(false); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: draft }),
      });
      const d = await r.json();
      if (d.ok) { setSaved(draft); setEditing(false); }
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
        onClick={() => { setDraft(saved); setEditing(true); setErr(null); }}
        className="rounded px-2 py-1 text-left font-semibold hover:bg-[var(--surface-2)]"
        title="Click to edit"
      >
        {saved || <span className="font-normal text-[var(--muted)]">{placeholder ?? "—"}</span>}
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={save}
        disabled={busy}
        placeholder={placeholder}
        className="w-36 rounded border border-[var(--accent)] bg-[var(--surface)] px-2 py-1 text-sm outline-none"
      />
      {err && <span className="text-xs font-semibold text-[var(--danger)]">{err}</span>}
    </div>
  );
}
