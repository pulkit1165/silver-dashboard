import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import UploadMasterLink from "@/components/erp/UploadMasterLink";
import CustomerGstManager from "@/components/erp/CustomerGstManager";
import { getCustomers } from "@/lib/erp/queries";
import { listDiscountClasses } from "@/lib/erp/discount-classes";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const [rows, discountClasses] = await Promise.all([getCustomers(sp.q), listDiscountClasses()]);
  const editable = canWrite(user.role, "customers");
  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Customer master with GST, discount class, credit limit and payment terms."
        right={editable ? <UploadMasterLink master="customers" /> : undefined}
      />
      <ListFilters fields={[{ key: "q", label: "Search", placeholder: "Name, code, or GST…" }]} />
      <CustomerGstManager customers={rows} discountClasses={discountClasses} editable={editable} />
    </>
  );
}
