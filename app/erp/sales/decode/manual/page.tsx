import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import ManualOrderBuilder from "@/components/erp/ManualOrderBuilder";
import { getCustomers, getSalesmen } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

export default async function ManualOrderPage() {
  const [customers, salesmen, user] = await Promise.all([getCustomers(), getSalesmen(), getCurrentUser()]);
  return (
    <>
      <PageHeader title="Write Sales Order" subtitle="Manually write an order for a party — review it, then submit it as a decoded order for punching." />
      <div className="mb-4 flex items-center gap-3">
        <Link href="/erp/sales/decode" className="text-sm font-semibold text-[var(--accent)]">← Decode</Link>
        <Link href="/erp/sales/decoded" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">📥 Decode Orders</Link>
      </div>
      <ManualOrderBuilder
        customers={customers.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
        salesmen={salesmen}
        defaultSalesman={user.name}
      />
    </>
  );
}
