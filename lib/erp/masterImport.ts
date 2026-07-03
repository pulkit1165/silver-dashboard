// Config-driven Excel/CSV upload for the Master Files.
//
// One place defines every uploadable master (customers, vendors, items/SKUs,
// and the two net-rate columns) plus how its sheet columns map to DB columns.
// The API route (app/api/erp/masters/import) and the client uploader
// (components/erp/MasterUpload) both read from here so they never drift.
//
// Two modes, chosen by the user per upload:
//   - partial : add rows that are new + update the rows present in the file,
//               matched by code. Everything else is left untouched.
//   - full    : the master becomes exactly what's in the file. Rows NOT in the
//               file are removed — EXCEPT rows already used in a transaction
//               (an order/invoice/stock move), which are protected and kept so
//               existing documents never break. (For the rate masters, "full"
//               resets the rate of every non-listed row to its default.)
//
// This module is pure data + string helpers (no server-only imports) so the
// client can import the metadata list too.

export type MasterKey = "customers" | "vendors" | "skus" | "party-rates" | "item-rates";

/** Collapse a header to a comparison key: lowercase, strip non-alphanumerics. */
export const norm = (k: string) => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");

/** Lenient numeric parse (strips ₹, commas, %, spaces). */
export const num = (v: string) => {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Normalize a raw sheet row to { normalizedHeader: trimmedString }. */
export function normalizeRaw(raw: Record<string, unknown>): Record<string, string> {
  const rn: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) rn[norm(k)] = v == null ? "" : String(v).trim();
  return rn;
}

/** First non-empty value among a field's accepted header aliases. */
export function pickFrom(rn: Record<string, string>, aliases: string[]): string {
  for (const a of aliases) if (rn[a] != null && rn[a] !== "") return rn[a];
  return "";
}

export type FieldType = "text" | "num";

export interface FieldDef {
  col: string; // DB column
  type: FieldType;
  aliases: string[]; // accepted header names (normalized)
  required?: boolean; // row is rejected if this is blank
  insertDefault?: string | number; // applied only when creating a new row
}

/** A table that points at this master's id — used to protect referenced rows on full overwrite. */
export interface RefCheck {
  table: string;
  col: string;
  where?: string; // extra condition, e.g. "qty <> 0" (constant, from this config only)
}

export interface MasterConfig {
  key: MasterKey;
  label: string;
  table: string;
  keyCol: string; // match column, e.g. "code" / "sku_code"
  altKeyCol?: string; // rate masters also match on this (e.g. "name")
  keyAliases: string[];
  keyLabel: string; // e.g. "Customer code"
  permission: string; // WRITERS key in rbac.ts
  entity: string; // activity-log entity
  action: string; // activity-log action prefix
  kind: "row" | "rate";
  fields: FieldDef[];
  refs?: RefCheck[]; // for row-kind full-overwrite protection
  cleanupChildren?: { table: string; col: string }[]; // child rows to purge when a row is deleted
  mintsQr?: boolean; // skus: create qr_token + qr_codes row on insert
  rateCol?: string; // rate kind: the single column set by the upload
  rateResetValue?: number; // rate kind full: value for non-listed rows
  rateResetToCol?: string; // rate kind full: reset to another column's value instead (wins over rateResetValue)
  sampleColumns: string[]; // "expected columns" hint shown in the UI
}

const CODE_ALIASES = ["code", "customercode", "partycode", "accountcode", "acode", "ac", "cust"];
const VENDOR_CODE_ALIASES = ["code", "vendorcode", "suppliercode", "accountcode", "acode"];
const ITEM_CODE_ALIASES = ["itemcode", "skucode", "sku", "code", "partno", "partnumber", "item"];

