"use client";

import { useEffect, useState } from "react";
import { ROLES, roleLabel, type Role } from "@/lib/erp/rbac";

type U = { id: number; name: string; username: string | null; email: string | null; role: Role; active: boolean; hasPassword: boolean };

export default function UsersManager({ meId }: { meId: number }) {
  const [users, setUsers] = useState<U[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // create form
  const [nu, setNu] = useState({ name: "", username: "", password: "", role: "viewer" as string, email: "" });
  // edit modal (username/email coerced to strings for the inputs)
  const [edit, setEdit] = useState<(Omit<U, "username" | "email"> & { username: string; email: string; password: string }) | null>(null);

  const flash = (ok: boolean, text: string) => { setMsg({ ok, text }); setTimeout(() => setMsg(null), 3500); };

  async function load() {
    try {
      const r = await fetch("/api/erp/users", { cache: "no-store" });
      const d = await r.json();
      if (d.ok) setUsers(d.users);
      else flash(false, d.error || "Could not load users.");
    } catch { flash(false, "Could not load users."); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true);
    try {
      const r = await fetch("/api/erp/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(nu) });
      const d = await r.json();
      if (!r.ok || !d.ok) { flash(false, d.error || "Could not create user."); return; }
      flash(true, `Created ${nu.username}.`);
      setNu({ name: "", username: "", password: "", role: "viewer", email: "" });
      load();
    } catch { flash(false, "Network error."); } finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: edit.name, username: edit.username, role: edit.role, email: edit.email, active: edit.active };
      if (edit.password) body.password = edit.password;
      const r = await fetch(`/api/erp/users/${edit.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok || !d.ok) { flash(false, d.error || "Could not save."); return; }
      flash(true, `Saved ${edit.username}.`);
      setEdit(null); load();
    } catch { flash(false, "Network error."); } finally { setBusy(false); }
  }

  const inp = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm outline-none focus:border-[var(--accent)]";

  return (
    <section className="panel mb-5">
      <div className="panel-hd flex items-center justify-between">
        <span>Users</span>
        {msg && <span className={`text-xs font-bold ${msg.ok ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{msg.ok ? "✓ " : "✕ "}{msg.text}</span>}
      </div>

      {/* create */}
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-[var(--border)] p-3">
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-[var(--muted-2)]">Full name
          <input className={inp} value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} placeholder="Raju Kumar" /></label>
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-[var(--muted-2)]">Username
          <input className={inp} value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} placeholder="raju" autoComplete="off" /></label>
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-[var(--muted-2)]">Password
          <input className={inp} type="text" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} placeholder="min 6 chars" autoComplete="off" /></label>
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-[var(--muted-2)]">Role
          <select className={inp} value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
            {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select></label>
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-[var(--muted-2)]">Email (optional)
          <input className={inp} value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} placeholder="raju@silver.local" autoComplete="off" /></label>
        <button onClick={create} disabled={busy} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-60">+ Create user</button>
      </div>

      <table className="rtable">
        <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="font-semibold">{u.name}{u.id === meId && <span className="ml-2 tag g">you</span>}</td>
              <td className="font-mono text-xs">{u.username || <span className="text-[var(--muted)]">—</span>}</td>
              <td className="font-mono text-xs">{u.email || <span className="text-[var(--muted)]">—</span>}</td>
              <td><span className="tag n">{roleLabel(u.role)}</span></td>
              <td>{u.active ? <span className="tag g">Active</span> : <span className="tag">Disabled</span>}{!u.hasPassword && <span className="ml-1 tag" title="No password set — can't log in">no pw</span>}</td>
              <td className="text-right">
                <button onClick={() => setEdit({ ...u, username: u.username ?? "", email: u.email ?? "", password: "" })}
                  className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)]">Edit</button>
              </td>
            </tr>
          ))}
          {users.length === 0 && <tr><td colSpan={6} className="!py-6 text-center text-[var(--muted)]">No users.</td></tr>}
        </tbody>
      </table>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEdit(null)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-extrabold">Edit user · {edit.username || edit.name}</h2>
              <button onClick={() => setEdit(null)} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-sm font-bold hover:bg-[var(--surface-2)]">✕</button>
            </div>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Full name<input className={inp} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
              <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Username<input className={inp} value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} autoComplete="off" /></label>
              <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Email<input className={inp} value={edit.email ?? ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} autoComplete="off" /></label>
              <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Role
                <select className={inp} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })} disabled={edit.id === meId}>
                  {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </select>
                {edit.id === meId && <span className="text-[10px] font-normal text-[var(--muted-2)]">You can't change your own role.</span>}
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Reset password (leave blank to keep)<input className={inp} type="text" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} placeholder="new password (min 6)" autoComplete="off" /></label>
              <label className="flex items-center gap-2 text-sm font-bold text-[var(--muted)]">
                <input type="checkbox" checked={edit.active} disabled={edit.id === meId} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
                Active (can log in){edit.id === meId && <span className="text-[10px] font-normal text-[var(--muted-2)]">— can't disable yourself</span>}
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">Cancel</button>
              <button onClick={saveEdit} disabled={busy} className="rounded-lg bg-[var(--accent-2)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">Save</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
