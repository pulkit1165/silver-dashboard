import PageHeader from "@/components/PageHeader";
import LabelMaster from "@/components/erp/LabelMaster";
import { getSql } from "@/lib/erp/db";
import { getLabelMasters } from "@/lib/erp/labelMaster";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
const CAP = 500;

export default async function LabelMasterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const user = await getCurrentUser();
  const editable = canWrite(user.role, "labels");
  const sql = getSql();

  const like = `%${q}%`;
  const rows = (q
    ? await sql`SELECT sku_code, name, COALESCE(unit,'') AS unit, COALESCE(category,'') AS category
        FROM skus WHERE sku_code ILIKE ${like} OR name ILIKE ${like}
        ORDER BY sku_code LIMIT ${CAP}`
    : await sql`SELECT sku_code, name, COALESCE(unit,'') AS unit, COALESCE(category,'') AS category
        FROM skus ORDER BY sku_code LIMIT ${CAP}`) as unknown as
    { sku_code: string; name: string; unit: string; category: string }[];

  const master = await getLabelMasters();

  return (
    <>
      <PageHeader
        title="Barcode / Label Master"
        subtitle="Structure how each part's label reads — Line 1 / Line 2 / Line 3 (like the old Item Master's Label Desc.), plus Units, Lot & Rack. Saved per SKU and used on every barcode print, every size. Leave a SKU blank to just use its full name."
      />
      <LabelMaster skus={rows} master={master} editable={editable} q={q} total={rows.length} cap={CAP} />
    </>
  );
}
