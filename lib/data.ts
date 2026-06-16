import "server-only";
import type { DashboardData, OpsSummary, Part } from "./types";
import { buildOpsSummary, buildSampleData, sampleParts } from "./sample-data";
import { isConfigured, ping, runQuery } from "./oracle";
import { QUERIES, queriesConfigured } from "./queries";

type Source = "mock" | "oracle" | "auto";

function configuredSource(): Source {
  const s = (process.env.DATA_SOURCE || "auto").toLowerCase();
  return s === "mock" || s === "oracle" ? s : "auto";
}

/**
 * Returns the data for the domain dashboards. Falls back to the sample dataset
 * (clearly flagged in the UI) whenever live data isn't available, so the
 * dashboard always renders.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const source = configuredSource();

  if (source === "mock") return buildSampleData("Sample data (DATA_SOURCE=mock).");

  if (!isConfigured()) {
    return buildSampleData(
      "Sample data — no Oracle credentials configured yet. Add them to .env.local to go live.",
    );
  }

  // Need both a reachable DB and configured domain SQL to serve live data.
  if (!queriesConfigured()) {
    const status = await ping();
    const note = status.ok
      ? "Connected to Oracle ✓ — domain queries not mapped yet. Use the Explorer to discover the schema, then fill in lib/queries.ts. Showing sample layout."
      : `Sample data — could not reach Oracle: ${status.error}`;
    return buildSampleData(note);
  }

  try {
    return await getOracleDashboard();
  } catch (e) {
    if (source === "oracle") throw e;
    return buildSampleData(`Sample data — live query failed: ${(e as Error).message}`);
  }
}

/**
 * Operations summary for the home screen (sale/purchase/receivables/banks/DR-CR).
 * Returns sample figures until the live SQL in lib/queries.ts is mapped.
 */
export async function getOpsSummary(): Promise<OpsSummary> {
  const source = configuredSource();
  if (source === "mock") return buildOpsSummary("Sample data (DATA_SOURCE=mock).");
  if (!isConfigured()) {
    return buildOpsSummary(
      "Sample figures — no Oracle credentials configured yet. Add them to .env.local to go live.",
    );
  }
  // Live ops queries are not mapped yet; report connectivity and show sample.
  const status = await ping();
  const note = status.ok
    ? "Connected to Oracle ✓ — home-screen queries not mapped yet (see lib/queries.ts). Showing sample figures."
    : `Sample figures — could not reach Oracle: ${status.error}`;
  return buildOpsSummary(note);
}

/** Inventory accessor used by the Inventory page. */
export async function getInventory(): Promise<{ parts: Part[]; mode: "mock" | "oracle"; note?: string }> {
  const source = configuredSource();
  if (source !== "mock" && isConfigured() && QUERIES.lowStock) {
    try {
      const r = await runQuery(QUERIES.lowStock);
      const parts = r.rows.map(rowToPart);
      return { parts, mode: "oracle" };
    } catch (e) {
      if (source === "oracle") throw e;
      return { parts: sampleParts, mode: "mock", note: `Live query failed: ${(e as Error).message}` };
    }
  }
  return { parts: sampleParts, mode: "mock" };
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

function rowToPart(r: Record<string, unknown>): Part {
  return {
    partNo: String(r.PART_NO ?? ""),
    name: String(r.NAME ?? ""),
    category: String(r.CATEGORY ?? ""),
    brand: String(r.BRAND ?? ""),
    warehouse: String(r.WAREHOUSE ?? ""),
    qtyOnHand: num(r.QTY_ON_HAND),
    reorderLevel: num(r.REORDER_LEVEL),
    unitCost: num(r.UNIT_COST),
    unitPrice: num(r.UNIT_PRICE),
  };
}

async function scalar(sql: string): Promise<number> {
  const r = await runQuery(sql);
  return num(r.rows[0]?.VALUE);
}

async function getOracleDashboard(): Promise<DashboardData> {
  const [trend, cats, top, low, recent, k1, k2, k3, k4] = await Promise.all([
    runQuery(QUERIES.salesTrend),
    runQuery(QUERIES.byCategory),
    runQuery(QUERIES.topParts),
    runQuery(QUERIES.lowStock),
    runQuery(QUERIES.recentOrders),
    scalar(QUERIES.kpiRevenue12mo),
    scalar(QUERIES.kpiActiveSkus),
    scalar(QUERIES.kpiStockValue),
    scalar(QUERIES.kpiLowStockCount),
  ]);

  return {
    mode: "oracle",
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: "Revenue (12 mo)", value: k1, unit: "currency" },
      { label: "Active SKUs", value: k2, unit: "count" },
      { label: "Stock Value", value: k3, unit: "currency" },
      { label: "Low-stock Items", value: k4, unit: "count" },
    ],
    salesTrend: trend.rows.map((r) => ({
      period: String(r.PERIOD),
      revenue: num(r.REVENUE),
      orders: num(r.ORDERS),
    })),
    byCategory: cats.rows.map((r) => ({
      category: String(r.CATEGORY),
      revenue: num(r.REVENUE),
      units: num(r.UNITS),
    })),
    topParts: top.rows.map((r) => ({
      partNo: String(r.PART_NO),
      name: String(r.NAME),
      units: num(r.UNITS),
      revenue: num(r.REVENUE),
    })),
    lowStock: low.rows.map(rowToPart),
    recentOrders: recent.rows.map((r) => ({
      orderNo: String(r.ORDER_NO),
      date: String(r.ORDER_DATE),
      customer: String(r.CUSTOMER),
      items: num(r.ITEMS),
      amount: num(r.AMOUNT),
      status: (String(r.STATUS) as "Paid" | "Pending" | "Shipped") || "Pending",
    })),
  };
}
