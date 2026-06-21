"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Logo from "@/components/Logo";
import {
  NAV, canSee, isFolder, visibleChildren, roleLabel,
  type Role, type NavItem, type NavFolder, type NavEntry,
} from "@/lib/erp/rbac";

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
  const [mounted, setMounted] = useState(false);
  // which folder's submenu is open, and where to anchor the desktop flyout
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setMounted(true), []);
  // close the submenu whenever the route changes
  useEffect(() => { setOpenKey(null); }, [path]);
  // close on outside click / Esc / resize
  useEffect(() => {
    if (!openKey) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-nav-folder]") && !t.closest("[data-nav-flyout]")) setOpenKey(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenKey(null); };
    const onResize = () => setOpenKey(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [openKey]);

  const isActive = (href: string) =>
    href === "/" || href === "/erp" ? path === href : path === href || path.startsWith(href + "/");
  const folderActive = (f: NavFolder) => visibleChildren(user.role, f).some((c) => isActive(c.href));

  function toggleFolder(label: string, e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setCoords({ top: r.top, left: r.right + 10 });
    setOpenKey((k) => (k === label ? null : label));
  }

  async function logout() {
    await fetch("/api/erp/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const leafClass = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
      active
        ? "bg-[var(--accent-bg)] text-[var(--accent-strong)]"
        : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
    }`;

  const renderLeaf = (it: NavItem) => (
    <Link key={it.href} href={it.href} onClick={() => { setOpenKey(null); onNavigate?.(); }} className={leafClass(isActive(it.href))}>
      <span className="w-4 text-center text-base opacity-90">{it.icon}</span>
      {it.label}
    </Link>
  );

  const openFolder: NavFolder | null = openKey
    ? (NAV.flatMap((g) => g.items).find((e): e is NavFolder => isFolder(e) && e.label === openKey) ?? null)
    : null;

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
          // keep only entries with something visible to this role
          const entries = group.items.filter((e: NavEntry) =>
            isFolder(e) ? visibleChildren(user.role, e).length > 0 : canSee(user.role, e),
          );
          if (entries.length === 0) return null;
          return (
            <div key={group.group}>
              <div className="mb-1 px-2 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--muted-2)]">{group.group}</div>
              <div className="flex flex-col gap-0.5">
                {entries.map((e) => {
                  if (!isFolder(e)) return renderLeaf(e);
                  const children = visibleChildren(user.role, e);
                  const active = folderActive(e);
                  const isOpen = openKey === e.label;
                  return (
                    <div key={e.label} data-nav-folder>
                      <button
                        onClick={(ev) => toggleFolder(e.label, ev)}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                          active || isOpen
                            ? "bg-[var(--accent-bg)] text-[var(--accent-strong)]"
                            : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                        }`}
                      >
                        <span className="w-4 text-center text-base opacity-90">{e.icon}</span>
                        <span className="flex-1 text-left">{e.label}</span>
                        <span className={`text-xs transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                      </button>

                      {/* mobile drawer: submenu expands inline (a right-side flyout won't fit) */}
                      {isOpen && (
                        <div className="mt-0.5 ml-3 flex flex-col gap-0.5 border-l border-[var(--border)] pl-3 md:hidden">
                          {children.map(renderLeaf)}
                        </div>
                      )}
                    </div>
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

      {/* desktop: flyout submenu floating to the right of the sidebar */}
      {mounted && openFolder && coords && createPortal(
        <div
          data-nav-flyout
          className="hidden md:block fixed z-50 w-64 max-h-[70vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl"
          style={{ top: coords.top, left: coords.left }}
        >
          <div className="px-2 pb-1 pt-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--muted-2)]">{openFolder.label}</div>
          <div className="flex flex-col gap-0.5">
            {visibleChildren(user.role, openFolder).map(renderLeaf)}
          </div>
        </div>,
        document.body,
      )}
    </aside>
  );
}
