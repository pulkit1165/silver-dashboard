import PageHeader from "@/components/PageHeader";
import { getCurrentUser } from "@/lib/erp/session";
import { listActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

// Color the action chip by module so the feed is scannable at a glance.
function chip(action: string): string {
  const k = action.split(".")[0];
  const map: Record<string, string> = {
    scan: "g", invoice: "n", po: "r", sku: "n", qr: "n", so: "g", user: "r",
  };
  return map[k] ?? "n";
}

export default async function ActivityPage() {
  await getCurrentUser(); // gate to signed-in users
  const rows = await listActivity(200);
  return (
    <>
      <PageHeader
        title="Activity Feed"
        subtitle="Live org-wide log of every action — scans, invoices, purchase orders, SKU & QR changes. Updates automatically across all devices."
      />
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={4} className="!py-8 text-center text-[var(--muted)]">No activity yet. Actions across the ERP will appear here live.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-[var(--muted)] tabular-nums">{r.created_at}</td>
                  <td className="whitespace-nowrap">
                    <span className="font-semibold">{r.actor || "—"}</span>
                    {r.actor_role && <span className="ml-1 text-xs text-[var(--muted-2)]">({r.actor_role})</span>}
                  </td>
                  <td className="whitespace-nowrap"><span className={`tag ${chip(r.action)}`}>{r.action}</span></td>
                  <td>{r.summary || <span className="text-[var(--muted)]">{r.entity}{r.entity_id ? ` #${r.entity_id}` : ""}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
