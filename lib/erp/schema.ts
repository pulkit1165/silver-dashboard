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
  singleQty: doublePrecision("single_qty").default(1), // smallest sellable/labelable unit — not always 1 (Oracle STDPACK2)
  barcodeCode: text("barcode_code").default(""), // base code for printed/scanned barcodes (base + "-S"/"-M"); falls back to sku_code
  itemNetRate: doublePrecision("item_net_rate").default(0), // live mirror of item_net_rates (0 = none); overrides party disc% in the SO waterfall
  focPct: doublePrecision("foc_pct").default(0), // live mirror of foc_rates (0 = none); applied last in the SO waterfall
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
    tier: text("tier").default("single"), // single | master — which pack size this QR identifies
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
  // optional whole-order override (takes precedence over the class default),
  // and is also this party's standing discount % off MRP for Sales Orders.
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

// Purchase-side mirror of packages/package_lines: a goods receipt (GRN) is
// what physically came in against a PO, status 'received' -> 'verified' —
// only verified qty is vendor-billable (see lib/erp/vendor-bills.ts).
export const goodsReceipts = pgTable("goods_receipts", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").notNull(),
  grnNo: text("grn_no"),
  status: text("status").default("received"), // received | verified
  createdBy: text("created_by"),
  createdAt: createdAt(),
});

export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id: serial("id").primaryKey(),
  grnId: integer("grn_id").notNull(),
  poLineId: integer("po_line_id").notNull(),
  skuId: integer("sku_id").notNull(),
  qty: doublePrecision("qty").default(0),
  createdAt: createdAt(),
});

// Vendor bill — mirrors invoices/invoice_lines but deliberately simpler (no
// GST/ITC split). billNo is the VENDOR's own invoice number, not ours.
export const vendorBills = pgTable("vendor_bills", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").notNull(),
  vendorId: integer("vendor_id").notNull(),
  billNo: text("bill_no").default(""),
  billDate: text("bill_date"),
  status: text("status").default("draft"),
  total: doublePrecision("total").default(0),
  createdBy: text("created_by"),
  createdAt: createdAt(),
});

export const vendorBillLines = pgTable("vendor_bill_lines", {
  id: serial("id").primaryKey(),
  billId: integer("bill_id").notNull(),
  poLineId: integer("po_line_id").notNull(),
  skuId: integer("sku_id").notNull(),
  qty: doublePrecision("qty").default(0),
  rate: doublePrecision("rate").default(0),
  amount: doublePrecision("amount").default(0),
});

