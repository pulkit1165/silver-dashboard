import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import QuotationEditor from "@/components/erp/QuotationEditor";
import { getQuotation } from "@/lib/erp/purchaseQuotations";
import { getSql } from "@/lib/erp/db";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
const ALLOWED = new Set(["admin", "purchase", "accounts"]);

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!ALLOWED.has(user.role)) return (<><PageHeader title="Quotation" /><p className="text-sm text-[var(--muted)]">No access.</p></>);
  const data = await getQuotation(Number(id));
  if (!data) notFound();
  const vrows = (await getSql()`SELECT id, COALESCE(name, '#'||id) AS name, credit_days, lead_days FROM vendors ORDER BY name`) as unknown as { id: number; name: string; credit_days: number | null; lead_days: number | null }[];
  const vendors = vrows.map((v) => ({ id: v.id, name: v.name, creditDays: v.credit_days ?? null, leadDays: v.lead_days ?? null }));

  return (
    <>
      <PageHeader
        title={`Quotation ${data.quo.quo_no}`}
        subtitle={`${data.quo.department || "—"}${data.quo.title ? " · " + data.quo.title : ""} · status: ${data.quo.status}`}
        right={<Link href="/erp/purchase/quotations" className="text-sm font-semibold text-[var(--accent)]">← All quotations</Link>}
      />
      <QuotationEditor
        quo={data.quo} lines={data.lines} vendors={vendors}
        canEdit={canWrite(user.role, "purchase") && data.quo.status === "draft"}
        isAdmin={user.role === "admin"}
      />
    </>
  );
}
