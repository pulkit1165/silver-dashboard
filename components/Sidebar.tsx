"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/inventory", label: "Inventory", icon: "▦" },
  { href: "/sales", label: "Sales", icon: "↗" },
  { href: "/explorer", label: "Data Explorer", icon: "⌕" },
  { href: "/connection", label: "Connection", icon: "⚙" },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] px-4 py-6 md:flex">
      <div className="mb-8 flex items-center gap-3 px-1">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)] text-lg font-extrabold text-white shadow-sm">
          S
        </span>
        <div className="leading-tight">
          <div className="text-[15px] font-extrabold tracking-tight">Silver Industries</div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            Bike Parts
          </div>
        </div>
      </div>

      <div className="mb-2 px-2 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--muted-2)]">
        Reports
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                active
                  ? "bg-[var(--accent-bg)] text-[var(--accent-strong)]"
                  : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              }`}
            >
              <span className="w-4 text-center text-base opacity-90">{n.icon}</span>
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-bold text-[var(--accent-2)]">
          <span className="h-2 w-2 rounded-full bg-[var(--accent-2)]" /> Read-only
        </div>
        <div className="mt-1 text-[11px] leading-snug text-[var(--muted)]">
          Connected for reporting only — the database is never modified.
        </div>
      </div>
    </aside>
  );
}
