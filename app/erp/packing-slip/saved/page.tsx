import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import SavedSlips from "@/components/erp/SavedSlips";
import { listPackingSlips } from "@/lib/erp/packing-slips";
import { getCurrentUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

export default async function SavedSlipsPage() {
  await getCurrentUser(); // gate to signed-in users
  const slips = await listPackingSlips();
  return (
    <>
      <PageHeader
        title="Saved Packing Slips"
        subtitle="Every packing slip, filed by customer and date. Filter to find one, then open it to view, print or export."
        right={
          <Link href="/erp/packing-slip" className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white hover:bg-[var(--accent-strong)]">
            + New packing slip
          </Link>
        }
      />
      <SavedSlips initial={slips} />
    </>
  );
}
