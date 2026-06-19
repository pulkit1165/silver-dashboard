"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Logo from "@/components/Logo";
import { NAV, canSee, roleLabel, type Role } from "@/lib/erp/rbac";

type U = { id: number; name: string; role: Role };

export default function Sidebar({ user }: { user: U }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 md:hidden">
        <button onClick={() => setOpen(true)} aria-label="Menu" className="text-2xl leading-none">☰</button>
        <Logo size={28} className="rounded-md" />
        <span className="font-extrabold tracking-tight">Silver Up ERP</span>
      </header>

      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}

      <NavBody
        user={user}
        onNavigate={() => setOpen(false)}
        className={`fixed z-40 h-full w-72 transform transition-transform md:static md:z-auto md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      />
    </>
  );
}

function NavBody({ user, onNavigate, className = "" }: { user: U; onNavigate?: () => void; className?: string }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" || href === "/erp" ? path === href : path === href || path.startsWith(href + "/"));

  async function logout() {
    await fetch("/api/erp/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <aside className={`flex w-72 shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] px-4 py-5 ${className}`}>
      <div className="mb-6 flex items-center gap-3 px-1">
        <Logo size={42} className="rounded-xl shadow-sm" />
        <div className="leading-tight">
          <div className="text-[15px] font-extrabold tracking-tight">Silver Up</div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">Auto Parts · ERP</div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-4">
        {NAV.map((group) => {
          const items = group.items.filter((it) => canSee(user.role, it));
          if (items.length === 0) return null;
          return (
            <div key={group.group}>
              <div className="mb-1 px-2 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--muted-2)]">{group.group}</div>
              <div className="flex flex-col gap-0.5">
                {items.map((it) => {
                  const active = isActive(it.href);
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      onClick={onNavigate}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                        active
                          ? "bg-[var(--accent-bg)] text-[var(--accent-strong)]"
                          : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      <span className="w-4 text-center text-base opacity-90">{it.icon}</span>
                      {it.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
        <div className="text-sm font-bold">{user.name}</div>
        <div className="mb-2 text-xs text-[var(--muted)]">{roleLabel(user.role)}</div>
        <button
          onClick={logout}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-bold text-[var(--accent-strong)] hover:bg-[var(--accent-bg)]"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
