import PageHeader from "@/components/PageHeader";
import { getCustomers } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const rows = await getCustomers();
  return (
    <>
      <PageHeader title="Customers" subtitle="Customer master with GST, credit limit and payment terms." />
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>Code</th><th>Name</th><th>GST</th><th>Contact</th><th>Billing</th><th className="!text-right">Credit limit</th><th>Terms</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs">{c.code}</td>
                  <td className="font-semibold">{c.name}</td>
                  <td className="font-mono text-xs">{c.gst}</td>
                  <td className="text-xs">{c.email}<br />{c.phone}</td>
                  <td className="text-xs text-[var(--muted)]">{c.billing}</td>
                  <td className="num-cell">{c.credit_limit.toLocaleString("en-IN")}</td>
                  <td>{c.payment_terms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
