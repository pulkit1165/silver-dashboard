/**
 * Sales-order line pricing waterfall (single source of truth, shared by the
 * New Sales Order screen and the server-side order writer).
 *
 * The discounts stack in a fixed order, exactly as the business applies them:
 *
 *   1. NET RATE OVERRIDE — a fixed net rate that SUPERSEDES the party discount
 *        for that line (party % + OGL go inert). Most specific wins:
 *          a. PARTY × ITEM net rate — the party's own rate for that item.
 *          b. GLOBAL ITEM net rate  — a per-SKU rate for everyone.
 *        The Y/N ("Net-rate") flag on the punch screen is true when either wins.
 *
 *   2. PARTY DISCOUNT % then OGL % — only when no net rate override applies.
 *        base   = MRP × (1 − partyDiscPct/100)
 *        preFoc = base × (1 − oglPct/100)     (OGL is an extra party discount)
 *
 *   3. FOC DISCOUNT %  — a party-level % taken off whatever the steps above
 *        produced, applied LAST, on top of everything.
 *        final = preFoc × (1 − focPct/100)
 *
 * All amounts are ex-GST net rates (GST is added later on the invoice). Every
 * value is rounded to 2 dp. The function is pure so it can be unit-tested and
 * run identically on client and server.
 */

export interface LineRateInput {
  mrp: number;
  partyDiscPct: number;            // 0 when the party has no standing discount
  oglPct?: number | null;          // extra party discount %, or null/0 if none
  itemNetRate?: number | null;     // global per-SKU net rate, or null/0 if none
  partyItemNetRate?: number | null;// party-specific net rate for this item (most specific)
  focPct?: number | null;          // party-level FOC %, applied last, or null/0
}

export type NetRateSource = "party-item" | "item" | "none";

export interface LineRateResult {
  base: number;            // MRP after party discount
  preFoc: number;          // rate after the net-rate / party-disc + OGL step
  final: number;           // final net rate charged (after FOC)
  netRateApplied: boolean; // did a net rate (party-item or global) override the party %?
  netRateSource: NetRateSource; // which net rate won
  partyDiscPct: number;    // echoed back (0 if net rate applied — party % didn't act)
  oglPct: number;          // OGL % actually applied (0 if net rate applied)
  focPct: number;          // FOC % actually applied
  effectiveDiscPct: number;// total effective % off MRP (for display / GP)
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeLineRate(input: LineRateInput): LineRateResult {
  const mrp = Number(input.mrp) || 0;
  const partyDiscPct = clampPct(input.partyDiscPct);
  const oglPct = clampPct(input.oglPct ?? 0);
  const focPct = clampPct(input.focPct ?? 0);
  const partyItemNetRate = input.partyItemNetRate != null && input.partyItemNetRate > 0 ? Number(input.partyItemNetRate) : null;
  const itemNetRate = input.itemNetRate != null && input.itemNetRate > 0 ? Number(input.itemNetRate) : null;

  // Most specific net rate wins: party×item, then global item.
  const netRate = partyItemNetRate ?? itemNetRate;
  const netRateApplied = netRate != null;
  const netRateSource: NetRateSource = partyItemNetRate != null ? "party-item" : itemNetRate != null ? "item" : "none";

  const base = round2(mrp * (1 - partyDiscPct / 100));
  // When a net rate wins, party disc% + OGL are inert. Otherwise OGL stacks on base.
  const preFoc = netRateApplied ? round2(netRate!) : round2(base * (1 - oglPct / 100));

  const final = round2(preFoc * (1 - focPct / 100));

  return {
    base,
    preFoc,
    final,
    netRateApplied,
    netRateSource,
    partyDiscPct: netRateApplied ? 0 : partyDiscPct, // party % is inert when net rate wins
    oglPct: netRateApplied ? 0 : oglPct,
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
