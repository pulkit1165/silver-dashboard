// Domain types for the Silver Industries bike-parts dashboard.
// These are the shapes the UI consumes, regardless of whether the data
// comes from the live Oracle database or the built-in sample dataset.

export type DataMode = "oracle" | "mock";

export interface Kpi {
  label: string;
  value: number;
  unit?: "currency" | "count" | "percent";
  delta?: number; // period-over-period change, fraction (0.12 = +12%)
  hint?: string;
}

export interface SalesPoint {
  period: string; // e.g. "2026-01"
  revenue: number;
  orders: number;
}

export interface CategorySlice {
  category: string;
  revenue: number;
  units: number;
}

export interface Part {
  partNo: string;
  name: string;
  category: string;
  brand: string;
  warehouse: string;
  qtyOnHand: number;
  reorderLevel: number;
  unitCost: number;
  unitPrice: number;
}

export interface OrderRow {
  orderNo: string;
  date: string;
  customer: string;
  items: number;
  amount: number;
  status: "Paid" | "Pending" | "Shipped";
}

export interface DashboardData {
  mode: DataMode;
  generatedAt: string;
  note?: string; // surfaced in the UI (e.g. why mock mode is active)
  kpis: Kpi[];
  salesTrend: SalesPoint[];
  byCategory: CategorySlice[];
  topParts: Array<{ partNo: string; name: string; units: number; revenue: number }>;
  lowStock: Part[];
  recentOrders: OrderRow[];
}

// ── Operations home screen (mirrors the client's legacy dashboard) ────────
export interface PeriodFigures {
  today: number;
  mtd: number; // month to date
  pmtd: number; // previous month to date
  ytd: number; // year to date
  pytd: number; // previous year to date
  srtExc: number; // shortage / excess (negative shows red)
}

export interface ReceivableRow {
  firm: string;
  lt60: number; // < 60 days
  d60_90: number; // 60-90
  d90_120: number; // 90-120
  gt120: number; // > 120
}

export interface BankBalance {
  group: string; // SILVER / STAR / STATE
  bank: string; // IDBI / HDFC / KVB
  balance: number;
}

export interface OpsSummary {
  mode: DataMode;
  note?: string;
  asOf: string; // ISO date the figures are reported for
  sale: PeriodFigures;
  purchase: PeriodFigures;
  orderInHand: number;
  orderDispatchRatio: number | null;
  receivables: ReceivableRow[];
  banks: BankBalance[];
  bankTotal: number;
  drcr: { dr: number; cr: number; total: number };
}

// Schema-explorer types (work against any Oracle schema)
export interface TableInfo {
  owner: string;
  table: string;
  rows: number | null;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
}

export interface QueryResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  elapsedMs: number;
  truncated: boolean;
}
