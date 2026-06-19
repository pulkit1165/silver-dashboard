import PageHeader from "@/components/PageHeader";
import ImportSkus from "@/components/erp/ImportSkus";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!canWrite(user.role, "skus")) {
    return (
      <>
        <PageHeader title="Import SKUs" />
        <p className="text-sm text-[var(--muted)]">Your role ({user.role}) can&apos;t import SKUs. Ask an admin.</p>
        <Link href="/erp/skus" className="text-sm font-semibold text-[var(--accent)]">← SKU Master</Link>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Import SKUs" subtitle="Upload your price list (Excel/CSV) — every SKU is saved and gets a unique secure QR code automatically." />
      <ImportSkus />
    </>
  );
}
