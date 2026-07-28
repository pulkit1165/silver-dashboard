import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import { getWeightMaster } from "@/lib/erp/oracle-masters";
import { getCurrentUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

// Product Weight master — live-ish from Oracle (A_LABELPRINT.NETWEIGHT), read-only.
export default async function WeightMasterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  await getCurrentUser();
  const rows = await getWeightMaster(sp.q);
  const wUnit = "g"; // NETWEIGHT is recorded in grams in the source

  return (
    <>
      <PageHeader
        title="Product Weight"
        subtitle={`Per-item net weight from Oracle (A_LABELPRINT) — ${rows.length} items. Read-only master, used for packing/freight weight.`}
      />
      <ListFilters fields={[{ key: "q", label: "Search", placeholder: "Item code or description…" }]} />
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr>
                <th>Item Code</th><th>Description</th><th>Category</th><th>Vehicle</th>
                <th className="!text-right">Net weight</th><th className="!text-right">Std pack</th>
                <th>Unit</th><th>HSN</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="!py-8 text-center text-[var(--muted)]">No items found{sp.q ? ` for “${sp.q}”` : ""}.</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="font-mono text-sm font-semibold">{r.code}</td>
                  <td>{r.name}</td>
                  <td className="text-[var(--muted)]">{r.category || "—"}</td>
                  <td className="text-[var(--muted)]">{r.vehicle || "—"}</td>
                  <td className="num-cell tabular-nums font-semibold">{r.weight != null ? `${r.weight.toLocaleString("en-IN")} ${wUnit}` : "—"}</td>
                  <td className="num-cell tabular-nums text-[var(--muted)]">{r.stdpack || "—"}</td>
                  <td className="text-[var(--muted)] text-sm">{r.unit || "—"}</td>
                  <td className="font-mono text-xs text-[var(--muted)]">{r.hsn || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && <p className="border-t border-[var(--border)] p-3 text-xs text-[var(--muted)]">{rows.length} items · net weight in grams, as recorded on the Oracle label master.</p>}
      </section>
    </>
  );
}
