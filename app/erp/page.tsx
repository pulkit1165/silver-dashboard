import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { getCurrentUser } from "@/lib/erp/session";
import { erpStats, getScans, getNotifications } from "@/lib/erp/queries";
import { roleLabel } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export default async function ErpDashboard() {
  const user = await getCurrentUser();
  const [s, scans, notes] = await Promise.all([
    erpStats(),
    getScans({ limit: 8 }),
    getNotifications(user.role),
  ]);

  const kpis = [
    { label: "SKUs", value: s.skus, sub: `${s.stockUnits} units in stock` },
    { label: "Low / out of stock", value: s.lowStock, sub: "needs reorder", alert: s.lowStock > 0 },
    { label: "Open sales orders", value: s.openSales, sub: `${s.pendingDispatch} to dispatch` },
    { label: "Open purchase orders", value: s.openPurchases, sub: `${s.vendors} vendors` },
    { label: "Pending DO verification", value: s.pendingVerifyDo, sub: "not yet billable", alert: s.pendingVerifyDo > 0, href: "/erp/deliveries" },
    { label: "Scans today", value: s.scansToday, sub: `${s.scansTotal} all time` },
  ];

  return (
    <>
      <PageHeader
        title="ERP Dashboard"
        subtitle={`Welcome, ${user.name} · ${roleLabel(user.role)} — operations at a glance.`}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => {
          const body = (
            <>
              <div className="lab">{k.label}</div>
              <div className="num" style={k.alert ? { color: "var(--danger)" } : undefined}>{k.value}</div>
              <div className="sub">{k.sub}</div>
            </>
          );
          return k.href ? (
            <Link key={k.label} href={k.href} className={`kpi hover:opacity-80 ${k.alert ? "alert" : ""}`}>{body}</Link>
          ) : (
            <div key={k.label} className={`kpi ${k.alert ? "alert" : ""}`}>{body}</div>
          );
        })}
      </div>

      {/* quick actions */}
      <div className="mb-5 flex flex-wrap gap-2">
        {[
          ["/erp/scan", "▣ Open QR Scanner"],
          ["/erp/scan/dispatch", "🚚 Dispatch Scan"],
          ["/erp/qr", "❒ Print QR Labels"],
          ["/erp/skus", "▦ SKU Master"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-bold hover:bg-[var(--accent-bg)] hover:text-[var(--accent-strong)]">
            {label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* alerts / low stock */}
        <section className="panel lg:col-span-1">
          <div className="panel-hd">Stock Alerts</div>
          <div className="p-2">
            {s.lowStockItems.length === 0 && <p className="p-4 text-sm text-[var(--muted)]">All items above minimum. ✓</p>}
            {s.lowStockItems.map((i) => (
              <Link key={i.id} href={`/erp/skus/${i.id}`} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-[var(--surface-2)]">
                <span><span className="font-semibold">{i.name}</span><br /><span className="font-mono text-xs text-[var(--muted)]">{i.sku_code}</span></span>
                <span className={`tag ${i.status === "out" ? "r" : "r"}`}>{i.qty} left</span>
              </Link>
            ))}
          </div>
        </section>

        {/* recent scans */}
        <section className="panel lg:col-span-2">
          <div className="panel-hd">Recent Scans</div>
          <div className="overflow-x-auto">
            <table className="rtable">
              <thead><tr><th>When</th><th>User</th><th>Action</th><th>SKU</th><th>Doc</th><th>Status</th></tr></thead>
              <tbody>
                {scans.length === 0 && <tr><td colSpan={6} className="!py-6 text-center text-[var(--muted)]">No scans yet — try the QR Scanner.</td></tr>}
                {scans.map((sc) => (
                  <tr key={sc.id}>
                    <td className="whitespace-nowrap text-xs text-[var(--muted)]">{sc.created_at}</td>
                    <td className="font-semibold">{sc.user_name}</td>
                    <td><span className="tag n">{sc.action}</span></td>
                    <td className="font-mono text-xs">{sc.sku_code ?? "—"}</td>
                    <td>{sc.ref_doc ?? "—"}</td>
                    <td>{sc.status === "success" ? <span className="tag g">ok</span> : <span className="tag r">fail</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[var(--border)] p-3 text-right">
            <Link href="/erp/scan/history" className="text-sm font-bold text-[var(--accent)]">View full audit log →</Link>
          </div>
        </section>
      </div>

      {notes.length > 0 && (
        <section className="panel mt-5">
          <div className="panel-hd">Notifications</div>
          <div className="p-2">
            {notes.map((n) => (
              <div key={n.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm">
                <span className="tag n">{n.type}</span>
                <span className="flex-1">{n.message}</span>
                <span className="text-xs text-[var(--muted)]">{n.created_at}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