export const salesOrders = pgTable("sales_orders", {
  id: serial("id").primaryKey(),
  soNo: text("so_no").unique(),
  customerId: integer("customer_id"),
  status: text("status").default("draft"),
  orderDate: text("order_date"),
  invoiceNo: text("invoice_no"),
  total: doublePrecision("total").default(0),
  // Header-level fields matching the legacy Sale Order screen. billType is
  // K | O | O/K. discPct is the party's locked standing discount % off MRP,
  // auto-fetched from customers.discount_pct — applied to every line
  // regardless of GST slab (this business doesn't discount by slab).
  billType: text("bill_type").default(""),
  discPct: doublePrecision("disc_pct").default(0),
  remarks: text("remarks").default(""),
  // Who booked the order (users.id) and how it was captured (manual | decode |
  // import). Both are also created idempotently by ensureSalesOrderCols() in
  // lib/erp/queries.ts so production self-migrates without a db:push.
  salesmanId: integer("salesman_id"),
  source: text("source").default("manual"),
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
  // Qty formally written off as unfulfillable (legacy Cancellation slip,
  // DTC107) — excluded from both "pending to pack" and the billable balance.
  // Distinct from a full order cancellation: this is a per-line shortfall.
  cancelledQty: doublePrecision("cancelled_qty").default(0),
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
// tr_type/do_type/slip_no match the legacy Delivery Order header (TR Type,
// DO Type, PSlip No) — defaulted automatically, editable on the DO detail page.
export const packages = pgTable(
  "packages",
  {
    id: serial("id").primaryKey(),
    soId: integer("so_id"),
    packageNo: text("package_no"),
    status: text("status").default("open"),
    trType: text("tr_type").default(""),
    doType: text("do_type").default("PS"),
    slipNo: text("slip_no").default(""),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => ({ bySo: index("pkg_so_idx").on(t.soId), uniqCase: uniqueIndex("pkg_so_case_uniq").on(t.soId, t.packageNo) }),
);

// One row per (case, item, qty) — what physically went into a case during packing.
// net_wt/pack_wt/bal_rm are the physical attributes from the legacy Delivery
// Order line grid — measured at packing time, not derivable from anything else.
export const packageLines = pgTable(
  "package_lines",
  {
    id: serial("id").primaryKey(),
    packageId: integer("package_id").notNull(),
    soId: integer("so_id").notNull(),
    soLineId: integer("so_line_id").notNull(),
    skuId: integer("sku_id").notNull(),
    qty: doublePrecision("qty").default(0),
    netWt: doublePrecision("net_wt").default(0),
    packWt: doublePrecision("pack_wt").default(0),
    balRm: doublePrecision("bal_rm").default(0),
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

// WhatsApp identities. Maps a phone number to a staff user + role so inbound
// messages can be authenticated and answers scoped. Unknown numbers are ignored.
export const whatsappContacts = pgTable("whatsapp_contacts", {
  id: serial("id").primaryKey(),
  phone: text("phone").unique().notNull(), // E.164 digits, no '+', e.g. 9198xxxxxxx
  userId: integer("user_id"),
  name: text("name"),
  role: text("role").default("viewer"), // mirrors rbac Role; scopes what they can ask
  optIn: boolean("opt_in").default(true), // WhatsApp policy: user must consent
  active: boolean("active").default(true),
  createdAt: createdAt(),
});

// Audit + idempotency for every WhatsApp message in/out. waMessageId dedupes
// webhook retries (Meta re-delivers if we don't 200 fast enough).
export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: serial("id").primaryKey(),
    direction: text("direction").notNull(), // in | out
    waMessageId: text("wa_message_id"), // Meta's message id (inbound) — dedupe key
    phone: text("phone"), // the staff/customer number (from on inbound, to on outbound)
    contactId: integer("contact_id"),
    body: text("body"),
    status: text("status"), // received | answered | sent | failed | ignored
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => ({ byWaId: index("wa_msg_waid_idx").on(t.waMessageId), byCreated: index("wa_msg_created_idx").on(t.createdAt) }),
);

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

// Global per-SKU net rate (the "item-wise net rate" master). Append-only ledger
// like mrp_history: the SKU's LIVE net rate is the most-recent row (mirrored to
// skus.item_net_rate). A line where this exists ignores the party discount %.
export const itemNetRates = pgTable(
  "item_net_rates",
  {
    id: serial("id").primaryKey(),
    skuId: integer("sku_id").notNull(),
    skuCode: text("sku_code"),
    netRate: doublePrecision("net_rate").notNull(),
    effectiveAt: text("effective_at").default(sql`to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`),
    note: text("note").default(""),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => ({ bySku: index("inr_sku_idx").on(t.skuId) }),
);

// Per-SKU FOC discount % (the "FOC" master). Same recency ledger; applied LAST,
// after party discount and item net rate. Not yet loaded — reserved for the FOC
// file upload. Mirrored live to skus.foc_pct.
export const focRates = pgTable(
  "foc_rates",
  {
    id: serial("id").primaryKey(),
    skuId: integer("sku_id").notNull(),
    skuCode: text("sku_code"),
    focPct: doublePrecision("foc_pct").notNull(),
    effectiveAt: text("effective_at").default(sql`to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`),
    note: text("note").default(""),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => ({ bySku: index("foc_sku_idx").on(t.skuId) }),
);

// Party discount % history (the whole-order % off MRP per customer). The live
// value stays on customers.discount_pct; this ledger keeps every prior value so
// the master can show a "previous value" column and never loses history.
export const partyDiscHistory = pgTable(
  "party_disc_history",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id").notNull(),
    code: text("code"),
    discPct: doublePrecision("disc_pct").notNull(),
    effectiveAt: text("effective_at").default(sql`to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`),
    note: text("note").default(""),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => ({ byCustomer: index("pdh_cust_idx").on(t.customerId) }),
);

// Shared, live process checklist (the module-wise SOP). A stage is one step of the
// MRN → QC → FG → Sales → Billing → Procurement loop; tasks are its sub-steps.
// Everyone (incl. the client) edits the SAME rows — updated_at feeds the live
// fingerprint so ticks/edits push to every device without spamming the audit feed.
export const checklistStages = pgTable("checklist_stages", {
  id: serial("id").primaryKey(),
  seq: integer("seq").notNull().default(0), // display order = stage number
  title: text("title").notNull(),
  owner: text("owner").default(""),
  tint: text("tint").default("blue"), // colour key: blue|amber|teal|red|violet|green
  description: text("description").default(""),
  createdAt: createdAt(),
  updatedAt: text("updated_at").default(sql`to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.MS')`),
});

export const checklistTasks = pgTable(
  "checklist_tasks",
  {
    id: serial("id").primaryKey(),
    stageId: integer("stage_id").notNull(),
    seq: integer("seq").notNull().default(0),
    label: text("label").notNull(),
    done: boolean("done").default(false),
    doneBy: text("done_by"), // who last ticked it (per-task audit, kept off the global feed)
    doneAt: text("done_at"),
    createdAt: createdAt(),
    updatedAt: text("updated_at").default(sql`to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.MS')`),
  },
  (t) => ({ byStage: index("checklist_task_stage_idx").on(t.stageId) }),
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
