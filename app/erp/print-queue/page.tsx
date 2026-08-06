import PageHeader from "@/components/PageHeader";
import PrintQueue from "@/components/erp/PrintQueue";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export default async function PrintQueuePage() {
  const user = await getCurrentUser();
  return (
    <>
      <PageHeader
        title="Print Queue"
        subtitle="Live view of the self-hosted print bridge — which PCs' agents are online, and every label job as it goes queued → printing → done. Retry any that fail."
      />
      <PrintQueue canRetry={canWrite(user.role, "labels")} />
    </>
  );
}
