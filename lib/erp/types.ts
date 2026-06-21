export interface Sku {
  id: number;
  sku_code: string;
  name: string;
  category: string;
  brand: string;
  unit: string;
  price: number;
  min_stock: number;
  reorder_level: number;
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
}
export interface SoLine {
  id: number; so_id: number; sku_id: number; qty: number;
  picked_qty: number; packed_qty: number; dispatched_qty: number; price: number;
  sku_code?: string; sku_name?: string; qr_token?: string;
}

export interface Vendor {
  id: number; code: string; name: string; gst: string; contact: string; email: string;
  phone: string; category: string; payment_terms: string; rating: number; status: string;
}
export interface Customer {
  id: number; code: string; name: string; gst: string; email: string; phone: string;
  billing: string; shipping: string; credit_limit: number; payment_terms: string;
}
export interface PurchaseOrder {
  id: number; po_no: string; vendor_id: number; status: string; order_date: string;
  total: number; vendor_name?: string;
}

export const SCAN_ACTIONS = [
  "lookup", "inward", "outward", "transfer", "count", "pick", "pack", "dispatch", "damage", "verify",
  "pack_case",
] as const;
export type ScanAction = (typeof SCAN_ACTIONS)[number];

// A line on the dispatch/packing screen: what's ordered vs already packed into cases.
export interface PackingLine {
  so_line_id: number; sku_id: number; sku_code: string; sku_name: string; qr_token: string;
  ordered: number; packed: number; remaining: number; on_hand: number;
}
// Contents of one case for a sales order.
export interface PackingCaseItem { sku_code: string; sku_name: string; qty: number }
export interface PackingCase { package_id: number; case_no: string; status: string; items: PackingCaseItem[]; total_qty: number }
export interface OrderPacking {
  id: number; so_no: string; customer_name: string; status: string;
  lines: PackingLine[]; cases: PackingCase[];
}
