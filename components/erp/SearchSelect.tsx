"use client";

import { useEffect, useRef, useState } from "react";

export interface SearchOption {
  value: number;
  label: string;
  sublabel?: string;
}

// A type-to-filter combobox. Plain <select> dropdowns don't scale past a
// handful of options — this is used anywhere a list can run into the
// hundreds or thousands (customers, items).
export default function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  className,
}: {
  options: SearchOption[];
  value: number | null;
  onChange: (value: number) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = (q
    ? options.filter((o) => `${o.label} ${o.sublabel ?? ""}`.toLowerCase().includes(q))
    : options
  ).slice(0, 50);

  return (
    <div ref={ref} className="relative">
      <input
        className={className}
        value={open ? query : selected ? `${selected.label}${selected.sublabel ? ` (${selected.sublabel})` : ""}` : ""}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(""); setOpen(true); }}
        placeholder={placeholder}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full min-w-[260px] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg">
          {filtered.length === 0 && <div className="px-3 py-2 text-sm text-[var(--muted)]">No matches</div>}
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setQuery(""); setOpen(false); }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]"
            >
              {o.label}
              {o.sublabel && <span className="ml-1 text-xs text-[var(--muted)]">({o.sublabel})</span>}
            </button>
          ))}
          {!q && options.length > 50 && (
            <div className="border-t border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-2)]">
              Showing first 50 of {options.length} — type to search
            </div>
          )}
        </div>
      )}
    </div>
  );
}