export const MASTERS: Record<MasterKey, MasterConfig> = {
  customers: {
    key: "customers",
    label: "Customer Master",
    table: "customers",
    keyCol: "code",
    keyAliases: CODE_ALIASES,
    keyLabel: "Customer code",
    permission: "customers",
    entity: "customer",
    action: "customer",
    kind: "row",
    fields: [
      { col: "name", type: "text", aliases: ["name", "customername", "partyname", "party", "acntdesc", "account", "accountname"], required: true },
      { col: "gst", type: "text", aliases: ["gst", "gstin", "gstno", "gstnumber", "tin"] },
      { col: "email", type: "text", aliases: ["email", "mail", "emailid"] },
      { col: "phone", type: "text", aliases: ["phone", "mobile", "contact", "phoneno", "mob", "mobileno"] },
      { col: "billing", type: "text", aliases: ["billing", "billingaddress", "address", "addr", "billaddress"] },
      { col: "shipping", type: "text", aliases: ["shipping", "shippingaddress", "shipto", "shipaddress"] },
      { col: "state_code", type: "text", aliases: ["statecode", "state", "gststate"] },
      { col: "pincode", type: "text", aliases: ["pincode", "pin", "zip", "postalcode"] },
      { col: "pos_state_code", type: "text", aliases: ["posstatecode", "placeofsupply", "pos"] },
      { col: "discount_pct", type: "num", aliases: ["discount", "discountpct", "disc", "standingdiscount", "discpercent", "discountpercent"] },
      { col: "credit_limit", type: "num", aliases: ["creditlimit", "credit", "limit"] },
      { col: "payment_terms", type: "text", aliases: ["paymentterms", "terms", "payment", "paymentterm"] },
    ],
    refs: [
      { table: "sales_orders", col: "customer_id" },
      { table: "invoices", col: "customer_id" },
    ],
    sampleColumns: ["code", "name", "gst", "state_code", "phone", "discount_pct", "credit_limit"],
  },

  vendors: {
    key: "vendors",
    label: "Vendor Master",
    table: "vendors",
    keyCol: "code",
    keyAliases: VENDOR_CODE_ALIASES,
    keyLabel: "Vendor code",
    permission: "vendors",
    entity: "vendor",
    action: "vendor",
    kind: "row",
    fields: [
      { col: "name", type: "text", aliases: ["name", "vendorname", "suppliername", "party", "acntdesc", "account"], required: true },
      { col: "gst", type: "text", aliases: ["gst", "gstin", "gstno", "tin"] },
      { col: "contact", type: "text", aliases: ["contact", "contactperson", "person", "contactname"] },
      { col: "email", type: "text", aliases: ["email", "mail", "emailid"] },
      { col: "phone", type: "text", aliases: ["phone", "mobile", "phoneno", "mob", "mobileno"] },
      { col: "category", type: "text", aliases: ["category", "cat", "group", "type"] },
      { col: "payment_terms", type: "text", aliases: ["paymentterms", "terms", "payment"] },
      { col: "rating", type: "num", aliases: ["rating", "score"] },
      { col: "status", type: "text", aliases: ["status", "state"] },
    ],
    refs: [
      { table: "purchase_orders", col: "vendor_id" },
      { table: "vendor_bills", col: "vendor_id" },
      { table: "skus", col: "vendor_id" },
    ],
    sampleColumns: ["code", "name", "gst", "contact", "phone", "category", "payment_terms"],
  },

  skus: {
    key: "skus",
    label: "Item (SKU) Master",
    table: "skus",
    keyCol: "sku_code",
    keyAliases: ITEM_CODE_ALIASES,
    keyLabel: "Item code",
    permission: "skus",
    entity: "sku",
    action: "sku",
    kind: "row",
    mintsQr: true,
    fields: [
      { col: "name", type: "text", aliases: ["itemname", "name", "item", "description", "particulars", "itemdescription"], required: true },
      { col: "category", type: "text", aliases: ["category", "cat", "group"] },
      { col: "brand", type: "text", aliases: ["brand", "make", "company"] },
      { col: "unit", type: "text", aliases: ["unit", "uom"], insertDefault: "PCS" },
      { col: "hsn", type: "text", aliases: ["hsn", "hsncode", "taxcode"] },
      { col: "price", type: "num", aliases: ["mrp", "price", "listprice", "maxretailprice", "mrprate"] }, // MRP
      { col: "purchase_price", type: "num", aliases: ["purchaseprice", "costprice", "cost", "pp", "buyprice"] },
      { col: "selling_price", type: "num", aliases: ["sellingprice", "netrate", "net", "sp", "sellprice", "rate", "netprice"] },
      { col: "gst_rate", type: "num", aliases: ["gstrate", "gst", "tax", "taxrate", "gstpercent"], insertDefault: 18 },
      { col: "reorder_level", type: "num", aliases: ["reorderlevel", "reorder", "minstock", "minimum"] },
      { col: "master_qty", type: "num", aliases: ["masterqty", "masterpacksize", "packsize", "cartonqty", "masterpack", "stdpack"] },
      { col: "single_qty", type: "num", aliases: ["singleqty", "innerpack", "unitpack", "piecesperunit", "stdpack2"] },
      { col: "barcode_code", type: "text", aliases: ["barcode", "barcodecode", "owncode", "itemcodelegacy"] },
    ],
    refs: [
      { table: "so_lines", col: "sku_id" },
      { table: "po_lines", col: "sku_id" },
      { table: "package_lines", col: "sku_id" },
      { table: "invoice_lines", col: "sku_id" },
      { table: "stock_moves", col: "sku_id" },
      { table: "scan_events", col: "sku_id" },
      { table: "inventory", col: "sku_id", where: "qty <> 0" },
    ],
    // A deleted (unused) SKU also owns its QR rows and zero-qty inventory rows.
    cleanupChildren: [
      { table: "qr_codes", col: "sku_id" },
      { table: "inventory", col: "sku_id" },
    ],
    sampleColumns: ["sku_code", "name", "category", "mrp", "selling_price", "hsn", "gst_rate"],
  },

  "party-rates": {
    key: "party-rates",
    label: "Party-wise Net Rate",
    table: "customers",
    keyCol: "code",
    altKeyCol: "name",
    keyAliases: [...CODE_ALIASES, "name", "customername", "partyname", "party", "acntdesc"],
    keyLabel: "Customer code or name",
    permission: "rates",
    entity: "customer",
    action: "customer.rate",
    kind: "rate",
    rateCol: "discount_pct",
    rateResetValue: 0,
    fields: [
      { col: "discount_pct", type: "num", aliases: ["discount", "discountpct", "disc", "standingdiscount", "discpercent", "discountpercent", "percent", "pct", "rate"], required: true },
    ],
    sampleColumns: ["code", "discount_pct"],
  },

  "item-rates": {
    key: "item-rates",
    label: "Item-wise Net Rate",
    table: "skus",
    keyCol: "sku_code",
    altKeyCol: "name",
    keyAliases: [...ITEM_CODE_ALIASES, "name", "itemname", "description", "particulars"],
    keyLabel: "Item code or name",
    permission: "rates",
    entity: "sku",
    action: "sku.rate",
    kind: "rate",
    rateCol: "selling_price",
    rateResetToCol: "price", // "no special net rate" falls back to MRP, not 0
    fields: [
      { col: "selling_price", type: "num", aliases: ["sellingprice", "netrate", "net", "rate", "sp", "price", "netprice", "amount"], required: true },
    ],
    sampleColumns: ["sku_code", "selling_price"],
  },
};

