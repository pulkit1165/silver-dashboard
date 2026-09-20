import { redirect, notFound } from "next/navigation";
import { getQuotation } from "@/lib/erp/purchaseQuotations";

// Quotations are now just one section of their indent's page — bounce old
// links (e.g. from activity-log history) to the unified view.
export default async function QuotationRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getQuotation(Number(id));
  if (!data?.quo.indent_id) notFound();
  redirect(`/erp/purchase/indents/${data.quo.indent_id}`);
}
