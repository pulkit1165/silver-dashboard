"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface SearchOption {
  value: number;
  label: string;
  sublabel?: string;
}

// Move focus to the next data-entry field (input/select/textarea) after `current`,
// scoped to the nearest [data-keyflow] container. Read-only fields are rendered as
// <div>, so they're skipped naturally. Powers "press Enter → next entry".
export function focusNextField(current: HTMLElement | null | undefined) {
  if (!current) return;
  const root = (current.closest("[data-keyflow]") as HTMLElement) ?? document.body;
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("input, select, textarea")).filter((el) => {
    const e = el as HTMLInputElement;
    return !e.disabled && !e.readOnly && e.type !== "hidden" && el.tabIndex !== -1 && el.offsetParent !== null;
  });
  const i = nodes.indexOf(current);
  if (i < 0) return;
  const next = nodes[i + 1] as HTMLInputElement | undefined;
  if (next) {
    next.focus();
    if (typeof next.select === "function" && ["text", "search", "number"].includes(next.type)) next.select();
  }
}

// A type-to-filter combobox with full keyboard control. Plain <select>
// dropdowns don't scale past a handful of options — this is used anywhere a
// list can run into the hundreds or thousands (customers/parties, items).
// Keyboard: ↑/↓ move (wrap), Enter selects, Esc closes, Home/End jump, PgUp/PgDn page.
const CAP = 100; // rendered rows (keeps the menu snappy on huge lists)

export default function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  className,
  advance = false,
}: {
  options: SearchOption[];
  value: number | null;
  onChange: (value: number) => void;
  placeholder?: string;
  className?: string;
  /** after a selection, move focus to the next data-entry field (Enter → next entry) */
  advance?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (q
        ? options.filter((o) => `${o.label} ${o.sublabel ?? ""}`.toLowerCase().includes(q))
        : options
      ).slice(0, CAP),
    [q, options],
  );

  // First match highlighted whenever the query changes or the menu (re)opens.
  useEffect(() => { setActive(0); }, [q, open]);

  // Keep the highlighted row scrolled into view as it moves.
  useEffect(() => {
    if (open) itemRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(o: SearchOption) {
    onChange(o.value);
    setQuery("");
    setOpen(false);
    if (advance) requestAnimationFrame(() => focusNextField(inputRef.current));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const last = filtered.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) { setOpen(true); return; }
        setActive((a) => (a >= last ? 0 : a + 1)); // wrap to top
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) { setOpen(true); return; }
        setActive((a) => (a <= 0 ? last : a - 1)); // wrap to bottom
        break;
      case "Enter":
        if (open && filtered[active]) { e.preventDefault(); choose(filtered[active]); }
        break;
      case "Escape":
        if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        break;
      case "Home":
        if (open) { e.preventDefault(); setActive(0); }
        break;
      case "End":
        if (open) { e.preventDefault(); setActive(last < 0 ? 0 : last); }
        break;
      case "PageDown":
        if (open) { e.preventDefault(); setActive((a) => Math.min(a + 8, last)); }
        break;
      case "PageUp":
        if (open) { e.preventDefault(); setActive((a) => Math.max(a - 8, 0)); }
        break;
      case "Tab":
        setOpen(false); // let focus move on naturally
        break;
    }
  }

  itemRefs.current = [];
  return (
    <div ref={ref} className="relative">
      <input
        ref={inputRef}
        className={className}
        value={open ? query : selected ? `${selected.label}${selected.sublabel ? ` (${selected.sublabel})` : ""}` : ""}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `ss-opt-${filtered[active].value}` : undefined}
        autoComplete="off"
      />
      {open && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 max-h-[80vh] w-full min-w-[440px] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1.5 text-[15px] shadow-2xl"
        >
          {filtered.length === 0 && <div className="px-3 py-2 text-sm text-[var(--muted)]">No matches</div>}
          {filtered.map((o, i) => (
            <button
              key={o.value}
              id={`ss-opt-${o.value}`}
              ref={(el) => { itemRefs.current[i] = el; }}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()} // keep the input focused so keyboard stays live
              onClick={() => choose(o)}
              className={`flex w-full items-baseline gap-2 px-4 py-3 text-left ${
                i === active ? "bg-[var(--accent-bg)] text-[var(--accent-strong)]" : "hover:bg-[var(--surface-2)]"
              } ${o.value === value ? "font-bold" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.sublabel && <span className="shrink-0 text-xs text-[var(--muted)]">{o.sublabel}</span>}
            </button>
          ))}
          {!q && options.length > CAP && (
            <div className="border-t border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-2)]">
              Showing first {CAP} of {options.length} — type to search
            </div>
          )}
        </div>
      )}
    </div>
  );
}
