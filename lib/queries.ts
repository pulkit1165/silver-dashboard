/**
 * Live SQL mapping for the domain dashboards (Overview / Inventory / Sales).
 *
 * Mapped 2026-07-19 against the real SILVER_2026 schema; all 9 statements were
 * executed against live Oracle before being committed. Single read-only SELECTs
 * only (lib/oracle.ts blocks the rest), 11g syntax: no FETCH FIRST, no
 * trailing semicolons.
 *
 * NOTE: these are the SALE-BILL views, which is a different (and smaller)
 * measure than the home screen's OPS_QUERIES below — the home screen reports
 * Sales ORDERS (DTC102) to mirror the client's legacy app, whereas these
 * report what was actually billed (VW_SALE_D). Expect the two to differ.
 *
 * Objects used (the legacy app's own views):
 *   VW_SALE_D        sale bill HEADER — SALEAMOUNT (net of trade discount),
 *                    BILLAMOUNT (gross), TRDATE, TRMID, ACNTDESC.
 *                    ~1.6k bills, Apr-2025 → today.
 *   VW_SALE_GST_D    sale LINE items — ITEMCODE/ITEMID, QUANTITY, AMOUNT, DISCAMT.
 *   VW_GST_PURC_ITEM purchase lines (current financial year only).
 *   VW_STOCK_REQ     on-hand + MIN_STOCK + REORDER (the app's own stock engine).
 *   A_LABELPRINT     item master (category / vehicle model / MRP).
 *
 * TRAPS (do not "simplify" these away):
 *  - Line revenue MUST be `AMOUNT - DISCAMT`; raw AMOUNT is gross and overstates
 *    revenue ~2.2x (verified on bill GC26/000312).
 *  - A_LABELPRINT is NOT unique on ITEMID (9,068 rows / 4,680 items) — collapse
 *    it with a GROUP BY before joining or the sale rows fan out.
 *  - `add_months(x,-365)` is 365 MONTHS. For "last 12 months" use `trunc(sysdate)-365`.
 *  - The driver truncates a column's NAME to its data width, so literal/date
 *    columns are CAST wide enough (else ORDER_DATE arrives as ORDER_DAT).
 */
export const QUERIES = {
  // returns: PERIOD (YYYY-MM), REVENUE (number), ORDERS (number) — ~18 months.
  salesTrend: `select to_char(trdate,'YYYY-MM') period,
                      round(sum(saleamount)) revenue,
                      count(*) orders
                 from VW_SALE_D
                where trdate >= add_months(trunc(sysdate,'MM'),-17)
                group by to_char(trdate,'YYYY-MM')
                order by 1`,

  // returns: CATEGORY (string), REVENUE (number), UNITS (number)
  byCategory: `select * from (
                 select cast(nvl(l.itemcateg,'UNCATEGORIZED') as varchar2(60)) category,
                        round(sum(s.amount - nvl(s.discamt,0))) revenue,
                        sum(s.quantity) units
                   from VW_SALE_GST_D s
                   left join (select itemid, max(itemcateg) itemcateg
                                from A_LABELPRINT group by itemid) l
                     on s.itemid = l.itemid
                  where s.trdate >= trunc(sysdate)-365
                  group by nvl(l.itemcateg,'UNCATEGORIZED')
                  order by 2 desc)
               where rownum <= 20`,

  // returns: PART_NO, NAME, UNITS, REVENUE
  topParts: `select * from (
               select itemcode part_no,
                      max(itemdescription) name,
                      sum(quantity) units,
                      round(sum(amount - nvl(discamt,0))) revenue
                 from VW_SALE_GST_D
                where trdate >= trunc(sysdate)-365
                group by itemcode
                order by 4 desc)
             where rownum <= 15`,

  // returns: PART_NO, NAME, CATEGORY, BRAND, WAREHOUSE, QTY_ON_HAND, REORDER_LEVEL, UNIT_COST, UNIT_PRICE
  // Unit cost = latest purchase rate, falling back to the stock-ledger rate.
  // VW_STOCK_REQ has no store dimension, so WAREHOUSE is a constant.
  lowStock: `select * from (
               select s.itemcode part_no,
                      s.itemdesc name,
                      cast(nvl(l.itemcateg,'UNCATEGORIZED') as varchar2(60)) category,
                      cast(nvl(l.vehiclemodel,'NA') as varchar2(60)) brand,
                      cast('MAIN' as varchar2(30)) warehouse,
                      s.stock qty_on_hand,
                      s.min_stock reorder_level,
                      round(coalesce(p.rate, m.rate, 0),2) unit_cost,
                      nvl(l.mrp,0) unit_price
                 from VW_STOCK_REQ s
                 left join (select itemid, max(itemcateg) itemcateg,
                                   max(vehiclemodel) vehiclemodel, max(mrp) mrp
                              from A_LABELPRINT group by itemid) l
                   on s.itemid = l.itemid
                 left join (select itemcode,
                                   max(rate) keep (dense_rank last order by trdate) rate
                              from VW_GST_PURC_ITEM where rate > 0 group by itemcode) p
                   on s.itemcode = p.itemcode
                 left join (select itemid, max(rate) rate
                              from VW_STOCK_MAIN where rate > 0 group by itemid) m
                   on s.itemid = m.itemid
                where s.reorder > 0
                order by s.reorder desc)
             where rownum <= 50`,

  // returns: ORDER_NO, ORDER_DATE, CUSTOMER, ITEMS, AMOUNT, STATUS
  // Billed sales carry no status column, so STATUS is a literal.
  recentOrders: `select * from (
                   select d.trmid order_no,
                          cast(to_char(d.trdate,'YYYY-MM-DD') as varchar2(30)) order_date,
                          d.acntdesc customer,
                          (select count(*) from VW_SALE_GST_D g where g.trmid = d.trmid) items,
                          d.billamount amount,
                          cast('Paid' as varchar2(30)) status
                     from VW_SALE_D d
                    order by d.trdate desc, d.trsno desc)
                 where rownum <= 20`,

  // each returns a single column VALUE (number)
  kpiRevenue12mo: `select round(sum(saleamount)) value from VW_SALE_D where trdate >= trunc(sysdate)-365`,
  kpiActiveSkus: `select count(distinct itemid) value from VW_SALE_GST_D where trdate >= trunc(sysdate)-365`,
  // Approximation: no working valuation view exists (VW_STOCKVALUATION is invalid),
  // so on-hand is priced at latest purchase rate with a stock-ledger fallback (~97% coverage).
  kpiStockValue: `select round(sum(s.stock * coalesce(p.rate, m.rate, 0))) value
                    from VW_STOCK_REQ s
                    left join (select itemcode,
                                      max(rate) keep (dense_rank last order by trdate) rate
                                 from VW_GST_PURC_ITEM where rate > 0 group by itemcode) p
                      on s.itemcode = p.itemcode
                    left join (select itemid, max(rate) rate
                                 from VW_STOCK_MAIN where rate > 0 group by itemid) m
                      on s.itemid = m.itemid
                   where s.stock > 0`,
  kpiLowStockCount: `select count(*) value from VW_STOCK_REQ where reorder > 0`,
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
