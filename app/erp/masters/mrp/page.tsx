import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// MRP Master has been merged into the Item Master — one item file with MRP +
// history, category, and active/inactive. Redirect any old link/bookmark there.
export default async function MrpMasterRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  redirect(sp.q ? `/erp/skus?q=${encodeURIComponent(sp.q)}` : "/erp/skus");
}
