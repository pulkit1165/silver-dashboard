export interface Sku {
  id: number;
  sku_code: string;
  name: string;
  category: string;
  brand: string;
  unit: string;
  price: number;
  purchase_price: number;
  selling_price: number;
  hsn: string;
  gst_rate: number;
  min_stock: number;
  reorder_level: number;
  master_qty: number;
  single_qty: number;
  barcode_code: string;
  batch_tracked: boolean;
  serial_tracked: boolean;
  status: string;
  qr_token: string;
}

export interface Warehouse { id: number; code: string; name: string; address: string; active: number }
export interface Bin { id: number; warehouse_id: number; code: string; rack: string; shelf: string; bin: string }

export interface InventoryRow {
  id: number; sku_id: number; warehouse_id: number; bin_id: number; batch: string; qty: number;
  warehouse_code?: string; bin_code?: string;
}

export type StockStatus = "out" | "low" | "reorder" | "ok";

export interface ScanEvent {
  id: number; qr_token: string; sku_id: number; user_id: number; user_name: string;
  action: string; qty: number; warehouse_id: number | null; bin_id: number | null;
  ref_doc: string | null; device: string | null; status: string; error: string | null;
  created_at: string; sku_code?: string; sku_name?: string;
}

export interface SalesOrder {
  id: number; so_no: string; customer_id: number; status: string; order_date: string;
  invoice_no: string | null; total: number; customer_name?: string;
  bill_type: string; disc_pct: number; remarks: string;
}
export interface SoLine {
  id: number; so_id: number; sku_id: number; qty: number;
  picked_qty: number; packed_qty: number; dispatched_qty: number; price: number;
  mrp: number; discount_pct: number; rate_type: string; foc_qty: number;
  // Qty formally written off as unfulfillable (legacy Cancellation slip).
  cancelled_qty: number;
  sku_code?: string; sku_name?: string; qr_token?: string;
  // Reference fields joined in for display only (not stored on so_lines) —
  // mirrors the legacy Sale Order line grid's GST Rate / Std Pack / Bal Qty.
  gst_rate?: number; std_pack?: number; bal_qty?: number;
}

export interface Vendor {
  id: number; code: string; name: string; gst: string; contact: string; email: string;
  phone: string; category: string; payment_terms: string; rating: number; status: string;
}
export interface Customer {
  id: number; code: string; name: string; gst: string; email: string; phone: string;
  billing: string; shipping: string; credit_limit: number; payment_terms: string;
  discount_pct: number | null; discount_class_id: number | null;
}
export interface PurchaseOrder {
  id: number; po_no: string; vendor_id: number; status: string; order_date: string;
  total: number; vendor_name?: string;
}
export interface PoLine {
  id: number; po_id: number; sku_id: number; qty: number; received_qty: number; price: number;
  sku_code?: string; sku_name?: string; remaining: number;
}
export interface PurchaseOrderDoc extends PurchaseOrder {
  lines: PoLine[];
}

// Purchase-side mirror of PackingCase/DeliveryOrderDoc.
export interface GoodsReceiptListRow {
  grn_id: number; grn_no: string; status: string; created_at: string;
  po_id: number; po_no: string; vendor_name: string; lines: number; total_qty: number;
}
export interface GoodsReceiptLine {
  grn_line_id: number; sku_code: string; sku_name: string; po_qty: number; received_qty: number; price: number;
}
export interface GoodsReceiptDoc {
  grn_id: number; grn_no: string; status: string; created_at: string;
  po_id: number; po_no: string; vendor_name: string;
  lines: GoodsReceiptLine[];
}

export interface VendorBillableRow {
  po_id: number; po_no: string; vendor_name: string; order_date: string; status: string;
  lines: number; received_qty: number; billed_qty: number; billable_qty: number;
}
export interface VendorBillRow {
  id: number; bill_no: string; bill_date: string | null; status: string; total: number;
  po_no?: string; vendor_name?: string;
}

export const SCAN_ACTIONS = [
  "lookup", "inward", "outward", "transfer", "count", "pick", "pack", "dispatch", "damage", "verify",
  "pack_case",
] as const;
export type ScanAction = (typeof SCAN_ACTIONS)[number];

// A line on the dispatch/packing screen: what's ordered vs already packed into cases.
export interface PackingLine {
  so_line_id: number; sku_id: number; sku_code: string; sku_name: string; qr_token: string;
  master_qty: number; single_qty: number; barcode_code: string; qr_token_master: string | null;
  ordered: number; packed: number; cancelled: number; remaining: number; on_hand: number;
}
// Contents of one case for a sales order.
export interface PackingCaseItem { sku_code: string; sku_name: string; qty: number }
export interface PackingCase { package_id: number; case_no: string; status: string; items: PackingCaseItem[]; total_qty: number }
export interface OrderPacking {
  id: number; so_no: string; customer_name: string; status: string;
  lines: PackingLine[]; cases: PackingCase[];
}

// The full legacy-style Delivery Order document for one case/package —
// every field visible on the client's printed DO slip.
export interface DeliveryOrderLine {
  package_line_id: number;
  sku_code: string; sku_name: string;
  order_qty: number; // originally ordered (so_lines.qty)
  do_qty: number; // actually packed/shipped into this case (package_lines.qty — "Bal FG")
  mrp: number; net_rate: number; rate_type: string; discount_pct: number; foc_qty: number;
  net_wt: number; pack_wt: number; bal_rm: number;
}
export interface DeliveryOrderDoc {
  package_id: number; package_no: string; status: string; created_at: string;
  tr_type: string; do_type: string; slip_no: string;
  so_id: number; so_no: string; customer_name: string;
  lines: DeliveryOrderLine[];
}
