import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AddSku from "@/components/erp/AddSku";
import MrpMaster from "@/components/erp/MrpMaster";
import MrpSearch from "@/components/erp/MrpSearch";
import SyncMrpButton from "@/components/erp/SyncMrpButton";
import UploadMasterLink from "@/components/erp/UploadMasterLink";
import { getSkusWithMrp } from "@/lib/erp/mrp";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
// Comfortably above the current catalogue size so "no search" shows everything,
// not just a truncated head of it (was 1000 — silently hid real items).
const PAGE_CAP = 8000;

// Item Master — the single item file. Combines the SKU list with MRP editing +
// history (from the old MRP Master), plus per-item category change and an
// active/inactive toggle (inactive items don't print or show in pick lists).
export default async function ItemMasterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const canEditItems = canWrite(user, "skus");
  const canEditRates = canWrite(user, "rates");
  const editable = canEditItems || canEditRates;
  const rows = await getSkusWithMrp(sp.q, PAGE_CAP);
  return (
    <>
      <PageHeader
        title="Item Master"
        subtitle="Every item in one place — set the MRP (with full history), change the category, and mark items active/inactive. Inactive items won't print or appear in pick lists. The latest MRP flows to labels, sales orders, invoices and stock value."
        right={canEditRates ? <SyncMrpButton /> : undefined}
      />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/erp/labels" className="text-sm font-semibold text-[var(--accent)]">Print barcode labels →</Link>
        {canEditItems && <UploadMasterLink master="skus" />}
      </div>
      <AddSku canCreate={canEditItems} />
      <div className="mb-4 mt-4 flex flex-wrap items-center gap-3">
        <MrpSearch initial={sp.q ?? ""} basePath="/erp/skus" />
        {sp.q && (
          <span className="text-xs font-semibold text-[var(--muted)]">
            Filtered to “{sp.q}” · <Link href="/erp/skus" className="text-[var(--accent)]">clear</Link>
          </span>
        )}
      </div>
      {!sp.q && rows.length >= PAGE_CAP && (
        <p className="mb-3 text-xs font-semibold text-[var(--muted)]">Showing {PAGE_CAP} items. Use the search above to find any item across the whole catalogue.</p>
      )}
      <MrpMaster rows={rows} editable={editable} basePath="/erp/skus" />
    </>
  );
}
