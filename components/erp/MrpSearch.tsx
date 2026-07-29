"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Result = { id: number; sku_code: string; name: string; price: number; change_count: number };

// Server-backed search-as-you-type for the MRP master. Opens a results menu as
// you type (searches the whole catalogue), and picking one filters the editable
// list to that item.
export default function MrpSearch({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced fetch.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) { setResults([]); setOpen(false); return; }
    setBusy(true);
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/erp/masters/mrp/search?q=${encodeURIComponent(term)}`);
        const d = await r.json();
        if (d.ok) { setResults(d.results); setOpen(true); setHi(0); }
      } catch { /* ignore */ } finally { setBusy(false); }
    }, 200);
    return () => clearTimeout(id);
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function pick(r: Result) {
    setOpen(false);
    setQ(r.sku_code);
    router.push(`/erp/masters/mrp?q=${encodeURIComponent(r.sku_code)}`);
  }
  function submit() {
    if (results[hi]) pick(results[hi]);
    else if (q.trim()) router.push(`/erp/masters/mrp?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 focus-within:border-[var(--accent)]">
        <span className="text-[var(--muted)]">🔍</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => { if (results.length) setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(i + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); submit(); }
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search any item — code or name (whole catalogue)…"
          className="w-full bg-transparent text-sm outline-none"
        />
        {busy && <span className="text-xs text-[var(--muted-2)]">…</span>}
        {q && <button onClick={() => { setQ(""); setResults([]); setOpen(false); }} className="text-[var(--muted-2)] hover:text-[var(--fg)]">✕</button>}
      </div>

      {open && (
        <div className="absolute z-40 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
          {results.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-[var(--muted)]">{busy ? "Searching…" : `No item matches "${q}".`}</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(r)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${i === hi ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]"}`}
              >
                <span className="min-w-0">
                  <span className="font-mono text-xs font-bold">{r.sku_code}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">{r.name}</span>
                </span>
                <span className="whitespace-nowrap text-right">
                  <span className={`text-sm font-bold tabular-nums ${r.price > 0 ? "" : "text-[var(--muted-2)]"}`}>{r.price > 0 ? `₹${Number(r.price).toFixed(2)}` : "no MRP"}</span>
                  {r.change_count > 0 && <span className="block text-[10px] text-[var(--muted-2)]">{r.change_count} change{r.change_count === 1 ? "" : "s"}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
