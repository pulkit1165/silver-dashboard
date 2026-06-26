import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import { getSalesOrders } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
const TAG: Record<string, string> = {
  draft: "n", confirmed: "n", picked: "n", packed: "n",
  "partially dispatched": "r", dispatched: "g", delivered: "g", cancelled: "r",
};

export default async function SalesOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const orders = await getSalesOrders({ party: sp.party, from: sp.from, to: sp.to, status: sp.status });
  return (
    <>
      <PageHeader
        title="Sales Orders"
        subtitle="Order lifecycle: draft → confirmed → picked → packed → dispatched."
        right={
          canWrite(user.role, "sales") ? (
            <Link
              href="/erp/sales/new"
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)]"
            >
              + New Sales Order
            </Link>
          ) : undefined
        }
      />
      <ListFilters
        fields={[
          { key: "party", label: "Customer", placeholder: "Search customer…" },
          { key: "status", label: "Status", placeholder: "e.g. draft, confirmed" },
          { key: "from", label: "From date", type: "date" },
          { key: "to", label: "To date", type: "date" },
        ]}
      />
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Invoice</th><th>Status</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/erp/sales/${o.id}`} className="font-semibold text-[var(--accent)] hover:underline">{o.so_no}</Link></td>
                  <td>{o.customer_name}</td>
                  <td className="text-[var(--muted)]">{o.order_date}</td>
                  <td>{o.invoice_no ?? "—"}</td>
                  <td><span className={`tag ${TAG[o.status] ?? "n"}`}>{o.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
