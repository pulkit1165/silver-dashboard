import type {
  DashboardData,
  Part,
  OrderRow,
  SalesPoint,
  CategorySlice,
  OpsSummary,
} from "./types";

// Figures taken from the client's existing home screen, used until the live
// Oracle queries are mapped (see lib/queries.ts).
export function buildOpsSummary(note?: string): OpsSummary {
  return {
    mode: "mock",
    note,
    asOf: new Date().toISOString(),
    sale: { today: 23, mtd: 134, pmtd: 150, ytd: 245, pytd: 268, srtExc: -23 },
    purchase: { today: 4, mtd: 91, pmtd: 117, ytd: 170, pytd: 190, srtExc: -20 },
    orderInHand: 16,
    orderDispatchRatio: null,
    receivables: [
      { firm: "SILVER", lt60: 0.0, d60_90: 136.64, d90_120: 120.15, gt120: 275.77 },
      { firm: "STAR", lt60: 0.0, d60_90: 16.59, d90_120: 16.21, gt120: 16.78 },
      { firm: "STATE", lt60: 0.0, d60_90: 0.0, d90_120: 0.0, gt120: 0.0 },
    ],
    banks: [
      { group: "SILVER", bank: "IDBI", balance: 0.0 },
      { group: "SILVER", bank: "HDFC", balance: -149.73 },
      { group: "STAR", bank: "KVB", balance: 0.1 },
      { group: "STAR", bank: "HDFC", balance: -23.72 },
      { group: "STATE", bank: "KVB", balance: 19.32 },
    ],
    bankTotal: -154.04,
    drcr: { dr: 828.7, cr: 357.43, total: 471.27 },
  };
}


// Deterministic, realistic sample data for a bike-parts business.
// Used until the live Oracle connection is wired (see lib/data.ts).

const parts: Part[] = [
  { partNo: "BRK-DSC-203", name: "Hydraulic Disc Brake 203mm", category: "Brakes", brand: "Silver Pro", warehouse: "Main", qtyOnHand: 8, reorderLevel: 25, unitCost: 28, unitPrice: 59 },
  { partNo: "CHN-11S-118", name: "11-Speed Chain 118L", category: "Drivetrain", brand: "Silver Pro", warehouse: "Main", qtyOnHand: 142, reorderLevel: 60, unitCost: 9, unitPrice: 22 },
  { partNo: "TYR-700-28", name: "Road Tyre 700x28c", category: "Tyres", brand: "GripMax", warehouse: "Main", qtyOnHand: 56, reorderLevel: 40, unitCost: 14, unitPrice: 34 },
  { partNo: "TYR-MTB-29", name: "MTB Tyre 29x2.25", category: "Tyres", brand: "GripMax", warehouse: "South", qtyOnHand: 12, reorderLevel: 30, unitCost: 18, unitPrice: 42 },
  { partNo: "SDL-COMP-01", name: "Comfort Saddle Gel", category: "Components", brand: "RideEasy", warehouse: "Main", qtyOnHand: 73, reorderLevel: 35, unitCost: 11, unitPrice: 27 },
  { partNo: "DER-RR-105", name: "Rear Derailleur 105", category: "Drivetrain", brand: "Shimato", warehouse: "Main", qtyOnHand: 6, reorderLevel: 20, unitCost: 41, unitPrice: 95 },
  { partNo: "WHL-700-AL", name: "Alloy Wheelset 700c", category: "Wheels", brand: "Silver Pro", warehouse: "South", qtyOnHand: 18, reorderLevel: 10, unitCost: 120, unitPrice: 245 },
  { partNo: "GRP-LCK-22", name: "Lock-on Grips", category: "Components", brand: "RideEasy", warehouse: "Main", qtyOnHand: 210, reorderLevel: 80, unitCost: 4, unitPrice: 13 },
  { partNo: "LGT-LED-800", name: "LED Headlight 800lm", category: "Accessories", brand: "Lumino", warehouse: "Main", qtyOnHand: 9, reorderLevel: 25, unitCost: 16, unitPrice: 39 },
  { partNo: "HLM-RD-M", name: "Road Helmet (M)", category: "Accessories", brand: "GuardX", warehouse: "South", qtyOnHand: 31, reorderLevel: 20, unitCost: 22, unitPrice: 55 },
  { partNo: "PDL-SPD-01", name: "Clipless Pedals SPD", category: "Components", brand: "Shimato", warehouse: "Main", qtyOnHand: 44, reorderLevel: 25, unitCost: 25, unitPrice: 58 },
  { partNo: "CBL-BRK-SET", name: "Brake Cable Set", category: "Brakes", brand: "Silver Pro", warehouse: "Main", qtyOnHand: 5, reorderLevel: 50, unitCost: 3, unitPrice: 9 },
];

