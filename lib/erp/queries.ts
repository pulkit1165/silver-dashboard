import "server-only";
import { getSql } from "./db";
import type {
  Sku, Warehouse, Bin, InventoryRow, StockStatus, ScanEvent,
  SalesOrder, SoLine, Vendor, Customer, PurchaseOrder,
  OrderPacking, PackingLine, PackingCase, DeliveryOrderDoc, DeliveryOrderLine,
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
export async function stockLevels(search?: string): Promise<SkuLevel[]> {
  const sql = getSql();
  const q = search?.trim() ? `%${search.trim()}%` : null;
  const rows = (await sql`
    SELECT s.*, COALESCE(SUM(i.qty),0)::float8 AS qty
    FROM skus s LEFT JOIN inventory i ON i.sku_id=s.id
    WHERE (${q}::text IS NULL OR s.sku_code ILIKE ${q} OR s.name ILIKE ${q} OR s.category ILIKE ${q})
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

export interface SoFilter { party?: string; from?: string; to?: string; status?: string }
export async function getSalesOrders(f: SoFilter = {}): Promise<SalesOrder[]> {
  const sql = getSql();
  const party = f.party?.trim() ? `%${f.party.trim()}%` : null;
  return (await sql`
    SELECT so.*, c.name AS customer_name FROM sales_orders so
    JOIN customers c ON c.id=so.customer_id
    WHERE (${party}::text IS NULL OR c.name ILIKE ${party})
      AND (${f.from ?? null}::text IS NULL OR so.order_date >= ${f.from ?? null})
      AND (${f.to ?? null}::text IS NULL OR so.order_date <= ${f.to ?? null})
      AND (${f.status ?? null}::text IS NULL OR so.status = ${f.status ?? null})
    ORDER BY so.id DESC`) as unknown as SalesOrder[];
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

export async function createSalesOrder(input: {
  customerId: number;
  orderDate: string;
  billType?: string;
  discPct18?: number;
  discPct28?: number;
  remarks?: string;
  lines: Array<{
    skuId: number; qty: number; price: number;
    mrp?: number; discountPct?: number; rateType?: string; focQty?: number;
  }>;
}): Promise<SalesOrder & { lines: SoLine[] }> {
  const sql = getSql();
  const [{ next }] = await sql`
    SELECT COALESCE(MAX(CAST(SUBSTRING(so_no FROM 4) AS INT)), 1000) + 1 AS next
      FROM sales_orders WHERE so_no LIKE 'SO-%'`;
  const soNo = `SO-${next}`;
  const total = input.lines.reduce((s, l) => s + l.qty * l.price, 0);
  const [so] = await sql`
    INSERT INTO sales_orders (so_no, customer_id, status, order_date, total, bill_type, disc_pct_18, disc_pct_28, remarks)
    VALUES (${soNo}, ${input.customerId}, 'draft', ${input.orderDate}, ${total},
      ${input.billType ?? ""}, ${input.discPct18 ?? 0}, ${input.discPct28 ?? 0}, ${input.remarks ?? ""})
    RETURNING id`;
  for (const l of input.lines) {
    await sql`INSERT INTO so_lines (so_id, sku_id, qty, price, mrp, discount_pct, rate_type, foc_qty)
      VALUES (${so.id}, ${l.skuId}, ${l.qty}, ${l.price}, ${l.mrp ?? l.price}, ${l.discountPct ?? 0},
        ${l.rateType ?? "MRP"}, ${l.focQty ?? 0})`;
  }
  return (await getSalesOrder(so.id as number))!;
}

// Hands a draft order to the warehouse — only after this does it show up in
// the packing queue / dispatch screen.
export async function confirmSalesOrder(id: number): Promise<{ ok: true } | { error: string }> {
  const sql = getSql();
  const [so] = (await sql`SELECT status FROM sales_orders WHERE id=${id}`) as unknown as Array<{ status: string }>;
  if (!so) return { error: "Sales order not found." };
  if (so.status !== "draft") return { error: `Order is already ${so.status} — nothing to confirm.` };
  await sql`UPDATE sales_orders SET status='confirmed' WHERE id=${id}`;
  return { ok: true };
}

// Orders that can still be packed/dispatched (drives the packing-screen dropdown).
const PACKABLE = ["confirmed", "picked", "packed", "partially dispatched"];
export async function getPackableOrders(): Promise<SalesOrder[]> {
  const sql = getSql();
  return (await sql`
    SELECT so.*, c.name AS customer_name FROM sales_orders so
    JOIN customers c ON c.id=so.customer_id
    WHERE so.status IN ${sql(PACKABLE)} ORDER BY so.id DESC`) as unknown as SalesOrder[];
}

export interface PendingPackRow {
  id: number; so_no: string; customer_name: string; order_date: string; status: string;
  lines: number; ordered_qty: number; packed_qty: number; pending_qty: number;
}
// Queue for the packing screen: confirmed orders that still have unpacked
// qty, oldest first (so the warehouse works through the backlog in order).
export async function getPendingToPack(): Promise<PendingPackRow[]> {
  const sql = getSql();
  return (await sql`
    SELECT so.id, so.so_no, c.name AS customer_name, so.order_date, so.status,
           COUNT(l.id)::int AS lines,
           COALESCE(SUM(l.qty),0)::float8 AS ordered_qty,
           COALESCE(SUM(l.packed_qty),0)::float8 AS packed_qty,
           COALESCE(SUM(l.qty - l.packed_qty),0)::float8 AS pending_qty
    FROM sales_orders so
    JOIN customers c ON c.id = so.customer_id
    JOIN so_lines l ON l.so_id = so.id
    WHERE so.status IN ${sql(PACKABLE)}
    GROUP BY so.id, c.name, so.order_date, so.status, so.so_no
    HAVING COALESCE(SUM(l.qty - l.packed_qty),0) > 0
    ORDER BY so.order_date, so.id`) as unknown as PendingPackRow[];
}

export interface PendingBillRow {
  id: number; so_no: string; customer_name: string; order_date: string; status: string;
  lines: number; dispatched_qty: number; invoiced_qty: number; billable_qty: number;
}
// Queue for the billing screen: orders with dispatched-but-uninvoiced qty —
// the legacy app's "pending Delivery Orders to be billed."
export async function getPendingToBill(): Promise<PendingBillRow[]> {
  const sql = getSql();
  return (await sql`
    SELECT so.id, so.so_no, c.name AS customer_name, so.order_date, so.status,
           COUNT(l.id)::int AS lines,
           COALESCE(SUM(l.dispatched_qty),0)::float8 AS dispatched_qty,
           COALESCE(SUM(l.invoiced_qty),0)::float8 AS invoiced_qty,
           COALESCE(SUM(GREATEST(l.dispatched_qty - l.invoiced_qty,0)),0)::float8 AS billable_qty
    FROM sales_orders so
    JOIN customers c ON c.id = so.customer_id
    JOIN so_lines l ON l.so_id = so.id
    WHERE so.status IN ('partially dispatched','dispatched')
    GROUP BY so.id, c.name, so.order_date, so.status, so.so_no
    HAVING COALESCE(SUM(GREATEST(l.dispatched_qty - l.invoiced_qty,0)),0) > 0
    ORDER BY so.order_date, so.id`) as unknown as PendingBillRow[];
}

// Full packing view for one order: per-line ordered/packed/remaining/on-hand + the cases.
export async function getOrderPacking(id: number): Promise<OrderPacking | undefined> {
  const sql = getSql();
  const [so] = (await sql`
    SELECT so.id, so.so_no, so.status, c.name AS customer_name FROM sales_orders so
    JOIN customers c ON c.id=so.customer_id WHERE so.id=${id}`) as unknown as
    Array<{ id: number; so_no: string; status: string; customer_name: string }>;
  if (!so) return undefined;

  const lines = (await sql`
    SELECT l.id AS so_line_id, l.sku_id, s.sku_code, s.name AS sku_name, s.qr_token,
           l.qty AS ordered, l.packed_qty AS packed,
           COALESCE((SELECT SUM(qty) FROM inventory WHERE sku_id=l.sku_id),0)::float8 AS on_hand
    FROM so_lines l JOIN skus s ON s.id=l.sku_id WHERE l.so_id=${id} ORDER BY l.id`) as unknown as
    Array<Omit<PackingLine, "remaining"> & { ordered: number; packed: number }>;
  const packingLines: PackingLine[] = lines.map((l) => ({ ...l, remaining: l.ordered - l.packed }));

  const caseRows = (await sql`
    SELECT p.id AS package_id, p.package_no AS case_no, p.status,
           s.sku_code, s.name AS sku_name, pl.qty
    FROM packages p
    JOIN package_lines pl ON pl.package_id=p.id
    JOIN skus s ON s.id=pl.sku_id
    WHERE p.so_id=${id} ORDER BY p.id, pl.id`) as unknown as
    Array<{ package_id: number; case_no: string; status: string; sku_code: string; sku_name: string; qty: number }>;
  const byCase = new Map<number, PackingCase & { _items: Map<string, { sku_code: string; sku_name: string; qty: number }> }>();
  for (const r of caseRows) {
    let c = byCase.get(r.package_id);
    if (!c) { c = { package_id: r.package_id, case_no: r.case_no, status: r.status, items: [], total_qty: 0, _items: new Map() }; byCase.set(r.package_id, c); }
    // merge repeat scans of the same item in one case into a single line
    const it = c._items.get(r.sku_code);
    if (it) it.qty += r.qty;
    else c._items.set(r.sku_code, { sku_code: r.sku_code, sku_name: r.sku_name, qty: r.qty });
    c.total_qty += r.qty;
  }
  const cases: PackingCase[] = [...byCase.values()].map((c) => ({
    package_id: c.package_id, case_no: c.case_no, status: c.status, total_qty: c.total_qty, items: [...c._items.values()],
  }));

  return { id: so.id, so_no: so.so_no, customer_name: so.customer_name, status: so.status, lines: packingLines, cases };
}

export interface DeliveryOrderListRow {
  package_id: number; package_no: string; status: string; created_at: string;
  tr_type: string; do_type: string; slip_no: string;
  so_id: number; so_no: string; customer_name: string; lines: number; total_qty: number;
}
export interface DoFilter { party?: string; from?: string; to?: string; status?: string }
// Every Delivery Order (packed case) — the list/queue this module was
// missing a dedicated entry point for.
export async function getDeliveryOrders(f: DoFilter = {}): Promise<DeliveryOrderListRow[]> {
  const sql = getSql();
  const party = f.party?.trim() ? `%${f.party.trim()}%` : null;
  return (await sql`
    SELECT p.id AS package_id, p.package_no, p.status, p.created_at, p.tr_type, p.do_type, p.slip_no,
           so.id AS so_id, so.so_no, c.name AS customer_name,
           COUNT(pl.id)::int AS lines, COALESCE(SUM(pl.qty),0)::float8 AS total_qty
    FROM packages p
    JOIN sales_orders so ON so.id = p.so_id
    JOIN customers c ON c.id = so.customer_id
    LEFT JOIN package_lines pl ON pl.package_id = p.id
    WHERE (${party}::text IS NULL OR c.name ILIKE ${party})
      AND (${f.from ?? null}::text IS NULL OR p.created_at >= ${f.from ?? null})
      AND (${f.to ?? null}::text IS NULL OR p.created_at <= ${f.to ?? null})
      AND (${f.status ?? null}::text IS NULL OR p.status = ${f.status ?? null})
    GROUP BY p.id, p.package_no, p.status, p.created_at, p.tr_type, p.do_type, p.slip_no, so.id, so.so_no, c.name
    ORDER BY p.id DESC`) as unknown as DeliveryOrderListRow[];
}

// The full legacy-style Delivery Order document for one case/package — every
// field from the client's printed DO slip in one place. so_lines is the
// source of truth for MRP/net rate/rate type/discount%/FOC qty (set once at
// order time); net_wt/pack_wt/bal_rm live on package_lines (measured at
// packing time, nothing else has them).
export async function getDeliveryOrder(packageId: number): Promise<DeliveryOrderDoc | undefined> {
  const sql = getSql();
  const [pkg] = (await sql`
    SELECT p.id AS package_id, p.package_no, p.status, p.created_at, p.tr_type, p.do_type, p.slip_no,
           p.so_id, so.so_no, c.name AS customer_name
    FROM packages p
    JOIN sales_orders so ON so.id = p.so_id
    JOIN customers c ON c.id = so.customer_id
    WHERE p.id = ${packageId}`) as unknown as Array<
    Omit<DeliveryOrderDoc, "lines">
  >;
  if (!pkg) return undefined;

  const lines = (await sql`
    SELECT pl.id AS package_line_id, s.sku_code, s.name AS sku_name,
           l.qty AS order_qty, pl.qty AS do_qty,
           l.mrp, l.price AS net_rate, l.rate_type, l.discount_pct, l.foc_qty,
           pl.net_wt, pl.pack_wt, pl.bal_rm
    FROM package_lines pl
    JOIN so_lines l ON l.id = pl.so_line_id
    JOIN skus s ON s.id = pl.sku_id
    WHERE pl.package_id = ${packageId}
    ORDER BY pl.id`) as unknown as DeliveryOrderLine[];

  return { ...pkg, lines };
}

export async function updateDeliveryOrderHeader(
  packageId: number,
  patch: { trType?: string; doType?: string; slipNo?: string },
): Promise<{ ok: true } | { error: string }> {
  const sql = getSql();
  const [pkg] = (await sql`SELECT id FROM packages WHERE id=${packageId}`) as unknown as Array<{ id: number }>;
  if (!pkg) return { error: "Delivery order not found." };
  await sql`
    UPDATE packages SET
      tr_type = COALESCE(${patch.trType ?? null}, tr_type),
      do_type = COALESCE(${patch.doType ?? null}, do_type),
      slip_no = COALESCE(${patch.slipNo ?? null}, slip_no)
    WHERE id = ${packageId}`;
  return { ok: true };
}

export async function updateDeliveryOrderLine(
  packageLineId: number,
  patch: { netWt?: number; packWt?: number; balRm?: number },
): Promise<{ ok: true } | { error: string }> {
  const sql = getSql();
  const [line] = (await sql`SELECT id FROM package_lines WHERE id=${packageLineId}`) as unknown as Array<{ id: number }>;
  if (!line) return { error: "Delivery order line not found." };
  await sql`
    UPDATE package_lines SET
      net_wt = COALESCE(${patch.netWt ?? null}, net_wt),
      pack_wt = COALESCE(${patch.packWt ?? null}, pack_wt),
      bal_rm = COALESCE(${patch.balRm ?? null}, bal_rm)
    WHERE id = ${packageLineId}`;
  return { ok: true };
}

// Flat rows for the Google-Sheet CSV mirror (one row per item packed into a case).
export async function getPackingExportRows() {
  return (await getSql()`
    SELECT pl.created_at, so.so_no, c.name AS customer, p.package_no AS case_no,
           s.sku_code, s.name AS item_name, pl.qty AS qty_packed, pl.packed_by, so.status AS order_status
    FROM package_lines pl
    JOIN packages p ON p.id=pl.package_id
    JOIN sales_orders so ON so.id=pl.so_id
    JOIN customers c ON c.id=so.customer_id
    JOIN skus s ON s.id=pl.sku_id
    ORDER BY pl.id DESC`) as unknown as Array<{
      created_at: string; so_no: string; customer: string; case_no: string;
      sku_code: string; item_name: string; qty_packed: number; packed_by: string; order_status: string;
    }>;
}

export async function getVendors(search?: string): Promise<Vendor[]> {
  const sql = getSql();
  if (search?.trim()) {
    const q = `%${search.trim()}%`;
    return (await sql`SELECT * FROM vendors WHERE name ILIKE ${q} OR code ILIKE ${q} OR gst ILIKE ${q} ORDER BY code`) as unknown as Vendor[];
  }
  return (await sql`SELECT * FROM vendors ORDER BY code`) as unknown as Vendor[];
}
export async function getCustomers(search?: string): Promise<Customer[]> {
  const sql = getSql();
  if (search?.trim()) {
    const q = `%${search.trim()}%`;
    return (await sql`SELECT * FROM customers WHERE name ILIKE ${q} OR code ILIKE ${q} OR gst ILIKE ${q} ORDER BY code`) as unknown as Customer[];
  }
  return (await sql`SELECT * FROM customers ORDER BY code`) as unknown as Customer[];
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
  // Run every count concurrently (was ~11 serial round-trips to the DB).
  const c = (q: ReturnType<typeof sql>) =>
    (q as unknown as Promise<Array<{ c: number }>>).then((r) => r[0].c);
  const [
    levels, skus, warehouses, openSales, openPurchases,
    vendors, customers, scansToday, scansTotal, pendingDispatch,
  ] = await Promise.all([
    stockLevels(),
    c(sql`SELECT COUNT(*)::int AS c FROM skus`),
    c(sql`SELECT COUNT(*)::int AS c FROM warehouses`),
    c(sql`SELECT COUNT(*)::int AS c FROM sales_orders WHERE status IN ('confirmed','picked','packed','draft')`),
    c(sql`SELECT COUNT(*)::int AS c FROM purchase_orders WHERE status IN ('draft','approved','sent','partially received')`),
    c(sql`SELECT COUNT(*)::int AS c FROM vendors`),
    c(sql`SELECT COUNT(*)::int AS c FROM customers`),
    c(sql`SELECT COUNT(*)::int AS c FROM scan_events WHERE created_at >= to_char(current_date,'YYYY-MM-DD')`),
    c(sql`SELECT COUNT(*)::int AS c FROM scan_events`),
    c(sql`SELECT COUNT(*)::int AS c FROM sales_orders WHERE status IN ('confirmed','picked','packed')`),
  ]);
  const lowStockItems = levels.filter((s) => s.status === "low" || s.status === "out");
  return {
    skus,
    stockUnits: levels.reduce((a, s) => a + s.qty, 0),
    lowStock: lowStockItems.length,
    warehouses, openSales, openPurchases, vendors, customers,
    scansToday, scansTotal, pendingDispatch, lowStockItems,
  };
}
