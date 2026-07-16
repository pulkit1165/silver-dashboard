import "server-only";
import { getSkus, getCustomers } from "./queries";
import { aiAvailable } from "./ai";
import type { Sku, Customer } from "./types";

// ---------------------------------------------------------------------------
// Sales Decoder — turn a photo of a handwritten order slip into a draft sales
// order that a human verifies before it is punched.
//
// Two stages, on purpose:
//   1. Claude *reads* the handwriting (vision) → raw line items, exactly as
//      written. It never guesses SKU codes — there are 2000+ and it would
//      hallucinate. Small, focused prompt.
//   2. We *match* each raw line to a real SKU with deterministic token overlap
//      against the live master, surfacing the best guess + alternates. The
//      human confirms/fixes every line (see the verify screen) before punching.
// ---------------------------------------------------------------------------

export { aiAvailable };

/** One item as Claude read it off the slip — not yet matched to a SKU. */
export interface RawLine {
  raw_text: string; // the item description exactly as written
  qty: number;
  rate: number; // 0 when no rate was written
  unit: string; // "" when none written (PCS/DOZ/BOX…)
}

/** What the vision pass returns before any matching. */
interface VisionResult {
  customer_hint: string;
  order_date: string; // "" when none
  notes: string;
  lines: RawLine[];
}

/** A SKU offered as a match candidate (trimmed for the wire). */
export interface SkuCandidate {
  id: number;
  sku_code: string;
  name: string;
  unit: string;
  price: number; // MRP
  selling_price: number;
}

export type MatchConfidence = "high" | "medium" | "low" | "none";

/** A verified-pending line: what was read + our best SKU guess + alternates. */
export interface DraftLine {
  raw_text: string;
  qty: number;
  rate: number; // suggested rate (written rate, else the SKU's selling price)
  unit: string;
  sku_id: number | null; // pre-filled with the suggestion when confident enough
  suggested: SkuCandidate | null;
  candidates: SkuCandidate[];
  confidence: MatchConfidence;
}

export interface DraftOrder {
  customer_hint: string;
  customer_id: number | null;
  customer_candidates: Array<{ id: number; code: string; name: string }>;
  order_date: string;
  notes: string;
  lines: DraftLine[];
}

const VISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    customer_hint: { type: "string" },
    order_date: { type: "string" },
    notes: { type: "string" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          raw_text: { type: "string" },
          qty: { type: "number" },
          rate: { type: "number" },
          unit: { type: "string" },
        },
        required: ["raw_text", "qty", "rate", "unit"],
      },
    },
  },
  required: ["customer_hint", "order_date", "notes", "lines"],
} as const;

const VISION_SYSTEM =
  "You read photos of handwritten wholesale order slips for an Indian two-wheeler " +
  "spare-parts distributor. The writing is often messy, in English/Hindi/Hinglish, " +
  "with trade abbreviations and brand names (Bajaj, Chetak, Hero, TVS, HH=Hero Honda). " +
  "Transcribe the PARTY/CUSTOMER name as written into customer_hint. " +
  "\n\nLAYOUT: the slip may have TWO columns. Read the ENTIRE left column top-to-bottom " +
  "first, then the entire right column top-to-bottom. Keep the written order.\n\n" +
  "CONTINUATION / DITTO SHORTHAND (important): a line that starts with a dash or long " +
  "underline (— , ___) or is only a short variant fragment means 'SAME base product as " +
  "the line just above, different variant'. You MUST carry the base product name down " +
  "and expand it, so raw_text is always the COMPLETE item name — never a bare suffix. " +
  "Examples: 'Valve Set CT100 ES' then '— Plat ES' then '— P.Pro BS6' → the next two " +
  "items are 'Valve Set Platina ES' and 'Valve Set Pess Pro BS6'. 'P.w No 17' then " +
  "'— 19' then '— 14' → 'Plain Washer No.19', 'Plain Washer No.14'. 'Clutch nut Big HH' " +
  "then '— Small' → 'Clutch Nut HH Small'. 'Br. Shoe rear HH' then '— KB/S' then " +
  "'— fr spl' → 'Brake Shoe Rear KB/S', 'Brake Shoe Front spl'. Never output a bare " +
  "'Plat ES', 'Small', '19', 'fr spl' on its own — always prepend the base product.\n\n" +
  "For every order line, put the (expanded) item description into raw_text as faithfully " +
  "as possible — do NOT invent a catalogue product code. Read the quantity into qty " +
  "(default 1 if a line is clearly an item but no number is shown). If a rate/price per " +
  "unit is written put it in rate, else 0. A brace with 'Net <n>' next to two lines means " +
  "both share that net rate. Put any unit (PCS, DOZ, BOX, SET) into unit, else \"\". Put a " +
  "date into order_date as YYYY-MM-DD if legible, else \"\". Put transport/free-item/other " +
  "remarks into notes. Return only genuine order items; ignore totals, signatures, the " +
  "printed diary calendar and quotes.";

