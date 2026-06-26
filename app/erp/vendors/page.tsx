import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import { getVendors } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";
const TAG: Record<string, string> = { approved: "g", pending: "n", rejected: "r", blocked: "r" };

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const rows = await getVendors(sp.q);
  return (
    <>
      <PageHeader title="Vendors" subtitle="Vendor master, approval status, terms and performance rating." />
      <ListFilters fields={[{ key: "q", label: "Search", placeholder: "Name, code, or GST…" }]} />
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>Code</th><th>Name</th><th>GST</th><th>Category</th><th>Contact</th><th>Terms</th><th className="!text-right">Rating</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className="font-mono text-xs">{v.code}</td>
                  <td className="font-semibold">{v.name}</td>
                  <td className="font-mono text-xs">{v.gst}</td>
                  <td>{v.category}</td>
                  <td className="text-xs">{v.contact}<br />{v.phone}</td>
                  <td>{v.payment_terms}</td>
                  <td className="num-cell">{"★".repeat(Math.round(v.rating))}<span className="text-[var(--muted)]"> {v.rating.toFixed(1)}</span></td>
                  <td><span className={`tag ${TAG[v.status] ?? "n"}`}>{v.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
