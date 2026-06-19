import "server-only";
import { getSql } from "./db";
import type {
  Sku, Warehouse, Bin, InventoryRow, StockStatus, ScanEvent,
  SalesOrder, SoLine, Vendor, Customer, PurchaseOrder,
} from "./types";

export function stockStatus(sku: { min_stock: number; reorder_level: number }, qty: number): StockStatus {
  if (qty <= 0) return "out";
  if (qty <= sku.min_stock) return "low";
  if (qty <= sku.reorder_level) return "reorder";
  return "ok";
}

export async function getSkus(search?: string): Promise<Sku[]> {
  const sql = getSql();
  if (search) {
    const q = `%${search}%`;
    return (await sql`SELECT * FROM skus WHERE sku_code ILIKE ${q} OR name ILIKE ${q} OR category ILIKE ${q} ORDER BY sku_code`) as unknown as Sku[];
  }
  return (await sql`SELECT * FROM skus ORDER BY sku_code`) as unknown as Sku[];
}

export async function getSku(id: number): Promise<Sku | undefined> {
  const [row] = await getSql()`SELECT * FROM skus WHERE id=${id}`;
  return row as Sku | undefined;
}

export type TokenState = "active" | "disabled" | "replaced" | "unknown";
/** Resolve a scanned token via qr_codes so disabled/replaced codes are rejected. */
export async function resolveQrToken(token: string): Promise<{ state: TokenState; sku?: Sku }> {
  const sql = getSql();
  const [qr] = await sql`SELECT * FROM qr_codes WHERE token=${token}`;
  if (!qr) return { state: "unknown" };
  const status = (qr as { status: string }).status;
  if (status !== "active") return { state: status === "replaced" ? "replaced" : "disabled" };
  const [sku] = await sql`SELECT * FROM skus WHERE id=${(qr as { sku_id: number }).sku_id}`;
  return sku ? { state: "active", sku: sku as Sku } : { state: "unknown" };
}

export async function getSkuByToken(token: string): Promise<Sku | undefined> {
  const r = await resolveQrToken(token);
  return r.state === "active" ? r.sku : undefined;
}

export async function totalQty(skuId: number): Promise<number> {
  const [r] = await getSql()`SELECT COALESCE(SUM(qty),0)::float8 AS q FROM inventory WHERE sku_id=${skuId}`;
  return (r as { q: number }).q;
}

export async function inventoryForSku(skuId: number): Promise<InventoryRow[]> {
  return (await getSql()`
    SELECT i.*, w.code AS warehouse_code, b.code AS bin_code
    FROM inventory i
    JOIN warehouses w ON w.id=i.warehouse_id
    LEFT JOIN bins b ON b.id=i.bin_id
    WHERE i.sku_id=${skuId} AND i.qty <> 0
    ORDER BY w.code, b.code`) as unknown as InventoryRow[];
}

export type SkuLevel = Sku & { qty: number; status: StockStatus };
export async function stockLevels(): Promise<SkuLevel[]> {
  const rows = (await getSql()`
    SELECT s.*, COALESCE(SUM(i.qty),0)::float8 AS qty
    FROM skus s LEFT JOIN inventory i ON i.sku_id=s.id
    GROUP BY s.id ORDER BY s.sku_code`) as unknown as Array<Sku & { qty: number }>;
  return rows.map((s) => ({ ...s, status: stockStatus(s, s.qty) }));
}

export async function getWarehouses(): Promise<Warehouse[]> {
  return (await getSql()`SELECT * FROM warehouses ORDER BY code`) as unknown as Warehouse[];
}
export async function getBins(warehouseId?: number): Promise<Bin[]> {
  const sql = getSql();
  return (warehouseId
    ? await sql`SELECT * FROM bins WHERE warehouse_id=${warehouseId} ORDER BY code`
    : await sql`SELECT * FROM bins ORDER BY warehouse_id, code`) as unknown as Bin[];
}

export async function getSalesOrders(): Promise<SalesOrder[]> {
  return (await getSql()`
    SELECT so.*, c.name AS customer_name FROM sales_orders so
    JOIN customers c ON c.id=so.customer_id ORDER BY so.id DESC`) as unknown as SalesOrder[];
}
export async function getSalesOrder(id: number): Promise<(SalesOrder & { lines: SoLine[] }) | undefined> {
  const sql = getSql();
  const [so] = (await sql`
    SELECT so.*, c.name AS customer_name FROM sales_orders so
    JOIN customers c ON c.id=so.customer_id WHERE so.id=${id}`) as unknown as SalesOrder[];
  if (!so) return undefined;
  const lines = (await sql`
    SELECT l.*, s.sku_code, s.name AS sku_name, s.qr_token FROM so_lines l
    JOIN skus s ON s.id=l.sku_id WHERE l.so_id=${id} ORDER BY l.id`) as unknown as SoLine[];
  return { ...so, lines };
}
export async function getSalesOrderByNo(soNo: string) {
  const [r] = await getSql()`SELECT id FROM sales_orders WHERE so_no=${soNo}`;
  return r ? getSalesOrder((r as { id: number }).id) : undefined;
}

export async function getVendors(): Promise<Vendor[]> {
  return (await getSql()`SELECT * FROM vendors ORDER BY code`) as unknown as Vendor[];
}
export async function getCustomers(): Promise<Customer[]> {
  return (await getSql()`SELECT * FROM customers ORDER BY code`) as unknown as Customer[];
}
export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  return (await getSql()`
    SELECT po.*, v.name AS vendor_name FROM purchase_orders po
    JOIN vendors v ON v.id=po.vendor_id ORDER BY po.id DESC`) as unknown as PurchaseOrder[];
}

