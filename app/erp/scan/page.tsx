import PageHeader from "@/components/PageHeader";
import ScanWorkspace from "@/components/erp/ScanWorkspace";
import { getCurrentUser } from "@/lib/erp/session";
import { getWarehouses, getBins } from "@/lib/erp/queries";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const [user, warehouses, bins] = await Promise.all([getCurrentUser(), getWarehouses(), getBins()]);
  return (
    <>
      <PageHeader
        title="QR Scanner"
        subtitle="Scan a SKU QR code, then run any warehouse action — all logged to the audit trail."
      />
      <ScanWorkspace
        user={{ name: user.name, role: user.role }}
        canWrite={canWrite(user.role, "scan")}
        warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
        bins={bins.map((b) => ({ id: b.id, warehouse_id: b.warehouse_id, code: b.code }))}
      />
    </>
  );
}
