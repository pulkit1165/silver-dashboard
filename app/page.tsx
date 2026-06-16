import { getOpsSummary } from "@/lib/data";
import OpsDashboard from "@/components/OpsDashboard";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const data = await getOpsSummary();
  return (
    <>
      <PageHeader title="Home" subtitle="Sale / Purchase, receivables and bank position at a glance." />
      <OpsDashboard data={data} />
    </>
  );
}
