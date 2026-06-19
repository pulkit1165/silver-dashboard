import { pgTable, serial, text, integer, doublePrecision, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
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
  price: doublePrecision("price").default(0),
  minStock: doublePrecision("min_stock").default(0),
  reorderLevel: doublePrecision("reorder_level").default(0),
  batchTracked: boolean("batch_tracked").default(false),
  serialTracked: boolean("serial_tracked").default(false),
  status: text("status").default("active"),
  qrToken: text("qr_token").unique().notNull(),
  createdAt: createdAt(),
});

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
  creditLimit: doublePrecision("credit_limit").default(0),
  paymentTerms: text("payment_terms"),
  createdAt: createdAt(),
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
  price: doublePrecision("price"),
});

export const packages = pgTable("packages", {
  id: serial("id").primaryKey(),
  soId: integer("so_id"),
  packageNo: text("package_no"),
  status: text("status").default("open"),
  createdAt: createdAt(),
});

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
