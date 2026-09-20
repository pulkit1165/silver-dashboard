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

export type MasterKey = "customers" | "vendors" | "skus" | "party-rates" | "party-ogl" | "party-foc" | "item-rates" | "item-net-rate" | "party-item-net-rate" | "sku-abbrev" | "party-k-items";

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
  kind: "row" | "rate" | "pair-rate" | "pair"; // pair-rate = a value keyed by TWO records (party × item); pair = an ASSIGNMENT keyed by two records (no value)
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
      { col: "ogl_pct", type: "num", aliases: ["ogl", "oglpct", "oglpercent", "oglper"] },
      { col: "foc_pct", type: "num", aliases: ["foc", "focpct", "focpercent", "focper", "focdisc"] },
      { col: "credit_limit", type: "num", aliases: ["creditlimit", "credit", "limit"] },
      { col: "payment_terms", type: "text", aliases: ["paymentterms", "terms", "payment", "paymentterm"] },
    ],
    refs: [
      { table: "sales_orders", col: "customer_id" },
      { table: "invoices", col: "customer_id" },
    ],
    sampleColumns: ["code", "name", "gst", "state_code", "phone", "discount_pct", "ogl_pct", "foc_pct", "credit_limit"],
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

  "party-ogl": {
    key: "party-ogl",
    label: "Party-wise OGL %",
    table: "customers",
    keyCol: "code",
    altKeyCol: "name",
    keyAliases: [...CODE_ALIASES, "name", "customername", "partyname", "party", "acntdesc"],
    keyLabel: "Customer code or name",
    permission: "rates",
    entity: "customer",
    action: "customer.ogl",
    kind: "rate",
    rateCol: "ogl_pct",
    rateResetValue: 0,
    fields: [
      { col: "ogl_pct", type: "num", aliases: ["ogl", "oglpct", "oglpercent", "oglper", "percent", "pct", "rate"], required: true },
    ],
    sampleColumns: ["code", "ogl_pct"],
  },

  "party-foc": {
    key: "party-foc",
    label: "FOC Disc %",
    table: "customers",
    keyCol: "code",
    altKeyCol: "name",
    keyAliases: [...CODE_ALIASES, "name", "customername", "partyname", "party", "acntdesc"],
    keyLabel: "Customer code or name",
    permission: "rates",
    entity: "customer",
    action: "customer.foc",
    kind: "rate",
    rateCol: "foc_pct",
    rateResetValue: 0,
    fields: [
      { col: "foc_pct", type: "num", aliases: ["foc", "focpct", "focpercent", "focper", "focdisc", "percent", "pct", "rate"], required: true },
    ],
    sampleColumns: ["code", "foc_pct"],
  },

  "item-net-rate": {
    key: "item-net-rate",
    label: "Item Net Rate (global)",
    table: "skus",
    keyCol: "sku_code",
    altKeyCol: "name",
    keyAliases: [...ITEM_CODE_ALIASES, "name", "itemname", "description", "particulars"],
    keyLabel: "Item code or name",
    permission: "rates",
    entity: "sku",
    action: "sku.net_rate",
    kind: "rate",
    rateCol: "item_net_rate",
    rateResetValue: 0,
    fields: [
      { col: "item_net_rate", type: "num", aliases: ["itemnetrate", "netrate", "net", "rate", "sp", "netprice", "amount"], required: true },
    ],
    sampleColumns: ["sku_code", "item_net_rate"],
  },

  // The MOST specific rate: a fixed net rate for one item, for one party. Keyed by
  // TWO records (party + item), so it's a "pair-rate" — the party and the item are
  // each resolved (by code or name); a row whose party OR item isn't found is
  // reported and skipped while the rest go through.
  "party-item-net-rate": {
    key: "party-item-net-rate",
    label: "Party × Item Net Rate",
    table: "party_item_net_rates",
    keyCol: "sku_code", // not used for matching (pair-rate resolves both sides itself)
    keyAliases: ITEM_CODE_ALIASES,
    keyLabel: "Party (code/name) + Item code",
    permission: "rates",
    entity: "customer",
    action: "customer.party_item",
    kind: "pair-rate",
    fields: [
      { col: "party", type: "text", aliases: ["party", "partyname", "partycode", "customer", "customername", "customercode", "account", "acntdesc", "ac"], required: true },
      { col: "sku_code", type: "text", aliases: ["skucode", "itemcode", "sku", "item", "code", "partno", "partnumber"], required: true },
      { col: "net_rate", type: "num", aliases: ["netrate", "net", "rate", "sp", "price", "netprice", "amount", "partyitemnetrate", "partynetrate"], required: true },
    ],
    sampleColumns: ["party", "sku_code", "net_rate"],
  },

  // Abbreviation ("trade name") STICKER master — a per-SKU row master feeding the
  // separate abbreviation-sticker module. Its own table (sku_abbrev_master); does
  // NOT touch label_master / skus.name / MRP. Columns map to the client's ITEMS
  // MASTER.xlsx: Label Desc.→line1, Label Desc.1→line2, Units→unit, MASTER/SINGAL PACK.
  "sku-abbrev": {
    key: "sku-abbrev",
    label: "Item Abbreviation (Sticker)",
    table: "sku_abbrev_master",
    keyCol: "sku_code",
    keyAliases: ITEM_CODE_ALIASES,
    keyLabel: "Item code",
    permission: "labels",
    entity: "sku",
    action: "sku.abbrev",
    kind: "row",
    fields: [
      { col: "line1", type: "text", aliases: ["labeldesc", "labeldescription", "abbreviation", "abbr", "line1", "tradename", "name1"], required: true },
      { col: "line2", type: "text", aliases: ["labeldesc1", "labeldescription1", "line2", "size", "sizetext", "variant", "name2"] },
      { col: "unit", type: "text", aliases: ["units", "unit", "uom"] },
      { col: "master_pack", type: "num", aliases: ["masterpack", "mpack", "cartonqty", "masterpacksize", "stdpack"] },
      { col: "single_pack", type: "num", aliases: ["singalpack", "singlepack", "spack", "innerpack", "singleqty"] },
    ],
    sampleColumns: ["code", "label desc.", "label desc.1", "units", "master pack", "singal pack"],
  },

  // Party → K-items assignment. Per party, the item codes that are "K" (retailer
  // network / OGL-eligible). Keyed by TWO records (party + item) with NO value —
  // a "pair" (presence = the item is K for that party). When such a party is
  // picked on an order, its listed items auto-mark K and the order becomes O/K.
  // Its own table (party_k_items); does NOT touch pricing masters. See
  // [[erp-retailer-network]] / [[erp-pricing-and-rulebook]].
  "party-k-items": {
    key: "party-k-items",
    label: "Party K-items (auto-K / OGL)",
    table: "party_k_items",
    keyCol: "sku_code", // not used for matching (pair resolves both sides itself)
    keyAliases: ITEM_CODE_ALIASES,
    keyLabel: "Party (code/name) + Item code",
    permission: "rates",
    entity: "customer",
    action: "customer.party_k",
    kind: "pair",
    fields: [
      { col: "party", type: "text", aliases: ["party", "partyname", "partycode", "customer", "customername", "customercode", "account", "acntdesc", "ac"], required: true },
      { col: "sku_code", type: "text", aliases: ["skucode", "itemcode", "sku", "item", "code", "partno", "partnumber"], required: true },
    ],
    sampleColumns: ["party", "sku_code"],
  },
};

