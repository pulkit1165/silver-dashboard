import PageHeader from "@/components/PageHeader";
import AnalyticsDashboard from "@/components/erp/AnalyticsDashboard";
import { getAnalytics } from "@/lib/erp/analytics";
import { getCurrentUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  await getCurrentUser(); // gate to signed-in users
  const data = await getAnalytics(undefined, new Date().toISOString());
  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Live sales analytics — daily sales & purchase, best-selling SKUs, top customers, returning cadence, slow-moving stock and more. Click any report to open it in full."
      />
      <AnalyticsDashboard data={data} />
    </>
  );
}
