/**
 * Sales-order line pricing waterfall (single source of truth, shared by the
 * New Sales Order screen and the server-side order writer).
 *
 * Three discounts stack in a fixed order, exactly as the business applies them:
 *
 *   1. PARTY DISCOUNT %  — a whole-order % off MRP, set per customer.
 *        base = MRP × (1 − partyDiscPct/100)
 *
 *   2. ITEM-WISE NET RATE — a GLOBAL per-SKU net rate that exists for only some
 *        SKUs. When present it SUPERSEDES the party discount for that line
 *        (the party % no longer applies to it). This is the Y/N the grid shows.
 *        preFoc = itemNetRate            (netRateApplied = true)
 *               = base                   (netRateApplied = false)
 *
 *   3. FOC DISCOUNT %    — an extra % taken off whatever rate step 2 produced,
 *        applied last, sourced from the uploadable FOC master.
 *        final = preFoc × (1 − focPct/100)
 *
 * All amounts are ex-GST net rates (GST is added later on the invoice). Every
 * value is rounded to 2 dp. The function is pure so it can be unit-tested and
 * run identically on client and server.
 */

export interface LineRateInput {
  mrp: number;
  partyDiscPct: number;        // 0 when the party has no standing discount
  itemNetRate?: number | null; // global per-SKU net rate, or null/0 if none
  focPct?: number | null;      // FOC % for this SKU, or null/0 if none
}

export interface LineRateResult {
  base: number;            // MRP after party discount
  preFoc: number;          // rate after the item-net-rate supersede step
  final: number;           // final net rate charged (after FOC)
  netRateApplied: boolean; // did a global item net rate override the party %?
  partyDiscPct: number;    // echoed back (0 if net rate applied — party % didn't act)
  focPct: number;          // FOC % actually applied
  effectiveDiscPct: number;// total effective % off MRP (for display / GP)
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeLineRate(input: LineRateInput): LineRateResult {
  const mrp = Number(input.mrp) || 0;
  const partyDiscPct = clampPct(input.partyDiscPct);
  const itemNetRate = input.itemNetRate != null && input.itemNetRate > 0 ? Number(input.itemNetRate) : null;
  const focPct = clampPct(input.focPct ?? 0);

  const base = round2(mrp * (1 - partyDiscPct / 100));

  const netRateApplied = itemNetRate != null;
  const preFoc = netRateApplied ? round2(itemNetRate) : base;

  const final = round2(preFoc * (1 - focPct / 100));

  return {
    base,
    preFoc,
    final,
    netRateApplied,
    partyDiscPct: netRateApplied ? 0 : partyDiscPct, // party % is inert when net rate wins
    focPct,
    effectiveDiscPct: mrp > 0 ? round2((1 - final / mrp) * 100) : 0,
  };
}

/** Gross profit on a line, given the final net rate and unit cost (both ex-GST). */
export function lineGpPct(finalNetRate: number, unitCost: number): number | null {
  if (!(finalNetRate > 0) || !(unitCost >= 0)) return null;
  return round2(((finalNetRate - unitCost) / finalNetRate) * 100);
}

/** First value that repeats in the list, or null. Used to enforce "no duplicate
 *  items in one sales order" (and verified by the Rule Book). */
export function firstDuplicate<T>(items: T[]): T | null {
  const seen = new Set<T>();
  for (const it of items) { if (seen.has(it)) return it; seen.add(it); }
  return null;
}

function clampPct(v: number | null | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}
