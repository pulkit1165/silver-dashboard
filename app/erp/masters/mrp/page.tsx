import PageHeader from "@/components/PageHeader";
import MrpMaster from "@/components/erp/MrpMaster";
import MrpSearch from "@/components/erp/MrpSearch";
import SyncMrpButton from "@/components/erp/SyncMrpButton";
import Link from "next/link";
import { getSkusWithMrp } from "@/lib/erp/mrp";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
const PAGE_CAP = 1000;

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
        right={editable ? <SyncMrpButton /> : undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <MrpSearch initial={sp.q ?? ""} />
        {sp.q && (
          <span className="text-xs font-semibold text-[var(--muted)]">
            Filtered to “{sp.q}” · <Link href="/erp/masters/mrp" className="text-[var(--accent)]">clear</Link>
          </span>
        )}
      </div>
      {!sp.q && rows.length >= PAGE_CAP && (
        <p className="mb-3 text-xs font-semibold text-[var(--muted)]">Showing {PAGE_CAP} items (MRP-set first). Use the search above to find any item across the whole catalogue.</p>
      )}
      <MrpMaster rows={rows} editable={editable} />
    </>
  );
}
