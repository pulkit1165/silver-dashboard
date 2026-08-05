import PageHeader from "@/components/PageHeader";
import PrinterManager from "@/components/erp/PrinterManager";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export default async function PrintersPage() {
  const user = await getCurrentUser();
  const editable = canWrite(user.role, "labels");
  return (
    <>
      <PageHeader
        title="Printers"
        subtitle="Rename each printer with a code, set the label size it's loaded with, and lock the size to the printer so only that size can be sent to it."
      />
      <PrinterManager editable={editable} />
    </>
  );
}
