"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { NAV, canSee, roleLabel, type Role } from "@/lib/erp/rbac";

type U = { id: number; name: string; role: Role };

export default function Sidebar({ user, users }: { user: U; users: U[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 md:hidden">
        <button onClick={() => setOpen(true)} aria-label="Menu" className="text-2xl leading-none">☰</button>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-extrabold text-white">S</span>
        <span className="font-extrabold tracking-tight">Silver ERP</span>
      </header>

      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}

      <NavBody
        user={user}
        users={users}
        onNavigate={() => setOpen(false)}
        className={`fixed z-40 h-full w-72 transform transition-transform md:static md:z-auto md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      />
    </>
  );
}

function NavBody({
  user, users, onNavigate, className = "",
}: {
  user: U; users: U[]; onNavigate?: () => void; className?: string;
}) {
  const path = usePathname();
  const router = useRouter();

  const isActive = (href: string) => {
    if (href === "/" || href === "/erp") return path === href;
    return path === href || path.startsWith(href + "/");
  };

  async function switchUser(id: number) {
    await fetch("/api/erp/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: id }),
    });
    router.refresh();
  }

  return (
    <aside className={`flex w-72 shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] px-4 py-5 ${className}`}>
      <div className="mb-6 flex items-center gap-3 px-1">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)] text-lg font-extrabold text-white shadow-sm">S</span>
        <div className="leading-tight">
          <div className="text-[15px] font-extrabold tracking-tight">Silver Industries</div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">ERP · Bike Parts</div>
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

      {/* user / role switcher */}
      <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
        <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-[var(--muted-2)]">Signed in</div>
        <div className="text-sm font-bold">{user.name}</div>
        <div className="mb-2 text-xs text-[var(--muted)]">{roleLabel(user.role)}</div>
        <select
          value={user.id}
          onChange={(e) => switchUser(Number(e.target.value))}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs font-semibold outline-none"
          title="Switch user / role (demo)"
        >
          {users.map((u) => <option key={u.id} value={u.id}>{u.name} — {roleLabel(u.role)}</option>)}
        </select>
      </div>
    </aside>
  );
}
