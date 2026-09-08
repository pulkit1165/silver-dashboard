import { getSql } from "@/lib/erp/db";
import photoMap from "@/lib/erp/catalogPhotos.json";
import { getCatalogExtras } from "@/lib/erp/catalogExtras";

// The internal product catalogue = every PRICED SKU (one that carries a price-list
// header) grouped under that header, mirroring the client's price-list PDF. Archived
// SKUs (not in the PDF) are excluded — see erp-sku-archive-cleanup.
export interface CatalogItem {
  sku_code: string;
  name: string;
  mrp: number;
  master_qty: number;
  single_qty: number;
  unit: string;
}
export interface CatalogGroup {
  header: string;
  items: CatalogItem[];
  photo?: string; // /catalog-photos/<slug>.png — one representative photo per category
}

export async function getCatalogGrouped(): Promise<CatalogGroup[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT COALESCE(header,'')            AS header,
           sku_code,
           name,
           COALESCE(price, 0)::float8      AS mrp,
           COALESCE(master_qty, 0)::float8 AS master_qty,
           COALESCE(single_qty, 0)::float8 AS single_qty,
           COALESCE(unit, '')              AS unit
      FROM skus
     WHERE COALESCE(header,'') <> '' AND status <> 'archived'
     ORDER BY header, name, sku_code`) as unknown as Array<CatalogItem & { header: string }>;

  const groups: CatalogGroup[] = [];
  const idx = new Map<string, CatalogGroup>();
  for (const r of rows) {
    let g = idx.get(r.header);
    if (!g) { g = { header: r.header, items: [] }; idx.set(r.header, g); groups.push(g); }
    g.items.push({
      sku_code: r.sku_code, name: r.name, mrp: Number(r.mrp) || 0,
      master_qty: Number(r.master_qty) || 0, single_qty: Number(r.single_qty) || 0,
      unit: r.unit || "",
    });
  }
  // Static (extracted-from-PDF) photos, then let user-uploaded ones override.
  const photos = photoMap as Record<string, string>;
  const extras = await getCatalogExtras();
  for (const g of groups) {
    if (photos[g.header]) g.photo = photos[g.header];
    if (extras.photos[g.header]) g.photo = extras.photos[g.header];
  }
  return groups;
}
