import PageHeader from "@/components/PageHeader";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import EwayBillPanel from "@/components/erp/EwayBillPanel";

export const dynamic = "force-dynamic";

export default async function EwayBillsPage() {
  const user = await getCurrentUser();
  if (!canWrite(user.role, "eway_bills")) {
    return (
      <>
        <PageHeader title="e-Way Bills" subtitle="Transport permits for shipments over the threshold value." />
        <section className="panel p-4 text-sm text-[var(--muted)]">Your role ({user.role}) doesn't have access to e-way bills.</section>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="e-Way Bills"
        subtitle="Finalized invoices over the threshold that need an e-way bill — open one to get every EWB-01 field ready to key into ewaybillgst.gov.in, then record the number here."
      />
      <EwayBillPanel />
    </>
  );
}
