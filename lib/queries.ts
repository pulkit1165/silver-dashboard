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
 * Home-screen (OpsSummary) live SQL — mapped to real Oracle 11g tables.
 *
 * Table notes (SILVER_2026 schema, year-specific tables = all rows are FY26):
 *   DTC102   = Sales Orders (TRTYPE=SO26, AMOUNT col)
 *   DTC201   = Purchase/MRN (TRTYPE=MRN26, BILLAMOUNT col)
 *   VW_PEND_SO  = pending (undelivered) Sales Orders view
 *   VW_DR_PENDBILLS = outstanding debtor invoices (INVDATE, BALAMOUNT)
 *   VW_CR_PENDBILLS = outstanding creditor invoices (BALAMOUNT)
 *   VW_BANK_D   = bank book by account series (SERIES, DR_AMOUNT, CR_AMOUNT)
 *                 includes 31-MAR-26 opening balance row — so CR-DR = current balance
 *
 * Oracle 11g syntax only: no FETCH FIRST, use rownum; TRUNC(date,'MM') for month start.
 */
export const OPS_QUERIES = {
  // one row: TODAY, MTD, PMTD, YTD (all FY26 = all rows), PYTD (=0), SRT_EXC (MTD-PMTD)
  sale: `SELECT
    NVL(SUM(CASE WHEN TRUNC(TRDATE)=TRUNC(SYSDATE) THEN AMOUNT ELSE 0 END),0) AS TODAY,
    NVL(SUM(CASE WHEN TRDATE>=TRUNC(SYSDATE,'MM') THEN AMOUNT ELSE 0 END),0) AS MTD,
    NVL(SUM(CASE WHEN TRDATE>=ADD_MONTHS(TRUNC(SYSDATE,'MM'),-1) AND TRDATE<TRUNC(SYSDATE,'MM') THEN AMOUNT ELSE 0 END),0) AS PMTD,
    NVL(SUM(AMOUNT),0) AS YTD,
    0 AS PYTD,
    NVL(SUM(CASE WHEN TRDATE>=TRUNC(SYSDATE,'MM') THEN AMOUNT ELSE 0 END),0)
      - NVL(SUM(CASE WHEN TRDATE>=ADD_MONTHS(TRUNC(SYSDATE,'MM'),-1) AND TRDATE<TRUNC(SYSDATE,'MM') THEN AMOUNT ELSE 0 END),0) AS SRT_EXC
  FROM DTC102`,

  // one row: TODAY, MTD, PMTD, YTD, PYTD (=0), SRT_EXC (MTD-PMTD)
  purchase: `SELECT
    NVL(SUM(CASE WHEN TRUNC(TRDATE)=TRUNC(SYSDATE) THEN BILLAMOUNT ELSE 0 END),0) AS TODAY,
    NVL(SUM(CASE WHEN TRDATE>=TRUNC(SYSDATE,'MM') THEN BILLAMOUNT ELSE 0 END),0) AS MTD,
    NVL(SUM(CASE WHEN TRDATE>=ADD_MONTHS(TRUNC(SYSDATE,'MM'),-1) AND TRDATE<TRUNC(SYSDATE,'MM') THEN BILLAMOUNT ELSE 0 END),0) AS PMTD,
    NVL(SUM(BILLAMOUNT),0) AS YTD,
    0 AS PYTD,
    NVL(SUM(CASE WHEN TRDATE>=TRUNC(SYSDATE,'MM') THEN BILLAMOUNT ELSE 0 END),0)
      - NVL(SUM(CASE WHEN TRDATE>=ADD_MONTHS(TRUNC(SYSDATE,'MM'),-1) AND TRDATE<TRUNC(SYSDATE,'MM') THEN BILLAMOUNT ELSE 0 END),0) AS SRT_EXC
  FROM DTC201`,

  // one row: VALUE = count of pending (undelivered) sales orders
  orderInHand: `SELECT COUNT(*) AS VALUE FROM VW_PEND_SO`,

  // one row per firm: FIRM, LT60, D60_90, D90_120, GT120 (outstanding by age bucket)
  receivables: `SELECT
    'SILVER' AS FIRM,
    NVL(SUM(CASE WHEN SYSDATE - INVDATE < 60 THEN BALAMOUNT ELSE 0 END),0) AS LT60,
    NVL(SUM(CASE WHEN SYSDATE - INVDATE BETWEEN 60 AND 90 THEN BALAMOUNT ELSE 0 END),0) AS D60_90,
    NVL(SUM(CASE WHEN SYSDATE - INVDATE BETWEEN 90 AND 120 THEN BALAMOUNT ELSE 0 END),0) AS D90_120,
    NVL(SUM(CASE WHEN SYSDATE - INVDATE > 120 THEN BALAMOUNT ELSE 0 END),0) AS GT120
  FROM VW_DR_PENDBILLS`,

  // one row per bank account: GRP, BANK (account name/series), BALANCE (CR-DR including opening)
  banks: `SELECT
    'SILVER' AS GRP,
    SERIES AS BANK,
    NVL(SUM(CR_AMOUNT),0) - NVL(SUM(DR_AMOUNT),0) AS BALANCE
  FROM VW_BANK_D
  GROUP BY SERIES
  ORDER BY SERIES`,

  // one row: DR = total debtor outstanding, CR = total creditor outstanding
  drcr: `SELECT
    (SELECT NVL(SUM(BALAMOUNT),0) FROM VW_DR_PENDBILLS) AS DR,
    (SELECT NVL(SUM(BALAMOUNT),0) FROM VW_CR_PENDBILLS) AS CR
  FROM DUAL`,
} as const;