const salesTrend: SalesPoint[] = [
  { period: "2025-07", revenue: 41200, orders: 220 },
  { period: "2025-08", revenue: 38800, orders: 205 },
  { period: "2025-09", revenue: 45600, orders: 248 },
  { period: "2025-10", revenue: 52100, orders: 271 },
  { period: "2025-11", revenue: 61800, orders: 318 },
  { period: "2025-12", revenue: 73400, orders: 386 },
  { period: "2026-01", revenue: 49200, orders: 256 },
  { period: "2026-02", revenue: 54300, orders: 281 },
  { period: "2026-03", revenue: 67900, orders: 349 },
  { period: "2026-04", revenue: 71200, orders: 372 },
  { period: "2026-05", revenue: 78650, orders: 401 },
  { period: "2026-06", revenue: 44120, orders: 233 },
];

const byCategory: CategorySlice[] = [
  { category: "Drivetrain", revenue: 184300, units: 6120 },
  { category: "Tyres", revenue: 152800, units: 5340 },
  { category: "Wheels", revenue: 121500, units: 980 },
  { category: "Components", revenue: 98700, units: 7210 },
  { category: "Brakes", revenue: 76400, units: 3120 },
  { category: "Accessories", revenue: 64200, units: 2890 },
];

const topParts = [
  { partNo: "CHN-11S-118", name: "11-Speed Chain 118L", units: 1840, revenue: 40480 },
  { partNo: "TYR-700-28", name: "Road Tyre 700x28c", units: 1320, revenue: 44880 },
  { partNo: "GRP-LCK-22", name: "Lock-on Grips", units: 2210, revenue: 28730 },
  { partNo: "PDL-SPD-01", name: "Clipless Pedals SPD", units: 760, revenue: 44080 },
  { partNo: "WHL-700-AL", name: "Alloy Wheelset 700c", units: 410, revenue: 100450 },
];

const recentOrders: OrderRow[] = [
  { orderNo: "SO-20266-0412", date: "2026-06-14", customer: "CycleHub Retail", items: 14, amount: 3820, status: "Paid" },
  { orderNo: "SO-20266-0411", date: "2026-06-14", customer: "Velocity Bikes", items: 6, amount: 1290, status: "Shipped" },
  { orderNo: "SO-20266-0410", date: "2026-06-13", customer: "Trailhead Co.", items: 22, amount: 6740, status: "Pending" },
  { orderNo: "SO-20266-0409", date: "2026-06-13", customer: "Metro Cycles", items: 3, amount: 540, status: "Paid" },
  { orderNo: "SO-20266-0408", date: "2026-06-12", customer: "Pro Pedal Shop", items: 18, amount: 4910, status: "Paid" },
  { orderNo: "SO-20266-0407", date: "2026-06-12", customer: "Summit Sports", items: 9, amount: 2180, status: "Shipped" },
];

export function buildSampleData(note?: string): DashboardData {
  const stockValue = parts.reduce((s, p) => s + p.qtyOnHand * p.unitCost, 0);
  const lowStock = parts.filter((p) => p.qtyOnHand < p.reorderLevel);
  const ytdRevenue = salesTrend.reduce((s, p) => s + p.revenue, 0);
  const lastMonth = salesTrend[salesTrend.length - 2];
  const thisMonth = salesTrend[salesTrend.length - 1];

  return {
    mode: "mock",
    generatedAt: new Date().toISOString(),
    note,
    kpis: [
      { label: "Revenue (12 mo)", value: ytdRevenue, unit: "currency", delta: 0.184, hint: "Trailing twelve months" },
      { label: "Active SKUs", value: parts.length * 53, unit: "count", hint: "Distinct parts in catalogue" },
      { label: "Stock Value", value: stockValue * 47, unit: "currency", hint: "On-hand qty × unit cost" },
      { label: "Low-stock Items", value: lowStock.length, unit: "count", delta: 0.25, hint: "Below reorder level" },
    ],
    salesTrend,
    byCategory,
    topParts,
    lowStock,
    recentOrders,
    // keep a reference to the full parts list via lowStock + topParts in UI;
    // expose all parts through the inventory accessor below.
  };
}

export const sampleParts = parts;
export const sampleSalesByMonthDelta = (() => {
  const a = salesTrend[salesTrend.length - 2].revenue;
  const b = salesTrend[salesTrend.length - 1].revenue;
  return (b - a) / a;
})();
