"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

export interface FilterField {
  key: string; // URL query param name
  label: string;
  type?: "text" | "date";
  placeholder?: string;
}

// A generic filter bar driven by URL search params — server pages read
// searchParams and pass them straight to the query function, so filters are
// shareable/bookmarkable and need no client-side data fetching of their own.
export default function ListFilters({ fields }: { fields: FilterField[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    fields.forEach((f) => { v[f.key] = sp.get(f.key) ?? ""; });
    return v;
  });

  function apply(next: Record<string, string>) {
    const params = new URLSearchParams();
    Object.entries(next).forEach(([k, val]) => { if (val) params.set(k, val); });
    router.push(params.toString() ? `${pathname}?${params}` : pathname);
  }

  function update(key: string, val: string) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  function clear() {
    setValues(Object.fromEntries(fields.map((f) => [f.key, ""])));
    router.push(pathname);
  }

  const hasAny = Object.values(values).some(Boolean);

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      {fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
          {f.label}
          <input
            type={f.type ?? "text"}
            value={values[f.key] ?? ""}
            onChange={(e) => update(f.key, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") apply(values); }}
            placeholder={f.placeholder}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </label>
      ))}
      <button
        onClick={() => apply(values)}
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)]"
      >
        Filter
      </button>
      {hasAny && (
        <button
          onClick={clear}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-[var(--surface-2)]"
        >
          Clear
        </button>
      )}
    </div>
  );
}