/** Call Claude vision to transcribe the slip. Throws on failure (route handles it). */
async function readSlip(imageBase64: string, mediaType: string): Promise<VisionResult> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  // Cast via unknown: the installed SDK's static types lag adaptive thinking /
  // output_config (same pattern as lib/erp/ai.ts and the assistant route).
  const params = {
    model: "claude-opus-4-8",
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: VISION_SCHEMA },
    },
    system: VISION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          {
            type: "text",
            text: "Transcribe this handwritten order slip into the required JSON structure.",
          },
        ],
      },
    ],
  };

  const msg = (await client.messages.create(
    params as unknown as Parameters<typeof client.messages.create>[0],
  )) as { content: Array<{ type: string; text?: string }> };

  const text = msg.content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("");
  const parsed = JSON.parse(text) as Partial<VisionResult>;
  return {
    customer_hint: String(parsed.customer_hint ?? ""),
    order_date: String(parsed.order_date ?? ""),
    notes: String(parsed.notes ?? ""),
    lines: Array.isArray(parsed.lines)
      ? parsed.lines
          .map((l) => ({
            raw_text: String(l.raw_text ?? "").trim(),
            qty: Number(l.qty) > 0 ? Number(l.qty) : 1,
            rate: Number(l.rate) > 0 ? Number(l.rate) : 0,
            unit: String(l.unit ?? "").trim(),
          }))
          .filter((l) => l.raw_text.length > 0)
      : [],
  };
}

const STOP_WORDS = new Set(["FOR", "AND", "THE", "PCS", "NOS", "SET", "DOZ", "BOX", "QTY"]);

