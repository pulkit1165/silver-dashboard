import PageHeader from "@/components/PageHeader";
import { listUsers, getCurrentUser } from "@/lib/erp/session";
import { leafNavItems, canSee, roleLabel, ROLES, canWrite } from "@/lib/erp/rbac";
import UsersManager from "@/components/erp/UsersManager";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await getCurrentUser();
  const isAdmin = canWrite(me.role, "users");
  const users = await listUsers();
  const modules = leafNavItems();

  return (
    <>
      <PageHeader title="Users & Roles" subtitle="Create accounts with a username + password, assign roles, and see module-level access." />

      {isAdmin ? (
        <UsersManager meId={me.id} />
      ) : (
        <section className="panel mb-5">
          <div className="panel-hd">Users</div>
          <table className="rtable">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="font-semibold">{u.name}</td>
                  <td className="font-mono text-xs">{u.email}</td>
                  <td><span className="tag n">{roleLabel(u.role)}</span></td>
                  <td>{u.id === me.id && <span className="tag g">you</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel">
        <div className="panel-hd">Role → module access matrix</div>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr><th>Module</th>{ROLES.map((r) => <th key={r} className="!text-center">{r.slice(0, 4)}</th>)}</tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.href}>
                  <td className="font-semibold">{m.label}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="text-center">{canSee(r, m) ? <span className="text-[var(--accent-2)]">●</span> : <span className="text-[var(--border)]">·</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
