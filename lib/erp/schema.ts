import { pgTable, serial, text, integer, doublePrecision, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// text timestamp keeps display/format identical to the prototype and makes
// string range filters (>= 'YYYY-MM-DD') trivial.
const createdAt = () => text("created_at").default(sql`to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
  role: text("role").notNull(),
  passwordHash: text("password_hash"),
  active: boolean("active").default(true),
  createdAt: createdAt(),
});

export const warehouses = pgTable("warehouses", {
  id: serial("id").primaryKey(),
  code: text("code").unique(),
  name: text("name"),
  address: text("address"),
  active: boolean("active").default(true),
});

export const bins = pgTable("bins", {
  id: serial("id").primaryKey(),
  warehouseId: integer("warehouse_id").notNull(),
  code: text("code"),
  rack: text("rack"),
  shelf: text("shelf"),
  bin: text("bin"),
});

export const skus = pgTable("skus", {
  id: serial("id").primaryKey(),
  skuCode: text("sku_code").unique().notNull(),
  name: text("name").notNull(),
  category: text("category").default(""),
  brand: text("brand").default(""),
  unit: text("unit").default("PCS"),
  price: doublePrecision("price").default(0), // MRP / display price
  purchasePrice: doublePrecision("purchase_price").default(0),
  sellingPrice: doublePrecision("selling_price").default(0),
  hsn: text("hsn").default(""),
  gstRate: doublePrecision("gst_rate").default(18), // % GST for this HSN (parts = 18)
  vendorId: integer("vendor_id"),
  minStock: doublePrecision("min_stock").default(0),
  reorderLevel: doublePrecision("reorder_level").default(0),
  masterQty: doublePrecision("master_qty").default(0), // 0 = no master carton pack defined for this SKU
  barcodeCode: text("barcode_code").default(""), // legacy/own item code to encode as a barcode; falls back to sku_code
  batchTracked: boolean("batch_tracked").default(false),
  serialTracked: boolean("serial_tracked").default(false),
  status: text("status").default("active"),
  qrToken: text("qr_token").unique().notNull(), // mirror of the active qr_codes token
  createdAt: createdAt(),
});

// Secure QR identifiers per SKU, with status + full history (regenerate keeps old rows).
export const qrCodes = pgTable(
  "qr_codes",
  {
    id: serial("id").primaryKey(),
    skuId: integer("sku_id").notNull(),
    skuCode: text("sku_code"),
    token: text("token").unique().notNull(),
    status: text("status").default("active"), // active | disabled | replaced
    printed: boolean("printed").default(false),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => ({ bySku: index("qr_sku_idx").on(t.skuId), byToken: index("qr_token_idx").on(t.token) }),
);

export const inventory = pgTable(
  "inventory",
  {
    id: serial("id").primaryKey(),
    skuId: integer("sku_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    binId: integer("bin_id").notNull().default(0),
    batch: text("batch").notNull().default(""),
    qty: doublePrecision("qty").default(0),
  },
  (t) => ({
    uniqLoc: uniqueIndex("inv_loc_uniq").on(t.skuId, t.warehouseId, t.binId, t.batch),
    bySku: index("inv_sku_idx").on(t.skuId),
  }),
);

export const stockMoves = pgTable("stock_moves", {
  id: serial("id").primaryKey(),
  skuId: integer("sku_id").notNull(),
  warehouseId: integer("warehouse_id"),
  binId: integer("bin_id"),
  type: text("type"),
  qty: doublePrecision("qty"),
  refDoc: text("ref_doc"),
  note: text("note"),
  userId: integer("user_id"),
  createdAt: createdAt(),
});

export const vendors = pgTable("vendors", {
  id: serial("id").primaryKey(),
  code: text("code").unique(),
  name: text("name"),
  gst: text("gst"),
  contact: text("contact"),
  email: text("email"),
  phone: text("phone"),
  category: text("category"),
  paymentTerms: text("payment_terms"),
  rating: doublePrecision("rating").default(0),
  status: text("status").default("pending"),
  createdAt: createdAt(),
});

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  code: text("code").unique(),
  name: text("name"),
  gst: text("gst"),
  email: text("email"),
  phone: text("phone"),
  billing: text("billing"),
  shipping: text("shipping"),
  // GST invoice fields. stateCode = buyer's GST state (2-digit, e.g. "03").
  // posStateCode = default Place of Supply (often the ship-to state) — this is
  // what decides IGST vs CGST/SGST against the seller's state.
  stateCode: text("state_code").default(""),
  pincode: text("pincode").default(""),
  posStateCode: text("pos_state_code").default(""),
  // Pricing scheme: a customer belongs to a discount class; discountPct is an
  // optional whole-order override (takes precedence over the class default).
  discountClassId: integer("discount_class_id"),
  discountPct: doublePrecision("discount_pct"),
  creditLimit: doublePrecision("credit_limit").default(0),
  paymentTerms: text("payment_terms"),
  createdAt: createdAt(),
});

// A reusable pricing scheme shared by many customers. wholeOrderPct is the
// default % off MRP applied to every billed line; per-SKU exceptions live in
// discount_class_skus.
export const discountClasses = pgTable("discount_classes", {
  id: serial("id").primaryKey(),
  code: text("code").unique(),
  name: text("name").notNull(),
  wholeOrderPct: doublePrecision("whole_order_pct").default(0),
  active: boolean("active").default(true),
  createdAt: createdAt(),
});

// Per-SKU discount override inside a class ("sometimes only for some skus").
export const discountClassSkus = pgTable(
  "discount_class_skus",
  {
    id: serial("id").primaryKey(),
    classId: integer("class_id").notNull(),
    skuId: integer("sku_id").notNull(),
    pct: doublePrecision("pct").default(0),
  },
  (t) => ({ uniq: uniqueIndex("dcsku_uniq").on(t.classId, t.skuId) }),
);

// Seller / company master used in the printed tax invoice header. Single row
// (id=1) acts as the active company; kept as a table so it's editable in-app.
export const companySettings = pgTable("company_settings", {
  id: serial("id").primaryKey(),
  legalName: text("legal_name").default("SILVER INDUSTRIES"),
  tradeName: text("trade_name").default(""),
  gstin: text("gstin").default(""),
  stateCode: text("state_code").default(""),
  address: text("address").default(""),
  city: text("city").default(""),
  pincode: text("pincode").default(""),
  phone: text("phone").default(""),
  email: text("email").default(""),
  msmeNo: text("msme_no").default(""),
  bankName: text("bank_name").default(""),
  bankAccount: text("bank_account").default(""),
  bankIfsc: text("bank_ifsc").default(""),
  bankBranch: text("bank_branch").default(""),
  invoicePrefix: text("invoice_prefix").default("GC26/"),
  invoiceNextNo: integer("invoice_next_no").default(1),
  terms: text("terms").default(""),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  poNo: text("po_no").unique(),
  vendorId: integer("vendor_id"),
  status: text("status").default("draft"),
  orderDate: text("order_date"),
  total: doublePrecision("total").default(0),
  createdAt: createdAt(),
});

export const poLines = pgTable("po_lines", {
  id: serial("id").primaryKey(),
  poId: integer("po_id"),
  skuId: integer("sku_id"),
  qty: doublePrecision("qty"),
  receivedQty: doublePrecision("received_qty").default(0),
  price: doublePrecision("price"),
});

export const salesOrders = pgTable("sales_orders", {
  id: serial("id").primaryKey(),
  soNo: text("so_no").unique(),
  customerId: integer("customer_id"),
  status: text("status").default("draft"),
  orderDate: text("order_date"),
  invoiceNo: text("invoice_no"),
  total: doublePrecision("total").default(0),
  // Header-level fields matching the legacy Delivery Order / Sale Bill
  // screens — Bill Type, the two GST-slab discount percentages (Disc 18 /
  // Disc 28), and free-text remarks.
  billType: text("bill_type").default(""),
  discPct18: doublePrecision("disc_pct_18").default(0),
  discPct28: doublePrecision("disc_pct_28").default(0),
  remarks: text("remarks").default(""),
  createdAt: createdAt(),
});

export const soLines = pgTable("so_lines", {
  id: serial("id").primaryKey(),
  soId: integer("so_id"),
  skuId: integer("sku_id"),
  qty: doublePrecision("qty"),
  pickedQty: doublePrecision("picked_qty").default(0),
  packedQty: doublePrecision("packed_qty").default(0),
  dispatchedQty: doublePrecision("dispatched_qty").default(0),
  // How much of the dispatched qty has already been pulled onto an invoice.
  // Billable now = dispatchedQty - invoicedQty; pending to dispatch = qty -
  // dispatchedQty (stays as a pending SO line in the booking menu).
  invoicedQty: doublePrecision("invoiced_qty").default(0),
  price: doublePrecision("price"),
  // MRP at the time of ordering (kept separate from price/net rate so later
  // master-price changes don't rewrite history), the rate type the line was
  // priced under (e.g. "MRP"), and free-of-cost / promotional qty — all
  // visible on the legacy Delivery Order line grid.
  mrp: doublePrecision("mrp").default(0),
  discountPct: doublePrecision("discount_pct").default(0),
  rateType: text("rate_type").default("MRP"),
  focQty: doublePrecision("foc_qty").default(0),
});

// A "case" (carton/box) that items get packed into for dispatch. package_no holds
// the human case number entered on the packing screen (unique per sales order).
export const packages = pgTable(
  "packages",
  {
    id: serial("id").primaryKey(),
    soId: integer("so_id"),
    packageNo: text("package_no"),
    status: text("status").default("open"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => ({ bySo: index("pkg_so_idx").on(t.soId), uniqCase: uniqueIndex("pkg_so_case_uniq").on(t.soId, t.packageNo) }),
);

// One row per (case, item, qty) — what physically went into a case during packing.
export const packageLines = pgTable(
  "package_lines",
  {
    id: serial("id").primaryKey(),
    packageId: integer("package_id").notNull(),
    soId: integer("so_id").notNull(),
    soLineId: integer("so_line_id").notNull(),
    skuId: integer("sku_id").notNull(),
    qty: doublePrecision("qty").default(0),
    packedBy: text("packed_by"),
    createdAt: createdAt(),
  },
  (t) => ({ byPkg: index("pkgline_pkg_idx").on(t.packageId), bySo: index("pkgline_so_idx").on(t.soId) }),
);

export const scanEvents = pgTable(
  "scan_events",
  {
    id: serial("id").primaryKey(),
    qrToken: text("qr_token"),
    skuId: integer("sku_id"),
    userId: integer("user_id"),
    userName: text("user_name"),
    action: text("action"),
    qty: doublePrecision("qty").default(0),
    warehouseId: integer("warehouse_id"),
    binId: integer("bin_id"),
    refDoc: text("ref_doc"),
    device: text("device"),
    status: text("status"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => ({ bySku: index("scan_sku_idx").on(t.skuId), byCreated: index("scan_created_idx").on(t.createdAt) }),
);

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  role: text("role"),
  type: text("type"),
  message: text("message"),
  read: boolean("read").default(false),
  createdAt: createdAt(),
});

// Shared packing slips (live across devices). The whole working doc — header +
// open case + completed cases — is stored as JSON; updatedAt drives live sync.
export const packingSlips = pgTable("packing_slips", {
  id: serial("id").primaryKey(),
  slipNo: text("slip_no").unique().notNull(),
  soNo: text("so_no"),
  party: text("party"),
  data: jsonb("data").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: text("updated_at").notNull(),
  createdAt: createdAt(),
});

// GST tax invoice. Created as a draft from dispatched-but-uninvoiced qty, then
// finalized (assigns invoiceNo + advances so_lines.invoiced_qty). IRN/QR/EWB
// columns are reserved for the later e-invoice / e-way-bill integration.
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNo: text("invoice_no").unique(),
  status: text("status").default("draft"), // draft | final | cancelled
  soId: integer("so_id"),
  packingSlipId: integer("packing_slip_id"),
  customerId: integer("customer_id"),
  // Snapshot of parties at invoice time (so later master edits don't rewrite history).
  sellerStateCode: text("seller_state_code").default(""),
  buyerName: text("buyer_name").default(""),
  buyerGstin: text("buyer_gstin").default(""),
  buyerStateCode: text("buyer_state_code").default(""),
  posStateCode: text("pos_state_code").default(""),
  taxType: text("tax_type").default("IGST"), // IGST | CGST_SGST
  invoiceDate: text("invoice_date"),
  discountClassId: integer("discount_class_id"),
  // Money totals (all in ₹).
  mrpTotal: doublePrecision("mrp_total").default(0),
  discountTotal: doublePrecision("discount_total").default(0),
  taxableTotal: doublePrecision("taxable_total").default(0),
  igst: doublePrecision("igst").default(0),
  cgst: doublePrecision("cgst").default(0),
  sgst: doublePrecision("sgst").default(0),
  roundOff: doublePrecision("round_off").default(0),
  grandTotal: doublePrecision("grand_total").default(0),
  // Transport (captured now, used by e-way bill later).
  transporter: text("transporter").default(""),
  transporterId: text("transporter_id").default(""),
  vehicleNo: text("vehicle_no").default(""),
  lrNo: text("lr_no").default(""),
  lrDate: text("lr_date").default(""),
  distanceKm: integer("distance_km"),
  notes: text("notes").default(""),
  // e-invoice / e-way bill (filled later by the IRP/GSP integration).
  irn: text("irn").default(""),
  ackNo: text("ack_no").default(""),
  ackDate: text("ack_date").default(""),
  qrPayload: text("qr_payload").default(""),
  ewbNo: text("ewb_no").default(""),
  createdBy: text("created_by"),
  createdAt: createdAt(),
});

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id").notNull(),
    soLineId: integer("so_line_id"),
    skuId: integer("sku_id"),
    skuCode: text("sku_code"),
    description: text("description"),
    hsn: text("hsn").default(""),
    unit: text("unit").default("PCS"),
    caseNo: text("case_no").default(""),
    qty: doublePrecision("qty").default(0),
    mrp: doublePrecision("mrp").default(0),
    discountPct: doublePrecision("discount_pct").default(0),
    taxableValue: doublePrecision("taxable_value").default(0),
    gstRate: doublePrecision("gst_rate").default(18),
    igst: doublePrecision("igst").default(0),
    cgst: doublePrecision("cgst").default(0),
    sgst: doublePrecision("sgst").default(0),
    lineTotal: doublePrecision("line_total").default(0),
  },
  (t) => ({ byInvoice: index("invline_inv_idx").on(t.invoiceId) }),
);

// Org-wide activity / audit feed. Every meaningful write appends one row, and the
// live-sync fingerprint watches MAX(id) here so any action — by anyone, in any
// module — pushes to every signed-in device. Also serves as a who-did-what audit.
export const activityLog = pgTable(
  "activity_log",
  {
    id: serial("id").primaryKey(),
    actor: text("actor"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    summary: text("summary"),
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (t) => ({ byId: index("activity_id_idx").on(t.id) }),
);