export const MASTER_KEYS = Object.keys(MASTERS) as MasterKey[];

/** A human label for a DB column (used by the single-entry add form). */
export function fieldLabel(col: string): string {
  const special: Record<string, string> = {
    sku_code: "Item code", gst: "GSTIN", ogl_pct: "OGL %", foc_pct: "FOC %",
    discount_pct: "Discount %", gst_rate: "GST %", hsn: "HSN", price: "MRP",
    net_rate: "Net rate", item_net_rate: "Item net rate", selling_price: "Net rate",
    master_qty: "Master (carton) qty", single_qty: "Inner/single qty", barcode_code: "Barcode",
    pos_state_code: "Place-of-supply state", state_code: "State code", credit_limit: "Credit limit",
    payment_terms: "Payment terms",
  };
  return special[col] ?? col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Client-safe metadata (no query logic) for the uploader dropdown + hints + single-add form. */
export const MASTER_LIST = MASTER_KEYS.map((k) => {
  const m = MASTERS[k];
  return {
    key: m.key,
    label: m.label,
    keyLabel: m.keyLabel,
    kind: m.kind,
    permission: m.permission,
    sampleColumns: m.sampleColumns,
    keyCol: m.keyCol,
    keyFieldAliasHint: m.keyLabel,
    fieldCols: m.fields.map((f) => f.col),
    // Full field metadata so the client can render a single-entry "add one" form.
    // For row/rate masters the match KEY is a separate column (not in fields), so we
    // prepend it; for pair-rate the two keys ARE fields already.
    formFields: (m.kind === "pair-rate" || m.kind === "pair"
      ? m.fields
      : [{ col: m.keyCol, type: "text" as FieldType, aliases: m.keyAliases, required: true }, ...m.fields]
    ).map((f) => ({ col: f.col, label: fieldLabel(f.col), type: f.type, required: !!f.required })),
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

/**
 * Does the uploaded sheet even have THIS master's columns? Used to STOP a
 * completely-wrong file (mismatched columns) before it silently changes nothing
 * — or, in full-overwrite mode, wrongly treats the whole master as "not in the
 * file" and deletes it. Looks only at the header row.
 */
export function detectColumns(cfg: MasterConfig, rows: Record<string, unknown>[]): {
  headers: string[];
  keyFound: boolean;
  fieldsFound: number;
} {
  const first = (rows.find((r) => r && typeof r === "object") ?? {}) as Record<string, unknown>;
  const headers = Object.keys(first);
  const headerKeys = headers.map(norm).filter(Boolean);
  const has = (aliases: string[]) => aliases.some((a) => headerKeys.includes(a));

  if (cfg.kind === "pair-rate" || cfg.kind === "pair") {
    const party = cfg.fields.find((f) => f.col === "party")!;
    const item = cfg.fields.find((f) => f.col === "sku_code")!;
    const rate = cfg.fields.find((f) => f.col === "net_rate"); // pair (assignment) has none
    const keyFound = has(party.aliases) && has(item.aliases);
    const fieldsFound = [party, item, rate].filter((f): f is FieldDef => !!f && has(f.aliases)).length;
    return { headers, keyFound, fieldsFound };
  }
  return {
    headers,
    keyFound: has(cfg.keyAliases),
    fieldsFound: cfg.fields.filter((f) => has(f.aliases)).length,
  };
}

/** A parsed pair-rate source row (party × item → net rate), pre-DB-resolution. */
export interface PairRow { party: string; sku_code: string; net_rate: number }

/**
 * Parse raw sheet rows for a pair-rate master (party × item net rate). Only
 * shape/blank validation here; party/item existence is checked against the DB in
 * the route (unknown party/item → skipped-with-error, the rest still apply).
 */
export function parsePairRows(cfg: MasterConfig, rows: Record<string, unknown>[]): { pairs: PairRow[]; errors: ParseError[] } {
  const pairs: PairRow[] = [];
  const errors: ParseError[] = [];
  const seen = new Set<string>();
  const partyF = cfg.fields.find((f) => f.col === "party")!;
  const itemF = cfg.fields.find((f) => f.col === "sku_code")!;
  const rateF = cfg.fields.find((f) => f.col === "net_rate")!;

  rows.forEach((raw, i) => {
    const rn = normalizeRaw(raw);
    const party = pickFrom(rn, partyF.aliases).trim();
    const sku = pickFrom(rn, itemF.aliases).trim();
    const rateCell = pickFrom(rn, rateF.aliases);
    if (!party && !sku && rateCell === "") return; // blank line
    if (!party) { errors.push({ row: i + 1, key: sku, reason: "Missing party" }); return; }
    if (!sku) { errors.push({ row: i + 1, key: party, reason: "Missing item code" }); return; }
    if (rateCell === "") { errors.push({ row: i + 1, key: `${party}/${sku}`, reason: "Missing net rate" }); return; }
    const dupKey = `${party.toUpperCase()}|${sku.toUpperCase()}`;
    if (seen.has(dupKey)) { errors.push({ row: i + 1, key: `${party}/${sku}`, reason: "Duplicate party+item in file" }); return; }
    seen.add(dupKey);
    pairs.push({ party, sku_code: sku, net_rate: num(rateCell) });
  });

  return { pairs, errors };
}

/** A parsed pair ASSIGNMENT source row (party × item, no value), pre-DB-resolution. */
export interface PairAssign { party: string; sku_code: string }

/**
 * Parse raw sheet rows for a "pair" (assignment) master — party × item with NO
 * value (e.g. party-k-items). Shape/blank validation only; existence is checked
 * in the route. Presence of the pair = the assignment.
 */
export function parsePairAssign(cfg: MasterConfig, rows: Record<string, unknown>[]): { pairs: PairAssign[]; errors: ParseError[] } {
  const pairs: PairAssign[] = [];
  const errors: ParseError[] = [];
  const seen = new Set<string>();
  const partyF = cfg.fields.find((f) => f.col === "party")!;
  const itemF = cfg.fields.find((f) => f.col === "sku_code")!;

  rows.forEach((raw, i) => {
    const rn = normalizeRaw(raw);
    const party = pickFrom(rn, partyF.aliases).trim();
    const sku = pickFrom(rn, itemF.aliases).trim();
    if (!party && !sku) return; // blank line
    if (!party) { errors.push({ row: i + 1, key: sku, reason: "Missing party" }); return; }
    if (!sku) { errors.push({ row: i + 1, key: party, reason: "Missing item code" }); return; }
    const dupKey = `${party.toUpperCase()}|${sku.toUpperCase()}`;
    if (seen.has(dupKey)) { errors.push({ row: i + 1, key: `${party}/${sku}`, reason: "Duplicate party+item in file" }); return; }
    seen.add(dupKey);
    pairs.push({ party, sku_code: sku });
  });

  return { pairs, errors };
}
