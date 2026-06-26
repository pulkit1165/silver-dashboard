import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AddSku from "@/components/erp/AddSku";
import ListFilters from "@/components/erp/ListFilters";
import { stockLevels } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

const TAG: Record<string, string> = { out: "r", low: "r", reorder: "n", ok: "g" };
const PAGE_CAP = 300;

export default async function SkuMasterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const all = await stockLevels(sp.q);
  const rows = all.slice(0, PAGE_CAP);
  return (
    <>
      <PageHeader title="SKU Master" subtitle="Item master — every SKU has a unique QR token for scanning and labels." />
      <AddSku canCreate={canWrite(user.role, "skus")} />
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
              <tr>
                <th>SKU</th><th>Category</th><th>Brand</th>
                <th className="!text-right">Price</th><th className="!text-right">On hand</th>
                <th>Status</th><th>QR token</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/erp/skus/${s.id}`} className="font-semibold text-[var(--accent)] hover:underline">{s.name}</Link>
                    <div className="font-mono text-xs text-[var(--muted)]">{s.sku_code}</div>
                  </td>
                  <td>{s.category}</td>
                  <td>{s.brand}</td>
                  <td className="num-cell">{s.price.toFixed(2)}</td>
                  <td className="num-cell">{s.qty}</td>
                  <td><span className={`tag ${TAG[s.status]}`}>{s.status}</span></td>
                  <td className="font-mono text-xs text-[var(--muted)]">{s.qr_token}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