export const MASTER_KEYS = Object.keys(MASTERS) as MasterKey[];

/** Client-safe metadata (no query logic) for the uploader dropdown + hints. */
export const MASTER_LIST = MASTER_KEYS.map((k) => {
  const m = MASTERS[k];
  return {
    key: m.key,
    label: m.label,
    keyLabel: m.keyLabel,
    kind: m.kind,
    permission: m.permission,
    sampleColumns: m.sampleColumns,
    fieldCols: m.fields.map((f) => f.col),
  };
});
export type MasterMeta = (typeof MASTER_LIST)[number];

export type ImportMode = "partial" | "full";

/** A parsed, validated source row ready to write. */
export interface ParsedRow {
  keyUpper: string; // normalized (uppercased) match key
  keyStored: string; // value to store for the key column
  values: Record<string, string | number>; // only columns actually provided in the file
  providedCols: string[];
}

export interface ParseError {
  row: number;
  key: string;
  reason: string;
}

/**
 * Parse + validate raw sheet rows against a master config. Shared by the
 * dry-run and the apply pass so both see identical results.
 */
export function parseRows(cfg: MasterConfig, rows: Record<string, unknown>[]): { parsed: ParsedRow[]; errors: ParseError[] } {
  const parsed: ParsedRow[] = [];
  const errors: ParseError[] = [];
  const seen = new Set<string>();

  rows.forEach((raw, i) => {
    const rn = normalizeRaw(raw);
    const keyRaw = pickFrom(rn, cfg.keyAliases).trim();

    if (!keyRaw) {
      // Silently skip a fully-blank line; flag a line that has data but no key.
      const anyValue = cfg.fields.some((f) => pickFrom(rn, f.aliases) !== "");
      if (anyValue) errors.push({ row: i + 1, key: "", reason: `Missing ${cfg.keyLabel}` });
      return;
    }

    const keyUpper = keyRaw.toUpperCase();
    if (seen.has(keyUpper)) {
      errors.push({ row: i + 1, key: keyRaw, reason: "Duplicate key in file" });
      return;
    }

    const values: Record<string, string | number> = {};
    const providedCols: string[] = [];
    let missingRequired: string | null = null;

    for (const f of cfg.fields) {
      const cell = pickFrom(rn, f.aliases);
      if (cell === "") {
        if (f.required) missingRequired = f.col;
        continue;
      }
      values[f.col] = f.type === "num" ? num(cell) : cell;
      providedCols.push(f.col);
    }

    if (missingRequired) {
      errors.push({ row: i + 1, key: keyRaw, reason: `Missing ${missingRequired}` });
      return;
    }

    seen.add(keyUpper);
    parsed.push({
      keyUpper,
      keyStored: cfg.keyCol === "sku_code" ? keyUpper : keyRaw,
      values,
      providedCols,
    });
  });

  return { parsed, errors };
}
