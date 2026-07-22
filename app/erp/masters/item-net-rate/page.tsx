import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import NetRateMaster from "@/components/erp/NetRateMaster";
import { getSkusWithNetRate } from "@/lib/erp/pricing-masters";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
const PAGE_CAP = 400;

export default async function ItemNetRatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const rows = await getSkusWithNetRate(sp.q, PAGE_CAP);
  const editable = canWrite(user.role, "rates");
  return (
    <>
      <PageHeader
        title="Item Net Rate Master"
        subtitle="Global per-SKU net rate. When set, it OVERRIDES the party discount % for that SKU on new sales orders (the sales screen shows Net-rate = Y). Versioned like MRP — the most recent value is live, every prior value is kept with a previous-value column."
      />
      <ListFilters fields={[{ key: "q", label: "Search", placeholder: "Name, code, or category…" }]} />
      {!sp.q && rows.length >= PAGE_CAP && (
        <p className="mb-3 text-xs font-semibold text-[var(--muted)]">Showing first {PAGE_CAP} items — use Search to narrow down (bulk upload updates any SKU by code regardless of this list).</p>
      )}
      <NetRateMaster rows={rows} editable={editable} />
    </>
  );
}
