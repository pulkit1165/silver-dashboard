import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import EditableRate from "@/components/erp/EditableRate";
import { getSkus } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
const PAGE_CAP = 300;

export default async function ItemRateMasterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const all = await getSkus(sp.q);
  const rows = all.slice(0, PAGE_CAP);
  const editable = canWrite(user.role, "rates");
  return (
    <>
      <PageHeader
        title="Item-wise Net Rate"
        subtitle="Each item's standard selling rate (net rate) — independent of MRP. This is what a Sales Order line defaults to before any party discount is applied."
      />
      <ListFilters fields={[{ key: "q", label: "Search", placeholder: "Name, code, or category…" }]} />
      {!sp.q && all.length > PAGE_CAP && (
        <p className="mb-3 text-xs font-semibold text-[var(--muted)]">
          Showing first {PAGE_CAP} of {all.length} items — use Search to narrow down.
        </p>
      )}
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr><th>Code</th><th>Item</th><th>Category</th><th className="!text-right">MRP</th><th className="!text-right">Net Rate</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} className="!py-6 text-center text-[var(--muted)]">No items found.</td></tr>
              )}
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="font-mono text-xs">{s.sku_code}</td>
                  <td className="font-semibold">{s.name}</td>
                  <td>{s.category}</td>
                  <td className="num-cell">{(s.price ?? 0).toFixed(2)}</td>
                  <td className="num-cell">
                    {editable ? (
                      <EditableRate
                        value={s.selling_price ?? s.price ?? 0}
                        endpoint={`/api/erp/skus/${s.id}/rate`}
                        field="selling_price"
                      />
                    ) : (
                      <span className="font-semibold">{(s.selling_price ?? s.price ?? 0).toFixed(2)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && <p className="border-t border-[var(--border)] p-3 text-xs text-[var(--muted)]">Click a net rate to edit it.</p>}
      </section>
    </>
  );
}
