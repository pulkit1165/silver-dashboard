import PageHeader from "@/components/PageHeader";
import QrManager from "@/components/erp/QrManager";
import { qrManagementList } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export default async function QrManagePage() {
  const user = await getCurrentUser();
  const items = await qrManagementList();
  return (
    <>
      <PageHeader
        title="SKU QR Codes"
        subtitle="Every SKU's secure QR code — status, scanning, printing, disable & regenerate."
      />
      <QrManager items={items} canWrite={canWrite(user.role, "skus")} />
    </>
  );
}
