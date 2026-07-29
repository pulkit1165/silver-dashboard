import { lineGpPct, round2 } from "./pricing";

// Pure gross-profit engine (no server imports → usable on the punch screen and
// the server). GP% = (net rate − unit cost) / net rate. Per-line floor 22%,
// order-average floor 23%. Order GP is measured over COSTED revenue only, so
// lines without a cost on file don't distort the average.
export const GP_FLOOR = 22;
export const ORDER_GP_FLOOR = 23;

export interface GpLineInput { qty: number; netRate: number; cost: number }
export interface GpLineResult { gpPct: number | null; revenue: number; cost: number; profit: number; below: boolean; hasCost: boolean }

export function lineGp(l: GpLineInput): GpLineResult {
  const qty = Number(l.qty) || 0;
  const netRate = Number(l.netRate) || 0;
  const unitCost = Number(l.cost) || 0;
  const hasCost = unitCost > 0;
  const revenue = round2(qty * netRate);
  const cost = round2(qty * unitCost);
  const gpPct = hasCost && netRate > 0 ? lineGpPct(netRate, unitCost) : null;
  return { gpPct, revenue, cost, profit: round2(revenue - cost), below: gpPct != null && gpPct < GP_FLOOR, hasCost };
}

export interface OrderGpResult {
  revenue: number; costedRevenue: number; cost: number; profit: number;
  gpPct: number | null; below: boolean; belowLines: number; costedLines: number; uncostedLines: number;
}
export function orderGp(lines: GpLineInput[]): OrderGpResult {
  let revenue = 0, costedRevenue = 0, cost = 0, costedLines = 0, belowLines = 0, uncostedLines = 0;
  for (const l of lines) {
    const r = lineGp(l);
    revenue += r.revenue;
    if (r.hasCost) { cost += r.cost; costedRevenue += r.revenue; costedLines++; if (r.below) belowLines++; }
    else uncostedLines++;
  }
  const profit = round2(costedRevenue - cost);
  const gpPct = costedRevenue > 0 ? round2((profit / costedRevenue) * 100) : null;
  return {
    revenue: round2(revenue), costedRevenue: round2(costedRevenue), cost: round2(cost), profit,
    gpPct, below: gpPct != null && gpPct < ORDER_GP_FLOOR, belowLines, costedLines, uncostedLines,
  };
}