function normalise(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s: string): string[] {
  return normalise(s)
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function trim(sku: Sku): SkuCandidate {
  return {
    id: sku.id,
    sku_code: sku.sku_code,
    name: sku.name,
    unit: sku.unit,
    price: Number(sku.price) || 0,
    selling_price: Number(sku.selling_price) || Number(sku.price) || 0,
  };
}

/** Rank the SKU master against one raw line by token overlap. */
function matchLine(raw: string, skus: Array<{ sku: Sku; hay: string }>): {
  candidates: SkuCandidate[];
  best: SkuCandidate | null;
  confidence: MatchConfidence;
} {
  const rawToks = tokens(raw);
  if (rawToks.length === 0) return { candidates: [], best: null, confidence: "none" };

  const scored = skus
    .map(({ sku, hay }) => {
      let matched = 0;
      for (const t of rawToks) if (hay.includes(t)) matched++;
      const ratio = matched / rawToks.length;
      // Prefer more specific (shorter) names when the ratio ties.
      const score = ratio - Math.min(hay.length, 120) / 100000;
      return { sku, matched, ratio, score };
    })
    .filter((r) => r.matched > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const candidates = scored.map((r) => trim(r.sku));
  const top = scored[0];
  if (!top) return { candidates: [], best: null, confidence: "none" };

  const confidence: MatchConfidence =
    top.ratio >= 0.75 ? "high" : top.ratio >= 0.5 ? "medium" : "low";
  // Only pre-fill the SKU when we're at least moderately sure; weak guesses are
  // left unmatched so staff must pick (matches the "always verified" choice).
  const best = top.ratio >= 0.5 ? trim(top.sku) : null;
  return { candidates, best, confidence };
}

function matchCustomer(hint: string, customers: Customer[]): {
  id: number | null;
  candidates: Array<{ id: number; code: string; name: string }>;
} {
  const list = customers.map((c) => ({ id: c.id, code: c.code, name: c.name }));
  const hintToks = tokens(hint);
  if (hintToks.length === 0) return { id: null, candidates: list };

  const scored = customers
    .map((c) => {
      const hay = normalise(`${c.name} ${c.code}`);
      const matched = hintToks.filter((t) => hay.includes(t)).length;
      return { c, matched };
    })
    .filter((r) => r.matched > 0)
    .sort((a, b) => b.matched - a.matched);

  const ranked = scored.map((r) => ({ id: r.c.id, code: r.c.code, name: r.c.name }));
  const rest = list.filter((c) => !ranked.some((r) => r.id === c.id));
  return { id: scored[0]?.c.id ?? null, candidates: [...ranked, ...rest] };
}

/** Full pipeline: read the slip, then match everything against the live masters. */
export async function decodeSalesImage(imageBase64: string, mediaType: string): Promise<DraftOrder> {
  const vision = await readSlip(imageBase64, mediaType);

  const [skus, customers] = await Promise.all([getSkus(), getCustomers()]);
  const haystacks = skus.map((sku) => ({ sku, hay: normalise(`${sku.name} ${sku.sku_code}`) }));

  const lines: DraftLine[] = vision.lines.map((l) => {
    const m = matchLine(l.raw_text, haystacks);
    const rate = l.rate > 0 ? l.rate : m.best?.selling_price ?? 0;
    return {
      raw_text: l.raw_text,
      qty: l.qty,
      rate,
      unit: l.unit || m.best?.unit || "",
      sku_id: m.best?.id ?? null,
      suggested: m.best,
      candidates: m.candidates,
      confidence: m.confidence,
    };
  });

  const cust = matchCustomer(vision.customer_hint, customers);

  return {
    customer_hint: vision.customer_hint,
    customer_id: cust.id,
    customer_candidates: cust.candidates,
    order_date: vision.order_date,
    notes: vision.notes,
    lines,
  };
}

/** One parsed line from an uploaded Excel/CSV sales order (before matching). */
export interface SalesFileLine { itemCode: string; raw_text: string; qty: number; rate: number; unit: string }

/**
 * Structured-file equivalent of decodeSalesImage — no AI/vision. Each line is
 * matched by EXACT item code first (sku_code / barcode_code, high confidence),
 * falling back to the same token-overlap matcher on the description. Returns the
 * same DraftOrder the verify screen already renders.
 */
export async function decodeSalesRows(fileRows: SalesFileLine[], customerHint: string): Promise<DraftOrder> {
  const [skus, customers] = await Promise.all([getSkus(), getCustomers()]);
  const haystacks = skus.map((sku) => ({ sku, hay: normalise(`${sku.name} ${sku.sku_code}`) }));
  const byCode = new Map<string, Sku>();
  for (const s of skus) {
    if (s.sku_code) byCode.set(normalise(s.sku_code), s);
    const bc = (s as { barcode_code?: string }).barcode_code;
    if (bc) byCode.set(normalise(bc), s);
  }

  const lines: DraftLine[] = fileRows.map((l) => {
    const exact = l.itemCode ? byCode.get(normalise(l.itemCode)) : undefined;
    if (exact) {
      const c = trim(exact);
      return {
        raw_text: l.raw_text || l.itemCode, qty: l.qty, rate: l.rate > 0 ? l.rate : c.selling_price,
        unit: l.unit || c.unit, sku_id: c.id, suggested: c, candidates: [c], confidence: "high" as MatchConfidence,
      };
    }
    const m = matchLine(l.raw_text || l.itemCode, haystacks);
    return {
      raw_text: l.raw_text || l.itemCode, qty: l.qty, rate: l.rate > 0 ? l.rate : (m.best?.selling_price ?? 0),
      unit: l.unit || m.best?.unit || "", sku_id: m.best?.id ?? null, suggested: m.best, candidates: m.candidates, confidence: m.confidence,
    };
  });

  const cust = matchCustomer(customerHint, customers);
  return { customer_hint: customerHint, customer_id: cust.id, customer_candidates: cust.candidates, order_date: "", notes: "", lines };
}
