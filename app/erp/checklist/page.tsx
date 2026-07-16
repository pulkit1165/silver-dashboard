import PageHeader from "@/components/PageHeader";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { listChecklist } from "@/lib/erp/checklist";
import ProcessChecklist from "@/components/erp/ProcessChecklist";

export const dynamic = "force-dynamic";

export default async function ChecklistPage() {
  const user = await getCurrentUser();
  const stages = await listChecklist();
  // Everyone signed in can tick & edit tasks (it's a shared SOP the client co-owns);
  // only an admin can reset the whole thing back to template.
  const canReset = canWrite(user.role, "users");
  return (
    <>
      <PageHeader
        title="Process Checklist"
        subtitle="The module-wise SOP loop — MRN → QC → Finished Goods → Sales → Packing/Scan → Pricing → Billing → Procurement → back to MRN. Everyone (and the client) ticks the same live copy; it syncs across every device automatically."
      />
      <ProcessChecklist initial={stages} me={user.name} canReset={canReset} />
    </>
  );
}
