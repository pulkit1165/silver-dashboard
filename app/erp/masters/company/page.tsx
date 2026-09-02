import PageHeader from "@/components/PageHeader";
import { getCompanySettings } from "@/lib/erp/invoices";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import CompanySettingsForm from "@/components/erp/CompanySettingsForm";

export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  const user = await getCurrentUser();
  const settings = await getCompanySettings();
  const editable = canWrite(user.role, "company_settings");

  return (
    <>
      <PageHeader
        title="Company Settings"
        subtitle="Your GSTIN, registered address and bank details — printed on every invoice and required before billing can go live."
      />
      {editable ? (
        <CompanySettingsForm initial={settings} />
      ) : (
        <section className="panel p-4 text-sm text-[var(--muted)]">
          Only an admin can edit company settings. Current GSTIN: <b>{settings.gstin || "not set"}</b>.
        </section>
      )}
    </>
  );
}
