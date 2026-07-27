import "server-only";
import { runQuery, isConfigured } from "@/lib/oracle";

// ── Analytics data layer ────────────────────────────────────────────────────
// Runs on the LIVE Oracle sale views (the same verified objects the domain
// dashboards use — VW_SALE_D header incl. ACNTDESC/SALEAMOUNT, VW_SALE_GST_D
// lines, A_LABELPRINT item master, VW_STOCK_REQ stock). Every query fails safe
// to [] so a down connector or one bad query degrades that card, never the page.
// Oracle 11g syntax only (no FETCH FIRST — use rownum; cast literals wide).

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const t = (v: unknown) => String(v ?? "");
const esc = (s: string) => s.replace(/'/g, "''");

async function q(sql: string): Promise<Record<string, unknown>[]> {
  if (!isConfigured()) return [];
  try {
    const r = await runQuery(sql);
    return (r.rows as Record<string, unknown>[]) ?? [];
  } catch {
    return [];
  }
}

export type DailyPoint = { d: string; revenue: number; bills: number };
export type PurchasePoint = { d: string; amount: number; bills: number };
export type SkuRow = { code: string; name: string; units: number; revenue: number };
export type CatRow = { category: string; revenue: number; units: number };
export type CustomerRow = { customer: string; revenue: number; bills: number };
export type ReturnRow = { customer: string; bills: number; avgDays: number; lastBill: string };
export type SlowRow = { code: string; name: string; qty: number; lastSale: string; daysIdle: number };
export type ItemRow = { code: string; name: string; units: number; revenue: number };
export type Kpis = { revenue: number; bills: number; units: number; skus: number; customers: number; aov: number };

// Daily sales, last N days — VW_SALE_D (SALEAMOUNT = net of trade discount)
export async function dailySales(days = 90): Promise<DailyPoint[]> {
  const rows = await q(`select cast(to_char(trdate,'YYYY-MM-DD') as varchar2(30)) d,
      round(sum(saleamount)) revenue, count(*) bills
    from VW_SALE_D where trdate >= trunc(sysdate)-${days}
    group by to_char(trdate,'YYYY-MM-DD') order by 1`);
  return rows.map((r) => ({ d: t(r.D), revenue: n(r.REVENUE), bills: n(r.BILLS) }));
}

// Daily purchase, last N days — DTC201 (BILLAMOUNT)
export async function dailyPurchase(days = 90): Promise<PurchasePoint[]> {
  const rows = await q(`select cast(to_char(trdate,'YYYY-MM-DD') as varchar2(30)) d,
      round(sum(billamount)) amount, count(*) bills
    from DTC201 where trdate >= trunc(sysdate)-${days}
    group by to_char(trdate,'YYYY-MM-DD') order by 1`);
  return rows.map((r) => ({ d: t(r.D), amount: n(r.AMOUNT), bills: n(r.BILLS) }));
}

// Sold by SKU (units, highest → lowest) — VW_SALE_GST_D
export async function soldBySku(days = 365, limit = 60): Promise<SkuRow[]> {
  const rows = await q(`select * from (
      select itemcode part_no, max(itemdescription) name,
             sum(quantity) units, round(sum(amount - nvl(discamt,0))) revenue
        from VW_SALE_GST_D where trdate >= trunc(sysdate)-${days}
       group by itemcode order by 3 desc)
    where rownum <= ${limit}`);
  return rows.map((r) => ({ code: t(r.PART_NO), name: t(r.NAME), units: n(r.UNITS), revenue: n(r.REVENUE) }));
}

// Sales by category — VW_SALE_GST_D × A_LABELPRINT (collapse the item master first)
export async function salesByCategory(days = 365, limit = 12): Promise<CatRow[]> {
  const rows = await q(`select * from (
      select cast(nvl(l.itemcateg,'UNCATEGORIZED') as varchar2(60)) category,
             round(sum(s.amount - nvl(s.discamt,0))) revenue, sum(s.quantity) units
        from VW_SALE_GST_D s
        left join (select itemid, max(itemcateg) itemcateg from A_LABELPRINT group by itemid) l
          on s.itemid = l.itemid
       where s.trdate >= trunc(sysdate)-${days}
       group by nvl(l.itemcateg,'UNCATEGORIZED') order by 2 desc)
    where rownum <= ${limit}`);
  return rows.map((r) => ({ category: t(r.CATEGORY), revenue: n(r.REVENUE), units: n(r.UNITS) }));
}

// Top customers (highest → lowest) — VW_SALE_D.ACNTDESC
export async function topCustomers(days = 365, limit = 40): Promise<CustomerRow[]> {
  const rows = await q(`select * from (
      select cast(acntdesc as varchar2(80)) customer,
             round(sum(saleamount)) revenue, count(*) bills
        from VW_SALE_D where trdate >= trunc(sysdate)-${days}
       group by acntdesc order by 2 desc)
    where rownum <= ${limit}`);
  return rows.map((r) => ({ customer: t(r.CUSTOMER), revenue: n(r.REVENUE), bills: n(r.BILLS) }));
}

// A customer's items bought (highest → lowest) — join lines to header by TRMID
export async function customerItems(customer: string, limit = 25): Promise<ItemRow[]> {
  const rows = await q(`select * from (
      select g.itemcode code, max(g.itemdescription) name,
             sum(g.quantity) units, round(sum(g.amount - nvl(g.discamt,0))) revenue
        from VW_SALE_GST_D g
        join VW_SALE_D d on d.trmid = g.trmid
       where d.acntdesc = '${esc(customer)}' and g.trdate >= trunc(sysdate)-365
       group by g.itemcode order by 4 desc)
    where rownum <= ${limit}`);
  return rows.map((r) => ({ code: t(r.CODE), name: t(r.NAME), units: n(r.UNITS), revenue: n(r.REVENUE) }));
}

// Returning customers: average days between bills — VW_SALE_D
export async function returningCustomers(limit = 50): Promise<ReturnRow[]> {
  const rows = await q(`select * from (
      select cast(acntdesc as varchar2(80)) customer, count(*) bills,
             round((cast(max(trdate) as date) - cast(min(trdate) as date)) / nullif(count(*)-1,0), 1) avg_days,
             cast(to_char(max(trdate),'YYYY-MM-DD') as varchar2(30)) last_bill
        from VW_SALE_D group by acntdesc
       having count(*) >= 2
       order by 2 desc)
    where rownum <= ${limit}`);
  return rows.map((r) => ({ customer: t(r.CUSTOMER), bills: n(r.BILLS), avgDays: n(r.AVG_DAYS), lastBill: t(r.LAST_BILL) }));
}

// Slow-moving stock: on hand, days since last sale (never = 9999) — VW_STOCK_REQ
export async function slowMovingStock(limit = 60): Promise<SlowRow[]> {
  const rows = await q(`select * from (
      select s.itemcode part_no, s.itemdesc name, s.stock qty,
             cast(nvl(to_char(ls.last_sale,'YYYY-MM-DD'),'never') as varchar2(30)) last_sale,
             nvl(trunc(sysdate) - ls.last_sale, 9999) days_idle
        from VW_STOCK_REQ s
        left join (select itemid, max(trdate) last_sale from VW_SALE_GST_D group by itemid) ls
          on s.itemid = ls.itemid
       where s.stock > 0
       order by days_idle desc, s.stock desc)
    where rownum <= ${limit}`);
  return rows.map((r) => ({ code: t(r.PART_NO), name: t(r.NAME), qty: n(r.QTY), lastSale: t(r.LAST_SALE), daysIdle: n(r.DAYS_IDLE) }));
}

// Headline KPIs — one round trip
export async function analyticsKpis(days = 365): Promise<Kpis> {
  const [a] = await q(`select round(sum(saleamount)) revenue, count(*) bills,
       count(distinct acntdesc) customers from VW_SALE_D where trdate >= trunc(sysdate)-${days}`);
  const [b] = await q(`select sum(quantity) units, count(distinct itemid) skus
       from VW_SALE_GST_D where trdate >= trunc(sysdate)-${days}`);
  const revenue = n(a?.REVENUE), bills = n(a?.BILLS);
  return {
    revenue, bills, customers: n(a?.CUSTOMERS),
    units: n(b?.UNITS), skus: n(b?.SKUS),
    aov: bills > 0 ? Math.round(revenue / bills) : 0,
  };
}

export type AnalyticsBundle = {
  live: boolean;
  days: number;
  generatedAt: string;
  kpis: Kpis;
  daily: DailyPoint[];
  purchase: PurchasePoint[];
  sku: SkuRow[];
  category: CatRow[];
  customers: CustomerRow[];
  returning: ReturnRow[];
  slow: SlowRow[];
};

const WINDOWS = new Set([7, 30, 90, 365]);
export async function getAnalytics(days = 365, nowIso = ""): Promise<AnalyticsBundle> {
  if (!WINDOWS.has(days)) days = 365;
  const trend = Math.min(days, 90); // daily trend caps at ~90 points for readability
  const [kpis, daily, purchase, sku, category, customers, returning, slow] = await Promise.all([
    analyticsKpis(days), dailySales(trend), dailyPurchase(trend), soldBySku(days), salesByCategory(days),
    topCustomers(days), returningCustomers(), slowMovingStock(),
  ]);
  const live = isConfigured() && daily.length + sku.length + customers.length > 0;
  return { live, days, generatedAt: nowIso, kpis, daily, purchase, sku, category, customers, returning, slow };
}
