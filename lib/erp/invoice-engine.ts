// Pure invoice math — no DB, no I/O, fully unit-testable. Encodes the pricing
// logic reverse-engineered from the client's real GST invoice (GC26/227):
//
//   taxableValue = MRP × qty × (1 − discount%)
//   then GST on taxableValue: inter-state → IGST (full rate),
//                             intra-state → CGST + SGST (rate split in half)
//   grandTotal   = Σ taxable + Σ GST, rounded to the nearest rupee
//
// Verified against the sample: HS01023 → 135 × 10 × (1 − 0.6058) = 532.17,
// taxable 76,656.72 × 18% = 13,798.21, grand total 90,455 (round-off 0.07). ✓

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Inputs needed to resolve the discount % for one line. */
export interface DiscountContext {
  skuId: number;
  /** Per-customer whole-order override (highest precedence when set). */
  customerPct?: number | null;
  /** Class default applied to every line. */
  classWholeOrderPct?: number | null;
  /** Per-SKU overrides inside the class, keyed by skuId. */
  classSkuPct?: Map<number, number>;
}

/**
 * Resolve the effective discount % off MRP for a line.
 * Precedence: per-SKU class override → per-customer override → class default → 0.
 * A per-SKU override is the most specific signal ("only for some skus"), so it
 * wins even over a customer-level whole-order override.
 */
export function resolveDiscountPct(ctx: DiscountContext): number {
  const skuOverride = ctx.classSkuPct?.get(ctx.skuId);
  if (skuOverride != null) return clampPct(skuOverride);
  if (ctx.customerPct != null) return clampPct(ctx.customerPct);
  if (ctx.classWholeOrderPct != null) return clampPct(ctx.classWholeOrderPct);
  return 0;
}

function clampPct(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, p));
}

/** Whether the transaction is inter-state (IGST) given seller + place of supply. */
export function isInterState(sellerStateCode?: string | null, posStateCode?: string | null): boolean {
  const s = (sellerStateCode ?? "").trim();
  const p = (posStateCode ?? "").trim();
  // If POS is unknown we cannot prove it's intra-state → default to IGST, the
  // safer assumption for these long-distance dispatches.
  if (!s || !p) return true;
  return s !== p;
}

export interface LineInput {
  skuId: number;
  skuCode?: string | null;
  description?: string | null;
  hsn?: string | null;
  unit?: string | null;
  caseNo?: string | null;
  qty: number;
  mrp: number;
  /** Effective discount % off MRP for this line (already resolved). */
  discountPct: number;
  /** GST rate for the line's HSN (e.g. 18). */
  gstRate: number;
  soLineId?: number | null;
}

export interface ComputedLine extends LineInput {
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  lineTotal: number;
}

export interface ComputedInvoice {
  lines: ComputedLine[];
  taxType: "IGST" | "CGST_SGST";
  mrpTotal: number;
  discountTotal: number;
  taxableTotal: number;
  igst: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  grandTotal: number;
}

/** Compute one line's taxable value + GST split. */
export function computeLine(line: LineInput, interState: boolean): ComputedLine {
  const qty = line.qty || 0;
  const mrp = line.mrp || 0;
  const pct = clampPct(line.discountPct || 0);
  const rate = line.gstRate ?? 18;

  const gross = round2(mrp * qty);
  const taxableValue = round2(gross * (1 - pct / 100));
  const tax = round2((taxableValue * rate) / 100);

  let igst = 0, cgst = 0, sgst = 0;
  if (interState) {
    igst = tax;
  } else {
    // Split the rounded total tax so cgst + sgst === tax exactly (no ±0.01 drift).
    cgst = round2(tax / 2);
    sgst = round2(tax - cgst);
  }

  return {
    ...line,
    qty,
    mrp,
    discountPct: pct,
    gstRate: rate,
    taxableValue,
    igst,
    cgst,
    sgst,
    lineTotal: round2(taxableValue + igst + cgst + sgst),
  };
}

/**
 * Compute a full invoice from already-resolved lines. Totals roll up from the
 * per-line figures; grandTotal is rounded to the nearest rupee and roundOff
 * carries the +/- adjustment (matching the printed "Round Off" cell).
 */
export function computeInvoice(
  lines: LineInput[],
  opts: { sellerStateCode?: string | null; posStateCode?: string | null },
): ComputedInvoice {
  const interState = isInterState(opts.sellerStateCode, opts.posStateCode);
  const computed = lines.map((l) => computeLine(l, interState));

  const mrpTotal = round2(computed.reduce((a, l) => a + l.mrp * l.qty, 0));
  const taxableTotal = round2(computed.reduce((a, l) => a + l.taxableValue, 0));
  const discountTotal = round2(mrpTotal - taxableTotal);
  const igst = round2(computed.reduce((a, l) => a + l.igst, 0));
  const cgst = round2(computed.reduce((a, l) => a + l.cgst, 0));
  const sgst = round2(computed.reduce((a, l) => a + l.sgst, 0));

  const preRound = round2(taxableTotal + igst + cgst + sgst);
  const grandTotal = Math.round(preRound);
  const roundOff = round2(grandTotal - preRound);

  return {
    lines: computed,
    taxType: interState ? "IGST" : "CGST_SGST",
    mrpTotal,
    discountTotal,
    taxableTotal,
    igst,
    cgst,
    sgst,
    roundOff,
    grandTotal,
  };
}

// ── Amount in words (Indian numbering: lakh/crore) ─────────────────────────
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return (TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "")).trim();
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? ONES[h] + " Hundred" : "", r ? twoDigits(r) : ""].filter(Boolean).join(" ");
}

/** "Ninety Thousand Four Hundred Fifty Five Only" — matches the invoice footer. */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.round(amount * 100) / 100);
  const paise = Math.round((amount - rupees) * 100);
  if (rupees === 0 && paise === 0) return "Zero Only";

  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;

  const parts = [
    crore ? threeDigits(crore) + " Crore" : "",
    lakh ? twoDigits(lakh) + " Lakh" : "",
    thousand ? twoDigits(thousand) + " Thousand" : "",
    rest ? threeDigits(rest) : "",
  ].filter(Boolean);

  let words = parts.join(" ").replace(/\s+/g, " ").trim();
  if (paise) words += " and " + twoDigits(paise) + " Paise";
  return words + " Only";
}
