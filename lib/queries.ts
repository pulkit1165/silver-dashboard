/**
 * Live SQL mapping for the domain dashboards.
 *
 * These are intentionally EMPTY until we can introspect the real SILVER_2026
 * schema (use the Explorer page / /api/schema once connected). Each query must
 * be a single read-only SELECT returning the documented columns. When filled
 * in, the Overview/Inventory/Sales pages automatically switch to live data.
 *
 * Example (adjust table/column names to the real schema):
 *   salesTrend:
 *     `select to_char(order_date,'YYYY-MM') period,
 *             sum(net_amount) revenue, count(distinct order_no) orders
 *        from sales_orders
 *       where order_date >= add_months(trunc(sysdate,'MM'), -11)
 *       group by to_char(order_date,'YYYY-MM')
 *       order by 1`
 */
export const QUERIES = {
  // returns: PERIOD (YYYY-MM), REVENUE (number), ORDERS (number)
  salesTrend: "",
  // returns: CATEGORY (string), REVENUE (number), UNITS (number)
  byCategory: "",
  // returns: PART_NO, NAME, UNITS, REVENUE
  topParts: "",
  // returns: PART_NO, NAME, CATEGORY, BRAND, WAREHOUSE, QTY_ON_HAND, REORDER_LEVEL, UNIT_COST, UNIT_PRICE
  lowStock: "",
  // returns: ORDER_NO, ORDER_DATE, CUSTOMER, ITEMS, AMOUNT, STATUS
  recentOrders: "",
  // each returns a single column VALUE (number)
  kpiRevenue12mo: "",
  kpiActiveSkus: "",
  kpiStockValue: "",
  kpiLowStockCount: "",
} as const;

export function queriesConfigured(): boolean {
  return Boolean(QUERIES.salesTrend && QUERIES.lowStock && QUERIES.recentOrders);
}

/**
 * Home-screen (OpsSummary) live SQL. Fill these in after schema discovery, then
 * extend getOpsSummary() in lib/data.ts to run them. Each should be a single
 * read-only SELECT returning the documented columns.
 */
export const OPS_QUERIES = {
  // one row: TODAY, MTD, PMTD, YTD, PYTD, SRT_EXC
  sale: "",
  purchase: "",
  // one row: VALUE
  orderInHand: "",
  // FIRM, LT60, D60_90, D90_120, GT120
  receivables: "",
  // GRP, BANK, BALANCE
  banks: "",
  // one row: DR, CR
  drcr: "",
} as const;