export interface ScanFilter {
  skuId?: number; userId?: number; warehouseId?: number; action?: string;
  refDoc?: string; from?: string; to?: string; limit?: number;
}
export async function getScans(f: ScanFilter = {}): Promise<ScanEvent[]> {
  const sql = getSql();
  const conds = [];
  if (f.skuId) conds.push(sql`e.sku_id=${f.skuId}`);
  if (f.userId) conds.push(sql`e.user_id=${f.userId}`);
  if (f.warehouseId) conds.push(sql`e.warehouse_id=${f.warehouseId}`);
  if (f.action) conds.push(sql`e.action=${f.action}`);
  if (f.refDoc) conds.push(sql`e.ref_doc=${f.refDoc}`);
  if (f.from) conds.push(sql`e.created_at >= ${f.from}`);
  if (f.to) conds.push(sql`e.created_at <= ${f.to + " 23:59:59"}`);
  const where = conds.length ? conds.reduce((a, c) => sql`${a} AND ${c}`) : null;
  return (await sql`
    SELECT e.*, s.sku_code, s.name AS sku_name
    FROM scan_events e LEFT JOIN skus s ON s.id=e.sku_id
    ${where ? sql`WHERE ${where}` : sql``}
    ORDER BY e.id DESC LIMIT ${f.limit ?? 200}`) as unknown as ScanEvent[];
}

export interface QrRow {
  sku_id: number; sku_code: string; name: string; category: string; token: string;
  qr_status: string | null; printed: boolean; qty: number; scanned: boolean;
}
export async function qrManagementList(): Promise<QrRow[]> {
  return (await getSql()`
    SELECT s.id AS sku_id, s.sku_code, s.name, s.category, s.qr_token AS token,
      q.status AS qr_status, COALESCE(q.printed,false) AS printed,
      COALESCE(inv.qty,0)::float8 AS qty,
      EXISTS(SELECT 1 FROM scan_events e WHERE e.sku_id=s.id AND e.status='success') AS scanned
    FROM skus s
    LEFT JOIN qr_codes q ON q.token=s.qr_token
    LEFT JOIN (SELECT sku_id, SUM(qty) qty FROM inventory GROUP BY sku_id) inv ON inv.sku_id=s.id
    ORDER BY s.sku_code`) as unknown as QrRow[];
}

export async function getNotifications(role: string) {
  return (await getSql()`
    SELECT * FROM notifications WHERE role=${role} OR role='all' ORDER BY id DESC LIMIT 20`) as unknown as Array<{
    id: number; role: string; type: string; message: string; read: boolean; created_at: string;
  }>;
}

export async function financeSummary() {
  const sql = getSql();
  const [r] = await sql`
    SELECT
      (SELECT COALESCE(SUM(l.qty*l.price),0)::float8 FROM so_lines l JOIN sales_orders so ON so.id=l.so_id WHERE so.status <> 'cancelled') AS receivables,
      (SELECT COALESCE(SUM(dispatched_qty*price),0)::float8 FROM so_lines) AS dispatched,
      (SELECT COALESCE(SUM(l.qty*l.price),0)::float8 FROM po_lines l JOIN purchase_orders po ON po.id=l.po_id WHERE po.status <> 'cancelled') AS payables,
      (SELECT COALESCE(SUM(i.qty*s.price),0)::float8 FROM inventory i JOIN skus s ON s.id=i.sku_id) AS stock_value`;
  return r as { receivables: number; dispatched: number; payables: number; stock_value: number };
}

export async function skuMovement(limit = 50) {
  return (await getSql()`
    SELECT s.sku_code, s.name,
      COALESCE(SUM(CASE WHEN m.type IN ('in','transfer-in','opening') THEN m.qty ELSE 0 END),0)::float8 AS inward,
      COALESCE(SUM(CASE WHEN m.type IN ('out','dispatch','damage','transfer-out') THEN m.qty ELSE 0 END),0)::float8 AS outward,
      COUNT(*)::int AS moves
    FROM stock_moves m JOIN skus s ON s.id=m.sku_id
    GROUP BY m.sku_id, s.sku_code, s.name ORDER BY moves DESC LIMIT ${limit}`) as unknown as Array<{
    sku_code: string; name: string; inward: number; outward: number; moves: number;
  }>;
}

export async function erpStats() {
  const sql = getSql();
  const c = async (q: ReturnType<typeof sql>) => ((await q) as unknown as Array<{ c: number }>)[0].c;
  const levels = await stockLevels();
  const lowStockItems = levels.filter((s) => s.status === "low" || s.status === "out");
  return {
    skus: await c(sql`SELECT COUNT(*)::int AS c FROM skus`),
    stockUnits: levels.reduce((a, s) => a + s.qty, 0),
    lowStock: lowStockItems.length,
    warehouses: await c(sql`SELECT COUNT(*)::int AS c FROM warehouses`),
    openSales: await c(sql`SELECT COUNT(*)::int AS c FROM sales_orders WHERE status IN ('confirmed','picked','packed','draft')`),
    openPurchases: await c(sql`SELECT COUNT(*)::int AS c FROM purchase_orders WHERE status IN ('draft','approved','sent','partially received')`),
    vendors: await c(sql`SELECT COUNT(*)::int AS c FROM vendors`),
    customers: await c(sql`SELECT COUNT(*)::int AS c FROM customers`),
    scansToday: await c(sql`SELECT COUNT(*)::int AS c FROM scan_events WHERE created_at >= to_char(current_date,'YYYY-MM-DD')`),
    scansTotal: await c(sql`SELECT COUNT(*)::int AS c FROM scan_events`),
    pendingDispatch: await c(sql`SELECT COUNT(*)::int AS c FROM sales_orders WHERE status IN ('confirmed','picked','packed')`),
    lowStockItems,
  };
}
