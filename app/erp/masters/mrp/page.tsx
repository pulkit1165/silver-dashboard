import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import MrpMaster from "@/components/erp/MrpMaster";
import { getSkusWithMrp } from "@/lib/erp/mrp";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
const PAGE_CAP = 400;

export default async function MrpMasterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const rows = await getSkusWithMrp(sp.q, PAGE_CAP);
  const editable = canWrite(user.role, "rates");
  return (
    <>
      <PageHeader
        title="MRP Master"
        subtitle="SKU-wise MRP with recency — the most recently set MRP is applied everywhere it's used: barcode/QR labels, new sales orders, invoices and stock value. Existing orders/invoices keep the MRP they were booked at, so history isn't rewritten."
      />
      <ListFilters fields={[{ key: "q", label: "Search", placeholder: "Name, code, or category…" }]} />
      {!sp.q && rows.length >= PAGE_CAP && (
        <p className="mb-3 text-xs font-semibold text-[var(--muted)]">Showing first {PAGE_CAP} items — use Search to narrow down (bulk upload updates any SKU by code regardless of this list).</p>
      )}
      <MrpMaster rows={rows} editable={editable} />
    </>
  );
}
