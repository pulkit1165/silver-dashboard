import PageHeader from "@/components/PageHeader";
import VendorCatalogTools from "@/components/erp/VendorCatalogTools";
import { getGroupVendorMatrix, getVendorGroupMatrix, getPricedGroups } from "@/lib/erp/vendorCatalog";
import { getVendors } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const ALLOWED = new Set(["admin", "purchase", "accounts"]);

export default async function VendorComparePage() {
  const user = await getCurrentUser();
  if (!ALLOWED.has(user.role)) return <><PageHeader title="Vendor Comparison" /><p className="text-sm text-[var(--muted)]">No access.</p></>;

  const [vendors, groups, gvm, vgm] = await Promise.all([
    getVendors(), getPricedGroups(), getGroupVendorMatrix(), getVendorGroupMatrix(),
  ]);

  // group → vendors, sorted by group
  const byGroup = new Map<string, typeof gvm>();
  for (const r of gvm) { (byGroup.get(r.header) ?? byGroup.set(r.header, []).get(r.header)!).push(r); }
  // vendor → groups
  const byVendor = new Map<string, typeof vgm>();
  for (const r of vgm) { (byVendor.get(r.vendor_name) ?? byVendor.set(r.vendor_name, []).get(r.vendor_name)!).push(r); }

  return (
    <>
      <PageHeader
        title="Vendor Comparison & Sourcing"
        subtitle="Upload each vendor's price list, then compare by product group both ways — who covers what, at what CP — and project the cheapest PO (single vendor vs mixed)."
      />
      <VendorCatalogTools vendors={vendors.map((v) => ({ id: v.id, name: v.name }))} groups={groups} />

      {/* GROUP → VENDOR */}
      <section className="panel mt-6">
        <h3 className="mb-2 px-1 text-sm font-extrabold">By product group → vendors</h3>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>Group</th><th>Vendor</th><th className="!text-right">Items covered</th><th className="!text-right">Range</th><th className="!text-right">CP min</th><th className="!text-right">CP avg</th><th className="!text-right">Lead (d)</th><th className="!text-right">Credit (d)</th></tr></thead>
            <tbody>
              {[...byGroup.entries()].map(([header, rows]) => rows.map((r, i) => (
                <tr key={`${header}-${r.vendor_id}`}>
                  {i === 0 ? <td rowSpan={rows.length} className="align-top font-bold">{header}<div className="text-xs font-normal text-[var(--muted)]">{r.group_items} items</div></td> : null}
                  <td>{r.vendor_name}</td>
                  <td className="num-cell">{r.items_covered} / {r.group_items}</td>
                  <td className="num-cell">{Math.round((r.items_covered / Math.max(1, r.group_items)) * 100)}%</td>
                  <td className="num-cell">{inr(r.cp_min)}</td>
                  <td className="num-cell">{inr(r.cp_avg)}</td>
                  <td className="num-cell">{r.lead_days ?? "—"}</td>
                  <td className="num-cell">{r.credit_days ?? "—"}</td>
                </tr>
              )))}
              {gvm.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-[var(--muted)]">Upload a vendor price list above to start comparing.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* VENDOR → GROUP */}
      <section className="panel mt-6">
        <h3 className="mb-2 px-1 text-sm font-extrabold">By vendor → product groups</h3>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>Vendor</th><th>Group</th><th className="!text-right">Items covered</th><th className="!text-right">Range</th><th className="!text-right">CP avg</th></tr></thead>
            <tbody>
              {[...byVendor.entries()].map(([name, rows]) => rows.map((r, i) => (
                <tr key={`${name}-${r.header}`}>
                  {i === 0 ? <td rowSpan={rows.length} className="align-top font-bold">{name}</td> : null}
                  <td>{r.header}</td>
                  <td className="num-cell">{r.items_covered} / {r.group_items}</td>
                  <td className="num-cell">{Math.round((r.items_covered / Math.max(1, r.group_items)) * 100)}%</td>
                  <td className="num-cell">{inr(r.cp_avg)}</td>
                </tr>
              )))}
              {vgm.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-[var(--muted)]">No vendor catalogs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
