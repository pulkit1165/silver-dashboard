import PageHeader from "@/components/PageHeader";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import Gstr1Panel from "@/components/erp/Gstr1Panel";

export const dynamic = "force-dynamic";

export default async function Gstr1Page() {
  const user = await getCurrentUser();
  if (!canWrite(user, "gst")) {
    return (
      <>
        <PageHeader title="GSTR-1 Export" subtitle="Outward supply return." />
        <section className="panel p-4 text-sm text-[var(--muted)]">Your role ({user.role}) doesn't have access to GST reports.</section>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="GSTR-1 Export"
        subtitle="Pick a return period to build B2B / B2C / HSN summaries from finalized invoices, ready to key into the GST portal's offline tool."
      />
      <Gstr1Panel />
    </>
  );
}
