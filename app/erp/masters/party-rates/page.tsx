import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import EditableRate from "@/components/erp/EditableRate";
import { getCustomers } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export default async function PartyRateMasterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const rows = await getCustomers(sp.q);
  const editable = canWrite(user.role, "rates");
  return (
    <>
      <PageHeader
        title="Party-wise Net Rate"
        subtitle="Each customer's standing discount % off MRP, by GST slab — applied automatically when a Sales Order is created (an item's own GST rate picks Disc 18 vs Disc 28)."
      />
      <ListFilters fields={[{ key: "q", label: "Search", placeholder: "Name, code, or GST…" }]} />
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr><th>Code</th><th>Customer</th><th>GST</th><th className="!text-right">Credit limit</th><th className="!text-right">Disc 18%</th><th className="!text-right">Disc 28%</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="!py-6 text-center text-[var(--muted)]">No customers found.</td></tr>
              )}
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs">{c.code}</td>
                  <td className="font-semibold">{c.name}</td>
                  <td className="font-mono text-xs">{c.gst}</td>
                  <td className="num-cell">{(c.credit_limit ?? 0).toLocaleString("en-IN")}</td>
                  <td className="num-cell">
                    {editable ? (
                      <EditableRate
                        value={c.discount_pct_18 ?? 0}
                        endpoint={`/api/erp/customers/${c.id}`}
                        field="discount_pct_18"
                        suffix="%"
                      />
                    ) : (
                      <span className="font-semibold">{(c.discount_pct_18 ?? 0).toFixed(2)}%</span>
                    )}
                  </td>
                  <td className="num-cell">
                    {editable ? (
                      <EditableRate
                        value={c.discount_pct_28 ?? 0}
                        endpoint={`/api/erp/customers/${c.id}`}
                        field="discount_pct_28"
                        suffix="%"
                      />
                    ) : (
                      <span className="font-semibold">{(c.discount_pct_28 ?? 0).toFixed(2)}%</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && <p className="border-t border-[var(--border)] p-3 text-xs text-[var(--muted)]">Click a discount % to edit it.</p>}
      </section>
    </>
  );
}
