import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import PartyPctMaster from "@/components/erp/PartyPctMaster";
import { getCustomersWithPct } from "@/lib/erp/party-masters";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
const PAGE_CAP = 600;

// Party-wise OGL: an extra party-level discount % that stacks on top of the
// party Disc% (compounding) when no item net rate supersedes the line.
export default async function PartyOglMasterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const rows = await getCustomersWithPct("ogl", sp.q, PAGE_CAP);
  const editable = canWrite(user.role, "rates");
  return (
    <>
      <PageHeader
        title="Party-wise OGL"
        subtitle="An extra party-level discount % — applied on top of the party Disc% (after it) when the line isn't on a fixed net rate. Versioned: latest value is live, every prior value kept."
      />
      <ListFilters fields={[{ key: "q", label: "Search", placeholder: "Name, code, or GST…" }]} />
      <PartyPctMaster rows={rows} kind="ogl" label="OGL%" editable={editable} />
    </>
  );
}
