import PageHeader from "@/components/PageHeader";
import { listUsers, getCurrentUser } from "@/lib/erp/session";
import { leafNavItems, canSee, roleLabel, canWrite } from "@/lib/erp/rbac";
import UsersManager from "@/components/erp/UsersManager";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await getCurrentUser();
  const isAdmin = canWrite(me, "users");
  const users = await listUsers();
  const modules = leafNavItems();

  return (
    <>
      <PageHeader title="Users & Roles" subtitle="Create accounts with a username + password, and give each person access to exactly the modules they need." />

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

      {isAdmin && (
        <section className="panel">
          <div className="panel-hd">User → module access matrix</div>
          <div className="overflow-x-auto">
            <table className="rtable">
              <thead>
                <tr><th>Page</th>{users.map((u) => <th key={u.id} className="!text-center" title={u.name}>{u.name.split(" ")[0]}</th>)}</tr>
              </thead>
              <tbody>
                {modules.map((m) => (
                  <tr key={m.href}>
                    <td className="font-semibold">{m.label}</td>
                    {users.map((u) => (
                      <td key={u.id} className="text-center">{canSee(u, m) ? <span className="text-[var(--accent-2)]">●</span> : <span className="text-[var(--border)]">·</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-[var(--border)] p-3 text-xs text-[var(--muted)]">
            Reflects each person's actual saved access — their custom module checkboxes if set, otherwise their role's usual defaults.
          </p>
        </section>
      )}
    </>
  );
}
