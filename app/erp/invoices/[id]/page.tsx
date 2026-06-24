import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import InvoiceEditor from "@/components/erp/InvoiceEditor";
import { getInvoiceFull } from "@/lib/erp/invoices";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getInvoiceFull(id);
  if (!data) notFound();
  const user = await getSessionUser();
  const editable = !!user && canWrite(user.role, "invoices");

  return (
    <>
      <PageHeader
        title={data.invoice.invoice_no ?? `Draft invoice #${data.invoice.id}`}
        subtitle={`${data.invoice.buyer_name || "—"} · ${data.invoice.tax_type === "IGST" ? "IGST" : "CGST+SGST"} · ${data.invoice.status}`}
      />
      <div className="mb-4 flex items-center gap-3 no-print">
        <Link href="/erp/invoices" className="text-sm font-semibold text-[var(--accent)]">← Invoices</Link>
      </div>
      <InvoiceEditor data={data} canEdit={editable} />
    </>
  );
}
