import PageHeader from "@/components/PageHeader";
import ImportLabelInfo from "@/components/erp/ImportLabelInfo";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ImportLabelInfoPage() {
  const user = await getCurrentUser();
  if (!canWrite(user.role, "skus")) {
    return (
      <>
        <PageHeader title="Backfill Barcode / Master Qty" />
        <p className="text-sm text-[var(--muted)]">Your role ({user.role}) can&apos;t edit SKUs. Ask an admin.</p>
        <Link href="/erp/skus" className="text-sm font-semibold text-[var(--accent)]">← SKU Master</Link>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Backfill Barcode / Master Qty" subtitle="Update existing SKUs with their legacy barcode code and/or master carton qty — matched by SKU code." />
      <ImportLabelInfo />
    </>
  );
}
