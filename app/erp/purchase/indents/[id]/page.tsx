import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import PurchaseCycle from "@/components/erp/PurchaseCycle";
import { getIndent, getQuotation } from "@/lib/erp/purchaseQuotations";
import { ensureVendorItems } from "@/lib/erp/vendorCatalog";
import { getSql } from "@/lib/erp/db";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
const ALLOWED = new Set(["admin", "purchase", "accounts"]);

// One screen for the whole indent -> quotation -> approval -> PO lifecycle —
// see components/erp/PurchaseCycle.tsx for the section-by-section UI.
export default async function IndentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!ALLOWED.has(user.role)) return (<><PageHeader title="Indent" /><p className="text-sm text-[var(--muted)]">No access.</p></>);
  const data = await getIndent(Number(id));
  if (!data) notFound();

  const quotation = data.ind.quotation_id ? await getQuotation(data.ind.quotation_id) : null;
  // vendors.credit_days/lead_days are added defensively by vendorCatalog.ts —
  // ensure that's run before relying on them (a fresh DB may not have them yet).
  await ensureVendorItems();
  const vrows = (await getSql()`SELECT id, COALESCE(name, '#'||id) AS name, credit_days, lead_days FROM vendors ORDER BY name`) as unknown as { id: number; name: string; credit_days: number | null; lead_days: number | null }[];
  const vendors = vrows.map((v) => ({ id: v.id, name: v.name, creditDays: v.credit_days ?? null, leadDays: v.lead_days ?? null }));

  return (
    <>
      <PageHeader
        title={`Indent ${data.ind.indent_no}`}
        subtitle={`${quotation ? `${quotation.quo.quo_no} · ` : ""}status: ${data.ind.status}`}
        right={<Link href="/erp/purchase/indents" className="text-sm font-semibold text-[var(--accent)]">← All indents</Link>}
      />
      <PurchaseCycle
        indent={data.ind}
        indentLines={data.lines}
        quotation={quotation}
        vendors={vendors}
        canEdit={canWrite(user, "purchase")}
        isAdmin={user.role === "admin"}
      />
    </>
  );
}
