import "server-only";

// Shared by the create-only bulk importer (/api/erp/skus/import) and the
// backfill-only bulk updater (/api/erp/skus/import-labels) — same flexible
// header-matching so both accept whatever column names the source sheet uses.
export const norm = (k: string) => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");

export const FIELD_ALIASES: Record<string, string[]> = {
  sku_code: ["itemcode", "skucode", "sku", "code", "partno", "partnumber"],
  name: ["itemname", "name", "item", "description", "particulars"],
  category: ["category", "cat", "group"],
  brand: ["brand", "make", "company"],
  unit: ["unit", "uom"],
  hsn: ["hsn", "hsncode", "taxcode"],
  purchase_price: ["purchaseprice", "costprice", "cost", "pp", "buyprice"],
  selling_price: ["mrp", "sellingprice", "price", "sp", "rate", "sellprice"],
  opening_stock: ["openingstock", "opening", "stock", "qty", "quantity", "openingqty"],
  reorder_level: ["reorderlevel", "reorder", "minstock", "minimum"],
  master_qty: ["masterqty", "masterpacksize", "packsize", "cartonqty", "masterpack"],
  barcode_code: ["barcode", "barcodecode", "owncode", "itemcodelegacy"],
};

export function pick(rowNorm: Record<string, string>, field: string): string {
  for (const a of FIELD_ALIASES[field]) if (rowNorm[a] != null && rowNorm[a] !== "") return rowNorm[a];
  return "";
}

export const num = (v: string) => {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
