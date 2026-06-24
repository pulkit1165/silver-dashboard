import PageHeader from "@/components/PageHeader";
import PackingSlip from "@/components/erp/PackingSlip";
import { getCurrentUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

export default async function PackingSlipPage() {
  await getCurrentUser(); // gate to signed-in users
  return (
    <>
      <PageHeader
        title="Packing Slip"
        subtitle="Build a packing slip case-by-case: scan items into a case, fill quantities, close it, then export to Excel."
      />
      <PackingSlip />
    </>
  );
}
